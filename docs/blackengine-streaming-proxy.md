# BlackEngine 本地代理与图片编辑流式修复

更新日期：2026-08-21

## 背景

浏览器直接请求 `https://api.blackengine.top` 时可能受到 CORS 限制。图片局部修改还需要上传原图和蒙版，处理时间通常长于普通文生图，服务商的 OpenResty 网关可能在上游返回结果前产生 `504 Gateway Time-out`。

## 本地配置

1. 复制 `dev-proxy.blackengine.example.json` 为 `dev-proxy.config.json`。
2. 复制 `.env.blackengine.example` 为 `.env.local`。
3. 执行 `npm install` 和 `npm run dev -- --host 127.0.0.1`。
4. 在页面中填写 API Key。API Key 仅保存在本地，不应写入 Git 或文档。

本地代理把同源请求：

```text
http://127.0.0.1:5173/api-proxy/*
```

转发到：

```text
https://api.blackengine.top/v1/*
```

`.env.local` 将代理设置为可用且强制启用，避免浏览器配置仍然绕过代理直接请求服务商。

## 代码修改

`src/lib/openaiCompatibleImageApi.ts` 现在会为 Images API 的图片编辑请求自动启用流式传输，即使当前配置没有手动开启流式模式。编辑请求会携带：

```text
stream=true
partial_images=1
```

收到 `text/event-stream` 响应时，仍使用现有 SSE 解析逻辑处理局部预览和最终图片。普通文生图继续遵循用户原有的流式设置。

## 执行与验证记录

- API 根地址可达：`https://api.blackengine.top/` 返回 HTTP 200。
- 标准模型端点可达：`https://api.blackengine.top/v1/models` 在无密钥探测时返回 HTTP 401，证明路由存在且需要鉴权。
- 本地代理模型端点可达：`/api-proxy/models` 返回上游 HTTP 401。
- 本地代理图片生成端点可达：`/api-proxy/images/generations` 在无密钥探测时返回上游 HTTP 401。
- 专项测试通过：`npm test -- --run src/lib/api.test.ts -t "enables streaming for image edits"`，1/1 通过。
- 生产构建通过：`npm run build`。
- 完整测试在临时隔离 `.env.local` 与 `dev-proxy.config.json` 后为 496/497 通过；剩余失败是仓库原有的 `customProviderConfigUrl.test.ts` 快照预期未包含 `presetProfileFields: {}`，与本次图片编辑流式修改无关。

## 限制

流式传输可以避免部分“长时间无响应”导致的网关超时，但无法修复服务商自身不支持 `images/edits`、不支持流式编辑，或上游任务本身失败的情况。如果仍返回 504，需要服务商提高反向代理超时或修复其图片编辑上游。
