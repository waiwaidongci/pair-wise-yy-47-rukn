import { useMemo, useState } from 'react'
import axios from 'axios'
import { useNavigate } from 'react-router-dom'
import { Alert, Badge, Button, Card, Empty, Radio, Segmented, Space, Table, Tag, Timeline, Typography, message } from 'antd'
import { MergeCellsOutlined, WarningOutlined } from '@ant-design/icons'
import { useConflicts, useIssues } from '../api/useIssues'
import { invalidateLedger } from '../api/client'
import { useWorkspaceStore } from '../store/useWorkspaceStore'
import { FIELD_LABELS, type Conflict, type ConflictField } from '../api/types'
import { findIssue, openConflicts } from '../api/selectors'

type Choice = 'current' | 'incoming'

function ConflictCard({ conflict, onResolved }: { conflict: Conflict; onResolved: () => void }) {
  useIssues()
  const issues = useWorkspaceStore((state) => state.issues)
  const issue = findIssue(issues, conflict.key)
  const [resolution, setResolution] = useState<Record<string, Choice>>(() =>
    Object.fromEntries(conflict.fields.map((item) => [item.field, 'incoming' as Choice])),
  )
  const [submitting, setSubmitting] = useState(false)

  const choose = (field: ConflictField, value: Choice) => setResolution((current) => ({ ...current, [field]: value }))

  const submit = async () => {
    if (conflict.fields.some((item) => !resolution[item.field])) {
      message.warning('请逐字段选择采用「当前值」或「本次值」')
      return
    }
    setSubmitting(true)
    try {
      // 按原操作号写入：服务器解决后该操作号即指向首次解决结果，重试不会重复追加复测记录
      const { data } = await axios.post(`/api/conflicts/${conflict.id}/resolve`, { resolution })
      message.success(`冲突已按原操作号 ${data.opId.slice(0, 8)} 解决，台账版本更新至 rev ${data.rev}`)
      invalidateLedger()
      onResolved()
    } catch (error) {
      message.error('解决失败，请检查网络后重试（原操作号保持不变）')
    } finally {
      setSubmitting(false)
    }
  }

  const currentRev = issue ? `rev ${issue.rev}` : '问题已不存在'

  return (
    <Card
      size="small"
      className="conflict-card"
      title={
        <Space wrap>
          <WarningOutlined style={{ color: '#b84f32' }} />
          <Typography.Text strong>{conflict.key}</Typography.Text>
          <Tag color={conflict.kind === '复测' ? 'orange' : 'geekblue'}>{conflict.kind}冲突</Tag>
          <Tag>提交基于 rev {conflict.baseRev}</Tag>
          <Tag color="cyan">当前 {currentRev}</Tag>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>操作号 {conflict.opId}</Typography.Text>
        </Space>
      }
      extra={<Typography.Text type="secondary" style={{ fontSize: 12 }}>{conflict.actor} · {conflict.at}</Typography.Text>}
    >
      <Table
        rowKey="field"
        size="small"
        pagination={false}
        dataSource={conflict.fields}
        columns={[
          { title: '字段', dataIndex: 'field', width: 110, render: (field: ConflictField) => <Typography.Text strong>{FIELD_LABELS[field]}</Typography.Text> },
          {
            title: '当前值（服务器）',
            dataIndex: 'current',
            render: (_, record) => (
              <div className="cell-current">
                <Typography.Text>{record.current}</Typography.Text>
                {record.currentDetail && <div className="muted" style={{ fontSize: 12 }}>{record.currentDetail}</div>}
              </div>
            ),
          },
          {
            title: '本次值（晚到提交）',
            dataIndex: 'incoming',
            render: (_, record) => (
              <div className="cell-incoming">
                <Typography.Text>{record.incoming}</Typography.Text>
                {record.incomingDetail && <div className="muted" style={{ fontSize: 12 }}>{record.incomingDetail}</div>}
              </div>
            ),
          },
          {
            title: '采用',
            width: 190,
            render: (_, record) => (
              <Radio.Group size="small" value={resolution[record.field]} onChange={(event) => choose(record.field, event.target.value)}>
                <Radio.Button value="current">当前</Radio.Button>
                <Radio.Button value="incoming">本次</Radio.Button>
              </Radio.Group>
            ),
          },
        ]}
      />
      <div style={{ marginTop: 12, display: 'flex', justifyContent: 'flex-end' }}>
        <Button type="primary" loading={submitting} onClick={submit} icon={<MergeCellsOutlined />}>
          按所选字段确认写入（沿用原操作号 {conflict.opId.slice(0, 8)}）
        </Button>
      </div>
      {issue && (
        <Typography.Text type="secondary" style={{ display: 'block', marginTop: 8, fontSize: 12 }}>
          提示：{issue.title}（{issue.site} / {issue.version}）在冲突解决前不计入正式统计。
        </Typography.Text>
      )}
    </Card>
  )
}

export default function ConflictsPage() {
  useConflicts()
  const issues = useWorkspaceStore((state) => state.issues)
  const conflicts = useWorkspaceStore((state) => state.conflicts)
  const [tab, setTab] = useState<'open' | 'resolved'>('open')
  const navigate = useNavigate()
  const [refreshTick, setRefreshTick] = useState(0)

  const open = useMemo(() => openConflicts(conflicts), [conflicts, refreshTick])
  const resolved = conflicts.filter((item) => item.resolvedAt)

  return (
    <section className="page">
      <div className="page-head">
        <div>
          <p className="eyebrow">CONFLICT QUEUE / 冲突待处理</p>
          <h1>并发修改冲突处理</h1>
          <p className="muted">版本落后的提交不会覆盖团队、状态和复测记录；逐字段对照采用后，按原操作号写入。</p>
        </div>
        <Space>
          <Badge count={open.length} showZero color="#b84f32">
            <Tag style={{ padding: '4px 12px' }}>待处理</Tag>
          </Badge>
          <Button onClick={() => navigate('/issues')}>返回问题台账</Button>
        </Space>
      </div>

      <Alert
        type={open.length ? 'warning' : 'success'}
        showIcon
        style={{ marginBottom: 14 }}
        message={
          open.length
            ? `${open.length} 项问题存在版本冲突，暂时移出正式统计口径，解决后自动恢复。`
            : '当前没有待处理冲突，台账所有问题均在正式统计口径内。'
        }
        description="断网恢复后重试沿用首次操作号；已写入的操作只回放结果，不重复追加复测记录。"
      />

      <Segmented
        options={[
          { label: `冲突待处理（${open.length}）`, value: 'open' },
          { label: `已解决（${resolved.length}）`, value: 'resolved' },
        ]}
        value={tab}
        onChange={(value) => setTab(value as 'open' | 'resolved')}
        style={{ marginBottom: 14 }}
      />

      {tab === 'open' ? (
        open.length ? (
          <Space direction="vertical" size={14} style={{ width: '100%' }}>
            {open.map((conflict) => (
              <ConflictCard key={conflict.id} conflict={conflict} onResolved={() => setRefreshTick((value) => value + 1)} />
            ))}
          </Space>
        ) : (
          <div className="panel" style={{ padding: 40 }}><Empty description="无冲突待处理" /></div>
        )
      ) : (
        <div className="panel" style={{ padding: 18 }}>
          {resolved.length === 0 ? (
            <Empty description="尚无已解决的冲突" />
          ) : (
            <Timeline
              items={resolved.map((conflict) => {
                const issue = findIssue(issues, conflict.key)
                const adopted = conflict.fields
                  .filter((item) => conflict.resolution?.[item.field] === 'incoming')
                  .map((item) => FIELD_LABELS[item.field])
                const kept = conflict.fields
                  .filter((item) => conflict.resolution?.[item.field] === 'current')
                  .map((item) => FIELD_LABELS[item.field])
                return {
                  color: 'green',
                  children: (
                    <div key={conflict.id}>
                      <Typography.Text strong>{conflict.key}</Typography.Text> <Tag>{conflict.kind}</Tag>
                      <div style={{ fontSize: 13, margin: '4px 0' }}>
                        采用本次值：{adopted.length ? adopted.join('、') : '无'} ｜ 保留当前值：{kept.length ? kept.join('、') : '无'}
                      </div>
                      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                        原操作号 {conflict.opId} · 基于 rev {conflict.baseRev} · 解决于 rev {conflict.resolvedRev}（{issue?.version ?? '-'}）· {conflict.resolvedAt}
                      </Typography.Text>
                    </div>
                  ),
                }
              })}
            />
          )}
        </div>
      )}
    </section>
  )
}
