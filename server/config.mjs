import { resolve } from 'node:path'

function readInt(name, fallback) {
  const value = Number.parseInt(process.env[name] ?? '', 10)
  return Number.isFinite(value) && value > 0 ? value : fallback
}

export const config = {
  host: process.env.HOST?.trim() || '127.0.0.1',
  port: readInt('PORT', 8788),
  dataDir: resolve(process.env.DATA_DIR?.trim() || './data'),
  upstreamApiUrl: (process.env.UPSTREAM_API_URL?.trim() || 'https://api.blackengine.top/v1').replace(/\/+$/, ''),
  upstreamApiKey: process.env.UPSTREAM_API_KEY?.trim() || '',
  upstreamModel: process.env.UPSTREAM_MODEL?.trim() || 'gpt-image-2',
  upstreamConcurrency: readInt('UPSTREAM_CONCURRENCY', 4),
  sixonerApiUrl: (process.env.SIXONER_API_URL?.trim() || 'https://sub.sixoner.com/v1').replace(/\/+$/, ''),
  sixonerApiKey: process.env.SIXONER_API_KEY?.trim() || '',
  sixonerModel: process.env.SIXONER_MODEL?.trim() || 'gpt-image-2',
  senseNovaApiUrl: (process.env.SENSENOVA_API_URL?.trim() || 'https://token.sensenova.cn/v1').replace(/\/+$/, ''),
  senseNovaApiKey: process.env.SENSENOVA_API_KEY?.trim() || '',
  senseNovaModel: process.env.SENSENOVA_MODEL?.trim() || 'sensenova-u1-fast',
  senseNovaConcurrency: readInt('SENSENOVA_CONCURRENCY', 2),
  dotsApiUrl: (process.env.DOTS_API_URL?.trim() || 'https://note3-prev-api.askdiandian.com').replace(/\/+$/, ''),
  dotsApiKey: process.env.DOTS_API_KEY?.trim() || '',
  dotsModel: process.env.DOTS_MODEL?.trim() || 'dots3-note-prev',
  adminUsername: process.env.ADMIN_USERNAME?.trim() || 'admin',
  adminPasswordHash: process.env.ADMIN_PASSWORD_HASH?.trim() || '',
  adminPassword: process.env.NODE_ENV === 'production' ? '' : process.env.ADMIN_PASSWORD?.trim() || '',
  sessionSecret: process.env.SESSION_SECRET?.trim() || '',
  statsHashSecret: process.env.STATS_HASH_SECRET?.trim() || '',
  sessionDays: readInt('ADMIN_SESSION_DAYS', 7),
  requestLogRetentionDays: readInt('REQUEST_LOG_RETENTION_DAYS', 30),
  auditLogRetentionDays: readInt('AUDIT_LOG_RETENTION_DAYS', 180),
  ipActivityRetentionDays: readInt('IP_ACTIVITY_RETENTION_DAYS', 90),
  trustProxy: readInt('TRUST_PROXY', 1),
  isProduction: process.env.NODE_ENV === 'production',
}

if (!config.sessionSecret) throw new Error('缺少 SESSION_SECRET')
if (!config.statsHashSecret) throw new Error('缺少 STATS_HASH_SECRET')
if (!config.adminPasswordHash && !config.adminPassword) {
  throw new Error('缺少 ADMIN_PASSWORD_HASH；本地开发可临时设置 ADMIN_PASSWORD')
}
