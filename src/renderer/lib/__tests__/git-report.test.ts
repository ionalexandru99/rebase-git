import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  engineFailureMessage,
  gitFailureBannerText,
  gitFailureMessage,
  toastEngineFailure,
  toastGitFailure
} from '@/lib/git-report'

const toast = vi.hoisted(() => ({ error: vi.fn() }))
vi.mock('sonner', () => ({ toast }))

const rawStderr = [
  'error: The following untracked working tree files would be overwritten by checkout:',
  '\tsrc/a.ts',
  '\tsrc/b.ts',
  '\tsrc/c.ts',
  'Please move or remove them before you switch branches.',
  'Aborting'
].join('\n')

afterEach(() => {
  vi.restoreAllMocks()
})

describe('git failure reporting', () => {
  it('sends git’s own output to the console and the short form to the caller', () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {})

    const message = gitFailureMessage('Checkout failed', rawStderr)

    expect(logged).toHaveBeenCalledWith('[git] Checkout failed:', rawStderr)
    expect(message).toBe(
      'Untracked files would be overwritten — 3 files. Move, delete or commit them first, then try again.'
    )
    expect(message).not.toContain('Aborting')
  })

  it('toasts the short form only', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})

    toastGitFailure('Checkout failed', rawStderr)

    expect(toast.error).toHaveBeenCalledWith('Checkout failed', {
      description:
        'Untracked files would be overwritten — 3 files. Move, delete or commit them first, then try again.'
    })
  })

  // A sidecar restart or a decode failure means git never ran; blaming git for it misleads, and the
  // classifier would bucket every one of them as unrecognised anyway.
  it('keeps a failed engine call out of the git classifier', () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {})

    const message = engineFailureMessage('Pushed failed', "sidecar RPC 'Push' failed")

    expect(logged).toHaveBeenCalledWith(
      '[git] Pushed failed — the engine call itself failed:',
      "sidecar RPC 'Push' failed"
    )
    expect(message).toContain('could not reach the Git engine')
    expect(message).not.toContain('Git rejected the operation')
  })

  it('toasts an engine failure as its own thing', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})

    toastEngineFailure('Pull failed', 'sidecar exited')

    expect(toast.error).toHaveBeenCalledWith('Pull failed', {
      description: expect.stringContaining('could not reach the Git engine')
    })
  })

  it('prefixes the banner form with what was being done', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})

    expect(gitFailureBannerText('Could not read history', 'fatal: unreadable object')).toBe(
      'Could not read history: Git rejected the operation. The full output is in the developer console.'
    )
  })
})
