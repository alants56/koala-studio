import type { ReactElement } from 'react'
import { Bubble, ThoughtChain } from '@ant-design/x'
import { BulbOutlined, ToolOutlined } from '@ant-design/icons'
import type { ChatMessage } from '@/models'
import { MarkdownMessage } from './MarkdownMessage'

const MAX_WIDTH = '82%'

/** 思考 / 工具调用的灰色次要文本色。 */
const SECONDARY = 'rgba(108,106,100,0.95)'

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
    return (
      <Bubble
        placement="end"
        content={<MarkdownMessage content={message.content} inverse />}
        shape="corner"
        style={{ maxWidth: MAX_WIDTH }}
        styles={{ content: { background: 'var(--primary)', color: 'var(--on-primary)' } }}
      />
    )
  }

  if (message.role === 'system') {
    return <Bubble.System content={<MarkdownMessage content={message.content} />} />
  }

  return (
    <Bubble
      placement="start"
      content={<MarkdownMessage content={message.content} streaming={streaming} />}
      variant="borderless"
      style={{ maxWidth: MAX_WIDTH }}
    />
  )
}
