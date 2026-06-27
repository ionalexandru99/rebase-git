import { Checkout } from '@shared/rpc'
import { type RefKind, shortRefName } from '@/lib/ref-tree'
import { rpcCheckout } from '@/lib/rpc-client'
import type { ActionRunner } from '@/stores/git'

export function useCheckoutRef(runner: ActionRunner) {
  return async (refKind: RefKind, fullPath: string): Promise<void> => {
    if (refKind === 'stash') {
      return
    }
    await runner.runAction(
      Checkout._tag,
      (path) => rpcCheckout(path, refKind, fullPath),
      `Switched to ${shortRefName(refKind, fullPath)}`
    )
  }
}
