import type {
  GitIdentity,
  IdentityField,
  IdentityScope,
  ResolvedIdentity
} from '@shared/schemas/git'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback } from 'react'
import { rpcClearIdentity, rpcGetIdentity, rpcSetIdentity } from '@/lib/rpc-client'
import { unwrapOk } from '@/lib/unwrap-rpc-result'

const IDENTITY_QUERY_ROOT = 'identity'

export const identityQueryKey = (repoPath: string | null) =>
  [IDENTITY_QUERY_ROOT, repoPath ?? 'app'] as const

export function useIdentity(repoPath: string | null) {
  const queryClient = useQueryClient()

  const query = useQuery<ResolvedIdentity>({
    queryKey: identityQueryKey(repoPath),
    queryFn: async () => {
      const { local, global, effective } = unwrapOk(await rpcGetIdentity(repoPath))
      return { local, global, effective }
    }
  })

  const invalidate = useCallback(
    () => queryClient.invalidateQueries({ queryKey: [IDENTITY_QUERY_ROOT] }),
    [queryClient]
  )

  const save = useMutation({
    mutationFn: async (input: { scope: IdentityScope; identity: GitIdentity }) => {
      unwrapOk(
        await rpcSetIdentity(input.scope, input.scope === 'local' ? repoPath : null, input.identity)
      )
    },
    onSuccess: () => {
      clear.reset()
      return invalidate()
    }
  })

  const clear = useMutation({
    mutationFn: async (fields: IdentityField[]) => {
      if (repoPath) {
        unwrapOk(await rpcClearIdentity(repoPath, fields))
      }
    },
    onSuccess: () => {
      save.reset()
      return invalidate()
    }
  })

  const failure = save.error ?? clear.error
  return {
    identity: query.data ?? null,
    loading: query.isPending,
    saving: save.isPending || clear.isPending,
    error: failure ? failure.message : query.error ? query.error.message : null,
    save: save.mutate,
    clear: clear.mutate
  }
}
