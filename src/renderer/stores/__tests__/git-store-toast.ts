import { vi } from 'vitest'

const gitStoreToast = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
  warning: vi.fn(),
  info: vi.fn()
}))
vi.mock('sonner', () => ({ toast: gitStoreToast }))

export function getGitStoreToast() {
  return gitStoreToast
}
