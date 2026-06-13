import type { ResetMode } from '@shared/schemas/ipc'

export type { ResetMode }

export type BranchAction =
  | 'merge'
  | 'rename'
  | 'delete'
  | 'new-branch'
  | 'create-tag'
  | 'delete-tag'
  | 'copy-name'

export type FileAction = 'stage' | 'unstage' | 'discard' | 'copy-path'

export type CommitAction =
  | 'branch-here'
  | 'tag-here'
  | 'reset-soft'
  | 'reset-mixed'
  | 'reset-hard'
  | 'revert'
  | 'cherry-pick'
  | 'copy-sha'
  | 'copy-message'

export const RESET_MODE_BY_ACTION: Record<'reset-soft' | 'reset-mixed' | 'reset-hard', ResetMode> =
  {
    'reset-soft': 'soft',
    'reset-mixed': 'mixed',
    'reset-hard': 'hard'
  }
