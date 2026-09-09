# gpt-img Codex 交接指南

## 包含内容

> 2026-09-09 更新：模型测试结果与配置建议见 [图像模型测试记录](docs/image-model-tests.md)。2026-09-06 已部署 v0.7.8 代码并通过健康检查，但部署保留生产环境文件和数据库路由，没有同步本地模型配置。线上模型映射和优先级仍需核验。下文交接包清单属于历史打包基线。

- 接管基线提交：`2969ce9`（`main`）
- 完整源码、文档、部署脚本和 Git 历史
- `.env.server.local`：本地开发/测试环境配置（含真实密钥）
- `.deploy.local`：生产部署地址、目录和 SSH 私钥路径
- `dev-proxy.config.json`：本地代理配置
- `ssh/gpt-image-deploy`：部署用 SSH 私钥
- 不包含 `node_modules`、`dist`、`data`、数据库备份、用户图片、`.workbuddy` 和旧发布包

## 安全要求

1. 本包是明文 ZIP，只能通过加密 U 盘或其他安全方式转移。
2. 不要上传公共网盘、GitHub、聊天群，也不要把 ZIP 放进项目提交。
3. `.env.server.local`、`.deploy.local` 和 `ssh/gpt-image-deploy` 绝不能提交 Git。
4. 生产服务器上的 `deploy/.env.server` 保留在服务器，不要下载、覆盖或提交。
5. 新设备确认可运行后，删除旧设备上的交接包和临时副本。

## 新设备首次接管

1. 将整个 ZIP 解压到新设备的工作目录，例如 `C:\\Users\\<用户名>\\Desktop\\gpt-img`。
2. 将 `ssh/gpt-image-deploy` 移到新设备的 SSH 目录：

   `C:\\Users\\<用户名>\\.ssh\\gpt-image-deploy`

3. 修改 `.deploy.local` 中的 `DEPLOY_SSH_KEY`，改为新设备上的实际路径。
4. 在项目根目录执行：

   ```bash
   npm ci
   npm run verify:release
   ```

5. 本地开发：

   ```bash
   npm run dev
   ```

   如需同时启动本地服务端和前端，使用：

   ```bash
   npm run dev:full
   ```

## 继续迭代规则

- 先阅读 `AGENTS.md`、`README.md` 和本文件。
- 修改前先运行 `git status`，确认没有意外改动。
- 不要执行 `git add .`；只添加明确的源码、测试和文档文件。
- 不要读取、打印或提交密钥、数据库、用户图片和部署包。
- 大改动完成后运行 `npm run verify:release`，再检查 `git diff`。
- 生产部署必须得到用户确认，然后执行 `npm run deploy:server`。
- 部署脚本会使用 `.deploy.local`，服务器继续使用原有 `deploy/.env.server`，并执行备份、构建、健康检查和失败回滚。

## 当前生产信息

- Git 远端：`origin/main`
- 当前生产路由设置由服务器保留，历史记录为 CatAPI 优先；最新顺序需在服务器后台核验。
- 生产检查入口：`https://img2.blackengine.top/`、`/admin`、`/api/health`、`/api/queue/status`
