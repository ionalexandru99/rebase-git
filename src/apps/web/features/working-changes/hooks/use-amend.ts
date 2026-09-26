import type { RepositoryChanges } from "@rebase/contracts";
import { type Dispatch, type SetStateAction, useEffect } from "react";

export type Amend =
  | { readonly on: false }
  | { readonly on: true; readonly head?: string | null };

export const amendOff: Amend = { on: false };

export function useAmendHead(
  amend: Amend,
  setAmend: Dispatch<SetStateAction<Amend>>,
  settled: RepositoryChanges | undefined,
  headMoved: () => void,
) {
  useEffect(() => {
    if (!amend.on || settled === undefined) return;
    if (amend.head === undefined) {
      setAmend({ on: true, head: settled.head });
    } else if (settled.head !== amend.head) {
      setAmend(amendOff);
      headMoved();
    }
  }, [amend, settled, setAmend, headMoved]);
}
