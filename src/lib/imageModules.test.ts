import { describe, expect, it } from 'vitest'
import {
  SENSENOVA_U1_MODEL,
  SENSENOVA_U1_SIZES,
  getProfileImageModule,
  getTaskImageModule,
  isSenseNovaU1Size,
} from './imageModules'

describe('imageModules', () => {
  it('recognizes U1 profiles and tasks without changing legacy GPT tasks', () => {
    expect(getProfileImageModule({ model: SENSENOVA_U1_MODEL })).toBe('sensenova-u1')
    expect(getProfileImageModule({ model: 'gpt-image-2' })).toBe('gpt')
    expect(getTaskImageModule({ apiModel: SENSENOVA_U1_MODEL })).toBe('sensenova-u1')
    expect(getTaskImageModule({ apiModel: undefined })).toBe('gpt')
  })

  it('only accepts official U1 Fast sizes', () => {
    expect(SENSENOVA_U1_SIZES).toHaveLength(11)
    expect(isSenseNovaU1Size('2048x2048')).toBe(true)
    expect(isSenseNovaU1Size('1024x1024')).toBe(false)
    expect(isSenseNovaU1Size('auto')).toBe(false)
  })
})
