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
          colorPrimary: '#cc785c',
          colorInfo: '#cc785c',
          colorSuccess: '#5db872',
          colorWarning: '#d4a017',
          colorError: '#c64545',
          colorText: darkMode ? '#faf9f5' : '#141413',
          colorTextSecondary: darkMode ? '#a09d96' : '#6c6a64',
          colorBorder: darkMode ? '#252320' : '#e6dfd8',
          colorBgLayout: darkMode ? '#181715' : '#faf9f5',
          colorBgContainer: darkMode ? '#252320' : '#faf9f5',
          borderRadius: 8,
          borderRadiusLG: 12,
          fontFamily: '"Koala Numerals", "Koala Serif", serif',
          fontFamilyCode: '"Koala Mono", "JetBrains Mono", monospace'
        },
        components: {
          Button: { controlHeight: 34, primaryShadow: 'none' },
          Input: { activeShadow: '0 0 0 3px rgb(204 120 92 / 12%)' },
          Menu: {
            itemHeight: 42,
            itemSelectedBg: darkMode ? 'rgb(204 120 92 / 14%)' : 'rgb(204 120 92 / 10%)',
            itemSelectedColor: darkMode ? '#d9957c' : '#a9583e'
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
