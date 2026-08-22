# GPT Image Playground 项目进度

最后更新：2026-08-22

## 当前状态

- 本地项目目录：`C:\Users\wooop\Desktop\gpt-img`
- 正式域名：`https://img2.blackengine.top`
- 管理后台：`https://img2.blackengine.top/admin`
- 宝塔服务器：`81.71.96.181`
- 项目部署目录：`/www/wwwroot/img2.blackengine.top`
- Docker 容器：`gpt-image-playground`
- 容器镜像：`gpt-image-playground-server:local`
- 应用监听：`127.0.0.1:8080`
- 上游 API：`https://api.blackengine.top/v1`
- 默认模型：`gpt-image-2`
- 默认全站并发：`4`

## 已完成功能

### 前台

- 服务端托管上游 API URL 和 API Key，前端无法读取或修改真实 Key。
- 图片、参考图和画廊数据仍保存在用户浏览器本地，服务器不保存图片。
- 首页顶部显示本地存储说明和生图队列状态。
- 本地存储说明支持后台开关和修改文字。
- 生图队列状态支持后台开关。
- 支持白天和夜间模式，切换按钮位于顶部。
- 已隐藏设置中的“关于作者”页签。
- 已隐藏服务器托管模式下不应由普通用户修改的 API 配置。
- 公告支持弹窗、仅弹一次、置顶悬浮横条和关闭。

### 生图队列

- 全站请求采用先进先出队列。
- 默认同时运行 4 个请求，后台可调整为 1～20。
- 首页显示生成中、排队和并发上限。
- 后台“实时任务”每 2 秒刷新。
- 实时任务显示正在生成和排队请求的真实 IP、提示词、动作、尺寸、数量、等待时间、运行时间和请求 ID。
- 公开接口只返回队列数量，不暴露 IP 或提示词。

### 管理后台

- 导航已按“监控 / 运营 / 系统”重新分组。
- 数据看板包含独立 IP、访问次数、生图请求、图片数量、成功失败、平均耗时、日均请求和单日峰值。
- 支持每日趋势、1K/2K/4K 分辨率统计和热门关键词。
- 生成记录支持日期筛选和文字搜索。
- 生成记录保存真实 IP、提示词、动作、尺寸、数量、状态和耗时，不保存图片。
- IP 管理支持查看真实 IP 使用情况并拉黑滥用 IP。
- 日志中心记录管理操作、请求、安全事件和脱敏错误。
- 系统设置集中管理队列并发和首页提示。

## 服务器部署结果

- Docker 生产镜像已成功构建。
- 容器健康检查通过：`/api/health` 返回 `ok: true` 和 `upstreamConfigured: true`。
- 宝塔反向代理已配置到 `http://127.0.0.1:8080`。
- Let's Encrypt 证书已签发并部署，有效期至 2026-11-20。
- HTTP 已自动跳转 HTTPS，并启用 HSTS。
- 正式首页返回 200，浏览器控制台无错误或警告。
- `/api/queue/status`、`/api/announcements` 和 `/api/health` 均验证正常。
- 服务器密钥文件位置：`deploy/.env.server`，权限为 `600`。
- 持久化数据目录：`deploy/data`，容器更新时不得删除。
- 本机用于上传的临时生产密钥文件已经删除。

## 构建兼容修正

- Docker 基础镜像由 Node 24 调整为 Node 22 LTS。
- `better-sqlite3` 安装阶段临时安装 `python3`、`make` 和 `g++`。
- 运行镜像完成原生依赖编译后会卸载编译工具。
- Debian 软件源切换为 `mirrors.cloud.tencent.com`，适配广东腾讯云服务器。

## 验证记录

- `npm run build`：通过。
- `npm test -- --run`：33 个测试文件、496 个测试全部通过。
- `npm run test:server`：通过。
- Docker 生产构建：通过。
- 容器健康检查：通过。
- HTTP 反向代理：通过。
- HTTPS 证书与跳转：通过。
- 正式首页加载：通过。
- 尚未执行真实生图测试，避免未经确认消耗上游 API 额度。

## 敏感信息规则

- 不在本文档、Git、前端源码或构建产物中记录 API Key。
- 不记录管理员明文密码、密码哈希、Session 密钥、统计哈希密钥或证书私钥。
- 不把 `deploy/.env.server`、SQLite 数据库或备份提交到仓库。
- 后台可查看提示词和真实 IP，但通用日志不得记录完整提示词、原始 IP、Authorization 或 Cookie。

## 后续工作

1. 用户确认后执行一次正式生图，验证 BlackEngine 全链路。
2. 验证后台登录、公告发布、实时任务和生成记录在正式域名下的行为。
3. 将定制版本推送到自己的私有仓库或专用部署仓库。
4. 建立 `stable` 分支，服务器更新只跟随经过本地测试和人工验收的版本。
5. 首次稳定运行后创建数据库和部署目录备份。
6. 后续更新使用 `bash deploy/update-server.sh`，更新失败时自动回滚。

## 一键直传更新

- 本地命令：`npm run deploy:server`
- 本地 SSH 配置：`.deploy.local`（已忽略，不提交）
- 服务器执行器：`deploy/update-from-bundle.sh`
- 不依赖 Git 仓库，适用于当前压缩包部署方式。
- 自动执行发布验证、打包、上传、源码备份、SQLite 在线备份、Docker 构建、健康检查和失败回滚。

## 后续接手提示

继续工作前先阅读：

- `docs/deployment-progress.md`
- `docs/baota-admin-announcement-plan.md`
- `docs/update-workflow.md`
- `deploy/UPDATE.md`

任何服务器更新都应先在本地执行测试和构建，再同步到生产环境。不要直接让服务器跟随原作者仓库更新。
