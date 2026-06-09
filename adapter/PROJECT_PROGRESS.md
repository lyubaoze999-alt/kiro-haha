# kiro-haha 项目进度

## 📌 v0.2.3 已发布 (2026-06-09)

GitHub Release：https://github.com/lyubaoze999-alt/kiro-haha/releases/tag/v0.2.3
6 个 assets 齐全（dmg / msi / exe / .app.tar.gz / .sig / latest.json），自动更新链路通。

### 本轮修了 v0.2.2 的 3 个 critical regression
| 修复 commit | 问题 | 严重度 |
|---|---|---|
| `2dfea4d` | rewind userMessageIndex 写死 0 → 清空整个 .jsonl 历史 | 数据丢失 |
| `abb1e45` | Sidebar useTabStore selector new Set 每次新引用 → infinite render loop → app 卡死 | app 不可用 |
| `f9f5612` | adapter 漏接 `/api/workspaces` 路由 → 前端 destructure undefined → `.find` 崩 | app 不可用 |

合并 PR/branch：`fix/rewind-data-loss` → main `9387cfd`，bump `74c5a91`，tag `v0.2.3` = `b0341dd`。

### 发版踩的坑（已写进 skill: kiro-haha-release）
1. **`TAURI_SIGNING_PRIVATE_KEY` secret 必须用 `gh secret set` 设**，浏览器手动粘贴会引入换行/多余字符 → workflow 报 `Invalid symbol 61`，v0.2.1 / v0.2.2 / v0.2.3 第一次发都因此失败。修复方法：`gh secret set TAURI_SIGNING_PRIVATE_KEY --body "$(cat ~/.tauri/kiro-haha.key | tr -d '\n')"`。
2. **bump version 在 `tauri-shell/src-tauri`，不是 `frontend/src-tauri`**——后者是 0.3.2 另一个无关版本号。
3. 重跑失败的 workflow：删 release + 删 tag + 重推 tag，或者 GitHub UI 点 "Re-run failed jobs"。
4. **SSH 密钥不能调 GitHub Actions API**——只能跑 git push/pull。看 workflow log / 改 secrets 必须 HTTPS API + token。

### 项目知识库 + Skill 已落地
- `knowledge` 索引 3 个 context：`kiro-haha-project`（repo）/ `kiro-haha-adapter-local`（~/kiro-adapter）/ `kiro-haha-progress`（本文件）
- Skill: `~/.agent-shared/skills/kiro-haha-release/SKILL.md`，下次发布直接 trigger

---

## 📌 最新进度 (2026-06-08, **Sidebar Credits Card v3**)

### Credits 入口升级（按 v3 设计稿落地）
- **设计稿**: `~/Downloads/codex项目/kiro-haha-credits-design-v3-compact.html`
- **改动定位**: 把账户级 credits 从 composer chip 升级到 **Sidebar 顶部卡片**（品牌区下方、NavItem 上方）。原 composer chip 保留并存（同一个 hook，零数据重复）。
- **三主题色板复用**: 用 `--color-brand` (light: 暖橘 #8F482F) + `--color-warning` + `--color-error`，**不引入设计稿原稿的 purple**，三主题（light/white/dark）自动适配。

### 新增/改动文件 (7 个，+663 行)
- 新增 `frontend/src/components/chat/useQuotaSummary.ts` (114 行)：抽 fetch + 缓存 + 强刷 + 派生态（pct / tone / toneColorVar）的 hook
- 新增 `frontend/src/components/layout/SidebarQuotaCard.tsx` (406 行)：三模式 `expanded` / `collapsed` / `mobile`
- 改 `frontend/src/components/chat/QuotaIndicator.tsx` (94 行)：composer chip 改用 useQuotaSummary（保留兼容）
- 改 `frontend/src/components/chat/ChatInput.tsx`：保留挂在 composer 工具栏的 chip
- 改 `frontend/src/components/layout/Sidebar.tsx`：在品牌区下方插入 `<SidebarQuotaCard mode={isMobile ? 'mobile' : (expanded ? 'expanded' : 'collapsed')} />`
- 改 `frontend/src/i18n/locales/{en,zh}.ts`：加 18 个 `quota.*` 词条（建议关注余量 / 即将用完 / 打开 Kiro IDE 后刷新 / 重置 / 重试 / 已用 / 剩余 / 超额计费 等）

### 四态视觉规则（按 `/api/quota` 字段派生）
| 状态 | 触发 | 主色 | 卡片 footer |
|---|---|---|---|
| 正常 | pct < 60% | `--color-brand` | `Jun 30 重置` + `46%` |
| 提醒 | 60–85% | `--color-warning` + 黄色卡片背景 | `建议关注余量` + `78%` |
| 紧张 | > 85% 或 overage>0 | `--color-error` + 浅红卡片背景 | `即将用完` + `94%` |
| 不可用 | `available=false` | 灰色 | `打开 Kiro IDE 后刷新` + `重试` |

**关键：不可用态不再 return null**（旧 QuotaIndicator 是 token 过期时整个隐藏），改为常显灰色卡片 + 重试 CTA，避免用户不知道为什么没数。

### 收起态 (rail) + 移动端
- collapsed: 44×44 圆角按钮 + zap 图标 + 右下 8px 状态点（颜色跟随 tone）+ hover 向右展开 220px tooltip
- mobile: 同样的 expanded 卡片样式，**点击打开 `MobileBottomSheet`**（已有组件复用，零新依赖）

### 实测验证
- playwright 截图 4 态 + collapsed rail：`/tmp/quota-{normal,warning,danger,unavailable,collapsed-rail,collapsed-tooltip}-*.png`
- 控制台 0 报错（`pageerror` / `console.error` 计数 = 0）
- TS strict 编译通过、bun build 通过、tauri build 通过、`/Applications/kiro-haha.app` 已重新部署、adapter 健康

### 部署 + git
- `/Applications/kiro-haha.app` 已替换为新版（含 SidebarQuotaCard）
- adapter 仍跑在 PID（孤儿进程模式，按上轮约定），数据正常返回
- git: `lyubaoze999-alt/kiro-haha` main = `f3f0f67`，已 push
  - 注意：当前 `/api/quota` 返回 `{available:false}`，是上一轮已知的 token 过期场景；用户打开 Kiro IDE 一次后会自动刷回正常数据，UI 会从灰色卡片切到正常态

---

## 📌 上一阶段进度 (2026-06-05 ~ 2026-06-08, **v0.2.0**)

### 当前部署状态
- `/Applications/kiro-haha.app` v0.2.0 已部署 (aarch64 dmg 35MB, app.tar.gz 14.6MB + .sig)
- adapter PID 跑在 3789（含今天全部修复，bundle 内 server.js 61448 字节、acp.js 16016 字节）
- git: `lyubaoze999-alt/kiro-haha` main = `5d5b31c` (commit `1e16932` 含 v0.2.0 全部代码 + tag v0.2.0 已推)
- README 改成 clone-and-build 优先（暂无 GitHub Release，OAuth code `48CB-0566` 未用、待发布走方案 A 给 PAT 或方案 C 手动 attach 4 个文件）
- Tauri signer keypair 在 `~/.tauri/kiro-haha.key` (密码 `kiro-haha-2026`)，pubkey 已进 tauri.conf.json
- GitHub workflow 加了 `TAURI_SIGNING_PRIVATE_KEY/_PASSWORD` env + macOS latest.json 生成 step；但**用户未在 GitHub 加 secrets**，所以 workflow 跑会失败。需要用户手动加 2 个 secrets 才能发版自动签名
- private key value 见 `cat ~/.tauri/kiro-haha.key`

### 浏览器子 webview (cc-haha 原版搬运)
- 抄 `webview_panel.rs` (~/kiro-gui/src-tauri/src/webview_panel.rs, 167 行) + `preview-agent.js` (~/kiro-gui/src-tauri/resources/, 216KB)
- lib.rs 加 `mod webview_panel + MAIN_WINDOW_LABEL=main + manage(PreviewState) + 注册 7 命令` (preview_open/navigate/setBounds/setVisible/close/eval/message)
- Cargo.toml: `tauri = features=["unstable"]` (add_child / get_window 是 unstable API)
- adapter `/preview-fs/:sid/<rest>` + `/local-file/<abs>` 路由提供 webview 静态文件 source，含 path-traversal sandbox + symlink check + 16 种 mime
- 前端契约 (`previewBridge.ts`) 已在 cc-haha 原版，本次只补后端

### 内置终端
- 新建 `terminal.rs` (270 行)：portable-pty 跨平台 PTY、AtomicU32 自增 session_id、reader/wait thread emit `terminal-output/exit` 事件（snake_case session_id 跟前端契约对齐）
- bash path override 用 `BASH_PATH_OVERRIDE: Mutex<Option<String>>` 内存值
- 7 命令：terminal_spawn/write/resize/kill + get_terminal_bash_path + set_terminal_bash_path
- pick_default_shell: cfg(windows) 选 cmd.exe，cfg(unix) 选 $SHELL/zsh/bash

### lib.rs 端口检测 + Win 兼容
- 加 `const PORT: u16 = 3789` + spawn 前 `TcpListener::bind` 试探，bind 失败说明已有 adapter，return 不重复 spawn（防双 spawn 抢端口失败回退到旧 adapter）
- `node_bin()` Win 分支加 `C:\Program Files\nodejs\node.exe` + `(x86)\nodejs\node.exe` 兜底

### Tauri 自动更新链路
- 加 tauri-plugin-updater = "2"
- lib.rs `.plugin(tauri_plugin_updater::Builder::new().build())`
- capabilities/default.json 加 `"updater:default"`
- tauri.conf.json: `bundle.createUpdaterArtifacts: true` + `plugins.updater.{pubkey, endpoints}`
- endpoint: `https://github.com/lyubaoze999-alt/kiro-haha/releases/latest/download/latest.json` (你不发 release 时 404，前端 catch 显示"无可用更新"不报红错)
- workflow build-macos.yml 加 latest.json 生成 step (darwin-aarch64) + attach 到 release
- workflow build-windows.yml 加 signer env + .nsis.zip + .sig attach（未做 latest.json 合并，Windows 自动更新待后续）
- 现状：用户点检查更新 → 404 graceful；推 main / 改分支不影响（Release 才触发）

### Adapter 9+ 项修复
1. **MCP toggle 真翻转**：原 `disabled = !enabled` 当 enabled=undefined 时永远关。改 flip 当前 disabled，支持项目级 cwd mcp.json
2. **图片预览**：原 `fs.readFileSync(abs, 'utf8')` 读 binary 全乱码。按扩展名分三类：image (.png/.jpg/.jpeg/.gif/.webp/.svg/.ico/.bmp) → base64 dataUrl + previewType:'image' + mimeType；非图片二进制 (.pdf/.zip/.pptx 等) → state:'binary'；其他走 utf8。size 上限 2MB→5MB
3. **/preview-fs + /local-file 路由**：webview 加载本地 HTML/asset 用，sandbox 严格限 cwd 或 HOME
4. **sessionInfoCwd 兼容 cli session**：先查 conversations_v2，没有再扫 ~/.kiro/sessions/cli/<id>.json
5. **workspace diff 找 git root + jsonl 伪 diff**：原走 `git -C cwd diff` cwd 错失败。改用 `path.dirname(abs) → git rev-parse --show-toplevel` 找 git 根；非 git 仓库 fallback 扫 jsonl 抽 strReplace 工具的 oldStr/newStr 拼 unified diff（cc-haha 在非 git 项目里也能看到本会话改了什么）
6. **workspace file path 不存在时回退**：相对路径 abs 不存在时扫 jsonl 找匹配 endsWith 的最近 ToolUse 绝对路径。处理 cli session cwd=HOME 但实际工作目录在别处的情况
7. **turn-checkpoints 抽 ToolUse path**：原永远返 filesChanged:[]。改成切组到每个 user turn，扫所有 tool_use 抽 input.path / input.file_path 收集去重，前端"本轮变更卡片"直接展示。**对接 cc-haha CurrentTurnChangeCard 的 progressive disclosure 模型，对应 OpenAI Codex App 的 task sidebar artifact 体系**
8. **权限 "Allow for session" 真生效**：acp.js 加 `sessionAllowToolNames: Set`，permission_response 收到 rule:'always' && allowed 时把 toolName 加进白名单；后续 session/request_permission 命中白名单直接 allow（per-WS 持久）
9. **permissionMode 持久化 + 跨 session 同步**：acp.js set_permission_mode 写回 ~/.kiro-haha-settings.json；server.js 在 ws connect、listSessions、inspection 三处 re-read settings；listSessions 返回每 session 都带 permissionMode = USER_SETTINGS.permissionMode；前端切换 selector 不再重置默认
10. **stale lock 启动自动清扫**：adapter 启动时扫 ~/.kiro/sessions/cli/*.lock，process.kill(pid, 0) ESRCH 检测进程已死则删 lock。修我之前 SIGKILL adapter 留下的孤儿 lock 导致"对话不展示结果/0-credits 假象"
11. **skill resources 用 kiro 官方 progressive disclosure**：撤回最初塞全量 skill 索引到 agent.prompt（每 turn 多 1800 token）。改成按 kiro IDE 官方机制，agent.resources 字段加 `["skill://.kiro/skills/*/SKILL.md", "skill://~/.kiro/skills/*/SKILL.md"]` 用 skill:// URI scheme，由 kiro-cli 自己 progressive disclosure（启动只加载 frontmatter name+description，活动时才加载完整 SKILL.md）。零 token 增量
12. **WS 默认走 kiro-haha agent**：原仅在 hooksConfigured() 时切换。改成新会话始终用 kiro-haha agent，让 skill resources 生效。adapter 启动时 syncSkillIndexToHookAgent() 维护 agent.json
13. **kiroBin() Windows where 兼容**：原 `which kiro-cli` Win 不行。改成 `process.platform === 'win32' ? 'where' : 'which'`，加 Win fallback 路径 `%USERPROFILE%/AppData/Local/Programs/kiro-cli/kiro-cli.exe`

### Quota / 总额度显示 (kiro Power 4628/10000 同款)
- **API endpoint**: `https://management.us-east-1.kiro.dev/` POST `AmazonCodeWhispererService.GetUsageLimits`
- **鉴权**: 读 `~/.aws/sso/cache/kiro-auth-token.json` accessToken（kiro IDE/desktop 维护刷新）
- **profileArn**: 读 sqlite `state` 表 `api.codewhisperer.profile.arn`
- adapter `/api/quota` 返回 `{available, plan, used, limit, overage, overageEnabled, nextResetAt, raw}`
- inspection 端点 usage.quota 也带，costDisplay 改成 `4500 / 10000 KIRO POWER credits`
- **触发策略 (mirror kiro IDE)**: 只在 ws 新连接 fetch 一次 + 前端组件 mount 时读缓存 + 用户**点击 chip refresh=1 强刷**。**没有定时轮询**（kiro IDE 也不轮询）
- 前端 QuotaIndicator.tsx (134 行) 加在 ChatInput 工具栏，显示 ⚡ used/limit + hover tooltip（plan / 进度条 / 重置日期 / 超额状态）
- **token 过期处理**：adapter 检测 expiresAt < now 时返 `error: "no valid kiro auth token (re-login may be needed)"`。用户需要打开 kiro IDE 触发 token 自动 refresh。**TODO: adapter 自动用 OIDC refresh_token grant 主动刷新（用 sqlite auth_kv 里的 device-registration client_id/secret）**

### 前端组件改动 (本轮 build 进 dist)
- `frontend/src/components/chat/QuotaIndicator.tsx` 新建 134 行
- `frontend/src/components/chat/ChatInput.tsx` import + 渲染 QuotaIndicator (compact prop 跟 PermissionModeSelector 同步)
- `frontend/src/api/websocket.ts` 复用 OPEN 连接给新 handler queueMicrotask 补发 connected 帧
- 其他 cc-haha 原版前端代码（535 文件）已 git tracked，clone build 即可复现

### 路径速查
- adapter src: `~/kiro-adapter/{server.js,acp.js}`
- adapter bundle: `~/kiro-gui/src-tauri/adapter/{server.js,acp.js}` (打包前必须 cp 同步！)
- frontend src: `~/kiro-haha-repo/frontend/`（git，已完整）+ `/tmp/cc-haha/desktop/`（macOS 会清 /tmp，可能不全；用 git 仓库版本）
- tauri shell: `~/kiro-gui/src-tauri/`
- git repo: `~/kiro-haha-repo/`（main 已推 v0.2.0）
- icon: `~/Downloads/codex项目/kiro_app_icon/Kiro_1024.png`
- 备份: `/tmp/kiro-haha-pkg-{1,23,browser}-backup/` （可能被清）

### 打包流程速查（5 步）
```bash
# 0. 同步 adapter 到 bundle (容易忘！)
cp ~/kiro-adapter/{server.js,acp.js} ~/kiro-gui/src-tauri/adapter/

# 1. 前端 build
export PATH="$HOME/.bun/bin:$PATH"
cd ~/kiro-haha-repo/frontend && VITE_DESKTOP_SERVER_URL=http://127.0.0.1:3789 bun run build
rm -rf ~/kiro-gui/cchaha-dist && cp -R ~/kiro-haha-repo/frontend/dist ~/kiro-gui/cchaha-dist

# 2. tauri build (含签名)
source "$HOME/.cargo/env"
export TAURI_SIGNING_PRIVATE_KEY=$(cat ~/.tauri/kiro-haha.key)
export TAURI_SIGNING_PRIVATE_KEY_PASSWORD="kiro-haha-2026"
cd ~/kiro-gui && npm run tauri build

# 3. 部署
pkill -f kiro-haha; sleep 1
rm -rf "/Applications/kiro-haha.app"
cp -R ~/kiro-gui/src-tauri/target/release/bundle/macos/kiro-haha.app /Applications/
xattr -cr "/Applications/kiro-haha.app"
lsof -ti:3789 | xargs kill -9; sleep 1
open "/Applications/kiro-haha.app"

# 4. 验证
sleep 4 && curl -s http://127.0.0.1:3789/health
curl -s http://127.0.0.1:3789/api/quota
```

### 待办（下一对话接续）
- [ ] 用户在 GitHub 上加 2 个 Secrets (`TAURI_SIGNING_PRIVATE_KEY` = `cat ~/.tauri/kiro-haha.key`, `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` = `kiro-haha-2026`) → 让 workflow 能跑
- [ ] 用户决定要不要发布 v0.2.0 Release（OAuth code `48CB-0566` 应该已过期，需要重新 device flow 或方案 C 拖文件）
- [ ] **token 自动 refresh**（OIDC refresh_token grant），免去用户偶尔需要打开 kiro IDE 刷新
- [ ] HTML 文件预览顶部加「▶ 浏览器渲染」按钮（cc-haha 默认走代码视角，渲染版要按钮触发）
- [ ] CurrentTurnChangeCard 默认 'diff' 改成 git/non-git 智能选（adapter 加 inGitRepo 字段，前端 1 行）
- [ ] ToolCallBlock chip 等 tool_result 才可点（cc-haha 原版 chip 出现就可点，但工具未完成时点了看不到正确内容）
- [ ] 历史 commits / clean up：今天的改动是 squash 一个 commit `1e16932`，下次想拆细可分 6-8 个

## 📌 上一阶段进度 (2026-06-04 ~ 2026-06-05)

### 自包含打包 + 跨平台
- **适配器打包进 Tauri 资源**：`~/kiro-gui/src-tauri/adapter/`（含 server.js + acp.js + node_modules 17MB），声明在 `tauri.conf.json` `bundle.resources`，构建后位于 `Contents/Resources/adapter/`。
- **`lib.rs` 跨平台重写**：`resolve_adapter_dir()` 优先用 bundled 资源，回退 `~/kiro-adapter`。`node_bin()` 平台分流：Mac 检 `/usr/local/bin/node` `/opt/homebrew/bin/node` `/usr/bin/node` + `which`；Windows `where node`。`start_adapter` 在 setup hook 里调（拿到 `app.handle()`）。
- **本地实测**：临时挪走 `~/kiro-adapter` 后启动 app，bundled adapter 正常 spawn、health ok。dmg 体积 14MB。
- **GitHub Actions 双 workflow**：`.github/workflows/build-{macos,windows}.yml` push main 自动产 dmg/msi/exe，打 tag `v*` 自动 attach 到 Release。
- **README.md** 完整：装 Kiro CLI + Node + 下载 .dmg/.msi 三步；含项目结构 + 源码构建命令。

### 用户操作要求
- 终端用户唯一前置依赖：**Node.js (≥18) + Kiro CLI**（AWS 官方，登录 Builder ID 拿 credits）
- ACP 配置无需用户填，适配器自动 spawn `kiro-cli acp`

### Codex 风格消息队列（chatStore + ChatInput + MessageQueue）
- 新增 `messageQueue: QueuedMessage[]` per-session 状态 + actions: `enqueueMessage` / `removeQueuedMessage` / `clearMessageQueue` / `flushQueuedMessage`
- ChatInput busy 时（chatState !== 'idle'）Enter 不再 toast 拒绝，**直接入队**并清空输入框
- 队列 UI 在 composer 上方，每条 pill 含截断文字 + ×：点 × 单删，点文字回填到输入框编辑（同时移出队列），右上有"清空"
- 自动 flush：`message_complete` 完成后 50ms + `stopGeneration` 完成后 50ms 触发 `flushQueuedMessage`，按 FIFO 自动发下一条
- 视觉用 `--color-*` 设计令牌，三主题（light/white/dark）自动适配

### Kiro IDE 风格 Rewind（铅笔按钮真删）
- **适配器**：`/api/sessions/:id/turn-checkpoints` 返回每条 user 消息的 checkpoint（targetUserMessageId/userMessageIndex/userMessageCount）；`/api/sessions/:id/rewind` 找到第 N 个 Prompt 的字节偏移，物理截断 .jsonl，清 JSONL_CACHE，强制 close 该 sessionId 的所有 WS（`ws.sessionId` stash + `wss.clients` 遍历 terminate）让前端重连开干净 ACP 子进程
- **前端**：UserMessage hover 时铅笔（之前是软-restore 复制内容）已升级，先尝试 `handleRewindToTarget(target)` 真 rewind→reloadHistory→queueComposerPrefill，无 target 才回退到软 restore
- 失败：必须是已完成 turn（即至少有一条 assistant 回复），否则 completedTurnTargets 不包含这条，铅笔降级为软 restore

### 体验稳定性修复（一系列硬骨头）
- **JSONL 增量缓存**：之前我加的"只读最后 8MB"截断在 message_complete 后 loadHistory 时把内存 live 消息覆盖成截断版本（"对话过程中消失"症状）。改为 mtime+size 失效的全量缓存，首次 144MB session 0.72s 解析、warm cache 35ms，**不截断**所以重连合并不丢消息
- **disabled `refreshCompletedTranscriptHistory`** in chatStore message_complete 后：那个调用触发 loadHistory→merge 与 stream 完成的新消息打架。注释掉后 stream 消息保留稳定。代价：app 持续打开时不再自动同步外部（CLI TUI）写入，可接受
- **图片附件传输**：acp.js `user_message` 之前只传 m.content 文本，**附件全部丢弃**。现在转成 ACP image content blocks（处理 data URL + 裸 base64），文件类附件转 `@path` 引用塞进文本。实测真截图能识别（Bedrock 错误"Could not process image"是测试用的 hex PNG 格式不合法，真 PNG 一切正常）
- **PermissionModeSelector 空白按钮**：用户设置文件 permissionMode="auto" 不在 PermissionMode 枚举（default/acceptEdits/plan/bypassPermissions/dontAsk），MODE_ICONS/LABELS["auto"] 是 undefined → 渲染空白。前端加白名单防御回退到 'default'，server.js 默认改 'default'，已保存的 settings.json 直接改写
- **Session lock orphan cleanup 撤回**：之前加的"启动时杀 kiro-cli 孤儿 ACP"过于粗暴，把用户 CLI TUI 的 ACP 子进程也杀了。**已完全移除**这段代码。Session 被锁的处理改为：session/load 报 `Session is active in another process` 时 acp.js 把 error 转成前端 error 帧 + close ws，让用户能看到原因（之前是静默 0-credits 假象）
- **Streaming indicator 漏显**：MessageList 之前只在 chatState='tool_executing' 或 'thinking && !activeThinkingId' 显示 indicator。在 'streaming' 期间长 chunk 间隔时用户看不到任何活动 → 误判卡死。已加 streaming 状态触发，含已耗时秒数 + token 数动态展示

### 模型 + 运行时持久化（修"切回会话模型变 auto"）
- acp.js 新增 `~/.kiro-haha-runtime.json` 按真实 ACP UUID 持久化 `{modelId, providerId}`
- WS handshake 完成后从磁盘读回 → 作为本会话 `curModel`，并 wsSend `connected` 帧带 `runtimeSelection`
- `set_runtime_config` WS 消息持久化到磁盘
- `session/prompt` **永远显式带 model**（即使 'auto'），消除 Kiro CLI ACP "0-credits 空响应" 偶发 bug
- 前端 chatStore connected handler：收到 `runtimeSelection` 时若本地 store 不一致就同步过来，让 model chip 显示正确

### 文件类工具调用 → 右侧面板预览
- ToolCallBlock：检测 input.path 或 input.file_path 即视为 fileTool（兼容 Kiro `fs_write` 真实工具名），对话里只显示**蓝色虚线下划线 + 完整路径**的可点击 chip + ↗ 图标，**不再内联展开代码**
- 点击 → `useWorkspacePanelStore.openPreview(sessionId, path, kind)` 在右侧面板按格式渲染（代码语法高亮 / Markdown / 图片 / diff）
- Edit 类（detect `command:'strReplace'` 或 `old_string`）打开 diff，否则普通文件预览
- ChatSessionContext 提供 sessionId fallback，避免逐层 prop drilling

### 图标二次替换（用户提供新 PNG）
- 用 `/Users/lvbaoze/Downloads/codex项目/kiro_app_icon/Kiro_1024.png`（紫底白幽灵清晰版）替换原水彩稿
- Python PIL 一次生成：`public/app-icon.png` (1024) + Tauri icons 全套 PNG + macOS .icns + **Windows .ico (16/32/48/64/128/256 多尺寸)**
- 部署后 killall Dock + Finder 强刷图标缓存

### Skill: claude-code-delegate
- 写在 `~/.agent-shared/skills/claude-code-delegate/SKILL.md`
- 触发词："用 claude 干"/"委派给 cc"/"用 claude code 跑"
- 行为：调 `claude --print --output-format text "<原任务>"`（Anthropic 预算池，不消耗 Kiro credits），结果原样返回。可选 `--dangerously-skip-permissions` 当用户明确同意/在 bypass 模式
- 适配器 `/api/skills` 已识别（实测返回 ✓ claude-code-delegate）；用户在 Kiro Haha 任意会话直接说自然语言即可

### GitHub 同步
- repo: https://github.com/lyubaoze999-alt/kiro-haha
- 最新 commit `51161cc`：feat: 自包含打包 + 跨平台构建（适配器进 bundle / lib.rs 跨平台 / Mac+Win workflow / README）
- 推送方式：SSH key (`ssh-ed25519 ...lvbaoze901@hellobike.com`) 已加到 lyubaoze999-alt 账号

### 当前部署状态
- adapter PID 持续运行，所有最新改动都跑在内存里
- /Applications/kiro-haha.app 是用新 Kiro 幽灵图标 + bundled adapter + 全部前端改动的版本
- ~/kiro-haha-repo 已和本地最新代码同步并推送

---

## 历史进度（含早期记录）

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
