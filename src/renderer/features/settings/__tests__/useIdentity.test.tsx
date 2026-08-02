import { ClearIdentity, GetIdentity, SetIdentity } from '@shared/rpc'
import { act, renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { createQueryClient, QueryProvider } from '@/app/QueryProvider'
import { sidecarMock } from '../../../../test/setup'
import { useIdentity } from '../useIdentity'

const REPO = '/home/user/projects/my-app'

const wrapper = ({ children }: { children: React.ReactNode }) => (
  <QueryProvider client={createQueryClient({ gcTime: Number.POSITIVE_INFINITY })}>
    {children}
  </QueryProvider>
)

describe('useIdentity', () => {
  it('drops a failed save error once a clear succeeds', async () => {
    sidecarMock.respond(GetIdentity, () => ({
      _tag: 'Ok',
      local: { email: 'local@example.com' },
      global: {},
      effective: { email: 'local@example.com' }
    }))
    sidecarMock.respond(SetIdentity, () => ({ _tag: 'GitError', message: 'could not lock config' }))
    sidecarMock.respond(ClearIdentity, () => ({ _tag: 'Ok' }))

    const { result } = renderHook(() => useIdentity(REPO), { wrapper })
    await waitFor(() => {
      expect(result.current.identity).not.toBeNull()
    })

    act(() => {
      result.current.save({ scope: 'local', identity: { name: 'Ada' } })
    })
    await waitFor(() => {
      expect(result.current.error).toBe('could not lock config')
    })

    act(() => {
      result.current.clear(['email'])
    })

    await waitFor(() => {
      expect(result.current.error).toBeNull()
    })
  })
})
