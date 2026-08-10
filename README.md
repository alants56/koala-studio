# Koala Studio

基于 Electron + React + Ant Design 构建的 AI Agent 桌面工作台，通过 Agent Client Protocol (ACP) 同时支持 Claude 和 Pi 两个 Agent。

> ❗ 项目仍在活跃开发中，可能频繁提交且偶有数据格式变更，建议 fork 到自己的仓库后使用。

## 功能

- **双 Agent 支持** — 在 Claude 和 Pi 之间自由切换，偏好设置持久化
- **多项目管理** — 创建、搜索、删除项目，绑定本地目录，持久化到本地 JSON
- **对话工作台** — 实时流式对话，支持图片、模型切换、推理强度调节、用量查询
- **历史会话** — 直接读取 ACP 会话记录，可在不同会话间无缝切换
- **资源管理** — 在应用内管理 Skills、插件和 MCP 配置（Claude 专属；Pi 仅支持 Skills）
- **自动化** — 创建和管理自动化规则，Agent 可通过内置 MCP 工具直接读写

## 快速开始

**前置条件：**
- 使用 Claude：完成 Claude Agent SDK 认证（如设置 `ANTHROPIC_API_KEY`）
- 使用 Pi：本机已安装 `pi` CLI 并完成认证

```bash
npm install
npm run dev
```

首次启动后，应用根据所选 Agent 自动启动对应的 ACP 适配器。顶栏可随时切换 Claude / Pi，偏好设置会持久化。

## 常用命令

```bash
npm run dev       # 启动开发环境
npm run build     # 类型检查 + 构建
npm run package   # 打包 macOS 安装包
```

## 页面

| 路径 | 说明 |
|------|------|
| `/projects` | 项目列表，支持搜索、新建、删除 |
| `/projects/:id` | 项目对话，自动连接 ACP；右上角可查看并切换历史会话 |
| `/claude` | Skills / 插件 / MCP 集中管理 |
| `/automations` | 自动化规则管理与运行记录 |
| `/workbench` | 工作台看板（待办视图） |

## 本地数据

| 数据 | 存储位置 |
|------|---------|
| 项目元数据 | `~/Library/Application Support/koala-studio/projects.json` |
| 自动化规则 | `~/Library/Application Support/koala-studio/automations.json` |
| 待办事项 | `~/Library/Application Support/koala-studio/todos.json` |
| 对话记录 | 由 Claude Code 管理（`~/.claude` 会话存储），应用不另行持久化 |

## License

[CC BY-NC 4.0](https://creativecommons.org/licenses/by-nc/4.0/deed.zh-hans) — 署名·非商业性使用

Copyright © 刘傲的AI实践
