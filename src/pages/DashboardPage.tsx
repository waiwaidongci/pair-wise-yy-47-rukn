import { Button, Progress, Space, Tag, Typography } from 'antd'
import { ArrowRightOutlined, CheckCircleOutlined, ClockCircleOutlined, ExclamationCircleOutlined, WarningOutlined } from '@ant-design/icons'
import { useNavigate } from 'react-router-dom'
import { useConflicts, useIssues } from '../api/useIssues'
import { useWorkspaceStore } from '../store/useWorkspaceStore'
import { conflictedKeys, officialIssues, openConflicts } from '../api/selectors'

export default function DashboardPage() {
  useIssues()
  useConflicts()
  const issues = useWorkspaceStore((state) => state.issues)
  const conflicts = useWorkspaceStore((state) => state.conflicts)
  const navigate = useNavigate()

  const pendingConflicts = openConflicts(conflicts)
  const blocked = conflictedKeys(conflicts)
  // 正式统计只认未冲突台账
  const ledger = officialIssues(issues, conflicts)

  const open = ledger.filter((item) => !['已通过', '不适用'].includes(item.status))
  const passed = ledger.filter((item) => item.status === '已通过').length
  const critical = ledger.filter((item) => item.impact === '致命' || item.impact === '严重').length
  const coverage = ledger.length ? Math.round((passed / ledger.length) * 100) : 0
  const bySite = Array.from(new Set(ledger.map((item) => item.site))).map((site) => {
    const items = ledger.filter((issue) => issue.site === site)
    return { site, total: items.length, passed: items.filter((item) => item.status === '已通过').length }
  })

  return (
    <section className="page">
      <div className="page-head">
        <div>
          <p className="eyebrow">ACCESSIBILITY PROGRAM / 无障碍治理</p>
          <h1>多站点整改总览</h1>
          <p className="muted">按风险、版本和团队持续跟踪 WCAG 问题；正式统计口径不含冲突待处理项。</p>
        </div>
        <Space>
          <Button onClick={() => navigate('/versions')}>查看版本差异</Button>
          <Button type="primary" onClick={() => navigate('/issues')}>进入问题台账 <ArrowRightOutlined /></Button>
        </Space>
      </div>

      {pendingConflicts.length > 0 && (
        <div className="conflict-banner panel" style={{ marginBottom: 14 }}>
          <WarningOutlined style={{ fontSize: 18, color: '#b84f32' }} />
          <Typography.Text strong>{pendingConflicts.length} 个冲突待处理</Typography.Text>
          <Typography.Text type="secondary">涉及 {blocked.size} 条问题（{Array.from(blocked).join('、')}），已暂时移出下方正式统计，解决后自动恢复</Typography.Text>
          <Button size="small" danger type="primary" onClick={() => navigate('/conflicts')}>逐字段处理</Button>
        </div>
      )}

      <div className="metric-grid">
        <div className="metric-card"><span>开放问题</span><strong>{open.length}</strong><small>{ledger.length} 条未冲突台账{pendingConflicts.length ? ` · ${blocked.size} 条待处理` : ''}</small></div>
        <div className="metric-card"><span>严重 / 致命</span><strong style={{ color: '#b84f32' }}>{critical}</strong><small>需优先排期</small></div>
        <div className="metric-card">
          <span>复测通过率</span><strong>{coverage}%</strong>
          <small>未冲突口径{issues.length !== ledger.length ? `（排除 ${issues.length - ledger.length} 条）` : ''}</small>
        </div>
        <div className="metric-card">
          <span>冲突待处理</span>
          <strong style={{ color: pendingConflicts.length ? '#b84f32' : '#26705a' }}>{pendingConflicts.length}</strong>
          <small>
            {pendingConflicts.length
              ? <a href="#conflicts" onClick={(event) => { event.preventDefault(); navigate('/conflicts') }}>前往处理 →</a>
              : '台账一致，无并发覆盖'}
          </small>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1.2fr) minmax(300px,.8fr)', gap: 14 }}>
        <div className="panel">
          <div className="panel-head"><h3>站点整改进度</h3><Tag color="blue">仅统计未冲突台账</Tag></div>
          <div style={{ padding: 18 }}>
            {bySite.map((item) => (
              <div key={item.site} style={{ marginBottom: 20 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 7 }}>
                  <Typography.Text strong>{item.site}</Typography.Text>
                  <Typography.Text type="secondary">{item.passed}/{item.total} 已通过</Typography.Text>
                </div>
                <Progress percent={item.total ? Math.round((item.passed / item.total) * 100) : 0} showInfo={false} strokeColor="#257c80" />
              </div>
            ))}
          </div>
        </div>

        <div className="panel">
          <div className="panel-head"><h3>处理关注</h3><span className="muted">智能排序</span></div>
          <div style={{ padding: 12 }}>
            {[
              pendingConflicts.length
                ? { icon: <WarningOutlined />, tone: '#ba4d31', title: `${pendingConflicts.length} 个并发冲突待处理`, detail: `晚到的修改已挂起，涉及 ${blocked.size} 条问题的团队/状态/复测记录`, action: '处理冲突' }
                : { icon: <CheckCircleOutlined />, tone: '#367d61', title: '无版本冲突', detail: '所有提交均带版本号，台账字段未被晚到修改覆盖', action: '查看台账' },
              { icon: <ExclamationCircleOutlined />, tone: '#ba4d31', title: 'P0 键盘陷阱', detail: 'A11Y-1048 已修复但尚未提交复测', action: '前往复测' },
              { icon: <ClockCircleOutlined />, tone: '#ba8529', title: '2 项临近截止', detail: '未来 3 天内到期，涉及基础组件组', action: '查看排期' },
            ].map((item) => (
              <div key={item.title} style={{ display: 'flex', gap: 10, padding: 12, borderBottom: '1px solid #edf1f2' }}>
                <span style={{ color: item.tone, fontSize: 20 }}>{item.icon}</span>
                <div style={{ flex: 1 }}><Typography.Text strong>{item.title}</Typography.Text><Typography.Paragraph type="secondary" style={{ margin: '5px 0 0', fontSize: 12 }}>{item.detail}</Typography.Paragraph></div>
                <Button size="small" type="link" onClick={() => navigate(item.action === '处理冲突' ? '/conflicts' : item.action === '查看台账' ? '/issues' : '/retest')}>{item.action}</Button>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  )
}
