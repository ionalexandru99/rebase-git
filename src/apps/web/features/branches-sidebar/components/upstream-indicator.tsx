import type { BranchUpstream } from "@rebase/contracts";
import { IconArrowDown, IconArrowUp } from "@tabler/icons-react";

export function UpstreamIndicator({
  upstream,
}: {
  readonly upstream: BranchUpstream;
}) {
  if (upstream.gone)
    return (
      <span className="shrink-0 text-xs text-status-unavailable">gone</span>
    );
  if (upstream.ahead === 0 && upstream.behind === 0) return null;
  return (
    <span className="flex shrink-0 items-center gap-1 text-xs font-normal tabular-nums">
      {upstream.ahead > 0 ? (
        <span
          role="img"
          className="inline-flex items-center text-status-available"
          aria-label={`${upstream.ahead} commits to push`}
        >
          <IconArrowUp aria-hidden="true" className="size-3" />
          {upstream.ahead}
        </span>
      ) : null}
      {upstream.behind > 0 ? (
        <span
          role="img"
          className="inline-flex items-center text-status-unavailable"
          aria-label={`${upstream.behind} commits to pull`}
        >
          <IconArrowDown aria-hidden="true" className="size-3" />
          {upstream.behind}
        </span>
      ) : null}
    </span>
  );
}
