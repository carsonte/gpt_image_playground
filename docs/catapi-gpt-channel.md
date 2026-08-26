# CatAPI GPT 生图渠道

CatAPI 可作为 GPT 生图主线路，失败时先回退到 Sixoner；Sixoner 仍失败时再回退 BlackEngine。后台“系统设置 → GPT 生图队列”提供两种路由：

- Sixoner → BlackEngine
- CatAPI → Sixoner → BlackEngine

管理员保存线路后，新提交的任务立即使用新线路；正在生成和已经排队的任务保留进入队列时的线路，不会中途切换。

## 环境变量

```env
CATAPI_API_URL=https://catapi.cc.cd/v1
CATAPI_API_KEY=
CATAPI_MODEL=gpt-image-2
```

真实 Key 只写入 `.env.server.local` 或服务器的 `deploy/.env.server`，不得提交到 Git。

## 兼容性验证

- `GET /v1/models`：成功。
- `POST /v1/images/generations`：成功。
- 测试模型：`gpt-image-2`。
- 测试结果：PNG；请求 1024×1024，实际返回 1254×1254，约 43 秒。
- 4K 测试：`gpt-image-2-4k` 请求 3840×2160，实际返回 3840×2160 PNG，约 29 秒、5.7 MB。
- CatAPI 的通用 `gpt-image-2` 会把部分 4K 请求降级为约 1K；服务端因此按请求尺寸自动选模：1K/2K 使用 `CATAPI_MODEL`，4K 使用 `CATAPI_4K_MODEL`（默认 `gpt-image-2-4k`）。生图和图片编辑均应用该规则。
- 4K 请求在 CatAPI 和 Sixoner 都使用各自的 `gpt-image-2-4k` 专用模型；回退 BlackEngine 时，服务端重新写入 BlackEngine 的模型名，避免把渠道专用模型传给最终备用线路。
- 模型列表包含 `gpt-image-2`、`gpt-image-2-2k`、`gpt-image-2-4k`。

## 完成状态

服务端只有在图片响应完整传输给浏览器后，才把生成记录标记为成功并释放队列槽。响应仍在传输时，后台“实时任务”继续显示为生成中；浏览器端解码和写入本地 IndexedDB 不计入服务器耗时。
