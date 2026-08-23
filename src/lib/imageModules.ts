import type { ApiProfile, TaskRecord } from '../types'

export type ImageModule = 'gpt' | 'sensenova-u1'

export const SENSENOVA_U1_MODEL = 'sensenova-u1-fast'
export const SENSENOVA_U1_PROFILE_ID = 'sensenova-u1'
export const SENSENOVA_U1_SIZES = [
  '2752x1536',
  '1536x2752',
  '2048x2048',
  '2496x1664',
  '1664x2496',
  '2368x1760',
  '1760x2368',
  '2272x1824',
  '1824x2272',
  '3072x1376',
  '1344x3136',
] as const

export function getProfileImageModule(profile: Pick<ApiProfile, 'model'>): ImageModule {
  return profile.model === SENSENOVA_U1_MODEL ? 'sensenova-u1' : 'gpt'
}

export function getTaskImageModule(task: Pick<TaskRecord, 'apiModel'>): ImageModule {
  return task.apiModel === SENSENOVA_U1_MODEL ? 'sensenova-u1' : 'gpt'
}

export function isSenseNovaU1Size(size: string): size is typeof SENSENOVA_U1_SIZES[number] {
  return SENSENOVA_U1_SIZES.includes(size as typeof SENSENOVA_U1_SIZES[number])
}
