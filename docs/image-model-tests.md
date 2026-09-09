# 图像模型测试记录

更新日期：2026-09-09。

## 测试范围

使用本地环境配置，通过 `scripts/real-image-smoke.mjs` 直接请求上游 `images/generations`，下载 PNG 并读取尺寸。参数为 high、PNG、单图、非流式；2K 为 `2560x1440`，4K 为 `3840x2160`。没有覆盖线上页面、生产代理、参考图编辑、遮罩或流式请求。提示词是无文字、无标志的红色电动轿车棚拍，并非特斯拉专用广告提示词。

## GPT Image 2（2026-09-06）

| 渠道 | 模型 | 请求 | 实际返回尺寸 | 返回质量 |
|------|------|------|--------------|----------|
| Sixoner | `gpt-image-2` | 2K / 4K | 分别匹配请求尺寸 | 未提供 |
| Sixoner | `gpt-image-2-2k` / `gpt-image-2-4k` | 2K | HTTP 503，无可用账号 | 无 |
| Sixoner | `gpt-image-2-4k` | 4K | HTTP 503，无可用账号 | 无 |
| CatAPI | `gpt-image-2` | 2K / 4K | 约 `1536x1024`，未匹配 | low 或 medium |
| CatAPI | `gpt-image-2-2k` | 2K | `2560x1440` | low 或 medium |
| CatAPI | `gpt-image-2-4k` | 4K | `3840x2160` | low 或 medium |
| Primary | `gpt-image-2` | 2K / 4K | HTTP 503，无可用账号 | 无 |

CatAPI 专用模型的尺寸元数据约为 `1536x1024`，与 PNG 尺寸不同。只能确认输出像素尺寸匹配，不能据此断言质量字段错误、实际使用了 high，或图片属于原生高分辨率生成而非放大。Sixoner 未提供质量字段，也不能确认 high 已生效。

## GPT Image 2.5（2026-09-09）

Sixoner 和 CatAPI 均分别测试了 `gpt-image-2.5`、`gpt-image-2.5-flare`、`gpt-image-2.5-sunburst` 的 2K 和 4K 请求，全部返回 HTTP 503、无可用账号。Primary 本轮未测试。

没有得到图片，无法确认 2K/4K 能力。这不证明模型不存在；准确模型 ID、账户权限及渠道接入状态仍需服务商确认。尚未将 2.5 接入生产默认配置。

## 配置建议与上线状态

建议 Sixoner 的 2K/4K 均使用 `gpt-image-2`，CatAPI 分别使用 `gpt-image-2-2k` 和 `gpt-image-2-4k`。生成线路建议为 Sixoner → CatAPI → Primary；编辑线路尚未实测。

2026-09-06 代码部署通过健康检查，但发布脚本排除本地环境文件，并保留生产 `deploy/.env.server` 和数据库路由。没有证据表明这些模型配置与建议优先级已经同步到线上，需另行核验容器生效配置与后台路由。

## 构建变更

Vite 增加 React/Zustand 与 Markdown 依赖分组。此前构建和测试通过，但 App 块仍约 513 KB，Markdown 块约 769 KB，仍有体积警告。没有浏览器加载指标证明首屏变快，约 199 KB 的入口块不等于整个首屏体积。
