import type { ChildProcess } from 'node:child_process'
import { describe, expect, it, vi } from 'vitest'
import type { TrackedProcessGroup } from '../process-tree'
import { drainTrackedProcesses } from '../spawn'

describe('tracked process cancellation', () => {
  it('drains a process whose bounded termination completes before its exit event', async () => {
    const terminate = vi.fn().mockResolvedValue(undefined)
    const tracked: TrackedProcessGroup = {
      child: {} as ChildProcess,
      exited: new Promise(() => {}),
      terminate
    }
    const children = new Set([tracked])

    await drainTrackedProcesses(children)

    expect(terminate).toHaveBeenCalledOnce()
    expect(children.size).toBe(0)
  })
})
