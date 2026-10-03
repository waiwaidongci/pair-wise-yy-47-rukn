import { useMemo, useState } from 'react'
import { Alert, Button, Checkbox, Empty, Space, Table, Tag, Typography, message } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import axios from 'axios'
import { CheckCircleOutlined, ClockCircleOutlined, WarningOutlined } from '@ant-design/icons'
import { useConflicts } from '../api/useConflicts'
import { useWorkspaceStore } from '../store/useWorkspaceStore'
import type { ConflictField, ConflictRecord, Issue } from '../api/types'

async function postResolveWithRetry(
  conflictId: string,
  payload: { opNo: string; adoptedFields: string[] },
  onRetry: (attempt: number) => void,
): Promise<{ issue: Issue; conflict: ConflictRecord }> {
  let attempt = 0
  for (;;) {
    try {
      const { data } = await axios.post<{ issue: Issue; conflict: ConflictRecord }>(`/api/conflicts/${conflictId}/resolve`, payload)
      return data
    } catch (error) {
      if (axios.isAxiosError(error) && error.response?.status === 404) throw error
      attempt += 1
      if (attempt >= 3) throw error
      onRetry(attempt)
      await new Promise((resolve) => setTimeout(resolve, 800))
    }
  }
}

export default function ConflictsPage() {
  useConflicts()
  const conflicts = useWorkspaceStore((state) => state.conflicts)
  const updateIssue = useWorkspaceStore((state) => state.updateIssue)
  const markConflictResolved = useWorkspaceStore((state) => state.markConflictResolved)
  const discardConflict = useWorkspaceStore((state) => state.discardConflict)
  const resolveConflictLocal = useWorkspaceStore((state) => state.resolveConflictLocal)
  const [adoptMap, setAdoptMap] = useState<Record<string, Set<string>>>({})

  const pending = useMemo(() => conflicts.filter((item) => item.status === '待处理'), [conflicts])
  const handled = useMemo(() => conflicts.filter((item) => item.status !== '待处理'), [conflicts])

  const getAdopted = (conflict: ConflictRecord): Set<string> => {
    const existing = adoptMap[conflict.id]
    if (existing) return existing
    return new Set(conflict.fields.filter((field) => field.adopt).map((field) => field.key))
  }

  const toggleField = (conflictId: string, key: string, checked: boolean) => {
    setAdoptMap((current) => {
      const next = new Set(current[conflictId] ?? conflicts.find((item) => item.id === conflictId)?.fields.filter((field) => field.adopt).map((field) => field.key) ?? [])
      if (checked) next.add(key)
      else next.delete(key)
      return { ...current, [conflictId]: next }
    })
  }

  const resolve = async (conflict: ConflictRecord) => {
    const adopted = [...getAdopted(conflict)]
    if (!adopted.length) {
      message.warning('请至少选择一个采用字段')
      return
    }
    const opNo = conflict.opNo
    try {
      const data = await postResolveWithRetry(conflict.id, { opNo, adoptedFields: adopted }, (attempt) => {
        message.loading({ content: `网络中断，正在重试（操作号 ${opNo.slice(0, 8)}）第 ${attempt} 次`, key: 'conflict-resolve' })
      })
      updateIssue(data.issue)
      markConflictResolved(conflict.id, data.conflict)
      message.success({ content: `已按操作号 ${opNo.slice(0, 8)} 写入 ${adopted.length} 项字段`, key: 'conflict-resolve' })
    } catch (error) {
      if (axios.isAxiosError(error) && error.response?.status === 404) {
        resolveConflictLocal(conflict.id, adopted)
        message.success('服务端未留存该冲突，已在本地按原操作号写入')
      } else {
        message.error({ content: '写入失败，请稍后在网络恢复后重试', key: 'conflict-resolve' })
      }
    }
  }

  const fieldColumns = (conflictId: string): ColumnsType<ConflictField> => [
    { title: '字段', dataIndex: 'label', width: 110, render: (value) => <Typography.Text strong>{value}</Typography.Text> },
    { title: '当前值（台账）', dataIndex: 'current', render: (value) => <span style={{ color: '#9a4d35' }}>{value}</span> },
    { title: '本次值（待采用）', dataIndex: 'proposed', render: (value) => <span style={{ color: '#26705a' }}>{value}</span> },
    {
      title: '采用',
      dataIndex: 'adopt',
      width: 70,
      render: (_, record) => {
        const adopted = adoptMap[conflictId] ?? new Set(conflicts.find((item) => item.id === conflictId)?.fields.filter((field) => field.adopt).map((field) => field.key) ?? [])
        return <Checkbox checked={adopted.has(record.key)} onChange={(event) => toggleField(conflictId, record.key, event.target.checked)} />
      },
    },
  ]

  return (
    <section className="page">
      <div className="page-head">
        <div>
          <p className="eyebrow">CONFLICT PENDING / 冲突待处理</p>
          <h1>逐字段确认并发修改</h1>
          <p className="muted">两名审核员基于同一版本提交时，晚到的修改不会覆盖台账；确认后按原操作号写入，重试不重复追加记录。</p>
        </div>
        <Tag color={pending.length ? 'red' : 'green'} icon={<WarningOutlined />}>{pending.length} 项待处理</Tag>
      </div>

      {pending.length === 0 && (
        <div className="panel" style={{ padding: 32 }}>
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无冲突待处理，所有并发修改均已按版本顺序写入台账" />
        </div>
      )}

      <Space direction="vertical" size={14} style={{ width: '100%' }}>
        {pending.map((conflict) => {
          const adopted = getAdopted(conflict)
          return (
            <div className="panel" key={conflict.id}>
              <div className="panel-head">
                <Space wrap>
                  <Typography.Text strong>{conflict.issueKey}</Typography.Text>
                  <Tag color="blue">{conflict.source}</Tag>
                  <Tag>操作号 {conflict.opNo.slice(0, 8)}</Tag>
                  <Tag color="orange">v{conflict.baseVersion} → v{conflict.currentVersion}（版本落后）</Tag>
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>{conflict.actor} · {conflict.submittedAt}</Typography.Text>
                </Space>
                <Space>
                  <Button onClick={() => discardConflict(conflict.id)}>放弃</Button>
                  <Button type="primary" icon={<CheckCircleOutlined />} onClick={() => resolve(conflict)}>
                    确认采用所选（{adopted.size}）
                  </Button>
                </Space>
              </div>
              <div style={{ padding: '4px 16px 14px' }}>
                <Alert
                  type="warning"
                  showIcon
                  style={{ marginBottom: 10 }}
                  message={`该问题在你提交后已被他人更新到 v${conflict.currentVersion}，以下为当前台账值与本次提交值，请逐字段核对采用。`}
                />
                <Table
                  rowKey="key"
                  columns={fieldColumns(conflict.id)}
                  dataSource={conflict.fields}
                  pagination={false}
                  size="small"
                />
              </div>
            </div>
          )
        })}
      </Space>

      {handled.length > 0 && (
        <div className="panel" style={{ marginTop: 14 }}>
          <div className="panel-head"><h3>已处理</h3></div>
          <Table
            rowKey="id"
            pagination={false}
            dataSource={handled}
            columns={[
              { title: '问题', dataIndex: 'issueKey', width: 120, render: (value) => <Typography.Text strong>{value}</Typography.Text> },
              { title: '来源', dataIndex: 'source', width: 90 },
              { title: '操作号', dataIndex: 'opNo', width: 130, render: (value: string) => <Tag>{value.slice(0, 8)}</Tag> },
              { title: '结果', dataIndex: 'status', width: 90, render: (value: string) => <Tag color={value === '已确认' ? 'green' : 'default'} icon={value === '已确认' ? <CheckCircleOutlined /> : <ClockCircleOutlined />}>{value}</Tag> },
              { title: '处理时间', dataIndex: 'resolvedAt', width: 120, render: (value?: string) => value ?? '—' },
            ]}
          />
        </div>
      )}
    </section>
  )
}
