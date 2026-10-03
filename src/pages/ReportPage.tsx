import { useState } from 'react'
import { Alert, Button, Checkbox, Select, Space, Tag, Typography, message } from 'antd'
import { DownloadOutlined, FilePdfOutlined } from '@ant-design/icons'
import { useConflicts, useIssues } from '../api/useIssues'
import { useWorkspaceStore } from '../store/useWorkspaceStore'
import { officialIssues, openConflicts } from '../api/selectors'

export default function ReportPage() {
  useIssues()
  useConflicts()
  const issues = useWorkspaceStore((state) => state.issues)
  const conflicts = useWorkspaceStore((state) => state.conflicts)
  const [site, setSite] = useState('全部站点')
  const [includeEvidence, setIncludeEvidence] = useState(true)
  const [includeHistory, setIncludeHistory] = useState(true)
  // 正式统计只认未冲突台账
  const pendingConflicts = openConflicts(conflicts)
  const ledger = officialIssues(issues, conflicts)
  const visible = ledger.filter((item) => site === '全部站点' || item.site === site)

  const exportCsv = () => {
    const rows = [
      ['编号', '站点', '版本', '问题', 'WCAG', '影响', '状态', '团队', '负责人', '截止日期'],
      ...visible.map((issue) => [issue.key, issue.site, issue.version, issue.title, issue.wcag.join(' / '), issue.impact, issue.status, issue.team, issue.owner, issue.dueDate]),
    ]
    const csv = rows.map((row) => row.map((cell) => `"${String(cell).replaceAll('"', '""')}"`).join(',')).join('\n')
    const url = URL.createObjectURL(new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8' }))
    const link = document.createElement('a')
    link.href = url
    link.download = `无障碍整改报告-${site}.csv`
    link.click()
    URL.revokeObjectURL(url)
    message.success('报告已导出')
  }

  return (
    <section className="page">
      <div className="page-head">
        <div>
          <p className="eyebrow">REPORT / 整改报告</p>
          <h1>可追溯的站点整改报告</h1>
          <p className="muted">按站点、版本和状态汇总问题，保留证据链接与流转记录。</p>
        </div>
        <Space>
          <Button icon={<DownloadOutlined />} onClick={exportCsv}>导出 CSV</Button>
          <Button type="primary" icon={<FilePdfOutlined />} onClick={() => window.print()}>打印 / PDF</Button>
        </Space>
      </div>

      {pendingConflicts.length > 0 && (
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 14 }}
          message={`${pendingConflicts.length} 个冲突待处理：相关问题已移出本次报告统计口径，解决后会自动纳入。`}
        />
      )}

      <div className="panel" style={{ padding: 12, marginBottom: 14 }}>
        <Space wrap>
          <span>报告范围</span>
          <Select value={site} onChange={setSite} style={{ width: 150 }} options={['全部站点', ...new Set(issues.map((item) => item.site))].map((value) => ({ value }))} />
          <Checkbox checked={includeEvidence} onChange={(event) => setIncludeEvidence(event.target.checked)}>包含证据链接</Checkbox>
          <Checkbox checked={includeHistory} onChange={(event) => setIncludeHistory(event.target.checked)}>包含操作历史</Checkbox>
        </Space>
      </div>

      <article className="panel report-sheet">
        <header style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '3px solid #173e4d', paddingBottom: 16 }}>
          <div><Typography.Text type="secondary">数字体验无障碍治理项目</Typography.Text><h2>网站无障碍整改报告</h2><Typography.Text>生成日期：2026-09-29 · WCAG 2.2 AA</Typography.Text></div>
          <div style={{ textAlign: 'right' }}>
            <Tag color="blue">{site}</Tag>
            <div>问题 {visible.length} 项{issues.length !== ledger.length ? <Typography.Text type="danger">（仅未冲突台账）</Typography.Text> : null}</div>
            <div>通过 {visible.filter((item) => item.status === '已通过').length} 项</div>
            {pendingConflicts.length > 0 && <div><Typography.Text type="warning">冲突待处理 {pendingConflicts.length} 个</Typography.Text></div>}
          </div>
        </header>
        <table>
          <thead><tr><th>编号</th><th>页面 / 范围</th><th>问题与 WCAG</th><th>影响</th><th>状态 / 责任</th><th>截止</th></tr></thead>
          <tbody>
            {visible.map((issue) => (
              <tr key={issue.key}>
                <td>{issue.key}</td>
                <td>{issue.site}<br /><Typography.Text type="secondary">{issue.version}</Typography.Text></td>
                <td><strong>{issue.title}</strong><br />{issue.wcag.join(' / ')}{includeEvidence && <><br /><Typography.Link href={issue.evidence}>查看证据</Typography.Link></>}</td>
                <td><Tag color={issue.impact === '致命' ? 'red' : issue.impact === '严重' ? 'volcano' : 'gold'}>{issue.impact}</Tag></td>
                <td>{issue.status}<br />{issue.team} / {issue.owner}</td>
                <td>{issue.dueDate}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {includeHistory && <div style={{ marginTop: 20 }}><Typography.Title level={5}>最近操作记录</Typography.Title>{visible.flatMap((issue) => issue.history.slice(-1).map((event) => <div className="timeline-item" key={`${issue.key}-${event.at}`}><strong>{issue.key} · {event.action}</strong><div>{event.detail}</div><span className="muted">{event.actor} · {event.at}</span></div>))}</div>}
      </article>
    </section>
  )
}
