# Broken Arrow Tactical Command

实时现代合成兵种战术对战：自定义战斗群卡组、AI 遭遇战、多人房间。

**在线体验：** https://hana-ame.github.io/broken-arrow/

## 关于部署形态（重要）

这是一个 **前后端一体** 的项目，`server.ts` 里跑着 Express + WebSocket 服务，负责多人房间、聊天与权威模拟（10Hz tick），前端通过 `wss://<host>/ws` 连接。

本项目现部署在 **GitHub Pages（纯静态）**，因此：

| 功能 | 静态部署下的表现 |
|---|---|
| 单人遭遇战（Solo Skirmish） | 正常，战斗逻辑完全在浏览器内运行 |
| 卡组构建（Deck Builder） | 正常 |
| 战术地图与渲染 | 正常 |
| 多人房间 / 联机对战 / 房间聊天 | **不可用**，页面连不上 `/ws` 会一直显示未连接 |

需要联机时必须在有 Node 运行时的环境启动完整服务：

```bash
bun install          # 或 npm install
bun run dev          # = tsx server.ts，默认 http://localhost:3000
```

生产模式：先 `bun run build`，再以 `NODE_ENV=production node server.ts` 启动，服务会自己托管 `dist/` 并同时提供 `/ws`。

## 本地开发

```bash
bun install
bun run dev
```

`.env.example` 里的 `GEMINI_API_KEY` 是 AI Studio 模板文案，当前代码中没有调用 Gemini API。

## 部署说明

由 GitHub Actions 自动发布，本地无需构建：

- 工作流：`.github/workflows/deploy.yml`（Pages 发布源为 **GitHub Actions**，不使用 `gh-pages` 分支）
- 触发：推送到 `main`，或在 Actions 页面手动 `Run workflow`
- 构建：`oven-sh/setup-bun@v2` + `bun install --frozen-lockfile` + `bun run build`
- `vite.config.ts` 设置 `base: './'`，适配 `/broken-arrow/` 子路径

更新后推送即可：

```bash
git add -A && git commit -m "your change" && git push origin main
```
