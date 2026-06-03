# Kiro Haha

一个 UI/功能对齐 cc-haha 桌面工作台、但后端用 **Kiro CLI**（ACP 协议）驱动的桌面应用。

## 结构
- `adapter/` — Node 适配器：HTTP `/api/*` + WS `/ws/:id`，桥接 Kiro CLI 的 ACP（JSON-RPC over stdio）。端口 3789。
- `tauri-shell/` — Tauri 外壳（`src-tauri/`：spawn 适配器、`get_server_url`、应用图标/配置）。
- `frontend/` — cc-haha 开源前端的分支，构建产物供 Tauri 加载。

## 构建与运行
```bash
# 1. 适配器依赖
cd adapter && npm install

# 2. 前端构建
cd ../frontend && bun install
VITE_DESKTOP_SERVER_URL=http://127.0.0.1:3789 bun run build

# 3. 打包桌面应用（需把 frontend/dist 复制到 tauri-shell/cchaha-dist）
cp -R dist ../tauri-shell/cchaha-dist
cd ../tauri-shell && npm run tauri build
```

应用启动时自动 `node adapter/server.js`（单实例，端口被占用则复用现有实例）。
