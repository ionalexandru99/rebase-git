import { createContext, useContext } from 'react'
import type { useDialogs } from '@/components/ui/prompt-dialog'
import type { GitActions } from '@/hooks/git/useGitActions'
import type { useStashes } from '@/hooks/git/useStashes'

type Dialogs = ReturnType<typeof useDialogs>
type StashList = ReturnType<typeof useStashes>

export interface WorkspaceContextValue {
  actions: GitActions
  stashList: StashList
  prompt: Dialogs['prompt']
  confirm: Dialogs['confirm']
}

const WorkspaceContext = createContext<WorkspaceContextValue | null>(null)

export const WorkspaceProvider = WorkspaceContext.Provider

export function useWorkspaceContext(): WorkspaceContextValue {
  const value = useContext(WorkspaceContext)
  if (!value) {
    throw new Error('useWorkspaceContext must be used within a WorkspaceProvider')
  }
  return value
}
