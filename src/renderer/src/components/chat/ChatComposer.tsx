import { useEffect, useMemo, useRef, useState, type ClipboardEvent, type DragEvent, type KeyboardEvent, type ReactElement, type ReactNode } from 'react'
import { Attachments, Sender } from '@ant-design/x'
import { App, Button, Popover, type UploadFile } from 'antd'
import {
  ApiOutlined,
  AppstoreOutlined,
  MacCommandOutlined,
  EditOutlined,
  FileSearchOutlined,
  LoadingOutlined,
  PaperClipOutlined,
  CheckOutlined,
  DownOutlined,
  RobotOutlined,
  SafetyCertificateOutlined,
  SendOutlined,
  StopOutlined,
  WarningOutlined
} from '@ant-design/icons'
import { useAgent } from '@/state/AgentContext'
import type { AgentCommand } from '@shared/acp'

const MAX_ATTACHMENT_COUNT = 10
const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024
const MAX_TOTAL_ATTACHMENT_BYTES = 50 * 1024 * 1024

interface PendingAttachment extends UploadFile {
  sourceFile: File
  previewUrl?: string
}

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

const EMPTY_COMMANDS: AgentCommand[] = []

type CommandSource = 'system' | 'mcp' | 'extension'

// ACP 会抹平命令来源；已知内置名按系统命令处理，其余视为外部扩展。
const SYSTEM_COMMANDS = new Set([
  'add-dir',
  'agents',
  'bashes',
  'bug',
  'clear',
  'compact',
  'config',
  'context',
  'cost',
  'doctor',
  'exit',
  'export',
  'extra-usage',
  'fast',
  'feedback',
  'help',
  'hooks',
  'ide',
  'init',
  'install-github-app',
  'keybindings',
  'login',
  'logout',
  'mcp',
  'memory',
  'mobile',
  'model',
  'output-style',
  'permissions',
  'plan',
  'plugin',
  'pr-comments',
  'privacy-settings',
  'release-notes',
  'remote-control',
  'rename',
  'resume',
  'review',
  'rewind',
  'sandbox',
  'security-review',
  'skills',
  'stats',
  'status',
  'statusline',
  'stickers',
  'tasks',
  'terminal-setup',
  'theme',
  'upgrade',
  'usage',
  'vim'
])

interface CommandSourcePresentation {
  label: string
  icon: ReactNode
}

const COMMAND_SOURCE_PRESENTATIONS: Record<CommandSource, CommandSourcePresentation> = {
  system: { label: '系统', icon: <MacCommandOutlined /> },
  mcp: { label: 'MCP', icon: <ApiOutlined /> },
  extension: { label: 'Skill / 插件', icon: <AppstoreOutlined /> }
}

function getCommandSource(command: AgentCommand): CommandSource {
  const name = command.name.toLocaleLowerCase()
  if (name.startsWith('mcp:')) return 'mcp'
  if (SYSTEM_COMMANDS.has(name)) return 'system'
  return 'extension'
}

function fuzzyScore(value: string, query: string): number | null {
  const candidate = value.toLocaleLowerCase()
  const target = query.toLocaleLowerCase()
  if (!target) return 0
  if (candidate === target) return 1000
  if (candidate.startsWith(target)) return 800 - candidate.length

  const containedAt = candidate.indexOf(target)
  if (containedAt >= 0) return 600 - containedAt * 4 - candidate.length

  let cursor = 0
  let gap = 0
  let consecutive = 0
  let previousMatch = -2
  for (const character of target) {
    const matchedAt = candidate.indexOf(character, cursor)
    if (matchedAt < 0) return null
    gap += matchedAt - cursor
    if (matchedAt === previousMatch + 1) consecutive += 1
    previousMatch = matchedAt
    cursor = matchedAt + 1
  }

  return 350 + consecutive * 8 - gap * 3 - candidate.length
}

function filterCommands(commands: AgentCommand[], query: string): AgentCommand[] {
  return commands
    .map((command, index) => {
      const nameScore = fuzzyScore(command.name, query)
      const descriptionScore = fuzzyScore(command.description, query)
      const hintScore = command.hint ? fuzzyScore(command.hint, query) : null
      const score = Math.max(nameScore ?? -1, (descriptionScore ?? -1) - 300, (hintScore ?? -1) - 350)
      return { command, index, score }
    })
    .filter((item) => item.score >= 0)
    .sort((left, right) => right.score - left.score || left.index - right.index)
    .map((item) => item.command)
}

/** 对话输入区：基于 Ant Design X 的 Sender，Enter 发送、加载时显示停止按钮。 */
export function ChatComposer(): ReactElement {
  const { state, send, stop, setMode, setModel } = useAgent()
  const { message } = App.useApp()
  const [prompt, setPrompt] = useState('')
  const [permissionOpen, setPermissionOpen] = useState(false)
  const [modelOpen, setModelOpen] = useState(false)
  const [activeCommandIndex, setActiveCommandIndex] = useState(0)
  const [dismissedCommandPrompt, setDismissedCommandPrompt] = useState<string>()
  const [attachmentItems, setAttachmentItems] = useState<PendingAttachment[]>([])
  const [importingAttachments, setImportingAttachments] = useState(false)
  const [draggingFiles, setDraggingFiles] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const attachmentItemsRef = useRef(attachmentItems)

  const ready = state.status === 'ready'
  const loading = state.status === 'working'
  const commands = state.commands ?? EMPTY_COMMANDS
  const commandQuery = prompt.match(/^[/、]([^\s]*)$/)?.[1]
  const filteredCommands = useMemo(
    () => (commandQuery === undefined ? [] : filterCommands(commands, commandQuery)),
    [commandQuery, commands]
  )
  const commandMenuOpen = ready && commandQuery !== undefined && prompt !== dismissedCommandPrompt
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
  const model = state.model
  const currentModel = model?.options.find((option) => option.value === model.currentValue)

  useEffect(() => {
    setActiveCommandIndex(0)
  }, [commandQuery, commands])

  useEffect(() => {
    attachmentItemsRef.current = attachmentItems
  }, [attachmentItems])

  useEffect(() => () => {
    attachmentItemsRef.current.forEach((item) => {
      if (item.previewUrl) URL.revokeObjectURL(item.previewUrl)
    })
  }, [])

  const handleModeChange = async (modeId: string): Promise<void> => {
    try {
      await setMode(modeId)
      setPermissionOpen(false)
    } catch (error) {
      message.error(error instanceof Error ? error.message : '切换 Claude 权限模式失败')
    }
  }

  const handleModelChange = async (modelId: string): Promise<void> => {
    try {
      await setModel(modelId)
      setModelOpen(false)
    } catch (error) {
      message.error(error instanceof Error ? error.message : '切换 Claude 模型失败')
    }
  }

  const clearAttachments = (): void => {
    attachmentItems.forEach((item) => {
      if (item.previewUrl) URL.revokeObjectURL(item.previewUrl)
    })
    setAttachmentItems([])
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  const addFiles = (files: File[]): void => {
    const existing = new Set(attachmentItems.map((item) => `${item.name}:${item.size}:${item.sourceFile.lastModified}`))
    const next: PendingAttachment[] = []
    let totalBytes = attachmentItems.reduce((total, item) => total + (item.size ?? 0), 0)
    let rejected = 0

    for (const file of files) {
      const signature = `${file.name}:${file.size}:${file.lastModified}`
      if (existing.has(signature) || attachmentItems.length + next.length >= MAX_ATTACHMENT_COUNT) {
        rejected += 1
        continue
      }
      if (file.size === 0 || file.size > MAX_ATTACHMENT_BYTES || totalBytes + file.size > MAX_TOTAL_ATTACHMENT_BYTES) {
        rejected += 1
        continue
      }
      const previewUrl = file.type.startsWith('image/') ? URL.createObjectURL(file) : undefined
      next.push({
        uid: crypto.randomUUID(),
        name: file.name,
        size: file.size,
        type: file.type,
        status: 'done',
        thumbUrl: previewUrl,
        previewUrl,
        sourceFile: file
      })
      existing.add(signature)
      totalBytes += file.size
    }

    if (next.length > 0) setAttachmentItems((current) => [...current, ...next])
    if (rejected > 0) void message.warning(`有 ${rejected} 个文件未添加：最多 10 个，单个不超过 25 MB，总计不超过 50 MB。`)
  }

  const removeAttachment = (uid: string): void => {
    setAttachmentItems((current) => current.filter((item) => {
      if (item.uid !== uid) return true
      if (item.previewUrl) URL.revokeObjectURL(item.previewUrl)
      return false
    }))
  }

  const handleSubmit = (text: string): void => {
    const trimmed = text.trim()
    if ((!trimmed && attachmentItems.length === 0) || !ready || importingAttachments) return

    setImportingAttachments(true)
    void Promise.all(attachmentItems.map(async (item) => ({
      name: item.name,
      mimeType: item.type || '',
      data: new Uint8Array(await item.sourceFile.arrayBuffer())
    }))).then(async (files) => {
      if (!window.attachments?.importFiles) throw new Error('附件桥接尚未加载，请完全退出应用后重新启动。')
      const attachments = files.length > 0 ? await window.attachments.importFiles(files) : []
      setPrompt('')
      clearAttachments()
      void send(trimmed, attachments).catch((error: unknown) => {
        void message.error(error instanceof Error ? error.message : '发送消息失败。')
      })
    }).catch((error: unknown) => {
      void message.error(error instanceof Error ? error.message : '无法导入附件。')
    }).finally(() => setImportingAttachments(false))
  }

  const selectCommand = (command: AgentCommand): void => {
    const nextPrompt = `/${command.name}${command.hint ? ' ' : ''}`
    setPrompt(nextPrompt)
    setDismissedCommandPrompt(nextPrompt)
  }

  const handlePromptChange = (nextPrompt: string): void => {
    setPrompt(nextPrompt)
    if (nextPrompt !== dismissedCommandPrompt) setDismissedCommandPrompt(undefined)
  }

  const handleComposerKeyDown = (event: KeyboardEvent): void | false => {
    if (
      event.key === 'Enter' &&
      !event.shiftKey &&
      !event.ctrlKey &&
      !event.altKey &&
      !event.metaKey &&
      !prompt.trim() &&
      attachmentItems.length > 0
    ) {
      event.preventDefault()
      handleSubmit('')
      return false
    }
    if (!commandMenuOpen) return

    if (event.key === 'Escape') {
      event.preventDefault()
      setDismissedCommandPrompt(prompt)
      return false
    }

    if (filteredCommands.length === 0) return

    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      const direction = event.key === 'ArrowDown' ? 1 : -1
      setActiveCommandIndex((current) => (current + direction + filteredCommands.length) % filteredCommands.length)
      return false
    }

    if (event.key === 'Enter' || event.key === 'Tab') {
      event.preventDefault()
      selectCommand(filteredCommands[activeCommandIndex] ?? filteredCommands[0])
      return false
    }
  }

  const handlePaste = (event: ClipboardEvent<HTMLElement>): void => {
    const files = Array.from(event.clipboardData.files)
    if (files.length === 0) return
    event.preventDefault()
    addFiles(files)
  }

  const handleDragOver = (event: DragEvent<HTMLDivElement>): void => {
    if (!event.dataTransfer.types.includes('Files')) return
    event.preventDefault()
    event.dataTransfer.dropEffect = 'copy'
    setDraggingFiles(true)
  }

  const handleDrop = (event: DragEvent<HTMLDivElement>): void => {
    if (!event.dataTransfer.types.includes('Files')) return
    event.preventDefault()
    setDraggingFiles(false)
    addFiles(Array.from(event.dataTransfer.files))
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

  const modelPanel = model && (
    <div className="chat-model-panel" role="listbox" aria-label={`${model.name}列表`}>
      {model.options.map((option) => {
        const selected = option.value === model.currentValue
        return (
          <button
            key={option.value}
            type="button"
            role="option"
            aria-selected={selected}
            className="chat-model-option"
            onClick={() => void handleModelChange(option.value)}
          >
            <span className="chat-model-option-copy">
              <span className="chat-model-option-title">{option.name}</span>
              {option.description && <span className="chat-model-option-description">{option.description}</span>}
            </span>
            {selected && <CheckOutlined className="chat-model-option-check" />}
          </button>
        )
      })}
    </div>
  )

  return (
    <div
      className={`chat-composer-wrap${draggingFiles ? ' is-dragging-files' : ''}`}
      onDragOver={handleDragOver}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDraggingFiles(false)
      }}
      onDrop={handleDrop}
    >
      {commandMenuOpen && (
        <div className="chat-command-menu" role="listbox" aria-label="匹配的命令">
          {filteredCommands.length > 0 ? (
            filteredCommands.map((command, index) => {
              const source = getCommandSource(command)
              const sourcePresentation = COMMAND_SOURCE_PRESENTATIONS[source]
              return (
                <button
                  key={command.name}
                  type="button"
                  role="option"
                  aria-selected={index === activeCommandIndex}
                  className={`chat-command-option chat-command-option-${source}${index === activeCommandIndex ? ' chat-command-option-active' : ''}`}
                  onMouseEnter={() => setActiveCommandIndex(index)}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => selectCommand(command)}
                >
                  <span className="chat-command-option-icon" aria-hidden="true">
                    {sourcePresentation.icon}
                  </span>
                  <span className="chat-command-option-copy">
                    <span className="chat-command-option-heading">
                      <span className="chat-command-option-name">/{command.name}</span>
                      {command.hint && <span className="chat-command-option-hint">{command.hint}</span>}
                      <span className="chat-command-source-badge">{sourcePresentation.label}</span>
                    </span>
                    <span className="chat-command-option-description">{command.description}</span>
                  </span>
                </button>
              )
            })
          ) : (
            <div className="chat-command-empty">没有匹配“/{commandQuery}”的命令</div>
          )}
        </div>
      )}
      {draggingFiles && <div className="chat-file-drop-hint">松开即可添加到对话</div>}
      <input
        ref={fileInputRef}
        className="chat-file-input"
        type="file"
        multiple
        onChange={(event) => addFiles(Array.from(event.target.files ?? []))}
      />
      <Sender
        value={prompt}
        onChange={handlePromptChange}
        onKeyDown={handleComposerKeyDown}
        onPaste={handlePaste}
        onSubmit={handleSubmit}
        onCancel={() => void stop()}
        loading={loading}
        // 生成时 Sender 会把发送按钮替换为停止按钮；不能禁用整个组件，否则停止按钮也无法点击。
        disabled={(!ready && !loading) || importingAttachments}
        readOnly={loading || importingAttachments}
        placeholder="输入消息，或粘贴 / 拖入图片、PDF、Markdown 等文件。"
        autoSize={{ minRows: 1, maxRows: 6 }}
        header={
          <Sender.Header
            open={attachmentItems.length > 0}
            closable={false}
            title={`${attachmentItems.length} 个附件`}
          >
            <Attachments
              className="chat-attachments"
              items={attachmentItems}
              overflow="scrollX"
              beforeUpload={() => false}
              onRemove={(item) => {
                removeAttachment(item.uid)
                return true
              }}
            />
          </Sender.Header>
        }
        suffix={(originNode) => {
          if (loading || prompt.trim() || attachmentItems.length === 0) return originNode
          return (
            <Button
              type="text"
              className="chat-attachment-send"
              aria-label="发送附件"
              icon={importingAttachments ? <LoadingOutlined spin /> : <SendOutlined />}
              disabled={!ready || importingAttachments}
              onClick={() => handleSubmit('')}
            />
          )
        }}
        footer={
          <div className="chat-composer-footer flex items-center gap-1.5 text-xs">
            <Button
              type="text"
              className="chat-attachment-trigger"
              icon={<PaperClipOutlined />}
              disabled={!ready || loading || importingAttachments}
              onClick={() => fileInputRef.current?.click()}
            >
              添加文件
            </Button>
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
            {model && (
              <div className="chat-model-control">
                <Popover
                  placement="topRight"
                  trigger="click"
                  open={modelOpen}
                  onOpenChange={setModelOpen}
                  content={modelPanel}
                >
                  <Button
                    type="text"
                    className="chat-model-trigger"
                    disabled={!ready}
                    aria-label={`当前${model.name}：${currentModel?.name ?? model.currentValue}`}
                    aria-expanded={modelOpen}
                  >
                    <span>{currentModel?.name ?? model.currentValue}</span>
                    <DownOutlined aria-hidden="true" />
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
