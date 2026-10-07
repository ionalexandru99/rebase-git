import { IconArrowBarToDown, IconArrowDown } from "@tabler/icons-react";
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
import {
  type Pull,
  useFetch,
  usePull,
} from "#web/features/remote-sync/use-pull.ts";
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

function SyncActions({
  pull,
  push,
}: {
  readonly pull: Pull;
  readonly push: Push;
}) {
  const fetch = useFetch();
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
      <ToolbarButton
        disabled={!ready || fetch.fetching}
        onClick={fetch.fetchNow}
      >
        <IconArrowDown aria-hidden="true" className="size-3.5" />
        {fetch.fetching ? "Fetching" : "Fetch"}
      </ToolbarButton>
      {pull.available ? (
        <ToolbarButton
          aria-label={pullLabel(pull.pulling, incoming)}
          disabled={!ready || activeBranch === undefined}
          onClick={() => {
            if (activeBranch !== undefined) void pull.pull(activeBranch);
          }}
        >
          <IconArrowBarToDown aria-hidden="true" className="size-3.5" />
          {pull.pulling ? "Pulling" : "Pull"}
          {pull.pulling || incoming === 0 ? null : (
            <span
              aria-hidden="true"
              className="rounded-full bg-primary/15 px-1.5 text-badge leading-[1.15rem] text-primary tabular-nums"
            >
              {incoming}
            </span>
          )}
        </ToolbarButton>
      ) : null}
      {scope === undefined || pushTarget === undefined ? null : (
        <PushButton
          push={push}
          target={pushTarget}
          operationBusy={recoveryBusy}
        />
      )}
      <FetchStatus
        connected={scope?.connected !== false}
        failed={fetch.failed}
        fetching={fetch.fetching}
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
    <span className="text-meta text-status-unavailable" role="status">
      {connected ? "Fetch failed" : "You're offline"}
    </span>
  );
}

function pullLabel(pulling: boolean, incoming: number) {
  if (pulling) return "Pulling";
  if (incoming === 0) return "Pull";
  return `Pull ${incoming} incoming ${incoming === 1 ? "commit" : "commits"}`;
}
