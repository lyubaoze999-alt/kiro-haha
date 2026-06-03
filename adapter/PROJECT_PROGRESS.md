# kiro-haha 项目进度

## 目标
做一个 UI 和功能都尽量和 cc-haha（NanmiCoder/cc-haha，基于 Claude Code 的桌面工作台）一致的应用，但后端用 **Kiro CLI** 驱动。最终方案 = **复用 cc-haha 开源前端 + 自写适配层接 Kiro CLI ACP 协议**。

## 总体架构（方案 A：复用前端）
```
[kiro-haha.app (Tauri 壳)]
   ├─ 启动时 spawn → node ~/kiro-adapter/server.js (端口 3789)
   ├─ 前端 = cc-haha 构建产物 (~/kiro-gui/cchaha-dist)
   └─ Rust 提供 get_server_url() → http://127.0.0.1:3789 (Tauri 环境跳过 H5)
        │ HTTP /api/* + WS /ws/:sessionId
        ▼
[适配器 ~/kiro-adapter/server.js + acp.js]
   ├─ HTTP: 实现 cc-haha 期望的 /api/* (读 kiro sqlite / mcp.json / skills 目录)
   └─ WS: 桥接 → kiro-cli acp (JSON-RPC over stdio)
        ▼
[kiro-cli acp --trust-all-tools]  (路径自动探测: which kiro-cli → ~/.local/bin/kiro-cli)
```

## 关键路径/文件
- 适配器：`~/kiro-adapter/server.js`（HTTP+WS 路由）、`~/kiro-adapter/acp.js`（ACP↔ServerMessage 桥接）
- Tauri 壳：`~/kiro-gui/src-tauri/src/lib.rs`（spawn 适配器 + get_server_url + stub 命令）、`~/kiro-gui/src-tauri/tauri.conf.json`（productName=kiro-haha, frontendDist=../cchaha-dist）
- 前端源码：`/tmp/cc-haha/desktop`（已 bun install，改了 `src/pages/Settings.tsx`）
- 前端构建产物：`~/kiro-gui/cchaha-dist`（由 `cd /tmp/cc-haha/desktop && VITE_DESKTOP_SERVER_URL=http://127.0.0.1:3789 bun run build` 生成后复制）
- 用户设置持久化：`~/.kiro-haha-settings.json`
- 自测脚本（在 ~/kiro-adapter）：`selftest.js`(全端点+WS)、`conerr.js`(Playwright 抓控制台错误)、`uichat.js`(UI 聊天)、`mcpshot.js`/`kconf.js`(截图)

## 环境
- bun: `~/.bun/bin/bun`（export PATH="$HOME/.bun/bin:$PATH"）
- node: /usr/local/bin/node
- 适配器端口 **3789**（3456 被 chrome-mcp 占用）
- playwright chromium 已装（用于无头自测截图/抓错，因为 screencapture 截图常被窗口焦点挡住）
- kiro sqlite: `~/Library/Application Support/kiro-cli/data.sqlite3` 表 conversations_v2(key=cwd, conversation_id, value=JSON history, updated_at)
- mcp 配置: `~/.kiro/settings/mcp.json`
- skills: `~/.agent-shared/skills/*/SKILL.md`

## cc-haha 通信契约（已摸清）
- 前端连 `http://127.0.0.1:3789`（默认3456或 VITE_DESKTOP_SERVER_URL）
- WS: `ws://.../ws/:sessionId`
- 客户端→服务器(ClientMessage): `user_message{content,attachments}`, `permission_response`, `set_runtime_config`, `set_permission_mode`, `stop_generation`, `prewarm_session`, `ping`
- 服务器→客户端(ServerMessage, types/chat.ts): `connected`, `content_start{blockType,toolName,toolUseId}`, `content_delta{text,toolInput}`, `tool_use_complete`, `tool_result`, `permission_request`, `message_complete{usage}`, `thinking`, `status{state,verb}`, `error`, `session_title_updated`, `pong`
- `/health` 必须返回 `{status:"ok"}`（否则浏览器模式卡 H5；Tauri 模式走 get_server_url 不经过）

## ACP 事件映射（acp.js 已实现）
- agent_message_chunk → content_start(text)+content_delta
- agent_thought_chunk → thinking
- tool_call → content_start(tool_use)+tool_use_complete(rawInput)
- tool_call_update(completed/failed) → tool_result（结果取自 `rawOutput.items[].Text`）
- session/request_permission → 自动选 allow 选项
- fs/read_text_file, fs/write_text_file → 本地读写
- session/prompt 响应(stopReason) → message_complete + status idle
- 新会话用 session/new；resume 旧会话用 session/load(sessionId=已有conversation_id)

## 已完成 ✅
1. 适配器 HTTP 全端点返回正确结构，自测 34/34 通过
2. WS 聊天流式（thinking→content_delta→message_complete）自测通过
3. 工具调用（tool_use→tool_result→文字）自测通过
4. Tauri 本地应用 kiro-haha.app 打包成功，自动 spawn 适配器，零 H5
5. 修复前端崩溃：ModelSelector（/api/models 要 {models:ModelInfo[],provider}，provider.models 需 main/haiku/sonnet/opus）、ContextUsageIndicator（inspection 要完整 SessionContextSnapshot）
6. 设置页：服务商显示 Kiro CLI；MCP 显示真实 22 个服务器（修了 /api/mcp/project-paths 子路由）；技能 42 个；Agents 3 个
7. **本轮**：删除不支持的设置页签（H5/IM/Adapter/插件/Computer Use/诊断）；服务商→"Kiro 配置"；新增 KiroConfig 简易配置组件（默认模型/Agent/信任模式/CLI路径，PATCH /api/settings/user 持久化）。改在 Settings.tsx，已重建 dist 并重新打包 kiro-haha.app

## 功能审计结论
- ✅ 真实支持(Kiro有)：对话/会话/模型/Agents/MCP/技能/Slash命令
- 🟡 可做未完成：**Token用量**(接 kiro `/usage`)、**记忆**(接 kiro `/knowledge`)、内置终端/浏览器(Tauri可自实现)
- ❌ 已删除(Kiro不支持)：IM接入、H5远程、Computer Use、定时任务、插件、Adapter、Teams、Providers OAuth

## 待办（下个对话继续）
0a. ✅ **[本轮关键] ACP 会话存成文件、列表看不见 → 已修**（适配器侧，重启 app 生效）：
   - 根因: 通过 ACP 创建的会话(kiro-haha/IDE)，kiro-cli **不写 conversations_v2**，而是存成 `~/.kiro/sessions/cli/<id>.json`(元数据,带 `session_created_reason:"subagent"`) + `<id>.jsonl`(消息) + `<id>.history`。之前 listSessions 只读 conversations_v2 → 这些真实会话全看不见(误判成 subagent 噪音)。
   - 修: `readCliSessionFiles()` 读 .json 头部(正则取 session_id/cwd/title/created_at/updated_at, 跳过无 title)，listSessions 合并 conversations_v2 + 文件(按 id 去重，按 modifiedAt 排序)。会话数 17→35。
   - 修: `messagesFromJsonl(id)` 解析 .jsonl(kind: Prompt→user / AssistantMessage→assistant+toolUse / ToolResults→tool_result / Clear跳过)，conversationMessages 无 v2 行时回退读它。点开文件会话能看历史。
   - 注: IDE 聊天记录在 `~/Library/Application Support/Kiro/User/globalStorage/kiro.kiroagent`(9.2G 内容寻址哈希库, 不透明)，读不到；能读的是 ~/.kiro/sessions/cli 的 ACP 会话。
0b. ✅ **[本轮] 项目列表/选项目/新建会话/在访达打开/新建项目入口 全套修复**：
   - **新建会话报错 startsWith**: `POST /api/sessions` 之前返回 `{session:{...}}`，前端要 `{sessionId, workDir}` → sessionId undefined → activeTabId.startsWith 崩。已改正确形状。
   - **选目录空/报错**: `/api/filesystem/browse` 之前空 stub → 实现真实目录浏览(currentPath/parentPath/entries)。
   - **recent-projects/repository-context** 之前用错 seg 索引(seg[3] 应为 seg[2]) → 返回了会话列表(脏数据)。已修 + repository-context 返回真实 git 信息。
   - **在访达中打开**: `/api/open-targets` 空 stub → 返回 Finder + `/api/open-targets/open` 执行 `open <path>`。
   - **看不到 IDE 项目**: recentProjects/mcpProjectPaths 读 IDE `state.vscdb`(`history.recentlyOpenedPathsList` folderUri) 合并。侧边栏 Sidebar.tsx 把 recent-projects 作为空会话项目组显示(去重 by workDir)，项目头部加**常显"📁新建项目"按钮**(原 hover-only)。注: 空项目组点击=只折叠(别绑新建会话, 否则一点就蹦新对话-已修)。
   - **适配器健壮性**: acp.js spawn cwd 不存在→回退 HOME + `child.on("error")`(避免 spawn 失败崩溃)；server.js 加 uncaughtException/unhandledRejection 兜底。批量删除 `POST /api/sessions/batch-delete` 实现(逐个 chat -d)。
   - 删除=物理删(kiro-cli chat -d 删 sqlite 行+文件，不可恢复；vs Codex 是归档软删)。
0. ✅ **[本轮新增] Specs/Hooks/项目级MCP&Skill**（适配器侧，前端 Specs/Hooks 页未打包，项目级MCP/Skill 纯适配器重启即生效）：
   - **Specs(自研, 对齐Kiro IDE)**: server.js `/api/specs` CRUD + `/api/specs/:name/generate`(async spawn `kiro-cli chat --no-interactive`, 需求EARS/设计读需求/任务读设计, agent写文件)。文件存 `<cwd>/.kiro/specs/<name>/{requirements,design,tasks}.md`。前端 SpecSettings(Settings.tsx)+'specs' tab。注: Kiro 原生 spec 在 KAS 引擎(`chat --agent-engine kas --mode spec`)，但本机 kiro-cli 未内嵌 KAS(报 "KAS assets not embedded")，故自研。每份 spec 约 1.3-1.5 credits(需求0.38/设计0.53/任务~0.5)。
   - **Hooks**: `/api/hooks` 读写 `~/.kiro/agents/kiro-haha.json` hooks(userPromptSubmit/preToolUse/postToolUse)。关键: ACP 须 `acp --agent <name>` 才应用 hooks(session/new 参数不行)。前端 HookSettings+'hooks' tab。配 hooks 时新会话自动用 kiro-haha agent。
   - **项目级 MCP/Skill**: listMcp(cwd)/listSkills(cwd) 合并 全局(~/.kiro/settings/mcp.json, ~/.agent-shared/skills) + 项目(`<cwd>/.kiro/settings/mcp.json`, `<cwd>/.kiro/skills`)，标 scope user/project、source user/project；`/api/mcp/project-paths` 返回会话 workDir。cc-haha mcpStore 本就按 projectPaths 多 cwd 拉取，**无需改前端**。实测 kiro agent 项目 22全局+15项目=37。
   - kiro skill/mcp 都是「全局+项目」双层(二进制确认: skills 从 .kiro/skills 和 ~/.kiro/skills；mcp workspace 配置需 useLegacyMcpJson)。
1. ✅ **[已修复] "打开旧会话卡加载中/默认进行中"** —— 实为两个 bug，均在适配器侧修复（前端 dist 未动，重启 app 即生效）：
   - **消息不渲染**：`/api/sessions/:id/messages` 之前返回 `{role,content}`，但 cc-haha 的 `mapHistoryMessagesToUiMessages` 按 `msg.type`（user/assistant/tool_use/tool_result）+ `content`(字符串/块数组) + `id` + `timestamp` 解析，字段不符全被跳过。已重写 `conversationMessages()` 输出标准 MessageEntry（含 ToolUse→块数组、ToolUseResults→tool_result、合成递增 timestamp）。
   - **会话卡"思考中/进行中"且出现 Stop 按钮**：`session/load` 会让 kiro-cli 把整段历史当作 live `session/update` 重放（content_start/delta/tool_call），适配器转发后前端误判为正在生成，且重放结束后没有 message_complete/status idle → chatState 卡在 streaming。已在 acp.js 加 `replaying` 标志：resume 时 `await session/load`（8s 超时兜底）期间 `mapUpdate` 直接 return 丢弃重放事件，load 完成后再发 connected + status idle。
   - 验证：playwright 实测历史正确渲染(用户气泡/fs_read工具调用+结果/助手回复)，无 Stop/思考中/活跃中；且 resume 后再发消息仍正常流式(thinking→content_delta→message_complete→idle)。
2. ✅ **[已修复] 侧边栏所有会话"目录缺失"**：listSessions 没返回 `workDirExists`，前端 `!session.workDirExists` 恒真。已补 `workDirExists: fs.existsSync(cwd)` + `projectPath`。
3. ✅ **[已修复] 工作区/代码面板坏**：`/api/sessions/:id/workspace/{status,tree,file,diff}` 之前路由 fall-through 返回了会话列表。已用本地 fs+git 实现真实 `gitInfo()` 和 `workspace()`（文件树/读文件/git status/diff）。已验证 AppSurveyMfWeb→branch=master 47改动。
4. ✅ **[已接通] 上下文 % + 每轮 credits**（重大发现）：kiro 通过自定义通知 `_kiro.dev/metadata` 主动推送 `contextUsagePercentage` 和 `meteringUsage:[{value,unit:"credit"}]`（本地算，0 token）。适配器原来把所有 `_kiro.dev/*` 丢弃。已在 acp.js 加 `SESSION_META`(导出 Map) 捕获，并：
   - `message_complete` 带 `credits`(本轮)/`totalCredits`(累计)
   - server.js `inspection` 用 `SESSION_META` 算真实 `context.percentage` + `usage.costDisplay="X credits"`；并补 `usage.models:[]`（之前缺这个数组导致 ContextUsageIndicator `.find()` 抛错显示"无法获取"）
   - 上下文 icon 已正常渲染(实测)；刚打开那一下可能 0%(轮询早于 metadata)，发一轮后显示真实%。
   - ✅ **[前端已改,未打包]** 每轮 credits 显示在每条回复后面(和 CLI 一样)：改 4 文件——types/chat.ts(assistant_text +credits?)、chatStore.ts(message_complete 把 usage.credits 挂到该条 assistant_text)、MessageList.tsx(传 credits)、AssistantMessage.tsx(气泡下常显 "↯ X.XXX credits")。dev 实测 "↯ 0.165 credits" + 上下文 icon 4.0%。**改在 /tmp/cc-haha/desktop/src，部署 dist 未更新，需 build+copy+重打包才进 app**。
5. **[中] 记忆页**：/api/memory 接 kiro `/knowledge`（slash 可走 ACP，返回是文本需解析）
5. **[中] 记忆页**：/api/memory 接 kiro `/knowledge`（slash 可走 ACP，返回是文本需解析）
   - ✅ **[已做]** 改走 steering 文件：`/api/memory/{projects,files,file}` 读写 `~/.kiro/steering`(全局) + `<cwd>/.kiro/steering`(项目)。projectId=目录绝对路径。验证读写通过。注：`/knowledge`(语义知识库) 经 ACP 返回空，是 TUI-only，不可用，故改用 steering 文件作为"记忆"。
5b. ✅ **[已做] 真实模型列表**：`loadModels()` 跑 `kiro-cli chat --list-models -f json` 缓存映射→10 个真实模型(ModelInfo{id,name,description=Nx credits,context})。替换硬编码。
5c. ✅ **[已做] 删除会话真生效**：DELETE 调 `kiro-cli chat -d <id>` + 清 title override。
5d. ✅ **[已做] 重命名会话**：`TITLE_OVERRIDES`(~/.kiro-haha-titles.json) 持久化覆盖，listSessions 应用。PATCH /api/sessions/:id {title} 写入。
5e. ✅ **[设计检查] credits UI**：对照 cc-haha 图标驱动规范微调——lucide `Zap` 图标 + `text-[11px] font-medium tabular-nums text-[var(--color-text-tertiary)]`(对齐 MessageActionBar)。
6. **[参考] kiro 能力复用三通道**：A) ACP 实时(对话/工具/slash 命令都能发，免费)；B) CLI shell-out `kiro-cli chat --list-models -f json`/`agent`/`chat -d` 等(带 -f json)；C) 直读文件/sqlite(会话/mcp/skills/agents/steering)。精确套餐剩余 credits 只在 `kiro-cli dashboard` 网页，ACP/CLI 都不给。
7. **[参考] steering 全局**：agent 配置(~/.kiro/agents/*.json，全局默认目录)的 `resources`(上下文文件)+`prompt`(系统提示)即 steering；`agent create` 默认建全局、`set-default` 设默认 → 对所有 cwd/会话(含 kiro-haha)生效；本地 agent 仅在含配置的目录加载。
8. **[数据源受限,做不了]** 上下文明细分类(只有总%)、token 精确数(ACP 不给)；记忆语义库 /knowledge(TUI-only)。
9. **[Tauri 待做]** 内置终端(有骨架)、内置浏览器面板。建议从导航删掉"定时任务"死入口。
10. **[低] 分发**：适配器依赖本机 node + ~/kiro-adapter 目录，给别人用需把 node+适配器打进 app bundle(sidecar)；kiro-cli 路径已自动探测
11. **[低] Windows**：shell 默认值、ConPTY、Windows 构建
12. **[低] 重连可能 connectionState 卡 connecting**：websocket.ts connect() 复用已 OPEN 连接时不会再触发 connected 事件给新 handler；重开同会话理论上可能卡。本次未复现到，留观察。

## ⚠️ 未打包提醒
## ✅ 部署状态（2026-06-03 最新）
**[本轮关键修复] 重启后"所有设置没了/上次对话变 Untitled Session 空记录" — 是我上一轮 EADDRINUSE takeover 引入的回归**：
- **现象**: app 重启后 UI 变英文(显示 "Untitled Session" 而非中文"未命名会话")+ 设置丢失 + 上次会话空。数据其实都在(磁盘 sqlite/session 文件 + localStorage 8个tab带标题 + ~/.kiro-haha-settings.json 都完好)，是**前端启动期拉取失败**回退到默认(英文/空)。
- **根因(我上轮的锅)**: 上轮给 server.js 加的 EADDRINUSE "杀旧适配器+500ms重试接管"。app 重启时旧适配器(孤儿进程,一直serving)还在→前端 `waitForHealth`(desktopRuntime.ts, 30次×250ms) 立刻 ok→开始 fetch settings/sessions；**与此同时**新spawn的适配器 EADDRINUSE→`lsof kill` 把正在服务前端的旧适配器杀了→500ms 空窗→前端 fetchSettings/fetchSessions 落在空窗里失败→回退英文默认+空会话(且不重试)。
- **修复**: server.js EADDRINUSE 改为**优雅退出 `process.exit(0)`，不杀旧适配器**，让健康的孤儿适配器继续serving。实测 app 重启全程 `/health` 持续 ok(200ms轮询25次0间断)，单监听进程，前端启动拉取永不落空。
- **代价**: 适配器代码更新需手动先 `lsof -ti:3789 | xargs kill` 再重启 app(只影响我开发部署，已纳入部署流程)。用户正常重启 app 不改适配器代码→孤儿适配器持续服务→秒级健康、零间隙、零丢数据。孤儿适配器在 app 退出后仍存活(launchd 接管)，下次启动 app 直接复用=启动更快。
- 注: 本轮只改 server.js(适配器)，前端无需重新打包；已 kill 旧适配器+重启 app，当前 adapter 86639 跑新代码。

**[本轮] 新建会话"选择项目"无反应修复 + 适配器单实例隐患**：
- **根因**: 新建会话 composer 的"选择项目"用的是 `DirectoryPicker`(workbar)。选最近项目走纯 React `handleSelect→onChange`(dev 实测 chip 正常更新)；但点"选择文件夹"在 Tauri 下走 `@tauri-apps/plugin-dialog` 原生对话框，**失败时只 console.error 静默吞掉**→"选完没变化"。dialog 插件配置其实齐全(Cargo/lib.rs init/capabilities dialog:default 含 allow-open)，但 release 无 devtools 无法确证原生 dialog 行为，故改为**健壮回退**: DirectoryPicker.tsx `handleChooseFolder` 原生 dialog throw 时回退到应用内 browse 模式(走 `/api/filesystem/browse`，已验证 100% 可用)。dev 实测 browse 模式选"使用此文件夹"→chip 更新为 lvbaoze。
- **适配器单实例隐患(已规避)**: lib.rs `start_adapter()` 无脑 spawn `node server.js`，不检测已运行→app 重启时新适配器 EADDRINUSE 绑不上 3789，仍由旧进程(旧代码)服务，导致之前 acp.js 改动不生效。本轮清理: 退出 app→`pkill kiro-gui`→`lsof -ti:3789|xargs kill`→重新部署+open，确认单实例(app 57973 / adapter 57986 全新)。**注意: 以后重启 app 前务必先 `lsof -ti:3789|xargs kill -9` 杀掉旧适配器，否则改的适配器代码不生效。** (待办: lib.rs 加端口占用检测或 server.js listen EADDRINUSE 时先 kill 旧进程)

**[本轮] 对话框模型选择不全 + 推理强度(effort)修复（已打包部署）**：
- **模型不全**: 对话框 `<ModelSelector runtimeKey=.../>` 走 runtime-scoped 模式，下拉只显示 provider.models 的 main/haiku/sonnet/opus 4 个(buildProviderModels 硬读这4字段)。改 ModelSelector.tsx `buildProviderChoices` 的 providers 循环: 激活的 provider(kiro) 且 availableModels 非空时直接用全部 availableModels(来自 /api/models 的10个真实模型)，否则回退4字段。
- **推理强度(effort low/medium/high/max) Kiro 不支持**: 实测 `kiro-cli acp --help` / `chat --help` 只有 `--model`，无 effort/think/reason/temperature 任何参数；ACP 也不暴露。effort 是 Claude-Code 专属。改 ModelSelector.tsx `canEditRuntimeEffort = false` 隐藏该选择器。
- **模型切换真生效**: acp.js 加 `curModel`(可变)，处理 WS `set_runtime_config`(取 m.modelId 更新 curModel)，session/prompt 带 `model: curModel`(≠auto 时)。探针验证 session/prompt 带 model 参数不报错(stopReason=end_turn)。改 acp.js+前端 ModelSelector.tsx，已 build+copy+tauri build 部署到 /Applications/kiro-haha.app。

**全部已打包并部署到 /Applications/kiro-haha.app**（前端 credits/Zap、Specs页、Hooks页、侧边栏IDE项目+常显新建项目按钮 都已 build 进 dist；适配器全部改动已随 app 重启加载）。app 启动时自动 spawn `node ~/kiro-adapter/server.js`(单实例)。后续只改适配器(server.js/acp.js)→重启 app 即可；改前端→需重新 build+copy+tauri build(命令见文末)。

## 调试技巧（本轮新增）
- 浏览器里复现真机：playwright 打开 localhost:1420，先 `localStorage.setItem("cc-haha-h5-server-url","http://127.0.0.1:3789")` 再 reload，侧边栏即加载真实会话（否则走 H5 连接页、默认连 3456 空列表）。
- 快速抓 WS 事件序列：在 ~/kiro-adapter 下 `import WebSocket from "ws"` 连 `ws://127.0.0.1:3789/ws/:id` 打印每帧 type/state。

## 启动/调试命令速查
```bash
# 启动适配器
cd ~/kiro-adapter && node server.js   # 端口 3789

# 启动前端 dev(调试用，改 Settings.tsx 等源码后热更新)
export PATH="$HOME/.bun/bin:$PATH"; cd /tmp/cc-haha/desktop && VITE_DESKTOP_SERVER_URL=http://127.0.0.1:3789 bun run dev   # localhost:1420

# 重建前端 dist 并部署到 Tauri
cd /tmp/cc-haha/desktop && VITE_DESKTOP_SERVER_URL=http://127.0.0.1:3789 bun run build
rm -rf ~/kiro-gui/cchaha-dist && cp -R /tmp/cc-haha/desktop/dist ~/kiro-gui/cchaha-dist

# 重新打包 kiro-haha.app
source "$HOME/.cargo/env" && cd ~/kiro-gui && npm run tauri build
rm -rf "/Applications/kiro-haha.app" && cp -R ~/kiro-gui/src-tauri/target/release/bundle/macos/kiro-haha.app /Applications/ && xattr -cr "/Applications/kiro-haha.app" && open "/Applications/kiro-haha.app"

# 自测
cd ~/kiro-adapter && node selftest.js      # 全端点+WS
node conerr.js                              # Playwright 抓前端控制台错误
node uichat.js                              # UI 发消息测试
```
