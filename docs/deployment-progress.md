# GPT Image Playground 项目进度

最后更新：2026-08-22

## 当前版本

- 应用版本：`v0.7.6`
- 当前发布分支：`main`
- 当前功能基线提交：`4e8e4e1 feat: default per-IP concurrency to two`
- 定制仓库：`https://github.com/carsonte/gpt_image_playground.git`
- 官方上游：`https://github.com/CookSleep/gpt_image_playground.git`
- 官方 `v0.7.6` 已完成差异检查、冲突处理、完整验证、推送和生产部署。

## 2026-08-22 最新更新

- `5ca8968`：新增按真实 IP 的公平队列与运行/排队配额。
- `b485fdd`：托管版首页数量固定为 1，服务器拒绝任何单次多图请求。
- `4e8e4e1`：单 IP 默认并发由 1 调整为 2，后台仍可在 1～20 之间修改。
- 当前默认规则为全站并发 4、单 IP 并发 2、单 IP 最多排队 3、每个请求生成 1 张。
- 上述更新均已通过测试、构建、Git 推送和生产部署。

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
- 默认单 IP 并发：`2`
- 默认单 IP 排队上限：`3`

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

- 首页数量固定为 1 且不可修改，服务器同时拒绝任何 `n > 1` 的代理请求。
- 全站请求采用先进先出队列。
- 默认同时运行 4 个请求，后台可调整为 1～20。
- 默认每个 IP 最多同时生成 2 个、排队 3 个，两个上限均可在后台调整。
- 调度器会跳过已达到并发上限的 IP，让其他 IP 优先使用空闲槽位。
- 单 IP 超出运行与排队配额时返回 HTTP 429，不再挤占全站队列。
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
- 系统设置集中管理全站并发、单 IP 并发、单 IP 排队上限和首页提示。

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
- `npm test`：33 个测试文件、512 个测试全部通过。
- `npm run test:server`：通过。
- `npm run verify:release`：通过。
- Docker 生产构建：通过。
- 容器健康检查：通过。
- HTTP 反向代理：通过。
- HTTPS 证书与跳转：通过。
- 正式首页加载：通过。
- 生产接口 `/api/health` 返回 `ok: true`、`upstreamConfigured: true`。
- 生产队列接口 `/api/queue/status` 返回并发上限 `4`。
- 生产容器状态为 `healthy`。

## 敏感信息规则

- 不在本文档、Git、前端源码或构建产物中记录 API Key。
- 不记录管理员明文密码、密码哈希、Session 密钥、统计哈希密钥或证书私钥。
- 不把 `deploy/.env.server`、SQLite 数据库或备份提交到仓库。
- 后台可查看提示词和真实 IP，但通用日志不得记录完整提示词、原始 IP、Authorization 或 Cookie。

## 后续工作

1. 后续官方更新先合并到本地，完成冲突排查、测试、构建和浏览器验收后再发布。
2. 较大版本更新可先创建临时集成分支，确认兼容后合入 `main`。
3. 继续观察正式环境的生图成功率、平均耗时、并发队列和异常日志。
4. 定期检查 `deploy/data/backups/`，确认 SQLite 备份可以正常恢复。

## 一键直传更新

- 本地命令：`npm run deploy:server`
- 本地 SSH 配置：`.deploy.local`（已忽略，不提交）
- 服务器执行器：`deploy/update-from-bundle.sh`
- 不依赖 Git 仓库，适用于当前压缩包部署方式。
- 自动执行发布验证、打包、上传、源码备份、SQLite 在线备份、Docker 构建、健康检查和失败回滚。
- 已在生产环境实际执行并验证成功。
- 已单独完成发布验证、仅需重新上传时可运行 `npm run deploy:server -- --skip-verify`。
- `.deploy.local` 和专用 SSH 私钥只保存在本机，不进入 Git。

## 后续接手提示

继续工作前先阅读：

- `docs/deployment-progress.md`
- `docs/baota-admin-announcement-plan.md`
- `docs/update-workflow.md`
- `deploy/UPDATE.md`

任何服务器更新都应先在本地执行测试和构建，再同步到生产环境。不要直接让服务器跟随原作者仓库更新。
