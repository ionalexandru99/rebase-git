import { useCallback, useState } from 'react'
import { useAutoFetch } from './git/useAutoFetch'
import { useGitActions } from './git/useGitActions'
import { useGitListeners } from './git/useGitListeners'
import { useGitState } from './git/useGitState'

export function useGit() {
  const { state, setters, repoPathRef, reset } = useGitState()
  const [fetchResetKey, setFetchResetKey] = useState(0)
  const bumpFetchResetKey = useCallback(() => setFetchResetKey((value) => value + 1), [])

  useGitListeners(setters, repoPathRef)
  const actions = useGitActions({ setters, repoPathRef, reset, bumpFetchResetKey })
  useAutoFetch(state.repoPath, setters, fetchResetKey)

  return {
    ...state,
    loading: state.opening || state.committing,
    ...actions
  }
}
