import { afterEach, describe, expect, it, vi } from 'vitest'
import { gitFailureBannerText, gitFailureMessage, toastGitFailure } from '@/lib/git-report'

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

  it('prefixes the banner form with what was being done', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})

    expect(gitFailureBannerText('Could not read history', 'fatal: unreadable object')).toBe(
      'Could not read history: Git rejected the operation. The full output is in the developer console.'
    )
  })
})
