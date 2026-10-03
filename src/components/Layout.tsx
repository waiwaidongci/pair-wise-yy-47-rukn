import { useEffect, useReducer, useState } from 'react'
import { NavLink, Outlet, useLocation } from 'react-router-dom'
import { Badge, Button, Drawer, Layout, Menu, Popover, Space, Switch, Tag, Typography } from 'antd'
import {
  AppstoreOutlined,
  AuditOutlined,
  BarsOutlined,
  CloudServerOutlined,
  DiffOutlined,
  FileDoneOutlined,
  MenuOutlined,
  ThunderboltOutlined,
  WarningOutlined,
} from '@ant-design/icons'
import { useConflicts } from '../api/useIssues'
import { invalidateLedger } from '../api/client'
import { useWorkspaceStore } from '../store/useWorkspaceStore'
import { isOffline, retryAllOutbox, setOffline, subscribe, subscribeOutbox, getOutbox, removeOutboxEntry } from '../api/offline'
import { openConflicts } from '../api/selectors'

function useSyncTick() {
  const [, force] = useReducer((x: number) => x + 1, 0)
  useEffect(() => subscribe(force), [])
  useEffect(() => subscribeOutbox(force), [])
}

function SyncCard({ compact = false }: { compact?: boolean }) {
  useSyncTick()
  const [retrying, setRetrying] = useState(false)
  const outbox = getOutbox()
  const offlineNow = isOffline()

  const retryAll = async () => {
    setRetrying(true)
    try {
      await retryAllOutbox()
      invalidateLedger()
    } catch {
      // 仍有失败项，保留在队列中
    } finally {
      setRetrying(false)
    }
  }

  const queuePanel = (
    <div style={{ width: 260 }}>
      <Typography.Text strong>断网待同步（{outbox.length}）</Typography.Text>
      <Typography.Paragraph type="secondary" style={{ fontSize: 12, margin: '6px 0' }}>
        恢复网络后按首次操作号重试，服务器回放首次结果，不重复追加复测记录。
      </Typography.Paragraph>
      {outbox.map((entry) => (
        <div key={entry.opId} style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center', padding: '6px 0', borderBottom: '1px solid #f0f0f0' }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 12 }}>{entry.label ?? entry.key}</div>
            <Typography.Text type="secondary" style={{ fontSize: 11 }}>{entry.key} · {entry.opId.slice(0, 8)} · rev {entry.baseRev}</Typography.Text>
          </div>
          <Button size="small" type="link" danger onClick={() => removeOutboxEntry(entry.opId)}>移除</Button>
        </div>
      ))}
      <Button size="small" type="primary" block disabled={offlineNow} loading={retrying} onClick={retryAll} style={{ marginTop: 8 }}>
        恢复网络并重试全部
      </Button>
    </div>
  )

  return (
    <div className="sync-card">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <Tag color={offlineNow ? 'error' : 'success'}>{offlineNow ? '已断网' : '正常'}</Tag>
        <Switch size="small" checkedChildren="断网" unCheckedChildren="在线" checked={offlineNow} onChange={setOffline} />
      </div>
      <strong>规则库 2026.09</strong>
      {compact ? (
        <Popover content={queuePanel} trigger="click" placement="topRight">
          <Button size="small" danger={outbox.length > 0} type={outbox.length ? 'primary' : 'default'} icon={<ThunderboltOutlined />}>
            待同步 {outbox.length}
          </Button>
        </Popover>
      ) : (
        <>
          <span>最后同步 16:42</span>
          {outbox.length > 0 && (
            <Popover content={queuePanel} trigger="click">
              <Button size="small" danger type="primary" icon={<ThunderboltOutlined />} style={{ marginTop: 4 }}>
                {outbox.length} 条写入待同步，点击重试
              </Button>
            </Popover>
          )}
        </>
      )}
    </div>
  )
}

export default function AppLayout() {
  useConflicts()
  const conflicts = useWorkspaceStore((state) => state.conflicts)
  const pendingCount = openConflicts(conflicts).length
  const [open, setOpen] = useState(false)
  const location = useLocation()

  const items = [
    { key: '/', icon: <AppstoreOutlined />, label: <NavLink to="/">整改总览</NavLink> },
    { key: '/issues', icon: <BarsOutlined />, label: <NavLink to="/issues">问题台账</NavLink> },
    { key: '/retest', icon: <AuditOutlined />, label: <NavLink to="/retest">复测工作台</NavLink> },
    {
      key: '/conflicts',
      icon: <WarningOutlined />,
      label: (
        <NavLink to="/conflicts" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          冲突待处理
          {pendingCount > 0 && <Badge count={pendingCount} size="small" style={{ backgroundColor: '#b84f32' }} />}
        </NavLink>
      ),
    },
    { key: '/versions', icon: <DiffOutlined />, label: <NavLink to="/versions">版本差异</NavLink> },
    { key: '/report', icon: <FileDoneOutlined />, label: <NavLink to="/report">整改报告</NavLink> },
  ]

  const sidebar = (
    <div className="sidebar-inner">
      <div className="brand">
        <div className="brand-mark"><AuditOutlined /></div>
        <div><strong>无障碍整改中心</strong><small>企业数字体验治理</small></div>
      </div>
      <Menu mode="inline" theme="dark" items={items} selectedKeys={[location.pathname]} onClick={() => setOpen(false)} />
      <SyncCard />
    </div>
  )

  return (
    <Layout className="shell">
      <Layout.Sider width={242} className="desktop-sider">{sidebar}</Layout.Sider>
      <Drawer placement="left" open={open} onClose={() => setOpen(false)} width={250} styles={{ body: { padding: 0, background: '#15313d' } }}>{sidebar}</Drawer>
      <Layout>
        <Layout.Header className="mobile-header">
          <Button type="text" icon={<MenuOutlined />} onClick={() => setOpen(true)} />
          <Typography.Text strong>无障碍整改中心</Typography.Text>
          <Space size={4}>
            <Badge count={pendingCount} size="small">
              <NavLink to="/conflicts"><CloudServerOutlined style={{ color: '#cfe5e8', fontSize: 18 }} /></NavLink>
            </Badge>
            <SyncCard compact />
          </Space>
        </Layout.Header>
        <Layout.Content><Outlet /></Layout.Content>
      </Layout>
    </Layout>
  )
}
