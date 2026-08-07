import { useMemo, useState, type ReactElement, type ReactNode } from 'react'
import { Sender } from '@ant-design/x'
import { App, Button, Popover } from 'antd'
import {
  EditOutlined,
  FileSearchOutlined,
  CheckOutlined,
  RobotOutlined,
  SafetyCertificateOutlined,
  StopOutlined,
  WarningOutlined
} from '@ant-design/icons'
import { useAgent } from '@/state/AgentContext'

interface PermissionModePresentation {
  label: string
  description: string
  icon: ReactNode
}

const MODE_PRESENTATIONS: Record<string, PermissionModePresentation> = {
  auto: {
    label: '自动',
    description: '由 Claude 判断哪些操作可安全执行。',
    icon: <RobotOutlined />
  },
  default: {
    label: '请求批准',
    description: '编辑外部文件和使用互联网时始终询问。',
    icon: <SafetyCertificateOutlined />
  },
  acceptEdits: {
    label: '替我审批',
    description: '仅对检测到的风险操作请求批准。',
    icon: <EditOutlined />
  },
  plan: {
    label: '计划',
    description: '只分析和规划，不执行工具或修改文件。',
    icon: <FileSearchOutlined />
  },
  dontAsk: {
    label: '不询问',
    description: '不弹出确认；未预先允许的操作会直接拒绝。',
    icon: <StopOutlined />
  },
  bypassPermissions: {
    label: '完全访问权限',
    description: '可不受限制地访问互联网和您电脑上的任何文件。',
    icon: <WarningOutlined />
  }
}

/** 对话输入区：基于 Ant Design X 的 Sender，Enter 发送、加载时显示停止按钮。 */
export function ChatComposer(): ReactElement {
  const { state, send, stop, setMode } = useAgent()
  const { message } = App.useApp()
  const [prompt, setPrompt] = useState('')
  const [permissionOpen, setPermissionOpen] = useState(false)

  const ready = state.status === 'ready'
  const loading = state.status === 'working'
  const modes = state.modes ?? []
  const modeOptions = useMemo(
    () =>
      modes.map((mode) => {
        const presentation = MODE_PRESENTATIONS[mode.id]
        return {
          value: mode.id,
          label: presentation?.label ?? mode.name,
          description: presentation?.description ?? mode.description ?? mode.name,
          icon: presentation?.icon ?? <SafetyCertificateOutlined />,
          bypass: mode.id === 'bypassPermissions'
        }
      }),
    [modes]
  )
  const currentMode = modeOptions.find((mode) => mode.value === (state.currentModeId ?? modes[0]?.id))

  const handleModeChange = async (modeId: string): Promise<void> => {
    try {
      await setMode(modeId)
      setPermissionOpen(false)
    } catch (error) {
      message.error(error instanceof Error ? error.message : '切换 Claude 权限模式失败')
    }
  }

  const handleSubmit = (text: string): void => {
    const trimmed = text.trim()
    if (!trimmed || !ready) return
    setPrompt('')
    void send(trimmed)
  }

  const permissionPanel = (
    <div className="chat-permission-panel">
      {modeOptions.map((mode) => {
        const selected = mode.value === (state.currentModeId ?? modes[0]?.id)
        return (
          <button
            key={mode.value}
            type="button"
            className={`chat-permission-option${mode.bypass ? ' chat-permission-option-bypass' : ''}`}
            onClick={() => void handleModeChange(mode.value)}
          >
            <span className="chat-permission-option-icon">{mode.icon}</span>
            <span className="chat-permission-option-copy">
              <span className="chat-permission-option-title">{mode.label}</span>
              <span className="chat-permission-option-description">{mode.description}</span>
            </span>
            {selected && <CheckOutlined className="chat-permission-option-check" />}
          </button>
        )
      })}
    </div>
  )

  return (
    <div className="chat-composer-wrap">
      <Sender
        value={prompt}
        onChange={setPrompt}
        onSubmit={handleSubmit}
        onCancel={() => void stop()}
        loading={loading}
        // 生成时 Sender 会把发送按钮替换为停止按钮；不能禁用整个组件，否则停止按钮也无法点击。
        disabled={!ready && !loading}
        readOnly={loading}
        placeholder="描述你想完成的工作。Enter 发送，Shift + Enter 换行。"
        autoSize={{ minRows: 1, maxRows: 6 }}
        footer={
          <div className="chat-composer-footer flex items-center gap-1.5 text-xs">
            {modes.length > 0 && (
              <div className="chat-permission-control">
                <Popover
                  placement="topLeft"
                  trigger="click"
                  open={permissionOpen}
                  onOpenChange={setPermissionOpen}
                  content={permissionPanel}
                  title="如何批准 Claude 操作？"
                >
                  <Button
                    type="text"
                    className={`chat-permission-trigger${currentMode?.bypass ? ' chat-permission-trigger-bypass' : ''}`}
                    icon={currentMode?.icon}
                    aria-label={`当前权限：${currentMode?.label ?? '未知'}`}
                    aria-expanded={permissionOpen}
                  >
                    {currentMode?.label ?? '权限'}
                  </Button>
                </Popover>
              </div>
            )}
          </div>
        }
      />
    </div>
  )
}
