import type { PullFailure } from "@rebase/contracts";

export function pullBlocked(detail: string): PullFailure {
  return { _tag: "PullBlocked", detail: detail.slice(0, 2_048) };
}
