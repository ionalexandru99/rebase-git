import type { UpdaterState } from '@shared/schemas/ipc'
import { useEffect, useState } from 'react'

export function hasPendingUpdate(state: UpdaterState | null): boolean {
  return state !== null && (state.status === 'available' || state.status === 'downloaded')
}

export function useUpdaterState(): UpdaterState | null {
  const [updater, setUpdater] = useState<UpdaterState | null>(null)

  useEffect(() => {
    let cancelled = false
    let pushed = false
    const unsubscribe = window.electronAPI.onUpdaterStateChanged((state) => {
      pushed = true
      setUpdater(state)
    })
    window.electronAPI
      .getUpdaterState()
      .then((state) => {
        if (!cancelled && !pushed) {
          setUpdater(state)
        }
      })
      .catch((error: unknown) => {
        console.error('[updates] failed to load the update state', error)
      })
    return () => {
      cancelled = true
      unsubscribe()
    }
  }, [])

  return updater
}
