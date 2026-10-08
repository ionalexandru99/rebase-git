import { IconArrowBarToDown } from "@tabler/icons-react";
import type { ReactNode } from "react";
import { ToolbarButton } from "#web/components/ui/toolbar-button.tsx";
import { useOperationCommandState } from "#web/features/operation-recovery/hooks/use-operation-status.ts";
import {
  activeHead,
  useScopedRepositoryRefs,
} from "#web/features/refs/repository-refs.ts";
import {
  type Push,
  PushButton,
  PushNotice,
  usePush,
} from "#web/features/remote-sync/push.tsx";
import { resolvePushTarget } from "#web/features/remote-sync/push-target.ts";
import { type Pull, usePull } from "#web/features/remote-sync/use-pull.ts";
import { useRepositoryScope } from "#web/platform/query/repository-scope.tsx";

export function RemoteSync({
  children,
}: {
  readonly children: (actions: ReactNode) => ReactNode;
}) {
  const pull = usePull();
  const push = usePush();
  return (
    <>
      <PushNotice push={push} />
      {children(<SyncActions pull={pull} push={push} />)}
    </>
  );
}

const segment =
  "h-full rounded-none border-0 border-border border-l px-1.5 first:border-l-0";

function SyncActions({
  pull,
  push,
}: {
  readonly pull: Pull;
  readonly push: Push;
}) {
  const scope = useRepositoryScope();
  const { refs } = useScopedRepositoryRefs();
  const recoveryBusy = useOperationCommandState() === "busy";
  const activeBranch =
    refs === undefined || scope === undefined
      ? undefined
      : activeHead(refs, scope.worktreePath)?.branch;
  const incoming =
    refs?.branches.find(({ name }) => name === activeBranch)?.upstream
      ?.behind ?? 0;
  const pushTarget = resolvePushTarget(refs, activeBranch);
  const ready = pull.canRun && pull.ready && !recoveryBusy && !pull.pulling;
  return (
    <>
      <div className="flex h-7 shrink-0 items-center overflow-hidden rounded-control border border-border">
        {pull.available ? (
          <ToolbarButton
            aria-label={pullLabel(pull.pulling, incoming)}
            className={segment}
            disabled={!ready || activeBranch === undefined}
            onClick={() => {
              if (activeBranch !== undefined) void pull.pull(activeBranch);
            }}
          >
            <IconArrowBarToDown aria-hidden="true" className="size-3.5" />
            {pull.pulling || incoming === 0 ? null : (
              <span className="text-destructive tabular-nums">{incoming}</span>
            )}
          </ToolbarButton>
        ) : null}
        {scope === undefined || pushTarget === undefined ? null : (
          <PushButton
            push={push}
            target={pushTarget}
            operationBusy={recoveryBusy}
            className={segment}
          />
        )}
      </div>
      <FetchStatus
        connected={scope?.connected !== false}
        failed={pull.fetchFailed}
        fetching={pull.fetching}
      />
    </>
  );
}

function FetchStatus({
  connected,
  fetching,
  failed,
}: {
  readonly connected: boolean;
  readonly fetching: boolean;
  readonly failed: boolean;
}) {
  if (fetching || (connected && !failed)) return null;
  return (
    <span className="text-meta text-destructive" role="status">
      {connected ? "Fetch failed" : "You're offline"}
    </span>
  );
}

function pullLabel(pulling: boolean, incoming: number) {
  if (pulling) return "Pulling";
  if (incoming === 0) return "Pull";
  return `Pull ${incoming} incoming ${incoming === 1 ? "commit" : "commits"}`;
}
