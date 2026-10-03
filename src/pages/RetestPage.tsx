import { useState } from 'react'
import { Alert, Button, Descriptions, Form, Input, Radio, Space, Switch, Table, Tag, Typography, message } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import axios from 'axios'
import { useIssues } from '../api/useIssues'
import { useWorkspaceStore } from '../store/useWorkspaceStore'
import type { ConflictRecord, Issue } from '../api/types'

type ReviewResult = { issue?: Issue; conflict?: ConflictRecord }

/** 断网/5xx 自动重试：同一操作号沿用首次结果，不重复追加复测记录 */
async function postReviewWithRetry(
  key: string,
  payload: { result: string; note: string; environment: string; opNo: string; baseVersion: number },
  onRetry: (attempt: number) => void,
): Promise<ReviewResult> {
  let attempt = 0
  for (;;) {
    try {
      const { data } = await axios.post<Issue | { conflict: ConflictRecord }>(`/api/issues/${key}/review`, payload)
      if ('conflict' in data) return { conflict: data.conflict }
      return { issue: data }
    } catch (error) {
      if (axios.isAxiosError(error) && error.response?.status === 409) {
        return { conflict: (error.response.data as { conflict: ConflictRecord }).conflict }
      }
      attempt += 1
      if (attempt >= 3) throw error
      onRetry(attempt)
      await new Promise((resolve) => setTimeout(resolve, 800))
    }
  }
}

export default function RetestPage() {
  useIssues()
  const issues = useWorkspaceStore((state) => state.issues)
  const updateIssue = useWorkspaceStore((state) => state.updateIssue)
  const addConflicts = useWorkspaceStore((state) => state.addConflicts)
  const queue = issues.filter((item) => ['待复测', '已退回'].includes(item.status))
  const [active, setActive] = useState<Issue | null>(queue[0] ?? null)
  const [retrying, setRetrying] = useState(false)
  const [armFailure, setArmFailure] = useState(false)
  const [form] = Form.useForm()

  const submit = async (values: { result: '已通过' | '已退回' | '不适用'; note: string; environment: string }) => {
    if (!active) return
    const opNo = crypto.randomUUID()
    const payload = { ...values, opNo, baseVersion: active.version }
    const hide = message.loading({ content: '提交复测记录…', key: 'review-submit' })
    try {
      const result = await postReviewWithRetry(active.key, payload, (attempt) => {
        setRetrying(true)
        message.loading({ content: `网络中断，正在重试（操作号 ${opNo.slice(0, 8)}）第 ${attempt} 次`, key: 'review-submit' })
      })
      setRetrying(false)
      if (result.conflict) {
        addConflicts([result.conflict])
        message.warning({
          content: `版本落后（v${active.version} → v${result.conflict.currentVersion}），本次修改已进入冲突待处理`,
          key: 'review-submit',
          duration: 5,
        })
        return
      }
      if (result.issue) {
        updateIssue(result.issue)
        setActive(result.issue)
      }
      form.resetFields()
      message.success({ content: `复测结果已记录：${values.result}（操作号 ${opNo.slice(0, 8)}，重试沿用首次结果）`, key: 'review-submit' })
    } catch {
      setRetrying(false)
      message.error({ content: '提交失败，请稍后在网络恢复后重试', key: 'review-submit' })
    }
  }

  const toggleArmFailure = async (checked: boolean) => {
    setArmFailure(checked)
    if (checked) {
      await axios.post('/api/dev/arm-failure')
      message.info('已模拟断网：下次写操作将在处理后丢失响应，重试时按操作号幂等返回')
    }
  }

  const columns: ColumnsType<Issue> = [
    { title: '问题', dataIndex: 'key', render: (_, record) => <div><Typography.Text strong>{record.key}</Typography.Text><div>{record.title}</div></div> },
    { title: '修复说明', dataIndex: 'fixNote', width: 260, render: (value) => value ?? '未提交' },
    { title: '环境', dataIndex: 'retestEnv', width: 200, render: (value) => value ?? '待开发提交' },
    { title: '状态', dataIndex: 'status', width: 90, render: (value) => <Tag color={value === '已退回' ? 'error' : 'orange'}>{value}</Tag> },
  ]

  return (
    <section className="page">
      <div className="page-head">
        <div>
          <p className="eyebrow">RETEST / 复测工作台</p>
          <h1>逐项验证修复结果</h1>
          <p className="muted">复测必须记录环境和结论；退回的问题不可无痕跳过。</p>
        </div>
        <Space>
          <Tag color="orange">{queue.length} 项待复测</Tag>
          <Switch checked={armFailure} onChange={toggleArmFailure} checkedChildren="模拟断网" unCheckedChildren="模拟断网" />
        </Space>
      </div>

      <Alert type="info" showIcon style={{ marginBottom: 12 }} message="复测规则" description="键盘问题必须覆盖 Tab、Shift+Tab、Esc 和焦点返回；屏幕阅读器问题需保留截图或播报日志。" />
      <Alert type="warning" showIcon style={{ marginBottom: 12 }} message="并发与重试" description="提交携带问题版本号与操作号：版本落后会进入冲突待处理；断网重试沿用首次结果，复测记录不会重复追加。" />

      <div className="review-grid">
        <div className="panel">
          <div className="panel-head"><h3>复测队列</h3><span className="muted">点击选择问题</span></div>
          <Table rowKey="key" columns={columns} dataSource={queue} pagination={false} rowClassName={(record) => record.key === active?.key ? 'ant-table-row-selected' : ''} onRow={(record) => ({ onClick: () => { setActive(record); form.resetFields() } })} scroll={{ x: 760 }} />
        </div>

        <div className="panel review-box">
          <Typography.Title level={4}>{active?.key ?? '暂无可复测项'}</Typography.Title>
          {active && (
            <>
              <Descriptions size="small" column={1} bordered>
                <Descriptions.Item label="问题">{active.title}</Descriptions.Item>
                <Descriptions.Item label="根因">{active.rootCause}</Descriptions.Item>
                <Descriptions.Item label="修复说明">{active.fixNote ?? '未提交'}</Descriptions.Item>
                <Descriptions.Item label="复测环境">{active.retestEnv ?? '待开发提交'}</Descriptions.Item>
                <Descriptions.Item label="台账版本">v{active.version}</Descriptions.Item>
              </Descriptions>
              <Form form={form} layout="vertical" style={{ marginTop: 18 }} onFinish={submit} initialValues={{ result: '已通过' }}>
                <Form.Item name="result" label="复测结论" rules={[{ required: true }]}>
                  <Radio.Group><Radio.Button value="已通过">通过</Radio.Button><Radio.Button value="已退回">退回</Radio.Button><Radio.Button value="不适用">不适用</Radio.Button></Radio.Group>
                </Form.Item>
                <Form.Item name="environment" label="本次复测环境" rules={[{ required: true }]}><Input placeholder="浏览器 / 辅助技术 / 版本号" /></Form.Item>
                <Form.Item name="note" label="复测记录" rules={[{ required: true, message: '请填写可验证的复测记录' }]}><Input.TextArea rows={5} placeholder="记录实际操作、结果与证据位置" /></Form.Item>
                <Button type="primary" htmlType="submit" block loading={retrying}>提交复测记录</Button>
              </Form>
              <Typography.Title level={5} style={{ marginTop: 20 }}>历史复测</Typography.Title>
              {active.retestRecords.length === 0 && <Typography.Text type="secondary">暂无历史记录</Typography.Text>}
              {active.retestRecords.map((record) => <div className="timeline-item" key={record.id}><Tag color={record.result === '通过' ? 'success' : record.result === '退回' ? 'error' : 'default'}>{record.result}</Tag><Typography.Text strong>{record.actor}</Typography.Text>{record.opNo && <Tag style={{ marginLeft: 6}}>操作号 {record.opNo.slice(0, 8)}</Tag>}<div>{record.note}</div><Typography.Text type="secondary" style={{ fontSize: 11 }}>{record.at}</Typography.Text></div>)}
            </>
          )}
        </div>
      </div>
    </section>
  )
}
