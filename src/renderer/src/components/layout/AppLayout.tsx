import { useMemo, useState, type ReactElement } from 'react'
import { Button, Layout, Menu, Tooltip } from 'antd'
import {
  CodeOutlined,
  DashboardOutlined,
  FolderOpenOutlined,
  AppstoreOutlined,
  MenuFoldOutlined,
  MenuUnfoldOutlined
} from '@ant-design/icons'
import { Outlet, useLocation, useNavigate } from 'react-router-dom'
import type { MenuProps } from 'antd'

const { Sider, Content } = Layout

const MENU_ITEMS: MenuProps['items'] = [
  { key: '/workbench', icon: <DashboardOutlined />, label: '工作台' },
  { key: '/claude', icon: <AppstoreOutlined />, label: '插件' },
  { key: '/projects', icon: <FolderOpenOutlined />, label: '项目' }
]

function getSelectedKey(pathname: string): string {
  if (pathname.startsWith('/projects')) return '/projects'
  if (pathname.startsWith('/workbench')) return '/workbench'
  if (pathname.startsWith('/claude')) return '/claude'
  return '/projects'
}

/** 应用整体框架：左侧导航 + 顶栏 + 内容区（Ant Design Pro 风格）。 */
export function AppLayout(): ReactElement {
  const [collapsed, setCollapsed] = useState(false)
  const location = useLocation()
  const navigate = useNavigate()

  const selectedKey = useMemo(() => getSelectedKey(location.pathname), [location.pathname])

  return (
    <Layout className="koala-shell">
      <div className="window-drag-region" aria-hidden="true" />
      <Sider
        className="koala-sider"
        width={224}
        collapsible
        collapsed={collapsed}
        onCollapse={setCollapsed}
        trigger={null}
      >
        <div className="koala-brand">
          <div className="koala-brand-mark">K</div>
          {!collapsed && (
            <div className="koala-brand-copy">
              <span className="koala-brand-name">Koala Studio</span>
              <span className="koala-brand-caption">Agent workspace</span>
            </div>
          )}

        </div>
        <Menu
          className="koala-nav"
          mode="inline"
          selectedKeys={[selectedKey]}
          items={MENU_ITEMS}
          onClick={({ key }) => void navigate(key)}
        />
        <div className="koala-sider-foot">
          {!collapsed &&
              <span className="chat-composer-attribution flex items-center gap-1.5">
              <CodeOutlined />
              Claude-Agent-ACP驱动
            </span>
          }
          <Tooltip title={collapsed ? '展开侧栏' : '收起侧栏'}>
            <Button
              type="text"
              size="small"
              icon={collapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}
              onClick={() => setCollapsed((value) => !value)}
              aria-label={collapsed ? '展开侧栏' : '收起侧栏'}
            />
          </Tooltip>
        </div>
      </Sider>
      <Layout className="koala-content-wrap">
        <Content className="koala-content">
          <Outlet />
        </Content>
      </Layout>
    </Layout>
  )
}
