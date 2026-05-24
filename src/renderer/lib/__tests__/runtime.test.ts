import { Context, Effect, Layer } from 'effect'
import { describe, expect, it, vi } from 'vitest'

class Greeter extends Context.Tag('test/Greeter')<Greeter, { hello: () => string }>() {}

describe('makeRuntime', () => {
  it('runs an effect that resolves a service from the provided layer', async () => {
    const { makeRuntime } = await vi.importActual<typeof import('@/lib/runtime')>('@/lib/runtime')
    const runtime = makeRuntime(Layer.succeed(Greeter, { hello: () => 'hi' }))

    const result = await runtime.runPromise(Greeter.pipe(Effect.map((greeter) => greeter.hello())))

    expect(result).toBe('hi')
    await runtime.dispose()
  })
})
