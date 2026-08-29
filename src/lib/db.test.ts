// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { TaskRecord } from '../types'
import { clearImages, putTask } from './db'

type FakeState = {
  db: ReturnType<typeof createFakeDb>
  closeCalls: number
  fail: boolean
  completeDelay: number
}

function createFakeDb(state: { closeCalls: number }) {
  const stores = new Map<string, Map<string, unknown>>()
  let closed = false
  const event = (target: unknown) => ({ target }) as unknown as Event

  const createTransaction = () => {
    let pending = 0
    let failed = false
    const tx: {
      error: DOMException | null
      oncomplete: ((event: Event) => void) | null
      onerror: ((event: Event) => void) | null
      onabort: ((event: Event) => void) | null
      objectStore: (name: string) => Record<string, unknown>
    } = {
      error: null,
      oncomplete: null,
      onerror: null,
      onabort: null,
      objectStore: () => ({}),
    }

    const enqueue = (work: () => void, state: FakeState) => {
      pending += 1
      setTimeout(() => {
        if (state.fail && !failed) {
          failed = true
          tx.error = new DOMException('模拟事务失败', 'UnknownError')
          tx.onerror?.(event(tx))
          tx.onabort?.(event(tx))
          return
        }
        work()
        pending -= 1
        if (!pending) {
          setTimeout(() => tx.oncomplete?.(event(tx)), state.completeDelay)
        }
      }, 0)
    }

    tx.objectStore = (name: string) => {
      const values = stores.get(name) ?? new Map<string, unknown>()
      stores.set(name, values)
      return {
        put(value: { id: string }) {
          const req = {
            result: undefined as unknown,
            error: null as DOMException | null,
            onsuccess: null as ((event: Event) => void) | null,
            onerror: null as ((event: Event) => void) | null,
          }
          enqueue(() => {
            values.set(value.id, value)
            req.result = value.id
            req.onsuccess?.(event(req))
          }, currentState)
          return req
        },
        getAll() {
          const req = {
            result: [] as unknown[],
            error: null as DOMException | null,
            onsuccess: null as ((event: Event) => void) | null,
            onerror: null as ((event: Event) => void) | null,
          }
          enqueue(() => {
            req.result = [...values.values()]
            req.onsuccess?.(event(req))
          }, currentState)
          return req
        },
        clear() {
          const req = {
            result: undefined,
            error: null as DOMException | null,
            onsuccess: null as ((event: Event) => void) | null,
            onerror: null as ((event: Event) => void) | null,
          }
          enqueue(() => {
            values.clear()
            req.result = undefined
            req.onsuccess?.(event(req))
          }, currentState)
          return req
        },
      }
    }
    return tx
  }

  const db = {
    objectStoreNames: {
      contains: (name: string) => stores.has(name),
    },
    createObjectStore: (name: string) => {
      stores.set(name, new Map())
      return {}
    },
    transaction: (_names: string | string[], _mode: IDBTransactionMode) => {
      if (closed) throw new Error('数据库连接已关闭')
      return createTransaction()
    },
    close: () => {
      if (closed) return
      closed = true
      state.closeCalls += 1
    },
  }
  return db
}

let currentState: FakeState
let originalIndexedDB: IDBFactory | undefined

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function createOpenRequest(state: FakeState, firstOpen: boolean) {
  const request = {
    result: state.db,
    error: null as DOMException | null,
    onupgradeneeded: null as ((event: Event) => void) | null,
    onsuccess: null as ((event: Event) => void) | null,
    onerror: null as ((event: Event) => void) | null,
  }
  setTimeout(() => {
    if (firstOpen) request.onupgradeneeded?.({ target: request } as unknown as Event)
    request.onsuccess?.({ target: request } as unknown as Event)
  }, 0)
  return request
}

describe('IndexedDB connection lifecycle', () => {
  beforeEach(() => {
    currentState = {
      db: undefined as unknown as FakeState['db'],
      closeCalls: 0,
      fail: false,
      completeDelay: 20,
    }
    currentState.db = createFakeDb(currentState)
    originalIndexedDB = globalThis.indexedDB
    let firstOpen = true
    Object.defineProperty(globalThis, 'indexedDB', {
      configurable: true,
      value: {
        open: () => {
          const request = createOpenRequest(currentState, firstOpen)
          firstOpen = false
          return request
        },
      },
    })
  })

  afterEach(() => {
    Object.defineProperty(globalThis, 'indexedDB', {
      configurable: true,
      value: originalIndexedDB,
    })
  })

  it('waits for transaction completion before resolving and closes the connection', async () => {
    const task = { id: 'task-1' } as TaskRecord
    let settled = false
    const pending = putTask(task).then(() => {
      settled = true
    })

    await wait(5)
    expect(settled).toBe(false)
    await pending
    expect(settled).toBe(true)
    expect(currentState.closeCalls).toBe(1)
  })

  it('closes the connection when a transaction fails', async () => {
    currentState.fail = true
    await expect(putTask({ id: 'task-failed' } as TaskRecord)).rejects.toThrow('模拟事务失败')
    expect(currentState.closeCalls).toBe(1)
  })

  it('closes the connection after a multi-store transaction', async () => {
    await expect(clearImages()).resolves.toBeUndefined()
    expect(currentState.closeCalls).toBe(1)
  })

  it('closes the connection when a multi-store transaction aborts', async () => {
    currentState.fail = true
    await expect(clearImages()).rejects.toThrow('模拟事务失败')
    expect(currentState.closeCalls).toBe(1)
  })
})
