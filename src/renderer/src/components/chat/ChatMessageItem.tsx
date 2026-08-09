import { useState, type ReactElement } from 'react'
import { Bubble, ThoughtChain } from '@ant-design/x'
import { BulbOutlined, CheckOutlined, CopyOutlined, FileMarkdownOutlined, FileOutlined, FilePdfOutlined, ToolOutlined } from '@ant-design/icons'
import { Image } from 'antd'
import type { ChatAttachment, ChatMessage } from '@/models'
import { MarkdownMessage } from './MarkdownMessage'

const MAX_WIDTH = '82%'

/** 思考 / 工具调用的灰色次要文本色。 */
const SECONDARY = 'rgba(108,106,100,0.95)'

function AttachmentIcon({ attachment }: { attachment: ChatAttachment }): ReactElement {
  if (attachment.kind === 'pdf') return <FilePdfOutlined />
  if (attachment.kind === 'text') return <FileMarkdownOutlined />
  return <FileOutlined />
}

function MessageContent({ message, inverse = false, streaming = false }: { message: ChatMessage; inverse?: boolean; streaming?: boolean }): ReactElement {
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
            <button
              key={attachment.id}
              type="button"
              className="chat-message-file"
              title={attachment.name}
              onClick={() => void window.attachments.open(attachment.storageKey)}
            >
              <AttachmentIcon attachment={attachment} />
              <span>{attachment.name}</span>
            </button>
          ))}
        </div>
      )}
      {message.content && <MarkdownMessage content={message.content} inverse={inverse} streaming={streaming} />}
    </div>
  )
}

function UserBubble({ message }: { message: ChatMessage }): ReactElement {
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
      className="flex flex-col items-end gap-1"
      style={{ maxWidth: MAX_WIDTH, marginLeft: 'auto' }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <Bubble
        placement="end"
        content={<MessageContent message={message} inverse />}
        shape="corner"
        styles={{ content: { background: 'var(--primary)', color: 'var(--on-primary)' } }}
      />
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
  )
}

/** 单条对话消息（基于 Ant Design X 渲染）。
 * - 用户消息：右侧气泡，无标签
 * - 助手正文：左侧，标签 Koala
 * - 思考过程 / 工具调用：左侧 ThoughtChain，灰色
 * - 系统消息：居中 System 气泡
 */
export function ChatMessageItem({ message, streaming = false }: { message: ChatMessage; streaming?: boolean }): ReactElement {
  if (message.kind === 'thinking') {
    return (
      <ThoughtChain
        className="mr-auto max-w-[82%]"
        defaultExpandedKeys={[]}
        line={false}
        items={[
          {
            key: message.id,
            icon: <BulbOutlined />,
            title: '思考',
            content: <MarkdownMessage content={message.content} />,
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
    return (
      <ThoughtChain
        className="mr-auto max-w-[82%]"
        line={false}
        items={[
          {
            key: message.id,
            icon: <ToolOutlined />,
            title: message.title ? `正在使用工具：${message.title}` : '工具',
            content: <MarkdownMessage content={message.content} />
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

  if (message.role === 'user') {
    return <UserBubble message={message} />
  }

  if (message.role === 'system') {
    return <Bubble.System content={<MarkdownMessage content={message.content} />} />
  }

  return (
    <Bubble
      placement="start"
      content={<MessageContent message={message} streaming={streaming} />}
      variant="borderless"
      style={{ maxWidth: MAX_WIDTH }}
    />
  )
}
