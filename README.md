# Koala Studio

基于 Electron、React、Ant Design 与 Agent Client Protocol (ACP) 的 Claude 桌面工作台。

## 开始

```bash
pnpm install
pnpm dev
```

首次连接时，应用会启动本地 `claude-agent-acp` 适配器。请先完成 Claude Agent SDK 所需的认证配置（例如 `ANTHROPIC_API_KEY`）。

## 命令

- `pnpm dev`：启动桌面开发环境
- `pnpm build`：类型检查并构建应用
- `pnpm package`：构建 macOS 安装包

## 页面

- `/workbench` 工作台：暂未实现，留白占位
- `/projects` 项目：项目卡片网格，支持按名称搜索、新建、删除
- `/projects/:projectId` 项目对话：进入后自动连接 ACP；右上角「历史对话」抽屉展示
  Claude Code 会话记录（来自 ACP `session/list`），点击可在不同会话间切换（`session/load`）
- `/claude` 插件：集中管理当前用户的 Claude Code 本地资源
  - Skills：扫描 `~/.claude/skills`，可新建、编辑或删除 `SKILL.md`
  - 插件：读取 `~/.claude/plugins/installed_plugins.json`，可启用、停用、更新或卸载
  - MCP：读取并维护 `~/.claude.json` 中的用户级和项目级 `mcpServers` 配置；列表会隐藏环境变量与请求头内容

## 项目数据（本地存储）

项目元数据由主进程持久化到本地 JSON 文件：

- 存储位置：`app.getPath('userData')/projects.json`（macOS 为
  `~/Library/Application Support/koala-studio/projects.json`）
- 支持：创建（名称、描述、标签、文件夹）、删除、按名称搜索
- 文件夹通过系统目录选择对话框选择已有目录，或直接新建目录（macOS `createDirectory`）
- 写入采用「临时文件 + 重命名」的原子方式，避免数据损坏

数据流：`renderer → preload (window.projects) → IPC → main (project-store)`。

Claude 本地资源数据流：`renderer → preload (window.claude) → IPC → main (claude-resources)`。
其中插件操作调用本机 `claude plugin` 命令；Skill 和 MCP 配置写入均采用临时文件后重命名，避免中断写入造成配置文件损坏。

## 对话记录（来自 Claude Code）

应用不自行持久化对话；历史对话直接查询 Claude Code 的 ACP 会话记录：

- 会话列表：ACP `session/list`（按项目目录过滤）
- 切换会话：ACP `session/load`（回放历史消息，并作为后续会话）
- 新建会话：ACP `session/new`
- 会话数据由 Claude Code（`~/.claude` 会话存储）管理

## 渲染进程目录结构

`src/renderer/src/` 按职责分层组织：

```
src/renderer/src/
├── main.tsx              # 应用入口（ConfigProvider + antd App + 路由）
├── App.tsx               # 根组件：ProjectsProvider + HashRouter + 布局路由
├── styles.css            # 全局样式（Tailwind）
├── assets/               # 静态资源（图片、字体等）
├── components/           # 可复用 UI 组件
│   ├── layout/           # 应用框架：侧边菜单 + 顶栏 + 内容区
│   ├── projects/         # 项目卡片、新建项目弹窗
│   └── chat/             # 对话：消息气泡、消息列表、输入区、会话视图
├── pages/                # 页面级组件
│   ├── workbench/        # 工作台（留白）
│   └── projects/         # 项目列表页、项目对话页
├── models/               # 领域模型与视图模型（复用 src/shared 的 IPC 类型）
├── state/                # 全局状态（ProjectsContext / AgentContext）
├── hooks/                # 可复用逻辑 Hook
├── services/             # 外部能力封装（window.acp / window.projects）
└── utils/                # 常量与工具函数
```

路径别名：`@/*` → `src/renderer/src/*`，`@shared/*` → `src/shared/*`（已在
`tsconfig.web.json` 与 `electron.vite.config.ts` 中配置）。

## License

本项目采用 [CC BY-NC 4.0](https://creativecommons.org/licenses/by-nc/4.0/deed.zh-hans)
（署名—非商业性使用）许可协议。

Copyright © 刘傲的AI实践
