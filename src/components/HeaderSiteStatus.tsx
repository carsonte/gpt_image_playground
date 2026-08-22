import { useEffect, useState } from 'react'
import { fetchPublicSiteConfig, type PublicSiteConfig } from '../lib/siteConfigApi'
import GenerationQueueStatus from './GenerationQueueStatus'

const DEFAULT_SITE_CONFIG: PublicSiteConfig = {
  privacyNoticeEnabled: true,
  privacyNoticeText: '图片仅保存在当前浏览器，服务器不保存图片',
  queueStatusEnabled: true,
}

export default function HeaderSiteStatus() {
  const [config, setConfig] = useState(DEFAULT_SITE_CONFIG)

  useEffect(() => {
    let cancelled = false
    const load = () => {
      void fetchPublicSiteConfig()
        .then((next) => {
          if (!cancelled) setConfig(next)
        })
        .catch(() => {})
    }
    load()
    const timer = window.setInterval(load, 5000)
    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [])

  return (
    <>
      {config.privacyNoticeEnabled && (
        <span
          className="hidden lg:inline-flex shrink-0 items-center gap-1.5 rounded-full border border-emerald-500/20 bg-emerald-500/10 px-2.5 py-1 text-sm font-medium text-emerald-700 dark:text-emerald-300"
          title={config.privacyNoticeText}
        >
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
          {config.privacyNoticeText}
        </span>
      )}
      {config.queueStatusEnabled && <GenerationQueueStatus />}
    </>
  )
}
