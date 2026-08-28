# CatAPI GPT 生图渠道

CatAPI 同时承担固定 2K 主线路和可选的 1K/4K 主线路。后台“系统设置 → GPT 生图队列”只切换 1K/4K 的两种路由：

- Sixoner → BlackEngine
- CatAPI → Sixoner → BlackEngine

2K 不受后台开关影响，固定使用 `CatAPI → Sixoner → BlackEngine`。

管理员保存线路后，新提交的任务立即使用新线路；正在生成和已经排队的任务保留进入队列时的线路，不会中途切换。

## 环境变量

```env
CATAPI_API_URL=https://catapi.cc.cd/v1
CATAPI_API_KEY=
CATAPI_MODEL=gpt-image-2
CATAPI_2K_MODEL=gpt-image-2-2k
CATAPI_4K_MODEL=gpt-image-2-4k
```

真实 Key 只写入 `.env.server.local` 或服务器的 `deploy/.env.server`，不得提交到 Git。

## 兼容性验证

- `GET /v1/models`：成功。
- `POST /v1/images/generations`：成功。
- 测试模型：`gpt-image-2`。
- 测试结果：PNG；请求 1024×1024，实际返回 1254×1254，约 43 秒。
- 4K 测试：`gpt-image-2-4k` 请求 3840×2160，实际返回 3840×2160 PNG，约 29 秒、5.7 MB。
- CatAPI 的通用 `gpt-image-2` 会把部分高分辨率请求降级；服务端因此按请求尺寸自动选模：1K 使用 `CATAPI_MODEL`，2K 使用 `CATAPI_2K_MODEL`（默认 `gpt-image-2-2k`），4K 使用 `CATAPI_4K_MODEL`（默认 `gpt-image-2-4k`）。生图和图片编辑均应用该规则。
- 2K/4K 请求在 CatAPI 和 Sixoner 都使用各自的 `gpt-image-2-2k`/`gpt-image-2-4k` 专用模型；回退 BlackEngine 时，服务端重新写入 BlackEngine 的模型名，避免把渠道专用模型传给最终备用线路。
- 由于实测 Sixoner 的 2K 请求会降到约 1254×1254，2K 请求无论后台选择哪条主线路都固定优先 CatAPI；CatAPI 不可用时再回退 Sixoner、BlackEngine。1K/4K 继续遵循后台选择。
- 实测专用 4K 模型会忽略 `jpeg`/`webp` 输出参数并返回 PNG；前端已锁定 PNG，服务端也会把新生图请求强制改写为 PNG，避免界面参数与实际文件格式不一致。
- 模型列表包含 `gpt-image-2`、`gpt-image-2-2k`、`gpt-image-2-4k`。

## 完成状态

服务端只有在图片响应完整传输给浏览器后，才把生成记录标记为成功并释放队列槽。响应仍在传输时，后台“实时任务”继续显示为生成中；浏览器端解码和写入本地 IndexedDB 不计入服务器耗时。
