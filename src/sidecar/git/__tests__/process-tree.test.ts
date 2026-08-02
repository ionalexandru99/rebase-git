import type { ChildProcess } from 'node:child_process'
import { EventEmitter } from 'node:events'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  createTrackedProcessGroup,
  descendantPidsFromProcessTable,
  waitForProcesses
} from '../process-tree'

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('descendantPidsFromProcessTable', () => {
  it('collects children across every generation', () => {
    const output = ['1 0', '10 1', '20 10', '21 10', '30 1', '40 20'].join('\n')

    expect(new Set(descendantPidsFromProcessTable(output, 1))).toEqual(
      new Set([10, 20, 21, 30, 40])
    )
  })

  it('does not include the parent or unrelated process trees', () => {
    const output = ['10 1', '20 10', '30 2', '40 30'].join('\n')

    expect(descendantPidsFromProcessTable(output, 10)).toEqual([20])
  })

  it('accepts the padded whitespace emitted by ps', () => {
    const output = ['  42      1', '\t84\t42', '  126   84  '].join('\n')

    expect(descendantPidsFromProcessTable(output, 42)).toEqual([84, 126])
  })

  it('ignores malformed and non-integer process rows', () => {
    const output = ['invalid row', '12.5 1', '20 missing', '30 1'].join('\n')

    expect(descendantPidsFromProcessTable(output, 1)).toEqual([30])
  })

  it('returns no descendants when the parent is absent', () => {
    expect(descendantPidsFromProcessTable('', 999)).toEqual([])
  })

  it('stops at cyclic and self-parent process rows', () => {
    const output = ['1 10', '10 1', '20 20', '30 1', '40 30'].join('\n')

    expect(descendantPidsFromProcessTable(output, 1)).toEqual([30, 40, 10])
    expect(descendantPidsFromProcessTable(output, 20)).toEqual([])
  })

  it('does not return duplicate descendants', () => {
    const output = ['10 1', '10 1', '20 10'].join('\n')

    expect(descendantPidsFromProcessTable(output, 1)).toEqual([10, 20])
  })
})

describe('waitForProcesses', () => {
  it('stops polling when the wait limit expires', async () => {
    vi.useFakeTimers()
    vi.spyOn(process, 'kill').mockReturnValue(true)

    const waiting = waitForProcesses([123], 25)
    await vi.advanceTimersByTimeAsync(25)

    await expect(waiting).resolves.toBeUndefined()
    expect(process.kill).toHaveBeenCalled()
  })
})

describe('tracked process groups', () => {
  it('starts its polling deadline only when termination begins', async () => {
    vi.useFakeTimers()
    const child = Object.assign(new EventEmitter(), {
      pid: undefined,
      exitCode: null,
      signalCode: null,
      kill: vi.fn()
    }) as unknown as ChildProcess
    const tracked = createTrackedProcessGroup(child)
    let exited = false
    void tracked.exited.then(() => {
      exited = true
    })

    await vi.advanceTimersByTimeAsync(5_000)
    expect(exited).toBe(false)

    const termination = tracked.terminate()
    await vi.advanceTimersByTimeAsync(4_000)

    await expect(termination).resolves.toBeUndefined()
    expect(vi.getTimerCount()).toBe(0)
  })
})
