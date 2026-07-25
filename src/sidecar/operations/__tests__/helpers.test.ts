import { describe, expect, it, vi } from 'vitest'
import { retryIndexLock } from '../helpers'

describe('retryIndexLock', () => {
  it('retries transient index.lock contention until the command succeeds', async () => {
    const command = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(new Error("Unable to create '.git/index.lock': File exists."))
      .mockRejectedValueOnce(new Error("Unable to create '.git/index.lock': File exists."))
      .mockResolvedValue('ok')

    await expect(retryIndexLock(command)).resolves.toBe('ok')
    expect(command).toHaveBeenCalledTimes(3)
  })

  it('stops after the bounded number of index.lock attempts', async () => {
    const command = vi
      .fn<() => Promise<string>>()
      .mockRejectedValue(new Error("Unable to create '.git/index.lock': File exists."))

    await expect(retryIndexLock(command)).rejects.toThrow('index.lock')
    expect(command).toHaveBeenCalledTimes(4)
  })

  it('does not retry other Git failures', async () => {
    const command = vi.fn<() => Promise<string>>().mockRejectedValue(new Error('not a repository'))

    await expect(retryIndexLock(command)).rejects.toThrow('not a repository')
    expect(command).toHaveBeenCalledTimes(1)
  })
})
