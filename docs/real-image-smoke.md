# 真实生图烟雾测试

这个脚本用于维护设备直连上游，定期检查 BlackEngine、Sixoner 和 CatAPI 的实际输出，不保存图片、URL 或 API Key。它不经过本地代理，因此不验证本地路由、队列或回退策略；这些由 `npm run test:server` 覆盖。

```bash
npm run test:real-image
```

默认只显示将要请求的线路和模型，不会产生费用。确认真实请求后执行：

```bash
npm run test:real-image -- --confirm-cost
```

可以只测某些线路或改为 2K：

```bash
npm run test:real-image -- --channels=sixoner,catapi --tier=4K --confirm-cost
npm run test:real-image -- --channels=catapi --tier=2K --confirm-cost
```

dry-run 会完整显示尺寸、质量、格式、张数、流式设置、线路和模型。线路参数会严格校验，重复线路、未知线路或缺少配置都会直接失败。

真实请求的输出只包含请求模型、HTTP 状态、耗时、上游声明的质量/尺寸、PNG 真实像素、字节数和截断哈希。脚本不会因为尺寸不符自动重试，避免重复计费。
