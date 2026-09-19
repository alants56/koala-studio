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
          colorPrimary: darkMode ? '#fafafa' : '#18181b',
          colorInfo: darkMode ? '#fafafa' : '#18181b',
          colorSuccess: '#22c55e',
          colorWarning: '#eab308',
          colorError: '#ef4444',
          colorText: darkMode ? '#fafafa' : '#18181b',
          colorTextSecondary: darkMode ? '#a1a1aa' : '#71717a',
          colorTextLightSolid: darkMode ? '#18181b' : '#ffffff',
          colorBorder: darkMode ? '#3f3f46' : '#e4e4e7',
          colorBgLayout: darkMode ? '#18181b' : '#fafafa',
          colorBgContainer: darkMode ? '#27272a' : '#ffffff',
          colorBgElevated: darkMode ? '#27272a' : '#ffffff',
          fontSize: 13,
          fontSizeHeading1: 28,
          fontSizeHeading2: 22,
          fontSizeHeading3: 16,
          fontWeightStrong: 600,
          borderRadius: 6,
          borderRadiusSM: 4,
          borderRadiusLG: 8,
          padding: 12,
          paddingSM: 8,
          paddingLG: 16,
          paddingXS: 4,
          margin: 12,
          marginSM: 8,
          marginLG: 16,
          boxShadow: '0 1px 2px rgb(0 0 0 / 0.05)',
          boxShadowSecondary: '0 2px 4px rgb(0 0 0 / 0.06)',
          controlHeight: 32,
          controlHeightSM: 28,
          fontFamily: '"Koala Numerals", "Koala Serif", serif',
          fontFamilyCode: '"Koala Mono", "JetBrains Mono", monospace'
        },
        components: {
          Card: {
            boxShadow: 'none',
            borderRadiusLG: 6
          },
          Button: {
            controlHeight: 32,
            primaryShadow: 'none',
            defaultShadow: 'none'
          },
          Input: {
            activeShadow: 'none'
          },
          Select: {
            boxShadow: 'none'
          },
          Menu: {
            itemHeight: 36,
            itemBorderRadius: 4,
            itemSelectedBg: darkMode ? 'rgb(250 250 250 / 10%)' : 'rgb(24 24 27 / 6%)',
            itemSelectedColor: darkMode ? '#fafafa' : '#18181b'
          },
          Layout: {
            siderBg: darkMode ? '#27272a' : '#ffffff',
            headerBg: darkMode ? '#27272a' : '#ffffff'
          },
          Modal: {
            borderRadiusLG: 8
          }
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
