import { useEffect, useState } from 'react'
import { type GraphMetrics, readGraphMetrics } from '@/features/history/graph/metrics'

export function useGraphMetrics(): GraphMetrics {
  const [metrics, setMetrics] = useState(readGraphMetrics)

  useEffect(() => {
    const refresh = () => setMetrics(readGraphMetrics())
    refresh()

    window.addEventListener('resize', refresh)
    const observer =
      typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => refresh())
    observer?.observe(document.documentElement)

    return () => {
      window.removeEventListener('resize', refresh)
      observer?.disconnect()
    }
  }, [])

  return metrics
}
