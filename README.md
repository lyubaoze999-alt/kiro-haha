# Kiro Haha

一个 UI/功能对齐 [cc-haha](https://github.com/NanmiCoder/cc-haha) 桌面工作台、但**后端用 Kiro CLI（ACP 协议）**驱动的多端桌面应用。

## ✨ 核心特性

- 🎨 **品牌化界面**：Kiro 粉紫小幽灵图标 + 三主题适配（light / white / dark）
- 💬 **完整对话能力**：流式回复、思考过程、工具调用、多模型切换（10 个 Kiro 模型，含 minimax / deepseek / qwen 低成本选项）
- 🛡️ **执行权限审核**：默认/接受编辑/计划/全部接受四档；写文件/执行命令前可弹卡审批
- 📋 **Codex 风格消息队列**：agent 跑着的时候打字会进入排队，按顺序自动发送，支持单条移除/编辑
- ⏪ **Kiro IDE 风格 rewind**：hover 历史消息点铅笔 → 删该消息及之后所有内容 → 内容回填输入框可改可重发
- 📂 **文件链接 + 右侧预览**：写/读/改文件不再在聊天里塞代码，显示成可点击 chip → 右侧面板按格式渲染（代码/diff/Markdown/图片）
- 🖼️ **图片/截图识别**：粘贴截图直接发给模型识别
- 🎯 **会话恢复无损**：模型选择按真实 UUID 持久化、142MB 大会话秒开（增量缓存）

## 📦 安装

> **当前最新版：[v0.2.3](https://github.com/lyubaoze999-alt/kiro-haha/releases/latest)**（2026-06-09）。
> 普通用户走预构建包；想改代码看下面"从源码构建"。

### 前置依赖（必须，否则 app 内一片空）

1. **Kiro CLI**：从 [AWS Kiro 官方页](https://kiro.dev) 下载 → 启动 → 登录 AWS Builder ID 拿 credits 配额。**装完先在终端跑一次 `kiro-cli login`** 完成认证，否则 quota 卡片是灰色的、聊天发不出。
2. **Node.js ≥ 18**：`brew install node`（Mac）或从 [nodejs.org](https://nodejs.org) 下 .msi（Win）。

> 仅当你想自己 build 才需要：bun (`curl -fsSL https://bun.sh/install | bash`) + Rust toolchain (`curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh`)。普通使用不需要这两个。

### macOS（Apple Silicon, M1/M2/M3）

去 [Releases](https://github.com/lyubaoze999-alt/kiro-haha/releases/latest) 下载 `kiro-haha_X.Y.Z_aarch64.dmg` → 双击 → 拖进 Applications → 第一次启动**右键→打开**绕过 Gatekeeper。

> Intel Mac 暂时只能从源码构建（workflow 没配 x86_64 macOS target，下一轮补）。

> 适配器（`server.js`）已打包进 `.app` bundle 内，无需额外配置。app 启动时自动 spawn 监听 3789 端口。第一次启动会有 FirstRunGuide modal 自检——4 项全 ✓ 才能用。

### Windows

下载 `kiro-haha_X.Y.Z_x64-setup.exe`（推荐）或 `.msi` 双击安装。

> Windows 自动更新当前**只检测但不会自动安装新版本**（latest.json 里 `platforms` 字段只列 darwin-aarch64）。Windows 用户需要手动到 Releases 页下载新版替换。这个会在下一轮修。

### Linux

暂未提供预构建包，从源码构建即可（见下面）。

### 把 app 发给同事的话术

```
1. 装前置（一次性）：
   - Kiro CLI: https://kiro.dev → 装完跑 `kiro-cli login`
   - Node.js: https://nodejs.org （≥ 18）

2. 装 app：
   👉 https://github.com/lyubaoze999-alt/kiro-haha/releases/latest
   - Mac (M1/M2/M3): 下 .dmg
   - Windows: 下 .exe
   - Mac Intel / Linux: 找我（暂时要源码 build）

3. 第一次启动 macOS：右键 → 打开（绕过 Gatekeeper，一次就够）。
   FirstRunGuide modal 会自检，按提示跑命令补齐缺失项。
```

## 🚀 使用

打开 Kiro Haha，新建会话选个项目目录，就可以开始用了。

- **切换模型**：对话框右下"模型"下拉。日常开发推荐 **minimax-m2.5**（0.25x credits，10 倍便宜于 Opus）；架构/调试切 **claude-sonnet-4.6** 或 **opus**。
- **切权限模式**：对话框左下盾牌按钮。
- **历史对话编辑**：hover 你发过的消息 → 右下角 ✏️ → 该消息之后内容删除 + 内容回输入框给你改。
- **截图发送**：直接 Cmd+V 粘贴到输入框。

## 🏗️ 项目结构

```
kiro-haha/
├── adapter/        # Node 适配器：HTTP /api/* + WS /ws/:id，桥接 Kiro CLI ACP 协议
│   ├── server.js   # HTTP+WS 路由、会话/消息 API、turn-checkpoints/rewind
│   └── acp.js      # ACP <-> ServerMessage 桥接、权限决策、模型/runtime 持久化
├── tauri-shell/    # Tauri 桌面外壳（产 .app/.dmg/.exe/.msi）
│   ├── src-tauri/
│   │   ├── src/lib.rs       # 启动时 spawn adapter（先找 bundled，回退 ~/kiro-adapter）
│   │   ├── adapter/         # bundled adapter (server.js + acp.js + node_modules)
│   │   └── icons/           # Kiro 幽灵图各尺寸
│   └── package.json
└── frontend/       # cc-haha 前端的分支（已品牌化为 Kiro Haha）
```

## 🔧 从源码构建（推荐 v0.2.0 路径）

```bash
# 0. clone
git clone https://github.com/lyubaoze999-alt/kiro-haha.git
cd kiro-haha

# 1. 适配器依赖
cd adapter && npm install

# 2. 前端构建
cd ../frontend && bun install
VITE_DESKTOP_SERVER_URL=http://127.0.0.1:3789 bun run build

# 3. 同步 adapter 到 tauri-shell 内部供打包
mkdir -p ../tauri-shell/src-tauri/adapter
cp -R ../adapter/{server.js,acp.js,package.json,package-lock.json} ../tauri-shell/src-tauri/adapter/
(cd ../tauri-shell/src-tauri/adapter && npm install --omit=dev)

# 4. 同步前端 dist
cp -R dist ../tauri-shell/cchaha-dist

# 5. 打包
cd ../tauri-shell && npm install && npm run tauri build
# 产物在 src-tauri/target/release/bundle/{macos,dmg,msi,nsis}/
```

构建完毕：

- **macOS**：`tauri-shell/src-tauri/target/release/bundle/dmg/kiro-haha_0.2.0_aarch64.dmg`
- **Windows**：`tauri-shell/src-tauri/target/release/bundle/msi/kiro-haha_0.2.0_x64.msi` 或 `nsis/*.exe`

## 🔁 Fork 后你需要改的（如果想做自己的更新链路）

`tauri-shell/src-tauri/tauri.conf.json` 里有两段需要换成你自己的值：

1. `plugins.updater.endpoints` —— 现在指向 `lyubaoze999-alt/kiro-haha` 的 Release。fork 后改成你自己仓库的 URL，否则别人用你的 app「检查更新」会拉到上游版本。
2. `plugins.updater.pubkey` —— 当前是上游的 minisign 公钥。你想签自己的 update 包要重新生成 keypair：
   ```bash
   cd tauri-shell && npx tauri signer generate -w ~/.tauri/your-key.key
   ```
   把生成的 `.pub` 内容替换 `pubkey` 字段，私钥设为 GitHub Secret `TAURI_SIGNING_PRIVATE_KEY`，密码设为 `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`，workflow 自动签产物。

如果不需要自动更新，这两个保持原样不影响 app 跑（更新检查会失败但不报错）。

## 🤝 贡献

issue / PR 欢迎，没有签 CLA。
