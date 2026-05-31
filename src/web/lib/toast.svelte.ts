export type ToastKind = 'success' | 'error' | 'info' | 'message'

export interface ToastItem {
  id: number
  kind: ToastKind
  message: string
}

const TOAST_TTL_MS = 5000

let nextToastId = 1
let items = $state<ToastItem[]>([])
const timers = new Map<number, ReturnType<typeof setTimeout>>()

function show(kind: ToastKind, message: string): number {
  const id = nextToastId++
  items = [...items, { id, kind, message }]
  timers.set(id, setTimeout(() => dismiss(id), TOAST_TTL_MS))
  return id
}

export const toast = {
  success: (message: string) => show('success', message),
  error: (message: string) => show('error', message),
  info: (message: string) => show('info', message),
  message: (message: string) => show('message', message),
}

export function getToasts(): ToastItem[] {
  return items
}

export function dismiss(id: number): void {
  const timer = timers.get(id)
  if (timer) clearTimeout(timer)
  timers.delete(id)
  items = items.filter(item => item.id !== id)
}
