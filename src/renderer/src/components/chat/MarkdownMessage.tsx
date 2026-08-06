import type { ReactElement } from 'react'
import { XMarkdown } from '@ant-design/x-markdown'
import Latex from '@ant-design/x-markdown/plugins/Latex'

const MARKDOWN_CONFIG = {
  extensions: Latex()
}

interface MarkdownMessageProps {
  content: string
  streaming?: boolean
  inverse?: boolean
}

/** 安全渲染对话中的 GFM Markdown 与 LaTeX 公式。 */
export function MarkdownMessage({ content, streaming = false, inverse = false }: MarkdownMessageProps): ReactElement {
  return (
    <XMarkdown
      className={inverse ? 'chat-markdown chat-markdown-inverse' : 'chat-markdown'}
      config={MARKDOWN_CONFIG}
      content={content}
      openLinksInNewTab
      streaming={streaming ? { hasNextChunk: true, tail: true } : undefined}
    />
  )
}
