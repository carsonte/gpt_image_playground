# 服务器一键更新

## 不依赖 GitHub：本地直传更新

当前生产环境采用此方式。在本地项目目录执行：

```bash
npm run deploy:server
```

首次使用前复制 `.deploy.local.example` 为 `.deploy.local`，填写 SSH 地址、端口、用户和可选的私钥路径。该文件已被 Git 忽略。

这条命令会在本地完成测试和构建，自动打包并通过 SSH 上传。服务器会备份源码和 SQLite 数据库，构建新镜像并检查健康状态；失败时恢复旧镜像、源码和数据库。更新包不会包含 API Key、后台密码、数据库、图片或本地环境配置。

标准发布顺序：

1. 合并或完成本地改动。
2. 执行 `npm run verify:release`。
3. 在浏览器验收前台和后台。
4. 提交并推送到 `origin/main`。
5. 执行 `npm run deploy:server`。
6. 确认公网 `/api/health`、`/api/queue/status` 和容器健康状态。

验证已经单独完成、只需重试上传时，可使用：

```bash
npm run deploy:server -- --skip-verify
```

只检查本地打包、不连接服务器时，可使用 `npm run deploy:server -- --skip-verify --dry-run`。

## 备用方式：服务器通过 Git 更新

正式部署后，在宝塔终端进入项目目录，执行：

```bash
bash deploy/update-server.sh
```

脚本会依次完成：

1. 阻止多个更新任务同时运行。
2. 检查服务器代码是否有未提交修改。
3. 拉取指定远程仓库和分支，且只接受安全的快进更新。
4. 使用 SQLite 在线备份创建一致的数据备份。
5. 保留旧镜像，构建新镜像时旧服务继续运行。
6. 启动新版本并检查 `/api/health`。
7. 健康检查失败时恢复旧镜像和更新前数据库。
8. 保留最近 10 份数据库备份，并记录 `deploy/data/update.log`。

## 首次配置

```bash
cp deploy/.env.server.example deploy/.env.server
```

编辑 `deploy/.env.server`，填入 API Key、后台密码哈希及两个随机密钥。该文件已被 Git 忽略，不会随着代码更新被覆盖。

该脚本默认配置仍可用于 Git 部署，但当前生产服务器使用上面的本地直传流程。不要让生产服务器直接跟随官方 `upstream`，避免未经检查的改动直接上线。

需要临时使用其他远程仓库或分支时：

```bash
DEPLOY_REMOTE=origin DEPLOY_BRANCH=main bash deploy/update-server.sh
```

如以后切换到 Git 部署，应确保服务器的 `origin` 指向定制仓库 `https://github.com/carsonte/gpt_image_playground.git`。官方仓库仅作为本地 `upstream`。远程仓库规划和上游合并流程见 `docs/update-workflow.md`。

## 恢复与排查

- 数据库备份：`deploy/data/backups/`
- 更新日志：`deploy/data/update.log`
- 容器日志：`docker compose --env-file deploy/.env.server -f deploy/docker-compose.server.yml logs --tail=200`

不要把 Docker Socket 挂载给网站容器，也不要把更新命令做成公网后台接口。更新操作仅通过宝塔终端或 SSH 执行。

## 最近一次生产更新

- 日期：2026-08-22。
- 版本：`v0.7.6`。
- 当前功能基线提交：`4e8e4e1`。
- 方式：`npm run deploy:server -- --skip-verify`（完整发布验证已提前通过）。
- 内容：单次生图数量固定为 1；全站默认并发 4；单 IP 默认并发 2、最多排队 3，后台可调整。
- 结果：源码和 SQLite 备份完成，新镜像构建成功，容器状态 `healthy`，公网健康检查通过。
