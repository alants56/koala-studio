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
          colorPrimary: '#5273cf',
          colorInfo: '#5273cf',
          colorSuccess: '#3f9b68',
          colorWarning: '#b47d22',
          colorError: '#c0444b',
          colorText: darkMode ? '#f7f8fa' : '#17191d',
          colorTextSecondary: darkMode ? '#aab1bd' : '#737a86',
          colorBorder: darkMode ? '#242830' : '#dfe3e8',
          colorBgLayout: darkMode ? '#17191d' : '#ffffff',
          colorBgContainer: darkMode ? '#242830' : '#ffffff',
          borderRadius: 8,
          borderRadiusLG: 12,
          fontFamily: '"Koala Numerals", "Koala Serif", serif',
          fontFamilyCode: '"Koala Mono", "JetBrains Mono", monospace'
        },
        components: {
          Button: { controlHeight: 34, primaryShadow: 'none' },
          Input: { activeShadow: '0 0 0 3px rgb(82 115 207 / 12%)' },
          Menu: {
            itemHeight: 42,
            itemSelectedBg: darkMode ? 'rgb(82 115 207 / 14%)' : 'rgb(82 115 207 / 10%)',
            itemSelectedColor: darkMode ? '#7b93dd' : '#4460ae'
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
