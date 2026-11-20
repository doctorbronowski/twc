export const demoTimeoutMs = 5 * 60 * 1000
const signalKey = 'twc.demo.signal'
const endedPrefix = 'twc.demo.ended.'
const endedRetentionMs = 24 * 60 * 60 * 1000

export type DemoSignal =
  | {
      type: 'activity'
      id: number
      tag: string
      startedAt: number
      remainingMs: number
    }
  | { type: 'ended'; id: number; tag: string }
  | { type: 'active'; id: number; tag: string | null }

export function isDemoSignal(value: unknown): value is DemoSignal {
  if (
    typeof value !== 'object' ||
    value === null ||
    !('type' in value) ||
    !('id' in value)
  ) {
    return false
  }
  if (
    !('tag' in value) ||
    (!(value.tag === null && value.type === 'active') &&
      !(typeof value.tag === 'string' && /^[0-9a-f]{64}$/.test(value.tag)))
  ) {
    return false
  }
  if (
    typeof value.id !== 'number' ||
    !Number.isSafeInteger(value.id) ||
    value.id <= 0
  ) {
    return false
  }
  if (value.type === 'activity') {
    return (
      'startedAt' in value &&
      typeof value.startedAt === 'number' &&
      Number.isFinite(value.startedAt) &&
      'remainingMs' in value &&
      typeof value.remainingMs === 'number' &&
      Number.isInteger(value.remainingMs) &&
      value.remainingMs >= 0 &&
      value.remainingMs <= demoTimeoutMs
    )
  }
  return value.type === 'ended' || value.type === 'active'
}

export function publishDemoSignal(signal: DemoSignal): void {
  try {
    if (signal.type === 'ended') {
      const now = Date.now()
      for (let i = window.localStorage.length - 1; i >= 0; i--) {
        const key = window.localStorage.key(i)
        if (key?.startsWith(endedPrefix)) {
          const created = Number(window.localStorage.getItem(key))
          if (Number.isFinite(created) && now - created > endedRetentionMs) {
            window.localStorage.removeItem(key)
          }
        }
      }
      window.localStorage.setItem(`${endedPrefix}${signal.tag}`, String(now))
    }
    window.localStorage.setItem(
      signalKey,
      JSON.stringify({ ...signal, nonce: Math.random() }),
    )
  } catch {
    console.warn('Demo tab synchronization through storage is unavailable.')
  }
  if (typeof BroadcastChannel !== 'undefined') {
    try {
      const channel = new BroadcastChannel(signalKey)
      channel.postMessage(signal)
      channel.close()
    } catch {
      console.warn('Demo tab synchronization through broadcast is unavailable.')
    }
  }
}

export function hasDemoEnded(tag: string): boolean {
  try {
    return window.localStorage.getItem(`${endedPrefix}${tag}`) !== null
  } catch {
    console.warn('Unable to check whether this demo ended in another tab.')
    return false
  }
}

export function listenForDemoSignals(
  handler: (signal: DemoSignal) => void,
): () => void {
  function onStorage(event: StorageEvent) {
    if (event.key !== signalKey || !event.newValue) return
    try {
      const signal: unknown = JSON.parse(event.newValue)
      if (isDemoSignal(signal)) handler(signal)
    } catch {
      console.warn('An invalid demo tab synchronization message was ignored.')
    }
  }
  let channel: BroadcastChannel | null = null
  if (typeof BroadcastChannel !== 'undefined') {
    try {
      channel = new BroadcastChannel(signalKey)
    } catch {
      console.warn('Demo tab synchronization through broadcast is unavailable.')
    }
  }
  if (channel) {
    channel.onmessage = (event: MessageEvent<unknown>) => {
      if (isDemoSignal(event.data)) handler(event.data)
    }
  }
  window.addEventListener('storage', onStorage)
  return () => {
    window.removeEventListener('storage', onStorage)
    channel?.close()
  }
}
