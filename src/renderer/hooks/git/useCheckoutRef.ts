import { toast } from 'sonner'
import type { RefKind } from '@/lib/ref-tree'
import { rpcCheckout } from '@/lib/rpc-client'

export function useCheckoutRef(
  repoPath: string | null,
  onCheckedOut?: (repoPath: string) => void | Promise<void>
) {
  return async (refKind: RefKind, fullPath: string) => {
    if (refKind === 'stash') {
      return
    }
    const path = repoPath
    if (!path) {
      toast.error('Repository is not open')
      return
    }
    try {
      const result = await rpcCheckout(path, refKind, fullPath)
      if (result._tag === 'Ok') {
        await onCheckedOut?.(path)
        toast.success(`Switched to ${result.checkedOut}`)
      } else if (result._tag === 'GitError') {
        toast.error('Checkout failed', { description: result.message })
      } else {
        toast.error('Repository is not open')
      }
    } catch (error) {
      toast.error('Checkout failed', {
        description: error instanceof Error ? error.message : String(error)
      })
    }
  }
}
