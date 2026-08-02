import { waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { createLocalChangesActions } from '@/features/status/local-changes-actions'
import { summarizeOperation } from '@/features/status/operation-summary'

function setup(overrides: Partial<Parameters<typeof createLocalChangesActions>[0]> = {}) {
  const options: Parameters<typeof createLocalChangesActions>[0] = {
    stageFile: vi.fn().mockResolvedValue(true),
    unstageFile: vi.fn().mockResolvedValue(true),
    actions: {
      stashPush: vi.fn().mockResolvedValue(true),
      discardChanges: vi.fn().mockResolvedValue(true),
      resolveConflict: vi.fn().mockResolvedValue(true),
      abortOperation: vi.fn().mockResolvedValue(true),
      discardAll: vi.fn().mockResolvedValue(true)
    },
    prompt: vi.fn(),
    confirm: vi.fn(),
    operationSummary: null,
    writeClipboard: vi.fn().mockResolvedValue(undefined),
    reportCopySuccess: vi.fn(),
    reportCopyFailure: vi.fn(),
    ...overrides
  }
  return { options, handlers: createLocalChangesActions(options) }
}

describe('createLocalChangesActions', () => {
  it('prompts for a selected-file stash and normalizes its optional message', () => {
    const { options, handlers } = setup()

    handlers.stashSelected([])
    expect(options.prompt).not.toHaveBeenCalled()

    handlers.stashSelected(['a.ts', 'b.ts'])
    const request = vi.mocked(options.prompt).mock.calls[0][0]
    expect(request).toMatchObject({
      title: 'Stash selected changes',
      confirmText: 'Stash',
      allowEmpty: true
    })

    request.onConfirm('  work in progress  ')
    expect(options.actions.stashPush).toHaveBeenCalledWith('work in progress', true, [
      'a.ts',
      'b.ts'
    ])
  })

  it('stashes all changes without a file filter or blank message', () => {
    const { options, handlers } = setup()

    handlers.stashAll()
    const request = vi.mocked(options.prompt).mock.calls[0][0]
    request.onConfirm('   ')

    expect(options.actions.stashPush).toHaveBeenCalledWith(undefined, true)
  })

  it('routes stage and rename-aware unstage actions', () => {
    const { options, handlers } = setup()

    handlers.handleFileAction('stage', 'new.ts')
    handlers.handleFileAction('unstage', 'new.ts', 'old.ts')

    expect(options.stageFile).toHaveBeenCalledWith('new.ts')
    expect(options.unstageFile).toHaveBeenCalledWith('new.ts', 'old.ts')
  })

  it('defers rename-aware file discard until confirmation', () => {
    const { options, handlers } = setup()

    handlers.handleFileAction('discard', 'new.ts', 'old.ts')

    expect(options.actions.discardChanges).not.toHaveBeenCalled()
    const request = vi.mocked(options.confirm).mock.calls[0][0]
    expect(request).toMatchObject({
      title: 'Discard changes to new.ts?',
      confirmText: 'Discard',
      destructive: true
    })

    request.onConfirm()
    expect(options.actions.discardChanges).toHaveBeenCalledWith(
      ['old.ts', 'new.ts'],
      'Discarded new.ts'
    )
  })

  it('reports clipboard success and failure', async () => {
    const successful = setup()
    successful.handlers.handleFileAction('copy-path', 'src/app.ts')
    await waitFor(() => {
      expect(successful.options.reportCopySuccess).toHaveBeenCalled()
    })

    const failed = setup({ writeClipboard: vi.fn().mockRejectedValue(new Error('denied')) })
    failed.handlers.handleFileAction('copy-path', 'src/app.ts')
    await waitFor(() => {
      expect(failed.options.reportCopyFailure).toHaveBeenCalled()
    })
  })

  it('routes conflict resolution and confirmed operation aborts', () => {
    const { options, handlers } = setup()
    const summary = summarizeOperation({
      kind: 'cherry-pick',
      oursLabel: 'main',
      theirsLabel: 'abc1234 feature'
    })

    handlers.resolveConflict('conflict.ts', 'theirs')
    handlers.requestAbortOperation(summary)
    const request = vi.mocked(options.confirm).mock.calls[0][0]
    request.onConfirm()

    expect(options.actions.resolveConflict).toHaveBeenCalledWith('conflict.ts', 'theirs')
    expect(options.actions.abortOperation).toHaveBeenCalledWith('cherry-pick')
  })

  it('aborts an in-progress operation before discarding all changes', async () => {
    const operationSummary = summarizeOperation({
      kind: 'rebase-merge',
      oursLabel: 'main',
      theirsLabel: 'feature'
    })
    const { options, handlers } = setup({ operationSummary })

    handlers.discardAll()
    const request = vi.mocked(options.confirm).mock.calls[0][0]
    expect(request.message).toContain('in-progress rebase is aborted')
    request.onConfirm()

    await waitFor(() => {
      expect(options.actions.abortOperation).toHaveBeenCalledWith('rebase')
      expect(options.actions.discardAll).toHaveBeenCalled()
    })
  })

  it('keeps changes when aborting the operation fails', async () => {
    const operationSummary = summarizeOperation({
      kind: 'merge',
      oursLabel: 'main',
      theirsLabel: 'feature'
    })
    const abortOperation = vi.fn().mockResolvedValue(false)
    const { options, handlers } = setup({
      operationSummary,
      actions: {
        stashPush: vi.fn().mockResolvedValue(true),
        discardChanges: vi.fn().mockResolvedValue(true),
        resolveConflict: vi.fn().mockResolvedValue(true),
        abortOperation,
        discardAll: vi.fn().mockResolvedValue(true)
      }
    })

    handlers.discardAll()
    vi.mocked(options.confirm).mock.calls[0][0].onConfirm()

    await waitFor(() => {
      expect(abortOperation).toHaveBeenCalled()
    })
    expect(options.actions.discardAll).not.toHaveBeenCalled()
  })
})
