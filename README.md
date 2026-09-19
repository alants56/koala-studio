# Koala Studio

基于 Electron + React + Ant Design 构建的 AI Agent 桌面工作台，通过 Agent Client Protocol (ACP) 同时支持 Claude、Pi 和 Codex 三个 Agent。

> ❗ 项目仍在活跃开发中，可能频繁提交且偶有数据格式变更，建议 fork 到自己的仓库后使用。

## 功能

- **多 Agent 支持** — 在 Claude、Pi、Codex 之间自由切换，偏好设置持久化
- **多项目管理** — 创建、搜索、删除项目，绑定本地目录，持久化到本地 JSON
- **仅对话** — 不绑定项目目录的轻量对话：点「对话」先进草稿页，提交首条消息时才创建时间戳工作目录（应用数据目录下），会话记录与产物都在里面；界面只展示对话历史，不展示目录
- **对话工作台** — 实时流式对话，支持图片、模型切换、推理强度调节、用量查询；Git 项目可在输入区查看本地分支、切换或新建分支
- **后台会话** — 各 Agent 共用最多 3 个独立会话运行实例，同目录、跨 Agent 也隔离消息、工具输出、权限和队列；切换会话/项目不会中断任务
- **历史会话** — 直接读取 ACP 会话记录，可在不同会话间无缝切换
- **已归档会话** — 侧栏可归档项目会话与仅对话；设置弹窗里集中管理，支持搜索、按项目筛选、取消归档或彻底删除
- **待办工具** — 待办看板数据可通过内置 MCP 工具（`koala_*_todo`）由 Agent 直接读写

## 快速开始

**前置条件：**
- 使用 Claude：完成 Claude Agent SDK 认证（如设置 `ANTHROPIC_API_KEY`）
- 使用 Pi：本机已安装 `pi` CLI 并完成认证
- 使用 Codex：完成 Codex 登录（终端运行 `codex login`），或设置 `OPENAI_API_KEY` / `CODEX_API_KEY`；首次对话若检测到未登录会自动打开浏览器完成 ChatGPT 授权

```bash
pnpm install
pnpm dev
```

首次启动后，应用根据所选 Agent 自动启动对应的 ACP 适配器。顶栏可随时切换 Claude / Pi / Codex，偏好设置会持久化。

会话池满时会自动释放最久未使用的空闲实例；若 3 个会话都在执行或等待权限确认，需等待或停止一个任务后才能打开其他会话。切回已在运行的会话不占新名额。后台执行仅限应用仍在运行时，退出应用会终止运行实例。

## 常用命令

```bash
pnpm dev       # 启动开发环境
pnpm test      # 会话隔离与并发回归测试（模拟 ACP 传输）
pnpm build     # 类型检查 + 构建
pnpm package   # 打包 macOS 安装包
```

## 页面

| 路径 | 说明 |
|------|------|
| `/projects` | 项目列表，支持搜索、新建、删除 |
| `/projects/:id` | 项目对话，自动连接 ACP；右上角可查看并切换历史会话 |
| `/projects/:id?view=board` | 项目待办看板，按待办类型分列、可拖拽流转 |
| `/chats/:id` | 单条仅对话，自动在专属目录连接 ACP，可加载历史 |
| `/workbench` | 占位页（看板已按项目拆分，见上） |

## 仅对话

与项目对话并列的轻量形态：不绑定任何用户目录。点侧栏「对话」先进草稿页——
只有输入框，不建目录也不开会话；提交首条消息时才在主进程创建以年月日时分秒命名的目录
（`conversations/20250919143012`），作为该对话的 ACP 工作目录。

- 目录、ACP 会话与 Agent 产物都按对话隔离，界面上只展示对话历史（侧栏「对话」区，新建与删除都在这里）
- 标题默认取首条消息；每条对话写回自己的 `sessionId`，重开时加载同一个会话而不是新建
- 切换 Agent 时会在同一目录内新开会话（旧 Agent 的会话 id 不能跨 Agent 加载）
- 删除对话只移除列表索引，目录与产物保留在本地
- 归档的对话从侧栏移出，在设置弹窗的「已归档的会话管理」里取消归档或删除

## 待办看板

每个项目有自己的一张看板，待办类型（列）按项目存放在 localStorage（`koala-studio:todo-board-columns-v1:<projectId>`）。
看板上新建的待办自动归属该项目，弹窗里的「挂载会话」可把待办指向本项目已有的会话。

点待办标题即进入会话：已挂载的直接打开那个会话，没挂载的会新建一个会话，
**首条消息发出后**才把待办挂载到实际产生的会话上——只是点开看看不会留下空关联。

侧栏项目行悬停出现「⋯」菜单：查看项目看板 / 重命名 / 删除。

## 本地数据

| 数据 | 存储位置 |
|------|---------|
| 项目元数据 | `~/Library/Application Support/koala-studio/projects.json` |
| 仅对话索引 | `~/Library/Application Support/koala-studio/conversations.json` |
| 仅对话目录（会话与产物） | `~/Library/Application Support/koala-studio/conversations/<年月日时分秒>/` |
| 会话元数据（重命名 / 归档标记） | `~/Library/Application Support/koala-studio/session-meta.json` |
| 待办事项 | `~/Library/Application Support/koala-studio/todos.json` |
| 对话记录 | 由各 Agent CLI 自行管理（Claude Code `~/.claude`、Codex `~/.codex`），应用不另行持久化 |

## License

[CC BY-NC 4.0](https://creativecommons.org/licenses/by-nc/4.0/deed.zh-hans) — 署名·非商业性使用

Copyright © 刘傲的AI实践
