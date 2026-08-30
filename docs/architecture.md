# Koala Studio 分层架构图

> 基于 Electron + React + Ant Design 的 AI Agent 桌面工作台，通过 **Agent Client Protocol (ACP)** 同时接入 Claude Code 与 Pi 两个 Agent。

## 分层架构总览

```mermaid
flowchart TB
    subgraph UI["① 表现层 Presentation · React 19 + Ant Design 6 + Tailwind"]
        direction TB
        P["pages/
Projects · ProjectChat · Claude · Automations · Workbench"]
        C["components/
ChatView·ChatThread·ChatComposer·MarkdownMessage·AppLayout·ProjectCard"]
        S["state/
AgentContext · ProjectsContext · AgentSelectionContext"]
        R["services/
window.acp · window.projects(封装 preload API)"]
        Cmd["路由 react-router-dom
/projects /projects/:id /claude /automations /workbench"]
    end

    subgraph Preload["② 桥接层 Bridge · contextBridge"]
        PB["preload/index.ts
window.acp / .projects / .claude / .automations / .todos / .attachments
(ipcRenderer.invoke · on)"]
    end

    subgraph Main["③ 主进程层 Main Process · Node + Electron"]
        direction TB
        IPC["ipcMain.handle
acp:* · projects:* · attachments:* · automations:* · todos:* · claude:*"]
        Acp["AcpBridge
会话生命周期 · 流式消息 · 权限请求 · 排队/steering · 附件事务"]
        Store["stores
project-store · automation-store · todo-store · attachment-store · preferences-store"]
        Claude["claude-resources
Skills / 插件 / MCP 配置管理"]
        Sched["automation-scheduler
定时检查 · 到期执行 · 运行记录"]
        Exec["automation executors
claude-executor · pi-executor · feature-brief(git)"]
        Pi["pi-runtime
Pi CLI 定位 · 内置 Node PATH 引导"]
        Win["BrowserWindow · koala-asset 自定义协议"]
    end

    subgraph Shared["④ 契约层 Shared Contracts · src/shared"]
        SC["acp.ts · projects.ts · automations.ts · todos.ts · attachments.ts · claude.ts
AutomationStore / TodoStore(主进程与 MCP 复用)"]
    end

    subgraph MCP["⑤ MCP 集成层 · src/mcp"]
        MCP["koala-automations MCP server
koala_* 自动化与待办工具 · stdio 或 http://127.0.0.1:29736/mcp"]
    end

    subgraph Adapter["⑥ Agent 适配层 · ACP Client"]
        ACP["@agentclientprotocol/sdk
ndjson stdio 客户端 · session/prompt · _session/steering · usage"]
        AdClaude["Claude Code ACP 适配器
@agentclientprotocol/claude-agent-acp"]
        AdPi["Pi ACP 适配器
pi-acp"]
    end

    subgraph Ext["⑦ 外部系统与数据层"]
        DS["用户数据 ~/Library/Application Support/koala-studio
projects.json · automations.json · todos.json · 偏好 · 附件"]
        CLI["Claude Code(会话存于 ~/.claude) · Pi CLI · Anthropic SDK"]
        Git["用户项目工作目录(git)"]
    end

    Cmd --> PB
    PB --> IPC
    IPC --> Acp
    Acp --> Store
    IPC --> Claude
    IPC --> Store
    Sched --> Exec
    Sched --> Store
    Exec --> Acp
    Acp --> ACP
    ACP --> AdClaude
    ACP --> AdPi
    AdClaude -.集成到会话.-> MCP
    AdPi -.集成到会话.-> MCP
    Acp -.注入 MCP 工具.-> MCP
    Store --> DS
    Store --> Shared
    MCP --> Shared
    AdClaude --> CLI
    AdPi --> CLI
    Exec --> Git
```

## 分层说明

| 层 | 位置 | 职责 |
|----|------|------|
| **① 表现层** | `src/renderer/src` | React 页面、聊天组件、状态上下文与路由；通过 preload 暴露的 API 与主进程通信 |
| **② 桥接层** | `src/preload` | `contextBridge` 把类型化 API 注入渲染进程，限制 IPC 白名单 |
| **③ 主进程层** | `src/main` | 注册 IPC 处理器，聚合 `AcpBridge`、各 store、资源管理、自动化调度与执行器 |
| **④ 契约层** | `src/shared` | 主进程、preload、渲染端共享的 TS 类型与可复用 store |
| **⑤ MCP 集成层** | `src/mcp` | 把自动化/待办作为 `koala_*` MCP 工具开放给 Agent 会话 |
| **⑥ Agent 适配层** | `@agentclientprotocol/*` | ACP 客户端，拉起 Claude Code / Pi 子进程并以 ndjson stdio 通信 |
| **⑦ 外部系统层** | 系统 / CLI | 本地 JSON 存储、Claude Code 会话、Pi CLI、用户 Git 项目 |

## 关键数据流

1. **聊天**：渲染端 `window.acp.prompt()` → preload → `acp:prompt` → `AcpBridge.prompt()` → ACP `session/prompt` → Agent 子进程；`session/update` 通知反向流回 UI。
2. **自动化**：`AutomationScheduler` 轮询到期任务 → 执行器拉起独立 Agent 会话完成指令 → 结果写回 `automations.json` 运行记录。
3. **Agent 自管理**：`AcpBridge` 在 `session/new` / `session/load` 时注入 `koala-automations` MCP server，让 Agent 可直接读写自动化与待办。
4. **项目/资源**：项目管理、Skills/插件/MCP 管理均经 IPC 落到本地 JSON 或 Claude Code 目录。

## 本地数据

| 数据 | 路径 |
|------|------|
| 项目元数据 | `~/Library/Application Support/koala-studio/projects.json` |
| 自动化规则 | `~/Library/Application Support/koala-studio/automations.json` |
| 待办事项 | `~/Library/Application Support/koala-studio/todos.json` |
| 对话记录 | Claude Code 管理（`~/.claude`），应用不另行持久化 |
