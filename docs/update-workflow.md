# 上游同步与服务器更新流程

## 核心规则

服务器不直接拉取官方上游。无论变更来自官方还是我们自己，都必须先在本地完成检查和验收，再推送到定制仓库并通过一键直传更新服务器。

```text
原作者 upstream/main ─┐
                     ├─> 本地集成与排查 ─> origin/main ─> 本地一键直传服务器
我们的本地改动 ───────┘
```

这样可以同时保留原作者后续优化和我们的后台、公告、统计、日志、服务端代理等定制功能。

## Git 远程仓库规划

当前使用两个远程仓库：

- `upstream`：官方仓库 `https://github.com/CookSleep/gpt_image_playground.git`，只用于获取官方更新。
- `origin`：定制仓库 `https://github.com/carsonte/gpt_image_playground.git`，用于保存和发布我们的版本。

当前发布分支为 `main`。服务器不依赖 Git 拉取，而是接收本地验证完成后的发布包，因此不会误跟随未经检查的官方提交。

## 原作者发布新版本时

1. 获取 `upstream/main` 的新提交，但不直接更新服务器。
2. 更新较小时可在本地完成合并；更新较大时创建独立集成分支，例如 `integration/upstream-20260822`。
3. 检查上游差异，重点关注：
   - `src/store.ts` 的持久化与数据迁移。
   - API Profile、代理请求和生图响应格式。
   - Vite 构建环境变量与 Docker 配置。
   - 我们新增的 `/admin`、公告、统计、日志和服务器 API。
   - SQLite schema 是否需要向前兼容迁移。
4. 合并上游并逐项解决冲突，不以简单覆盖我们的定制代码作为解决方案。
5. 执行发布验证：

   ```bash
   npm run verify:release
   ```

6. 在本地浏览器验收前台生图、公告、后台登录、数据看板和日志。
7. 验收通过后才将该版本合入并推送到 `origin/main`。
8. 在本地运行 `npm run deploy:server`，由脚本上传发布包并更新服务器。脚本会在 Windows 自动使用 `npm.cmd`。

如果只需要重新上传已经完成验证的版本，可运行：

```bash
node scripts/deploy-server.mjs --skip-verify
```

`--skip-verify` 只适用于刚刚已经在同一工作区完成 `npm run verify:release` 的情况；不要用它跳过未验证的代码。

如果上游更新暂时不兼容，就保留当前线上版本，在集成分支继续修复；服务器不受影响。

## v0.7.6 同步记录

- 同步日期：2026-08-22。
- 官方版本：`v0.7.6`。
- 合并提交：`8099594 merge: upstream v0.7.6`。
- 冲突集中在 API Profile 导入兼容逻辑，解决时同时保留官方导入校验和服务端托管 API 判断。
- `npm run verify:release` 已通过：33 个测试文件、512 个测试、服务端冒烟测试和生产构建均成功。
- 已推送到 `origin/main`，并通过 `npm run deploy:server -- --skip-verify` 成功更新生产服务器。
- 公网 HTTPS、健康接口、队列接口和 Docker 容器健康状态均已复核。

## 我们自己发布新功能时

流程相同：本地开发完成后先执行 `npm run verify:release`，再做浏览器验收。只有确认通过的提交才推送到 `origin/main`，随后在本地运行 `npm run deploy:server`。

## 日常维护清单

### 发布前

1. 查看工作区和远程：`git status`、`git log -3 --oneline`、`git remote -v`。
2. 官方更新只从 `upstream` 获取，先在本地合并、排查冲突和兼容性。
3. 执行 `npm run verify:release`，确认测试、服务器冒烟测试和生产构建全部通过。
4. 浏览器验收前台两个模块、公告、队列、后台看板、生成记录和报错记录。
5. 只提交源码、测试、文档和部署脚本；不要提交 `.env.server`、`.deploy.local`、数据库、备份或用户图片。
6. 提交并推送：`git add <明确的文件>`、`git commit -m "..."`、`git push origin main`。

### 服务器更新

1. 使用 `npm run deploy:server`；脚本会打包本地已验证代码，不直接从官方仓库拉取。
2. 服务器端更新器会检查远程版本、备份源码和 SQLite、构建 Docker 镜像、启动新容器并执行健康检查。
3. 构建失败时旧容器继续运行；健康检查失败时自动回退镜像和数据库备份。
4. 更新后检查 `https://img2.blackengine.top/api/health`、首页、后台登录和实际生图链路。

### 服务器数据与密钥

- API Key、管理员密码哈希、Session 密钥和统计哈希密钥只放在服务器 `deploy/.env.server`，权限保持 `600`。
- SQLite 和备份只在服务器 `deploy/data/`，不要删除 `app.db`、WAL 文件或 `backups/`。
- 服务器不会保存用户图片；日志只保存必要的请求元数据、尺寸、线路、耗时和脱敏错误摘要。
- 定期确认 `deploy/data/backups/` 有最近备份，并抽查一次备份可恢复性。
- 不要在聊天、文档、提交记录或前端代码中粘贴 Key、密码、Cookie、私钥或完整原始 IP。

### 故障排查

- 先看后台“日志中心 → 报错记录”，用请求 ID 关联“生成记录”和“IP 管理”。
- 4K 图片编辑重点检查每条线路的 HTTP 状态、响应体中断、输入/遮罩大小和耗时；不要只根据“请求中断”判断原因。
- 宝塔 OpenResty 只读检查反向代理超时和容器状态，不要先删除数据或重置数据库。
- 上游渠道异常时先在本地用无私人内容的合成图复测，再决定是否调整路由或增加降级策略。

## 更新失败处理

- 本地验证失败：停止打包和上传，服务器不受影响。
- 服务器构建失败：旧容器继续运行，不切换版本。
- 新版本健康检查失败：自动恢复旧镜像和更新前数据库。
- 上游发生较大架构变化：继续使用当前线上版本，不要强行上线。

API Key、后台密码和随机密钥保存在服务器的 `deploy/.env.server`，不进入 Git，也不会被代码更新覆盖。SQLite 数据保存在 `deploy/data/`，每次更新前自动备份。本机连接信息保存在被忽略的 `.deploy.local`，SSH 私钥不得写入文档或仓库。
