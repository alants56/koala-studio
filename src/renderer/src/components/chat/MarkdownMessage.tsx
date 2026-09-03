import { useMemo, type ReactElement } from 'react'
import { XMarkdown, type ComponentProps, type XMarkdownProps } from '@ant-design/x-markdown'
import Latex from '@ant-design/x-markdown/plugins/Latex'
import { FileContextMenu } from './FileContextMenu'

const MARKDOWN_CONFIG = {
  extensions: Latex()
}

/** 常见源码/文档/资源文件扩展名，用于行内代码中的路径识别。 */
const FILE_EXTENSION_RE = /\.(ts|tsx|js|jsx|mjs|cjs|json|jsonl|md|markdown|py|rb|go|rs|java|c|cc|cpp|h|hpp|cs|css|scss|less|html|htm|vue|svelte|sh|bash|zsh|fish|yaml|yml|toml|ini|cfg|conf|sql|graphql|gql|log|xml|svg|txt|png|jpg|jpeg|gif|webp|avif|pdf|env|lock)$/i
const URL_OR_SCHEME_RE = /^(https?|ftp|file|data|mailto|tel|ws|wss):/i

/** 判断一段行内代码文本是否像文件路径。保守规则：避免命中 URL、邮箱、普通代码。 */
export function isFilePath(value: string): boolean {
  const text = value.trim()
  if (!text || /\s/.test(text)) return false
  if (URL_OR_SCHEME_RE.test(text)) return false
  if (/^[@#]/.test(text)) return false
  // Windows 盘符路径，如 C:\src\index.ts
  if (/^[A-Za-z]:[\\/]/.test(text)) return true
  const hasSeparator = text.includes('/') || text.includes('\\')
  const hasExtension = FILE_EXTENSION_RE.test(text)
  const isExplicit = /^(\.{1,2}\/|~\/|\/)/.test(text)
  return hasSeparator && (hasExtension || isExplicit)
}

/** 递归提取 DOM 节点文本。props.children 是渲染后的 React 节点，取原始字符串用 domNode 更可靠。
 * 参数用宽松结构类型，避免直接依赖 html-react-parser（其为 XMarkdown 的传递依赖）。 */
function extractTextFromNode(node: unknown): string {
  const record = node as { type?: string; data?: string; children?: unknown[] }
  if (record.type === 'text') return record.data ?? ''
  return (record.children ?? []).map((child) => extractTextFromNode(child)).join('')
}

interface MarkdownMessageProps {
  content: string
  streaming?: boolean
  inverse?: boolean
  /** 项目工作目录。提供后才启用正文文件路径的右键识别；为空时行为与现状一致。 */
  cwd?: string
}

/** 安全渲染对话中的 GFM Markdown 与 LaTeX 公式。 */
export function MarkdownMessage({ content, streaming = false, inverse = false, cwd }: MarkdownMessageProps): ReactElement {
  const codeComponents = useMemo<XMarkdownProps['components'] | undefined>(() => {
    if (!cwd) return undefined
    function CodeComponent(props: ComponentProps): ReactElement {
      // fenced 代码块原样透传，保留外层 <pre> 与默认样式
      if (props.block) {
        return <code className={props.className}>{props.children}</code>
      }
      const text = extractTextFromNode(props.domNode).trim()
      if (isFilePath(text)) {
        return (
          <FileContextMenu cwd={cwd} path={text}>
            <span className="chat-file-ref">{text}</span>
          </FileContextMenu>
        )
      }
      return <code className={props.className}>{props.children}</code>
    }
    return { code: CodeComponent }
  }, [cwd])

  return (
    <XMarkdown
      className={inverse ? 'chat-markdown chat-markdown-inverse' : 'chat-markdown'}
      config={MARKDOWN_CONFIG}
      content={content}
      openLinksInNewTab
      components={codeComponents}
      streaming={streaming ? { hasNextChunk: true, tail: true } : undefined}
    />
  )
}
