import { beforeEach, describe, expect, it, vi } from 'vitest'
import { showActionRunnerNotice } from '../action-runner-notices'

const { toast, toastGitFailure } = vi.hoisted(() => ({
  toast: {
    success: vi.fn(),
    warning: vi.fn(),
    error: vi.fn()
  },
  toastGitFailure: vi.fn()
}))

vi.mock('sonner', () => ({ toast }))
vi.mock('@/lib/git-report', () => ({ toastGitFailure }))

beforeEach(() => {
  vi.clearAllMocks()
})

describe('showActionRunnerNotice', () => {
  it('uses the success channel', () => {
    showActionRunnerNotice({ kind: 'success', title: 'Pulled' })
    expect(toast.success).toHaveBeenCalledWith('Pulled')
  })

  it('uses the warning channel with guidance', () => {
    showActionRunnerNotice({
      kind: 'warning',
      title: 'Pull hit conflicts',
      description: 'Resolve the conflicts.'
    })
    expect(toast.warning).toHaveBeenCalledWith('Pull hit conflicts', {
      description: 'Resolve the conflicts.'
    })
  })

  it('does not add an empty options argument to ordinary errors', () => {
    showActionRunnerNotice({ kind: 'error', title: 'Repository is not open' })
    expect(toast.error).toHaveBeenCalledWith('Repository is not open')
  })

  it('passes unexpected-response details through the error channel', () => {
    showActionRunnerNotice({
      kind: 'error',
      title: 'Fetch failed',
      description: 'Unexpected response: FutureResponse'
    })
    expect(toast.error).toHaveBeenCalledWith('Fetch failed', {
      description: 'Unexpected response: FutureResponse'
    })
  })

  it('uses the Git failure presenter for Git errors', () => {
    showActionRunnerNotice({ kind: 'git-error', title: 'Push failed', message: 'rejected' })
    expect(toastGitFailure).toHaveBeenCalledWith('Push failed', 'rejected')
  })
})
