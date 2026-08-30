const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
const PNG_IHDR = Buffer.from('IHDR')
const BASE64_HEADER_LENGTH = 64

export function readPngSize(bytes) {
  const buffer = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes ?? [])
  if (
    buffer.length < 24
    || !buffer.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)
    || buffer.readUInt32BE(8) !== 13
    || !buffer.subarray(12, 16).equals(PNG_IHDR)
  ) return ''

  const width = buffer.readUInt32BE(16)
  const height = buffer.readUInt32BE(20)
  if (!width || !height) return ''
  return `${width}x${height}`
}

export function readPngSizeFromBase64(value) {
  if (typeof value !== 'string') return ''
  const commaIndex = value.indexOf(',')
  const encoded = value.startsWith('data:') && commaIndex >= 0 ? value.slice(commaIndex + 1) : value
  if (!encoded.trim()) return ''

  let bytes
  try {
    bytes = Buffer.from(encoded.slice(0, BASE64_HEADER_LENGTH), 'base64')
  } catch {
    return ''
  }
  return readPngSize(bytes)
}

export function readEmbeddedPngSizes(payload) {
  const sizes = []
  const add = (value) => {
    const size = readPngSizeFromBase64(value)
    if (size && !sizes.includes(size)) sizes.push(size)
  }
  const visit = (value, depth = 0) => {
    if (depth > 5 || value == null) return
    if (Array.isArray(value)) {
      for (const item of value) visit(item, depth + 1)
      return
    }
    if (typeof value !== 'object') return

    add(value.b64_json)
    add(value.base64)
    if (typeof value.result === 'string' && String(value.type ?? '').includes('image')) add(value.result)
    for (const key of ['data', 'output', 'content', 'images']) visit(value[key], depth + 1)
  }

  visit(payload)
  return sizes
}
