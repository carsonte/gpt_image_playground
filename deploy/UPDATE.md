# 服务器一键更新

## 不依赖 GitHub：本地直传更新

当前宝塔服务器使用压缩包部署时，在本地项目目录执行：

```bash
npm run deploy:server
```

首次使用前复制 `.deploy.local.example` 为 `.deploy.local`，填写 SSH 地址、端口、用户和可选的私钥路径。该文件已被 Git 忽略。

这条命令会在本地完成测试和构建，自动打包并通过 SSH 上传。服务器会备份源码和 SQLite 数据库，构建新镜像并检查健康状态；失败时恢复旧镜像、源码和数据库。更新包不会包含 API Key、后台密码、数据库、图片或本地环境配置。

验证已经单独完成、只需重试上传时，可使用：

```bash
npm run deploy:server -- --skip-verify
```

只检查本地打包、不连接服务器时，可使用 `npm run deploy:server -- --skip-verify --dry-run`。

## 使用私有 Git 仓库更新

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

默认只从我们自己仓库的 `origin/stable` 更新。`stable` 只接收已经在本地完成代码检查、测试、构建和人工验收的版本。服务器不会直接跟随原作者仓库，避免未经检查的上游改动直接上线。

需要临时使用其他远程仓库或分支时：

```bash
DEPLOY_REMOTE=production DEPLOY_BRANCH=stable bash deploy/update-server.sh
```

正式上线时，应将服务器 Git 远程地址配置成你拥有权限的私有仓库或专用部署仓库。当前本地 `origin` 指向原作者仓库，不能用于发布你的定制版本。远程仓库规划和上游合并流程见 `docs/update-workflow.md`。

## 恢复与排查

- 数据库备份：`deploy/data/backups/`
- 更新日志：`deploy/data/update.log`
- 容器日志：`docker compose --env-file deploy/.env.server -f deploy/docker-compose.server.yml logs --tail=200`

不要把 Docker Socket 挂载给网站容器，也不要把更新命令做成公网后台接口。更新操作仅通过宝塔终端或 SSH 执行。
