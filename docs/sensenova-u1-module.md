# SenseNova U1 信息图模块

## 功能范围

- 首页顶部提供同款样式的“GPT 生图”和“U1 信息图”入口。
- 两个模块分别显示自己的本地画廊和队列状态。
- U1 使用日日新 `sensenova-u1-fast`，仅支持文字生成，每次固定生成 1 张。
- U1 请求固定发送 `watermark: false`，由 SenseNova 官方接口直接生成无水印图片，不进行裁剪或后处理抹除。
- U1 只允许官方支持的 11 个固定尺寸，前台尺寸选择器不会提交其他尺寸。
- 生成图片直接返回用户浏览器并存入浏览器 IndexedDB，服务器不保存图片。
- SenseNova 返回临时图片 URL 时，服务端会在内存中下载并转换为 Base64 再交给浏览器，避免跨域失败；不会写入磁盘或数据库。

## 服务端隔离

- GPT 与 U1 使用不同的 API URL、API Key、模型、全站队列和单 IP 限制。
- 前端只向站内 `/api-proxy` 请求，不会获得或暴露 SenseNova API Key。
- 服务端向 SenseNova 仅发送 `model`、`prompt`、`size`、`n: 1` 和 `watermark: false`。
- U1 默认全站并发 2、单 IP 并发 1、单 IP 排队 2，后台可调整。
- 后台实时任务、生成记录和总览统计会标识“GPT 生图”或“U1 信息图”。

## 配置

本地在 `.env.server.local`、生产在服务器 `deploy/.env.server` 中配置：

```env
SENSENOVA_API_URL=https://token.sensenova.cn/v1
SENSENOVA_API_KEY=your-key
SENSENOVA_MODEL=sensenova-u1-fast
SENSENOVA_CONCURRENCY=2
```

API Key 不得写入前端源码、Git、构建产物或文档。未配置时，U1 请求返回“服务器尚未配置 SenseNova API Key”，GPT 生图不受影响。

## 发布前验收

1. 执行 `npm test` 和 `npm run build`。
2. 切换两个顶部入口，确认任务和画廊互不混用。
3. 确认 U1 无参考图上传入口、数量固定为 1、尺寸只能从官方列表选择。
4. 使用测试 Key 实际生成一张 U1 信息图。
5. 在后台确认 U1 实时任务、真实 IP、提示词、耗时和独立统计正确。
6. 再执行 `npm run deploy:server` 发布，并检查 `/api/health` 的 `senseNovaConfigured`。
