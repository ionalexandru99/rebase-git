import type { ChildProcess } from 'node:child_process'
import { describe, expect, it } from 'vitest'
import { tryReserveFetch } from './autoFetch'

function fakeProc(): ChildProcess {
  return {} as ChildProcess
}

describe('tryReserveFetch', () => {
  it('reserves an unseen path and returns true', () => {
    const active = new Map<string, ChildProcess>()
    const proc = fakeProc()

    expect(tryReserveFetch(active, '/repo/a', proc)).toBe(true)
    expect(active.get('/repo/a')).toBe(proc)
  })

  it('refuses to reserve a path that is already reserved', () => {
    const active = new Map<string, ChildProcess>()
    const first = fakeProc()
    const second = fakeProc()

    expect(tryReserveFetch(active, '/repo/a', first)).toBe(true)
    expect(tryReserveFetch(active, '/repo/a', second)).toBe(false)
    expect(active.get('/repo/a')).toBe(first)
  })

  it('tracks paths independently', () => {
    const active = new Map<string, ChildProcess>()
    expect(tryReserveFetch(active, '/repo/a', fakeProc())).toBe(true)
    expect(tryReserveFetch(active, '/repo/b', fakeProc())).toBe(true)
    expect(active.size).toBe(2)
  })
})
