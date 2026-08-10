import { ClientBootstrapSchema } from '@common/features/client-connection'
import { Schema } from 'effect4'
import { describe, expect, it } from 'vitest'

const decodeBootstrap = Schema.decodeUnknownSync(ClientBootstrapSchema)

describe('Browser client bootstrap contract', () => {
  it('accepts the browser-safe bootstrap facts', () => {
    expect(
      decodeBootstrap({
        csrfToken: 'session-csrf-token',
        environment: { environmentId: 'local', path: '/workspace/rebase' },
        readOnly: true
      })
    ).toEqual({
      csrfToken: 'session-csrf-token',
      environment: { environmentId: 'local', path: '/workspace/rebase' },
      readOnly: true
    })
  })

  it('rejects incomplete or unbounded bootstrap data', () => {
    expect(() =>
      decodeBootstrap({
        environment: { environmentId: 'local', path: '' },
        readOnly: false
      })
    ).toThrow()
  })
})
