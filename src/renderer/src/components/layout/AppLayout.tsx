import { useLayoutEffect, useMemo, useState, type ReactElement, type ReactNode } from 'react'
import { Button, Layout, Menu, Tooltip } from 'antd'
import {
  CodeOutlined,
  DashboardOutlined,
  FolderOpenOutlined,
  AppstoreOutlined,
  MenuFoldOutlined,
  MenuUnfoldOutlined,
  ThunderboltOutlined
} from '@ant-design/icons'
import { useLocation, useNavigate, useOutlet } from 'react-router-dom'
import type { MenuProps } from 'antd'
import { ProjectNavigation } from './ProjectNavigation'

const { Sider, Content } = Layout

const MENU_ITEMS: MenuProps['items'] = [
  { key: '/workbench', icon: <DashboardOutlined />, label: '工作台' },
  { key: '/claude', icon: <AppstoreOutlined />, label: '插件' },
  { key: '/automations', icon: <ThunderboltOutlined />, label: '自动化执行' },
  { key: '/projects', icon: <FolderOpenOutlined />, label: '项目' }
]

function getSelectedKey(pathname: string): string {
  if (pathname === '/projects') return '/projects'
  if (pathname.startsWith('/workbench')) return '/workbench'
  if (pathname.startsWith('/claude')) return '/claude'
  if (pathname.startsWith('/automations')) return '/automations'
  return ''
}

/** 应用整体框架：左侧导航 + 顶栏 + 内容区（Ant Design Pro 风格）。 */
export function AppLayout(): ReactElement {
  const [collapsed, setCollapsed] = useState(false)
  const location = useLocation()
  const navigate = useNavigate()
  const outlet = useOutlet()
  const [projectDetailOutlet, setProjectDetailOutlet] = useState<ReactNode>(null)

  const selectedKey = useMemo(() => getSelectedKey(location.pathname), [location.pathname])
  const projectDetailActive = location.pathname.startsWith('/projects/')

  // 项目详情离开可视区域后仍保持挂载，让进行中的会话继续接收状态和消息。
  useLayoutEffect(() => {
    if (projectDetailActive) setProjectDetailOutlet(outlet)
  }, [location.key, projectDetailActive])

  const retainedProjectDetail = projectDetailActive ? outlet : projectDetailOutlet

  const handleMenuClick: MenuProps['onClick'] = ({ key }) => {
    void navigate(key)
  }

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
        <div className={`koala-brand${collapsed ? ' koala-brand--collapsed' : ''}`}>
          <div className="koala-brand-mark">K</div>
          {!collapsed && (
            <div className="koala-brand-copy">
              <span className="koala-brand-name">Koala Studio</span>
              <span className="koala-brand-caption">Agent workspace</span>
            </div>
          )}
          <Tooltip title={collapsed ? '展开侧栏' : '收起侧栏'}>
            <Button
              className="koala-brand-toggle"
              type="text"
              size="small"
              icon={collapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}
              onClick={() => setCollapsed((value) => !value)}
              aria-label={collapsed ? '展开侧栏' : '收起侧栏'}
            />
          </Tooltip>
        </div>
        <Menu
          className="koala-nav"
          mode="inline"
          selectedKeys={selectedKey ? [selectedKey] : []}
          items={MENU_ITEMS}
          onClick={handleMenuClick}
        />
        <ProjectNavigation collapsed={collapsed} />
        <div className="koala-sider-foot">
          {!collapsed && (
            <span className="chat-composer-attribution flex items-center gap-1.5">
              <CodeOutlined />
              Claude-Agent-ACP驱动
            </span>
          )}
        </div>
      </Sider>
      <Layout className="koala-content-wrap">
        <Content className="koala-content">
          {retainedProjectDetail && (
            <div className={projectDetailActive ? 'koala-route-pane' : 'koala-route-pane-hidden'}>
              {retainedProjectDetail}
            </div>
          )}
          {!projectDetailActive && <div className="koala-route-pane">{outlet}</div>}
        </Content>
      </Layout>
    </Layout>
  )
}
