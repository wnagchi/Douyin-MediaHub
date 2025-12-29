# 抖音视频支撑 / 媒体资源库（内网工具）

这是一个 Node.js 本地/内网媒体浏览工具：服务端扫描资源目录，前端在浏览器里按「发布时间 / 发布人 / 主题」自动分组展示，并支持视频/图片预览与下载。

前端使用 **Vite + React + TypeScript** 构建，后端使用纯 Node.js HTTP 服务器。

## 近期优化点（功能 + 性能）

### 前端功能

- **展开模式**：卡片更大、预览更多缩略图（会记住开关状态）
- **按发布人分组**：按 `author` 分组展示（会记住开关状态）
- **瀑布流（卡片）**：卡片列表支持 columns 瀑布流布局
- **平铺模式（瀑布流）**：所有资源条目（图片/视频）拉平，以瀑布流 tile 展示（更适合竖屏内容）
- **移动端可收起顶部工具栏**：减少占屏（会记住开关状态）
- **样式体系**：已接入 Tailwind（为避免影响既有样式，默认关闭 preflight）

### 后端性能

- **SQLite 索引缓存**：不再每次请求 `/api/resources` 都全量扫描目录；启动时做一次增量检查，后续请求直接查库
- **外部钩子 API**：可从外部触发一次增量更新检查（适合定时任务/上传后通知刷新）

## 开发模式

要求：安装 Node.js（建议 18+）。

首次运行需要安装依赖：

```bash
npm install
```

开发模式（同时启动后端和前端开发服务器）：

```bash
npm run dev
```

- 后端服务（dev）：`http://localhost:3001`
- 前端开发服务器：`http://localhost:5173`（若端口被占用会自动顺延到 5174/5175…）
- 代理：Vite 会把 `/api/*`、`/media/*` 代理到后端 3001

## 生产模式

构建前端：

```bash
npm run build
```

启动生产服务器：

```bash
npm run start
```

浏览器访问：`http://localhost:3000/`（由 Node 服务器托管构建后的前端）

## 配置资源目录

- 页面里可配置多个资源目录（每行一个**绝对路径**）
- 保存后会写入项目根目录 `config.json`

也可以用环境变量覆盖（适合部署到内网服务器）：

- `MEDIA_DIR`: 单个目录（绝对路径）
- `MEDIA_DIRS`: 多个目录，用 `;` 分隔（绝对路径）
- `PORT`: 服务端端口（默认 3000）
- `INDEX_DB_PATH`: SQLite 索引库路径（默认 `data/index.sqlite`）
- `LAN_IP` / `LAN_HOST`: 强制指定启动日志输出的局域网访问 IP（可选）
- `HOOK_TOKEN`: 钩子 API 鉴权 token（可选）

## 内网访问（多端）

服务端默认监听 `0.0.0.0`，因此同网段可通过 `http://内网IP:PORT/` 访问。

如无法访问：

- 检查 Windows 防火墙/安全软件是否放行端口
- 确认资源目录是在服务端那台机器上可访问的路径（本地盘/共享盘映射等）

## 目录结构

- `app.js`: 启动入口（薄封装，调用 `src/server.js`）
- `src/`: 服务端模块
  - `src/server.js`: 启动与装配（托管 `dist/` 目录）
  - `src/handler.js`: 路由与请求处理
  - `src/config/`: 配置与目录管理
  - `src/media/`: 扫描/分组/inspect
  - `src/http/`: 静态文件与响应工具
- `web/`: 前端源码（Vite + React + TypeScript）
  - `web/src/`: React 组件和逻辑
  - `web/index.html`: HTML 入口
- `dist/`: 前端构建产物（运行 `npm run build` 后生成，由 Node 服务器托管）

## API 说明（片段）

- `GET /api/resources`
  - 支持分页：`page`（默认 1）、`pageSize`（默认 30，最大 200）
  - 支持筛选：`type`（对应顶部 chips）、`dirId`（目录选择）、`q`（搜索）
  - 返回字段包含 `pagination`（当前页、总数、是否还有更多等），前端会按需增量加载，避免一次拉取全部资源。

- `POST /api/reindex?force=0|1`
  - 触发一次索引增量更新检查
  - `force=0`：仅对变更目录做增量更新（默认）
  - `force=1`：强制扫描（适合外部脚本想确保完全刷新）
  - 可选鉴权：设置 `HOOK_TOKEN` 后，需提供 `?token=xxx` 或请求头 `x-hook-token: xxx`


