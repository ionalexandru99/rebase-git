import { describe, expect, it } from 'vitest'

describe('Agent composition root', () => {
  it('can be imported outside Electron without starting a process connection', async () => {
    const agent = await import('../index')

    expect(agent.startLegacySidecar).toBeTypeOf('function')
  })
})
