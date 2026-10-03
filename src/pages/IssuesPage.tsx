import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import axios from 'axios'
import {
  Button,
  DatePicker,
  Drawer,
  Form,
  Input,
  Modal,
  Select,
  Space,
  Table,
  Tag,
  Typography,
  message,
} from 'antd'
import type { ColumnsType } from 'antd/es/table'
import { FilterOutlined, MergeCellsOutlined, SaveOutlined, TeamOutlined, EditOutlined, WarningOutlined } from '@ant-design/icons'
import { useIssues } from '../api/useIssues'
import { invalidateLedger } from '../api/client'
import { newOpId, submitChange } from '../api/offline'
import { useWorkspaceStore } from '../store/useWorkspaceStore'
import type { Issue, IssuePatch, IssueStatus } from '../api/types'
import { conflictedKeys } from '../api/selectors'

const impactColor: Record<string, string> = { 致命: 'red', 严重: 'volcano', 中等: 'gold', 轻微: 'blue' }
const statusColor: Record<string, string> = { 待分配: 'default', 修复中: 'processing', 待复测: 'orange', 已通过: 'success', 已退回: 'error', 不适用: 'default' }
const STATUS_OPTIONS: IssueStatus[] = ['待分配', '修复中', '待复测', '已通过', '已退回', '不适用']

export default function IssuesPage() {
  useIssues()
  const navigate = useNavigate()
  const issues = useWorkspaceStore((state) => state.issues)
  const selectedKeys = useWorkspaceStore((state) => state.selectedKeys)
  const setSelectedKeys = useWorkspaceStore((state) => state.setSelectedKeys)
  const savedFilters = useWorkspaceStore((state) => state.savedFilters)
  const saveFilter = useWorkspaceStore((state) => state.saveFilter)
  const removeFilter = useWorkspaceStore((state) => state.removeFilter)
  const mergeIssues = useWorkspaceStore((state) => state.mergeIssues)
  const conflicts = useWorkspaceStore((state) => state.conflicts)
  const blocked = conflictedKeys(conflicts)
  const [filters, setFilters] = useState({ query: '', site: '', status: '', priority: '' })
  const [detail, setDetail] = useState<Issue | null>(null)
  const [assignOpen, setAssignOpen] = useState(false)
  const [mergeOpen, setMergeOpen] = useState(false)
  const [editTarget, setEditTarget] = useState<Issue | null>(null)
  const [editSaving, setEditSaving] = useState(false)
  const [form] = Form.useForm()
  const [editForm] = Form.useForm()

  const data = useMemo(
    () =>
      issues.filter(
        (issue) =>
          (!filters.query || `${issue.key}${issue.title}${issue.rootCause}`.toLowerCase().includes(filters.query.toLowerCase())) &&
          (!filters.site || issue.site === filters.site) &&
          (!filters.status || issue.status === filters.status) &&
          (!filters.priority || issue.priority === filters.priority),
      ),
    [issues, filters],
  )

  const columns: ColumnsType<Issue> = [
    {
      title: '问题',
      dataIndex: 'title',
      width: 290,
      render: (_, record) => (
        <div><Typography.Text strong>{record.key}</Typography.Text><div>{record.title}</div><Typography.Text type="secondary" style={{ fontSize: 11 }}>{record.wcag.join(' / ')}</Typography.Text></div>
      ),
    },
    { title: '站点 / 版本', dataIndex: 'site', width: 130, render: (_, record) => <div>{record.site}<br /><Typography.Text type="secondary">{record.version}</Typography.Text></div> },
    { title: '影响', dataIndex: 'impact', width: 86, render: (value) => <Tag color={impactColor[value]}>{value}</Tag> },
    { title: '根因', dataIndex: 'rootCause', width: 220, render: (value) => <span className="root-cause" title={value}>{value}</span> },
    { title: '优先级', dataIndex: 'priority', width: 76, render: (value) => <Tag>{value}</Tag> },
    { title: '团队 / 负责人', dataIndex: 'team', width: 160, render: (_, record) => <div>{record.team}<br /><Typography.Text type="secondary">{record.owner}</Typography.Text></div> },
    { title: '状态', dataIndex: 'status', width: 110, render: (value, record) => (
      <Space size={4} wrap>
        <Tag color={statusColor[value]}>{value}</Tag>
        {blocked.has(record.key) && <Tag color="error" icon={<WarningOutlined />}>冲突</Tag>}
      </Space>
    ) },
    { title: '截止', dataIndex: 'dueDate', width: 105 },
    { title: '', width: 76, fixed: 'right', render: (_, record) => <Button type="link" onClick={() => setDetail(record)}>详情</Button> },
  ]

  const applyFilter = () => {
    const input = window.prompt('筛选方案名称')
    if (input?.trim()) {
      saveFilter({ name: input.trim(), ...filters })
      message.success('筛选条件已保存')
    }
  }

  const submitEdit = async (values: IssuePatch) => {
    if (!editTarget) return
    const opId = newOpId()
    const label = `编辑 ${editTarget.key} 的团队/负责人/状态`
    setEditSaving(true)
    try {
      const data = await submitChange({ key: editTarget.key, opId, baseRev: editTarget.rev, patch: values, label })
      if (data.replay) message.success(`沿用操作号 ${opId.slice(0, 8)} 的首次结果，未重复写入`)
      else message.success(`已按操作号 ${opId.slice(0, 8)} 写入，问题版本更新为 rev ${data.rev}`)
      setEditTarget(null)
      invalidateLedger()
    } catch (error) {
      if (axios.isAxiosError(error) && error.response?.status === 409) {
        message.error('提交基于旧版本，已转入冲突待处理，请逐字段采用')
        setEditTarget(null)
        invalidateLedger()
      } else if (axios.isAxiosError(error) && error.response?.status === 428) {
        message.warning(error.response.data?.message ?? '请携带问题版本号后重新提交')
      } else {
        message.warning(`网络不可用，修改已按操作号 ${opId.slice(0, 8)} 放入待同步队列，恢复后可重试`)
        setEditTarget(null)
      }
    } finally {
      setEditSaving(false)
    }
  }

  return (
    <section className="page">
      <div className="page-head">
        <div>
          <p className="eyebrow">ISSUE LEDGER / 问题台账</p>
          <h1>问题流转与批量处理</h1>
          <p className="muted">筛选条件可复用；选择多条问题后可合并同根因项或批量指派。</p>
        </div>
        <Space>
          <Button icon={<MergeCellsOutlined />} disabled={selectedKeys.length < 2} onClick={() => setMergeOpen(true)}>合并重复问题</Button>
          <Button type="primary" icon={<TeamOutlined />} disabled={!selectedKeys.length} onClick={() => setAssignOpen(true)}>批量分配</Button>
        </Space>
      </div>

      <div className="toolbar panel">
        <Input.Search placeholder="搜索编号、标题或根因" allowClear style={{ width: 270 }} value={filters.query} onChange={(event) => setFilters({ ...filters, query: event.target.value })} />
        <Select placeholder="站点" allowClear style={{ width: 130 }} value={filters.site || undefined} onChange={(value) => setFilters({ ...filters, site: value ?? '' })} options={[...new Set(issues.map((item) => item.site))].map((value) => ({ value }))} />
        <Select placeholder="状态" allowClear style={{ width: 120 }} value={filters.status || undefined} onChange={(value) => setFilters({ ...filters, status: value ?? '' })} options={['待分配', '修复中', '待复测', '已通过', '已退回', '不适用'].map((value) => ({ value }))} />
        <Select placeholder="优先级" allowClear style={{ width: 110 }} value={filters.priority || undefined} onChange={(value) => setFilters({ ...filters, priority: value ?? '' })} options={['P0', 'P1', 'P2', 'P3'].map((value) => ({ value }))} />
        <Button icon={<SaveOutlined />} onClick={applyFilter}>保存筛选</Button>
        <span className="spacer" />
        <Typography.Text type="secondary">已选 {selectedKeys.length} 条 · 共 {data.length} 条{blocked.size > 0 ? ` · ${blocked.size} 条冲突待处理（不计入正式统计）` : ''}</Typography.Text>
      </div>

      {blocked.size > 0 && (
        <div className="conflict-banner">
          <WarningOutlined />
          <Typography.Text strong>{blocked.size} 条问题存在并发修改冲突</Typography.Text>
          <Typography.Text type="secondary">晚到提交已挂起，团队 / 状态 / 复测记录尚未被覆盖</Typography.Text>
          <a href="#conflict" onClick={(event) => { event.preventDefault(); navigate('/conflicts') }}>前往逐字段处理 →</a>
        </div>
      )}

      <div className="panel">
        <div className="saved-filters">
          <FilterOutlined />
          {savedFilters.map((filter) => (
            <Tag key={filter.id} closable onClose={(event) => { event.preventDefault(); removeFilter(filter.id) }} onClick={() => setFilters({ query: filter.query, site: filter.site, status: filter.status, priority: filter.priority })} style={{ cursor: 'pointer' }}>
              {filter.name}
            </Tag>
          ))}
        </div>
        <div className="table-wrap">
          <Table
            rowKey="key"
            columns={columns}
            dataSource={data}
            pagination={{ pageSize: 10, showSizeChanger: true, showTotal: (total) => `共 ${total} 条` }}
            rowSelection={{ selectedRowKeys: selectedKeys, onChange: (keys) => setSelectedKeys(keys as string[]) }}
            rowClassName={(record) => (blocked.has(record.key) ? 'row-conflicted' : '')}
            scroll={{ x: 1250 }}
          />
        </div>
      </div>

      <Drawer
        title={detail ? `${detail.key} · ${detail.title}` : ''}
        open={Boolean(detail)}
        onClose={() => setDetail(null)}
        width={560}
        extra={detail && (
          <Button
            icon={<EditOutlined />}
            onClick={() => {
              editForm.setFieldsValue({ status: detail.status, team: detail.team, owner: detail.owner })
              setEditTarget(detail)
            }}
          >
            编辑台账字段
          </Button>
        )}
      >
        {detail && (
          <Space direction="vertical" size={18} style={{ width: '100%' }}>
            <Space wrap>
              <Tag color={impactColor[detail.impact]}>{detail.impact}</Tag>
              <Tag>{detail.priority}</Tag>
              <Tag color={statusColor[detail.status]}>{detail.status}</Tag>
              {detail.rev === 0 ? (
                <Tag color="gold">旧数据 · rev 0（首次带版本号提交后生效）</Tag>
              ) : (
                <Tag color="cyan">问题版本 rev {detail.rev}</Tag>
              )}
              {blocked.has(detail.key) && <Tag color="error" icon={<WarningOutlined />}>存在冲突待处理，暂不计入正式统计</Tag>}
            </Space>
            <dl className="detail-list">
              <dt>站点版本</dt><dd>{detail.site} / {detail.version}</dd>
              <dt>WCAG</dt><dd>{detail.wcag.join('、')}</dd>
              <dt>影响范围</dt><dd>{detail.affected}</dd>
              <dt>复现条件</dt><dd>{detail.reproduction}</dd>
              <dt>证据链接</dt><dd><Typography.Link href={detail.evidence} target="_blank">{detail.evidence}</Typography.Link></dd>
              <dt>根因</dt><dd>{detail.rootCause}</dd>
              <dt>关联重复</dt><dd>{detail.mergedKeys.length ? detail.mergedKeys.join('、') : '无'}</dd>
              <dt>修复说明</dt><dd>{detail.fixNote ?? '开发尚未提交'}</dd>
              <dt>复测环境</dt><dd>{detail.retestEnv ?? '待开发提交'}</dd>
            </dl>
            <div>
              <Typography.Title level={5}>操作历史</Typography.Title>
              {detail.history.map((event, index) => <div className="timeline-item" key={index}><Typography.Text strong>{event.action}</Typography.Text><div>{event.detail}</div><Typography.Text type="secondary" style={{ fontSize: 11 }}>{event.actor} · {event.at}</Typography.Text></div>)}
            </div>
          </Space>
        )}
      </Drawer>

      <Modal title="批量分配整改项" open={assignOpen} onCancel={() => setAssignOpen(false)} onOk={() => form.submit()} okText="确认分配">
        <Form form={form} layout="vertical" onFinish={async (values) => {
          const revs = Object.fromEntries(selectedKeys.map((key) => [key, issues.find((item) => item.key === key)?.rev ?? 0]))
          const { data } = await axios.post('/api/issues/bulk-assign', {
            opId: newOpId(),
            keys: selectedKeys,
            revs,
            ...values,
            dueDate: values.dueDate.format('YYYY-MM-DD'),
          })
          if (data.conflicted > 0) message.warning(`已分配 ${data.updated} 条；${data.conflicted} 条因版本落后进入冲突待处理`)
          else message.success(`已分配 ${data.updated} 条问题`)
          setSelectedKeys([])
          setAssignOpen(false)
          invalidateLedger()
        }}>
          <Form.Item name="team" label="目标团队" rules={[{ required: true }]}><Select options={['前端基础组件组', '结算体验组', '数据可视化组', '供应链前端组'].map((value) => ({ value }))} /></Form.Item>
          <Form.Item name="owner" label="负责人" rules={[{ required: true }]}><Input placeholder="输入负责人姓名" /></Form.Item>
          <Space style={{ display: 'flex' }}>
            <Form.Item name="priority" label="优先级" rules={[{ required: true }]}><Select style={{ width: 140 }} options={['P0', 'P1', 'P2', 'P3'].map((value) => ({ value }))} /></Form.Item>
            <Form.Item name="dueDate" label="截止日期" rules={[{ required: true }]}><DatePicker /></Form.Item>
          </Space>
        </Form>
      </Modal>

      <Modal
        title={editTarget ? `编辑 ${editTarget.key} · 基于 rev ${editTarget.rev}` : ''}
        open={Boolean(editTarget)}
        onCancel={() => setEditTarget(null)}
        onOk={() => editForm.submit()}
        confirmLoading={editSaving}
        okText="带版本号提交"
      >
        <Typography.Paragraph type="secondary" style={{ fontSize: 12 }}>
          提交将携带当前问题版本号与新操作号；若期间他人已修改导致版本落后，本次提交转入冲突待处理，不会直接覆盖。
          {editTarget?.rev === 0 ? '该问题为旧数据（rev 0），本次提交即完成版本接入并生效。' : ''}
        </Typography.Paragraph>
        <Form form={editForm} layout="vertical" onFinish={submitEdit}>
          <Form.Item name="status" label="状态" rules={[{ required: true }]}>
            <Select options={STATUS_OPTIONS.map((value) => ({ value }))} />
          </Form.Item>
          <Form.Item name="team" label="团队" rules={[{ required: true }]}>
            <Select options={['前端基础组件组', '结算体验组', '数据可视化组', '供应链前端组'].map((value) => ({ value }))} />
          </Form.Item>
          <Form.Item name="owner" label="负责人" rules={[{ required: true }]}><Input /></Form.Item>
        </Form>
      </Modal>

      <Modal title="合并为同一整改项" open={mergeOpen} onCancel={() => setMergeOpen(false)} onOk={() => { mergeIssues(selectedKeys); setMergeOpen(false); message.success('问题已按根因合并，子项仍可追溯') }} okText="确认合并">
        <Typography.Paragraph>将以 <Typography.Text code>{selectedKeys[0]}</Typography.Text> 为主问题，其余 {selectedKeys.length - 1} 项保留历史并关联到该主问题。</Typography.Paragraph>
        <Space wrap>{selectedKeys.map((key) => <Tag key={key}>{key}</Tag>)}</Space>
      </Modal>
    </section>
  )
}
