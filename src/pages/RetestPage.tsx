import { useState } from 'react'
import { Alert, Button, Descriptions, Form, Input, Radio, Space, Table, Tag, Typography, message } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import axios from 'axios'
import { useIssues } from '../api/useIssues'
import { invalidateLedger } from '../api/client'
import { newOpId, submitChange } from '../api/offline'
import { useWorkspaceStore } from '../store/useWorkspaceStore'
import type { Issue, RetestResult } from '../api/types'
import { conflictedKeys } from '../api/selectors'

export default function RetestPage() {
  useIssues()
  const issues = useWorkspaceStore((state) => state.issues)
  const conflicts = useWorkspaceStore((state) => state.conflicts)
  const blocked = conflictedKeys(conflicts)
  const updateIssue = useWorkspaceStore((state) => state.updateIssue)
  const queue = issues.filter((item) => ['待复测', '已退回'].includes(item.status))
  const [active, setActive] = useState<Issue | null>(queue[0] ?? null)
  const [form] = Form.useForm()
  const [submitting, setSubmitting] = useState(false)

  const submit = async (values: { result: RetestResult; note: string; environment: string }) => {
    if (!active) return
    const opId = newOpId()
    const label = `复测 ${active.key}：${values.result}`
    setSubmitting(true)
    try {
      const data = await submitChange({ key: active.key, opId, baseRev: active.rev, retest: values, label })
      if (data.replay) {
        message.success(`操作号 ${opId.slice(0, 8)} 已有首次结果，已回放（复测记录未重复追加）`)
      } else {
        message.success(`复测结果已记录：${values.result}（rev ${data.rev}）`)
      }
      updateIssue(data.issue as Issue)
      setActive(data.issue as Issue)
      form.resetFields()
      invalidateLedger()
    } catch (error) {
      if (axios.isAxiosError(error) && error.response?.status === 409) {
        message.error('该问题已被他人推进到更新版本，本次复测转入冲突待处理，请逐字段采用')
        form.resetFields()
        invalidateLedger()
      } else if (axios.isAxiosError(error) && error.response?.status === 428) {
        message.warning(error.response.data?.message ?? '请携带问题版本号后重新提交')
      } else {
        message.warning(`网络不可用，复测已按操作号 ${opId.slice(0, 8)} 进入待同步队列；恢复后重试沿用首次结果`)
        form.resetFields()
      }
    } finally {
      setSubmitting(false)
    }
  }

  const columns: ColumnsType<Issue> = [
    { title: '问题', dataIndex: 'key', render: (_, record) => <div><Typography.Text strong>{record.key}</Typography.Text><div>{record.title}</div></div> },
    { title: '修复说明', dataIndex: 'fixNote', width: 240, render: (value) => value ?? '未提交' },
    { title: '环境', dataIndex: 'retestEnv', width: 190, render: (value) => value ?? '待开发提交' },
    { title: '版本', dataIndex: 'rev', width: 84, render: (value) => <Tag color={value === 0 ? 'gold' : 'cyan'}>{value === 0 ? 'rev 0 旧' : `rev ${value}`}</Tag> },
    { title: '状态', dataIndex: 'status', width: 120, render: (value, record) => (
      <Space size={4} wrap>
        <Tag color={value === '已退回' ? 'error' : 'orange'}>{value}</Tag>
        {blocked.has(record.key) && <Tag color="error">冲突</Tag>}
      </Space>
    ) },
  ]

  return (
    <section className="page">
      <div className="page-head">
        <div>
          <p className="eyebrow">RETEST / 复测工作台</p>
          <h1>逐项验证修复结果</h1>
          <p className="muted">复测必须记录环境和结论；提交带问题版本号，落后版本进入冲突处理，断网重试不重复记账。</p>
        </div>
        <Tag color="orange">{queue.length} 项待复测</Tag>
      </div>

      <Alert type="info" showIcon style={{ marginBottom: 12 }} message="复测规则" description="键盘问题必须覆盖 Tab、Shift+Tab、Esc 和焦点返回；屏幕阅读器问题需保留截图或播报日志。同一操作号重试只回放首次复测结果。" />

      <div className="review-grid">
        <div className="panel">
          <div className="panel-head"><h3>复测队列</h3><span className="muted">点击选择问题</span></div>
          <Table rowKey="key" columns={columns} dataSource={queue} pagination={false} rowClassName={(record) => record.key === active?.key ? 'ant-table-row-selected' : ''} onRow={(record) => ({ onClick: () => { setActive(record); form.resetFields() } })} scroll={{ x: 820 }} />
        </div>

        <div className="panel review-box">
          <Typography.Title level={4}>{active?.key ?? '暂无可复测项'}</Typography.Title>
          {active && (
            <>
              <Space wrap style={{ marginBottom: 8 }}>
                <Tag color={active.rev === 0 ? 'gold' : 'cyan'}>{active.rev === 0 ? '旧数据 rev 0（提交即接入版本）' : `问题版本 rev ${active.rev}`}</Tag>
                {blocked.has(active.key) && <Tag color="error">存在冲突待处理，复测记录暂停写入统计</Tag>}
              </Space>
              <Descriptions size="small" column={1} bordered>
                <Descriptions.Item label="问题">{active.title}</Descriptions.Item>
                <Descriptions.Item label="根因">{active.rootCause}</Descriptions.Item>
                <Descriptions.Item label="修复说明">{active.fixNote ?? '未提交'}</Descriptions.Item>
                <Descriptions.Item label="复测环境">{active.retestEnv ?? '待开发提交'}</Descriptions.Item>
              </Descriptions>
              <Form form={form} layout="vertical" style={{ marginTop: 18 }} onFinish={submit} initialValues={{ result: '已通过' }}>
                <Form.Item name="result" label="复测结论" rules={[{ required: true }]}>
                  <Radio.Group><Radio.Button value="已通过">通过</Radio.Button><Radio.Button value="已退回">退回</Radio.Button><Radio.Button value="不适用">不适用</Radio.Button></Radio.Group>
                </Form.Item>
                <Form.Item name="environment" label="本次复测环境" rules={[{ required: true }]}><Input placeholder="浏览器 / 辅助技术 / 版本号" /></Form.Item>
                <Form.Item name="note" label="复测记录" rules={[{ required: true, message: '请填写可验证的复测记录' }]}><Input.TextArea rows={5} placeholder="记录实际操作、结果与证据位置" /></Form.Item>
                <Button type="primary" htmlType="submit" block loading={submitting}>提交复测记录（携带 rev {active.rev}）</Button>
              </Form>
              <Typography.Title level={5} style={{ marginTop: 20 }}>历史复测</Typography.Title>
              {active.retestRecords.length === 0 && <Typography.Text type="secondary">暂无历史记录</Typography.Text>}
              {active.retestRecords.map((record) => (
                <div className="timeline-item" key={record.id}>
                  <Tag color={record.result.includes('通过') ? 'success' : record.result.includes('退回') ? 'error' : 'default'}>{record.result}</Tag>                  <Typography.Text strong>{record.actor}</Typography.Text>
                  <div>{record.note}</div>
                  <Typography.Text type="secondary" style={{ fontSize: 11 }}>{record.at}</Typography.Text>
                </div>
              ))}
            </>
          )}
        </div>
      </div>
    </section>
  )
}
