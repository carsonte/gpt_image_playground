import { describe, expect, it } from 'vitest'
import { readEmbeddedPngSizes, readPngSize, readPngSizeFromBase64 } from './imageDimensions.mjs'

function createPngBase64(width, height) {
  const header = Buffer.alloc(24)
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(header)
  header.writeUInt32BE(13, 8)
  header.write('IHDR', 12, 'ascii')
  header.writeUInt32BE(width, 16)
  header.writeUInt32BE(height, 20)
  return header.toString('base64')
}

describe('embedded PNG dimensions', () => {
  it('reads dimensions from raw base64 and data URLs', () => {
    const image = createPngBase64(3840, 2160)
    expect(readPngSizeFromBase64(image)).toBe('3840x2160')
    expect(readPngSizeFromBase64(`data:image/png;base64,${image}`)).toBe('3840x2160')
    expect(readPngSize(Buffer.from(image, 'base64'))).toBe('3840x2160')
  })

  it('prefers image bytes independently of conflicting response metadata', () => {
    const image = createPngBase64(3840, 2160)
    expect(readEmbeddedPngSizes({
      size: '1536x1024',
      data: [{ size: '1536x1024', b64_json: image }],
    })).toEqual(['3840x2160'])
  })

  it('reads Responses image generation results and ignores invalid input', () => {
    const image = createPngBase64(2304, 3456)
    expect(readEmbeddedPngSizes({ output: [{ type: 'image_generation_call', result: image }] })).toEqual(['2304x3456'])
    expect(readPngSizeFromBase64('not-an-image')).toBe('')
    expect(readEmbeddedPngSizes({ data: [{ b64_json: 'invalid' }] })).toEqual([])
  })

  it('rejects data that has a PNG signature without a valid IHDR header', () => {
    const invalid = Buffer.alloc(24)
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(invalid)
    invalid.writeUInt32BE(12, 8)
    invalid.write('IDAT', 12, 'ascii')
    invalid.writeUInt32BE(3840, 16)
    invalid.writeUInt32BE(2160, 20)
    expect(readPngSize(invalid)).toBe('')
  })
})
