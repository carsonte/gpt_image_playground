export type PublicSiteConfig = {
  privacyNoticeEnabled: boolean
  privacyNoticeText: string
  queueStatusEnabled: boolean
}

export async function fetchPublicSiteConfig() {
  const response = await fetch('/api/site-config', { cache: 'no-store' })
  if (!response.ok) throw new Error(`站点配置请求失败：HTTP ${response.status}`)
  return response.json() as Promise<PublicSiteConfig>
}
