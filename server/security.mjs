import { createHash, createHmac, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'
import { config } from './config.mjs'

export function createPasswordHash(password) {
  const salt = randomBytes(16)
  const hash = scryptSync(password, salt, 64)
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`
}

export function verifyPassword(password) {
  if (config.adminPasswordHash) {
    const [algorithm, saltHex, hashHex] = config.adminPasswordHash.split('$')
    if (algorithm !== 'scrypt' || !saltHex || !hashHex) return false
    const expected = Buffer.from(hashHex, 'hex')
    const actual = scryptSync(password, Buffer.from(saltHex, 'hex'), expected.length)
    return expected.length === actual.length && timingSafeEqual(expected, actual)
  }
  const expected = Buffer.from(config.adminPassword)
  const actual = Buffer.from(password)
  return expected.length === actual.length && timingSafeEqual(expected, actual)
}

export function hashToken(token) {
  return createHash('sha256').update(token).digest('hex')
}

export function hashIp(ip) {
  return createHmac('sha256', config.statsHashSecret).update(normalizeIp(ip)).digest('hex')
}

export function createSessionToken() {
  return randomBytes(32).toString('base64url')
}

export function sanitizeError(value) {
  return String(value ?? '')
    .replace(/Bearer\s+[^\s"']+/gi, 'Bearer [REDACTED]')
    .replace(/sk-[A-Za-z0-9_-]{8,}/g, 'sk-[REDACTED]')
    .replace(/([?&](?:api_?key|key|token)=)[^&\s]+/gi, '$1[REDACTED]')
    .slice(0, 500)
}

export function safeDetails(value) {
  const allowed = {}
  for (const key of ['announcementId', 'blockId', 'version', 'endpoint', 'model', 'imageCount', 'upstreamStatus', 'message']) {
    if (value[key] !== undefined) allowed[key] = key === 'message' ? sanitizeError(value[key]) : value[key]
  }
  return JSON.stringify(allowed)
}

export function normalizeIp(value) {
  const ip = String(value ?? '').trim().replace(/^::ffff:/, '')
  return ip || 'unknown'
}
