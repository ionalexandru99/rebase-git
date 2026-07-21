import { describe, expect, it, vi } from 'vitest'
import { createBeforeQuitHandler } from '../shutdown'

describe('before-quit shutdown coordination', () => {
  it('prevents quit until one shared sidecar shutdown finishes', async () => {
    let finishShutdown: () => void = () => {}
    const shutdown = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finishShutdown = resolve
        })
    )
    const quit = vi.fn()
    const handler = createBeforeQuitHandler(shutdown, quit)
    const firstEvent = { preventDefault: vi.fn() }
    const secondEvent = { preventDefault: vi.fn() }

    handler(firstEvent)
    handler(secondEvent)

    expect(firstEvent.preventDefault).toHaveBeenCalledOnce()
    expect(secondEvent.preventDefault).toHaveBeenCalledOnce()
    expect(shutdown).toHaveBeenCalledOnce()
    expect(quit).not.toHaveBeenCalled()

    finishShutdown()
    await Promise.resolve()
    await Promise.resolve()
    expect(quit).toHaveBeenCalledOnce()

    const resumedQuitEvent = { preventDefault: vi.fn() }
    handler(resumedQuitEvent)
    expect(resumedQuitEvent.preventDefault).not.toHaveBeenCalled()
  })
})
