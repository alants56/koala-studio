import { StrictMode, useEffect, useState, type ReactElement } from 'react'
import { createRoot } from 'react-dom/client'
import { App as AntdApp, ConfigProvider, theme } from 'antd'
import zhCN from 'antd/locale/zh_CN'
import { XProvider } from '@ant-design/x'
import xZhCN from '@ant-design/x/locale/zh_CN'
import './styles.css'
import { App } from './App'

function ApplicationRoot(): ReactElement {
  const [darkMode, setDarkMode] = useState(() => window.matchMedia('(prefers-color-scheme: dark)').matches)

  useEffect(() => {
    const query = window.matchMedia('(prefers-color-scheme: dark)')
    const update = (event: MediaQueryListEvent): void => setDarkMode(event.matches)
    query.addEventListener('change', update)
    return () => query.removeEventListener('change', update)
  }, [])

  return (
    <ConfigProvider
      locale={zhCN}
      theme={{
        algorithm: darkMode ? theme.darkAlgorithm : theme.defaultAlgorithm,
        token: {
          colorPrimary: '#1d7a63',
          colorInfo: '#1d7a63',
          colorSuccess: '#3d9b6c',
          colorText: darkMode ? '#e7ece8' : '#202522',
          colorTextSecondary: darkMode ? '#a6b0aa' : '#6f7973',
          colorBorder: darkMode ? '#343d37' : '#dfe5e1',
          colorBgLayout: darkMode ? '#171a18' : '#f4f6f4',
          colorBgContainer: darkMode ? '#202522' : '#ffffff',
          borderRadius: 8,
          borderRadiusLG: 12,
          fontFamily: '"Avenir Next", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif'
        },
        components: {
          Button: { controlHeight: 34, primaryShadow: 'none' },
          Input: { activeShadow: '0 0 0 3px rgb(29 122 99 / 12%)' },
          Menu: {
            itemHeight: 42,
            itemSelectedBg: darkMode ? '#263c32' : '#e8f4ee',
            itemSelectedColor: darkMode ? '#a8e0c7' : '#17644f'
          },
          Modal: { borderRadiusLG: 12 }
        }
      }}
    >
      <AntdApp>
        <XProvider locale={xZhCN}>
          <App />
        </XProvider>
      </AntdApp>
    </ConfigProvider>
  )
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ApplicationRoot />
  </StrictMode>
)
