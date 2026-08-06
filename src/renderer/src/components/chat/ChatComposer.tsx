import { useState, type ReactElement } from 'react'
import { Sender } from '@ant-design/x'
import { CodeOutlined } from '@ant-design/icons'
import { useAgent } from '@/state/AgentContext'

/** 对话输入区：基于 Ant Design X 的 Sender，Enter 发送、加载时显示停止按钮。 */
export function ChatComposer(): ReactElement {
  const { state, send, stop } = useAgent()
  const [prompt, setPrompt] = useState('')

  const ready = state.status === 'ready'
  const loading = state.status === 'working'

  const handleSubmit = (text: string): void => {
    const trimmed = text.trim()
    if (!trimmed || !ready) return
    setPrompt('')
    void send(trimmed)
  }

  return (
    <div className="chat-composer-wrap">
      <Sender
        value={prompt}
        onChange={setPrompt}
        onSubmit={handleSubmit}
        onCancel={() => void stop()}
        loading={loading}
        disabled={!ready}
        placeholder="描述你想完成的工作。Enter 发送，Shift + Enter 换行。"
        autoSize={{ minRows: 1, maxRows: 6 }}
        footer={
          <span className="chat-composer-footer flex items-center gap-1.5 text-xs">
            <CodeOutlined />
            由 Claude Agent SDK 与 ACP 驱动
          </span>
        }
      />
    </div>
  )
}
