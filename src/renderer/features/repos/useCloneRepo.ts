import { useCallback, useEffect, useRef, useState } from 'react'

export interface CloneProgressState {
  phase: string
  percent?: number
}

export interface CloneRequest {
  url: string
  parentDir: string
  folderName: string
}

export interface CloneRepoStore {
  cloning: boolean
  progress: CloneProgressState | null
  error: string | null
  clone: (request: CloneRequest) => Promise<string | null>
  cancel: () => void
  reset: () => void
}

let nextCloneId = 1

export function useCloneRepo(): CloneRepoStore {
  const [cloning, setCloning] = useState(false)
  const [progress, setProgress] = useState<CloneProgressState | null>(null)
  const [error, setError] = useState<string | null>(null)
  const cloneIdRef = useRef<number | null>(null)

  useEffect(() => {
    return window.electronAPI.onCloneProgress((event) => {
      if (event.cloneId !== cloneIdRef.current) {
        return
      }
      setProgress({ phase: event.phase, percent: event.percent })
    })
  }, [])

  useEffect(() => {
    return () => {
      if (cloneIdRef.current !== null) {
        void window.electronAPI.cancelClone(cloneIdRef.current)
      }
    }
  }, [])

  const clone = useCallback(async (request: CloneRequest): Promise<string | null> => {
    const cloneId = nextCloneId++
    cloneIdRef.current = cloneId
    setCloning(true)
    setError(null)
    setProgress({ phase: 'Connecting' })
    try {
      const response = await window.electronAPI.cloneRepo({ cloneId, ...request })
      if (cloneIdRef.current !== cloneId) {
        return null
      }
      if (response._tag === 'Ok') {
        return response.path
      }
      setError(response.message || 'Clone failed')
      return null
    } catch (caught) {
      if (cloneIdRef.current !== cloneId) {
        return null
      }
      setError(caught instanceof Error ? caught.message : String(caught))
      return null
    } finally {
      if (cloneIdRef.current === cloneId) {
        cloneIdRef.current = null
        setCloning(false)
        setProgress(null)
      }
    }
  }, [])

  const cancel = useCallback(() => {
    const cloneId = cloneIdRef.current
    cloneIdRef.current = null
    setCloning(false)
    setProgress(null)
    setError(null)
    if (cloneId !== null) {
      void window.electronAPI.cancelClone(cloneId)
    }
  }, [])

  const reset = useCallback(() => {
    setError(null)
    setProgress(null)
  }, [])

  return { cloning, progress, error, clone, cancel, reset }
}
