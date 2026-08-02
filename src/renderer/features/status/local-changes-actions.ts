import type { ConfirmRequest, PromptRequest } from '@/components/ui/prompt-dialog'
import type { GitActions } from '@/hooks/git/useGitActions'
import type { FileAction } from '@/lib/git-actions'
import type { ConflictSide } from './conflict-resolution'
import type { OperationSummary } from './operation-summary'

interface LocalChangesActionOptions {
  stageFile: (file: string) => Promise<unknown>
  unstageFile: (file: string, renameSource?: string) => Promise<unknown>
  actions: Pick<
    GitActions,
    'stashPush' | 'discardChanges' | 'resolveConflict' | 'abortOperation' | 'discardAll'
  >
  prompt: (request: PromptRequest) => void
  confirm: (request: ConfirmRequest) => void
  operationSummary: OperationSummary | null
  writeClipboard: (text: string) => Promise<void>
  reportCopySuccess: () => void
  reportCopyFailure: () => void
}

export function createLocalChangesActions(options: LocalChangesActionOptions) {
  const promptStash = (title: string, run: (message?: string) => Promise<boolean>) => {
    options.prompt({
      title,
      label: 'Message (optional)',
      placeholder: 'Describe these changes',
      confirmText: 'Stash',
      allowEmpty: true,
      onConfirm: (message) => void run(message.trim() || undefined)
    })
  }

  const stashSelected = (files: string[]) => {
    if (files.length === 0) {
      return
    }
    promptStash('Stash selected changes', (message) =>
      options.actions.stashPush(message, true, files)
    )
  }

  const stashAll = () => {
    promptStash('Stash all changes', (message) => options.actions.stashPush(message, true))
  }

  const handleFileAction = (action: FileAction, file: string, renameSource?: string) => {
    switch (action) {
      case 'stage':
        void options.stageFile(file)
        return
      case 'unstage':
        void options.unstageFile(file, renameSource)
        return
      case 'discard':
        options.confirm({
          title: `Discard changes to ${file}?`,
          message: 'Local edits to this file are lost. Untracked files are deleted.',
          confirmText: 'Discard',
          destructive: true,
          onConfirm: () =>
            void options.actions.discardChanges(
              renameSource ? [renameSource, file] : [file],
              `Discarded ${file}`
            )
        })
        return
      case 'copy-path':
        void options
          .writeClipboard(file)
          .then(options.reportCopySuccess)
          .catch(options.reportCopyFailure)
        return
    }
  }

  const resolveConflict = (file: string, side: ConflictSide) => {
    void options.actions.resolveConflict(file, side)
  }

  const requestAbortOperation = (summary: OperationSummary) => {
    options.confirm({
      title: summary.confirmTitle,
      message: summary.confirmMessage,
      confirmText: summary.abortText,
      destructive: true,
      onConfirm: () => void options.actions.abortOperation(summary.noun)
    })
  }

  const discardAll = () => {
    const summary = options.operationSummary
    options.confirm({
      title: 'Discard all changes?',
      message: summary
        ? `Every uncommitted change in the working tree is permanently lost, and the in-progress ${summary.noun} is aborted.`
        : 'Every uncommitted change in the working tree is permanently lost.',
      confirmText: 'Discard all',
      destructive: true,
      onConfirm: () => {
        void (async () => {
          if (summary) {
            const aborted = await options.actions.abortOperation(summary.noun)
            if (!aborted) {
              return
            }
          }
          await options.actions.discardAll()
        })()
      }
    })
  }

  return {
    stashSelected,
    stashAll,
    handleFileAction,
    resolveConflict,
    requestAbortOperation,
    discardAll
  }
}
