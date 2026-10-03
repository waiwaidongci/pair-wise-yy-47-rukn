import { useState } from 'react'
import { NavLink, Outlet } from 'react-router-dom'
import { Badge, Button, Drawer, Layout, Menu, Space, Tag, Typography } from 'antd'
import {
  AppstoreOutlined,
  AuditOutlined,
  BarsOutlined,
  DiffOutlined,
  FileDoneOutlined,
  MenuOutlined,
  WarningOutlined,
} from '@ant-design/icons'
import { useWorkspaceStore } from '../store/useWorkspaceStore'

export default function AppLayout() {
  const [open, setOpen] = useState(false)
  const pendingConflicts = useWorkspaceStore((state) => state.conflicts.filter((item) => item.status === '待处理').length)
  const items = [
    { key: '/', icon: <AppstoreOutlined />, label: <NavLink to="/">整改总览</NavLink> },
    { key: '/issues', icon: <BarsOutlined />, label: <NavLink to="/issues">问题台账</NavLink> },
    { key: '/retest', icon: <AuditOutlined />, label: <NavLink to="/retest">复测工作台</NavLink> },
    { key: '/versions', icon: <DiffOutlined />, label: <NavLink to="/versions">版本差异</NavLink> },
    { key: '/report', icon: <FileDoneOutlined />, label: <NavLink to="/report">整改报告</NavLink> },
    {
      key: '/conflicts',
      icon: <WarningOutlined />,
      label: (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <NavLink to="/conflicts">冲突待处理</NavLink>
          {pendingConflicts > 0 && <Badge count={pendingConflicts} size="small" />}
        </span>
      ),
    },
  ]
  const sidebar = (
    <div className="sidebar-inner">
      <div className="brand">
        <div className="brand-mark"><AuditOutlined /></div>
        <div><strong>无障碍整改中心</strong><small>企业数字体验治理</small></div>
      </div>
      <Menu mode="inline" theme="dark" items={items} selectedKeys={[location.pathname]} onClick={() => setOpen(false)} />
      <div className="sync-card"><Tag color="success">正常</Tag><strong>规则库 2026.09</strong><span>最后同步 16:42</span></div>
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
          <Space />
        </Layout.Header>
        <Layout.Content><Outlet /></Layout.Content>
      </Layout>
    </Layout>
  )
}
