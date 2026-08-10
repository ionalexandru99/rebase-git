import { act, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
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

afterEach(() => {
  document.querySelector('meta[name="rebase-server-instance-id"]')?.remove()
  vi.restoreAllMocks()
})

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

  it('connects with the document client when no client is supplied', async () => {
    const container = document.createElement('div')
    const serverIdentity = document.createElement('meta')
    serverIdentity.name = 'rebase-server-instance-id'
    serverIdentity.content = 'server-instance-test'
    document.head.append(serverIdentity)
    const fetchRequest = vi.spyOn(window, 'fetch').mockImplementation(async () =>
      new Response(
        JSON.stringify({
          csrfToken: 'csrf-token',
          environment: { environmentId: 'local', path: '/work/document-client' },
          readOnly: false
        }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      )
    )

    await act(async () => startRuntimeRenderer(container))

    await waitFor(() => expect(container).toHaveTextContent('/work/document-client'))
    expect(fetchRequest).toHaveBeenCalled()
    const [target, request] = fetchRequest.mock.calls[0]
    const headers = new Headers(request?.headers)
    expect(target).toBe('/api/bootstrap')
    expect(headers.get('x-rebase-renderer-build-id')).toBe('renderer-test-build')
    expect(headers.get('x-rebase-server-instance-id')).toBe('server-instance-test')
  })
})
