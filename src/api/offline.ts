import axios from 'axios'
import type { ChangeRequest } from './types'

/**
 * 断网模拟 + 断网待同步队列。
 * 写入请求因网络失败时，按其首次操作号进入队列；恢复网络后重试仍沿用首次结果，
 * 服务器侧按操作号幂等，不会重复追加复测记录。
 */

const OFFLINE_KEY = 'a11y-offline'

let offline = false
try {
  offline = localStorage.getItem(OFFLINE_KEY) === '1'
} catch {
  offline = false
}
globalThis.__setA11yOffline?.(offline)

const listeners = new Set<() => void>()
const subscribe = (listener: () => void) => {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}
const emit = () => listeners.forEach((listener) => listener())

export const isOffline = () => offline
export function setOffline(value: boolean) {
  offline = value
  globalThis.__setA11yOffline?.(value)
  try {
    value ? localStorage.setItem(OFFLINE_KEY, '1') : localStorage.removeItem(OFFLINE_KEY)
  } catch {
    /* 忽略隐私模式存储异常 */
  }
  emit()
}

type Listener = (count: number) => void
const outboxListeners = new Set<Listener>()
const emitOutbox = () => outboxListeners.forEach((listener) => listener(outbox.length))

const STORAGE_KEY = 'a11y-change-outbox-v1'
type StoredEntry = ChangeRequest & { label: string; at: string }
let outbox: StoredEntry[] = []
try {
  outbox = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]') as StoredEntry[]
} catch {
  outbox = []
}

const saveOutbox = () => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(outbox))
  } catch {
    /* 忽略存储异常 */
  }
  emitOutbox()
}

export const getOutbox = () => outbox
export const subscribeOutbox = (listener: Listener) => {
  outboxListeners.add(listener)
  return () => {
    outboxListeners.delete(listener)
  }
}

export const newOpId = () => `OP-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`

/** 发起写入；仅网络失败（断网）时进入待同步队列，业务冲突等响应不进队列 */
export async function submitChange(payload: ChangeRequest & { label: string }) {
  try {
    const { data } = await axios.post('/api/changes', payload, {
      headers: { 'Idempotency-Key': payload.opId },
    })
    return data as { outcome: 'applied'; replay?: boolean; issue: unknown; rev: number; opId: string }
  } catch (error) {
    if (axios.isAxiosError(error) && error.response) throw error
    // 无响应：网络错误（含模拟断网），按原操作号入队等待重试
    const { ...entry } = payload
    if (!outbox.some((item) => item.opId === entry.opId)) {
      outbox = [...outbox, entry as StoredEntry]
      saveOutbox()
    }
    throw error
  }
}

/** 恢复网络后重试：沿用首次操作号，服务器回放首次结果 */
export async function retryOutboxEntry(opId: string) {
  const entry = outbox.find((item) => item.opId === opId)
  if (!entry) return
  const { data } = await axios.post('/api/changes', entry, { headers: { 'Idempotency-Key': opId } })
  outbox = outbox.filter((item) => item.opId !== opId)
  saveOutbox()
  return data
}

export async function retryAllOutbox() {
  const entries = [...outbox]
  const results = []
  for (const entry of entries) {
    // 逐条串行，每条都带各自首次的操作号
    // eslint-disable-next-line no-await-in-loop
    const data = await retryOutboxEntry(entry.opId)
    results.push(data)
  }
  return results
}

export const removeOutboxEntry = (opId: string) => {
  outbox = outbox.filter((item) => item.opId !== opId)
  saveOutbox()
}

export { subscribe }
