import { useState, type ReactElement } from 'react'
import { Bubble, ThoughtChain } from '@ant-design/x'
import { BulbOutlined, CheckCircleOutlined, CheckOutlined, CloseCircleOutlined, CopyOutlined, FileMarkdownOutlined, FileOutlined, FilePdfOutlined, LoadingOutlined, ToolOutlined } from '@ant-design/icons'
import { Image } from 'antd'
import type { ChatAttachment, ChatMessage } from '@/models'
import { formatMessageTime } from '@/utils/format'
import { useAgent } from '@/state/AgentContext'
import { MarkdownMessage } from './MarkdownMessage'
import { FileContextMenu } from './FileContextMenu'

const MAX_WIDTH = '76%'

/** 思考 / 工具调用的灰色次要文本色。 */
const SECONDARY = 'rgba(108,106,100,0.95)'

function AttachmentIcon({ attachment }: { attachment: ChatAttachment }): ReactElement {
  if (attachment.kind === 'pdf') return <FilePdfOutlined />
  if (attachment.kind === 'text') return <FileMarkdownOutlined />
  return <FileOutlined />
}

function MessageContent({ message, inverse = false, streaming = false, cwd }: { message: ChatMessage; inverse?: boolean; streaming?: boolean; cwd?: string }): ReactElement {
  const images = message.attachments?.filter((attachment) => attachment.kind === 'image') ?? []
  const files = message.attachments?.filter((attachment) => attachment.kind !== 'image') ?? []
  return (
    <div className={`chat-message-content${inverse ? ' is-inverse' : ''}`}>
      {images.length > 0 && (
        <div className="chat-message-images">
          {images.map((attachment) => (
            <Image key={attachment.id} src={attachment.url} alt={attachment.name} fallback="" />
          ))}
        </div>
      )}
      {files.length > 0 && (
        <div className="chat-message-files">
          {files.map((attachment) => (
            <FileContextMenu key={attachment.id} storageKey={attachment.storageKey}>
              <button
                type="button"
                className="chat-message-file"
                title={attachment.name}
                onClick={() => void window.attachments.open(attachment.storageKey)}
              >
                <AttachmentIcon attachment={attachment} />
                <span>{attachment.name}</span>
              </button>
            </FileContextMenu>
          ))}
        </div>
      )}
      {message.content && <MarkdownMessage content={message.content} inverse={inverse} streaming={streaming} cwd={cwd} />}
    </div>
  )
}

/** 时间戳（M月D日 HH:mm），展示在消息底部。 */
export function MessageTimestamp({ iso }: { iso: string }): ReactElement {
  return <span className="chat-message-time">{formatMessageTime(iso)}</span>
}

function UserBubble({ message, cwd }: { message: ChatMessage; cwd?: string }): ReactElement {
  const [copied, setCopied] = useState(false)
  const [hovered, setHovered] = useState(false)

  function handleCopy(): void {
    void navigator.clipboard.writeText(message.content ?? '').then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    })
  }

  return (
    <div
      className="chat-user-message flex flex-col items-end gap-1"
      style={{ maxWidth: MAX_WIDTH, marginLeft: 'auto' }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <Bubble
        placement="end"
        content={<MessageContent message={message} inverse cwd={cwd} />}
        shape="corner"
        styles={{ content: { background: 'var(--chat-user-bubble)', color: 'var(--chat-user-text)' } }}
      />
      <div className="chat-message-footer flex items-center justify-between self-stretch">
        <MessageTimestamp iso={message.createdAt} />
        <button
          type="button"
          onClick={handleCopy}
          style={{
            opacity: hovered ? 1 : 0,
            transition: 'opacity 0.15s',
            pointerEvents: hovered ? 'auto' : 'none',
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            padding: '2px 6px',
            color: 'var(--muted)',
            fontSize: 12,
            display: 'flex',
            alignItems: 'center',
            gap: 4,
          }}
        >
          {copied ? <CheckOutlined style={{ color: 'var(--success)' }} /> : <CopyOutlined />}
          {copied ? '已复制' : '复制'}
        </button>
      </div>
    </div>
  )
}

/** 单条对话消息（基于 Ant Design X 渲染）。
 * - 用户消息：右侧气泡，无标签
 * - 助手正文：左侧，标签 Koala
 * - 思考过程 / 工具调用：左侧 ThoughtChain，灰色
 * - 系统消息：居中 System 气泡
 */
export function ChatMessageItem({ message, streaming = false }: { message: ChatMessage; streaming?: boolean }): ReactElement {
  const { cwd } = useAgent()
  if (message.kind === 'thinking') {
    return (
      <ThoughtChain
        className="chat-activity-message chat-thinking-message mr-auto max-w-[82%]"
        defaultExpandedKeys={[]}
        line={false}
        items={[
          {
            key: message.id,
            icon: <BulbOutlined />,
            title: '思考',
            content: <MarkdownMessage content={message.content} cwd={cwd} />,
            collapsible: true
          }
        ]}
        styles={{
          itemIcon: { color: SECONDARY },
          itemHeader: { color: SECONDARY },
          itemContent: { color: SECONDARY }
        }}
      />
    )
  }

  if (message.kind === 'tool') {
    const status = message.toolStatus
    const running = status === 'pending' || status === 'in_progress'
    const failed = status === 'failed'
    const icon = running
      ? <LoadingOutlined spin />
      : failed
        ? <CloseCircleOutlined />
        : status === 'completed'
          ? <CheckCircleOutlined />
          : <ToolOutlined />
    const toolTitle = message.title ? `：${message.title}` : ''
    const title = running
      ? `正在使用工具${toolTitle}`
      : failed
        ? `工具调用失败${toolTitle}`
        : status === 'completed'
          ? `已使用工具${toolTitle}`
          : `使用工具${toolTitle}`
    // 后缀元信息：耗时 / 退出码（非零才提示）
    const metaParts: string[] = []
    if (typeof message.elapsedSeconds === 'number') metaParts.push(`${message.elapsedSeconds}s`)
    if (message.exitCode != null && message.exitCode !== 0) metaParts.push(`退出码 ${message.exitCode}`)
    const accent = failed ? 'var(--error)' : SECONDARY
    return (
      <ThoughtChain
        className="chat-activity-message chat-tool-message mr-auto max-w-[82%]"
        defaultExpandedKeys={[]}
        line={false}
        items={[
          {
            key: message.id,
            icon,
            title: (
              <span>
                {title}
                {metaParts.length > 0 && <span style={{ color: 'var(--muted-soft)' }}> · {metaParts.join(' · ')}</span>}
              </span>
            ),
            collapsible: true,
            content: message.content ? (
              <div className="chat-tool-output">
                {message.outputTruncated && <div className="chat-tool-truncated">输出过长，仅显示末尾。</div>}
                <MarkdownMessage content={message.content} cwd={cwd} />
              </div>
            ) : undefined
          }
        ]}
        styles={{
          itemIcon: { color: accent },
          itemHeader: { color: accent },
          itemContent: { color: SECONDARY }
        }}
      />
    )
  }

  if (message.role === 'user') {
    return <UserBubble message={message} cwd={cwd} />
  }

  if (message.role === 'system') {
    return <Bubble.System content={<MarkdownMessage content={message.content} cwd={cwd} />} />
  }

  return (
    <div className="chat-assistant-message" style={{ maxWidth: MAX_WIDTH }}>
      <Bubble
        placement="start"
        content={<MessageContent message={message} streaming={streaming} cwd={cwd} />}
        variant="borderless"
      />
      {message.finishedAt && (
        <div className="chat-message-footer chat-assistant-footer flex items-center">
          <MessageTimestamp iso={message.finishedAt} />
        </div>
      )}
    </div>
  )
}
