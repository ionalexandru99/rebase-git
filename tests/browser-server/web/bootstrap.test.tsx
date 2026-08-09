import { act } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { startRuntimeRenderer } from '../../../src/web/bootstrap'
import type { RebaseClient } from '../../../src/web/features/server-connection'

const connectedClient: RebaseClient = {
  loadBootstrap: async () => ({
    environment: {
      environmentId: 'local',
      path: '/work/rebase-git'
    },
    readOnly: true
  })
}

describe('startRuntimeRenderer', () => {
  it('shows the Server environment after the browser client connects', async () => {
    const container = document.createElement('div')

    await act(async () => startRuntimeRenderer(container, connectedClient))

    expect(container).toHaveTextContent('Rebase Server ready')
    expect(container).toHaveTextContent('/work/rebase-git')
    expect(container).toHaveTextContent('Read-only')
  })

  it('shows a browser-safe failure when the Server cannot be reached', async () => {
    const container = document.createElement('div')
    const disconnectedClient: RebaseClient = {
      loadBootstrap: async () => {
        throw new Error('Server request failed with status 503')
      }
    }

    await act(async () => startRuntimeRenderer(container, disconnectedClient))

    expect(container).toHaveTextContent('Cannot connect to Rebase Server')
    expect(container).toHaveTextContent('Server request failed with status 503')
  })
})
