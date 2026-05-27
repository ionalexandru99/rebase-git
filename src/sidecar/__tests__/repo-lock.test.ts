import { describe, expect, it } from 'vitest'
import { repoLockCount, withRepoLock } from '../repo-lock'

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

describe('repo lock', () => {
  it('serializes work for the same repo', async () => {
    const order: string[] = []

    await Promise.all([
      withRepoLock('/repo', async () => {
        order.push('a:start')
        await delay(10)
        order.push('a:end')
      }),
      withRepoLock('/repo', async () => {
        order.push('b:start')
        order.push('b:end')
      })
    ])

    expect(order).toEqual(['a:start', 'a:end', 'b:start', 'b:end'])
    expect(repoLockCount()).toBe(0)
  })

  it('allows different repos to run independently', async () => {
    const order: string[] = []

    await Promise.all([
      withRepoLock('/repo-a', async () => {
        order.push('a:start')
        await delay(10)
        order.push('a:end')
      }),
      withRepoLock('/repo-b', async () => {
        order.push('b:start')
        order.push('b:end')
      })
    ])

    expect(order.indexOf('b:start')).toBeLessThan(order.indexOf('a:end'))
    expect(repoLockCount()).toBe(0)
  })
})
