# Sixoner GPT 生图渠道

Sixoner 是默认 GPT 生图主线路。主线路出现网络异常、鉴权失败、余额不足、限流或服务端错误时，服务器自动把同一请求转发到 BlackEngine 备用线路。400/422 等请求参数错误不会重试。

管理后台“系统设置 → GPT 生图队列”可以在 `Sixoner → BlackEngine` 与 `CatAPI → BlackEngine` 两种路由之间切换。

管理员保存线路后，新提交的任务立即使用新线路；正在生成和已经排队的任务保留进入队列时的线路，不会中途切换。服务端只有在图片响应完整传输给浏览器后，才把生成记录标记为成功并释放队列槽。

## 环境变量

```env
SIXONER_API_URL=https://sub.sixoner.com/v1
SIXONER_API_KEY=
SIXONER_MODEL=gpt-image-2
```

真实 Key 只写入 `.env.server.local` 或服务器的 `deploy/.env.server`，不得提交到 Git。

## 兼容性验证

- `GET /v1/models`：成功。
- `POST /v1/images/generations`：成功。
- 测试模型：`gpt-image-2`。
- 测试结果：PNG、1024×1024，约 57 秒返回。
- 接口模型列表包含 `gpt-image`、`gpt-image-2` 及 1K、2K、4K 变体。
