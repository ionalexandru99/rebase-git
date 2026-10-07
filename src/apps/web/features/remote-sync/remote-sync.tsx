import { Menu } from "@base-ui/react/menu";
import {
  IconArrowBarToDown,
  IconArrowDown,
  IconArrowUp,
  IconChevronDown,
} from "@tabler/icons-react";
import type { ReactNode } from "react";
import { Button } from "#web/components/ui/button.tsx";
import {
  DropdownMenuContent,
  DropdownMenuItem,
} from "#web/components/ui/dropdown-menu.tsx";
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
  pushAvailability,
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

const segment =
  "h-full rounded-none border-0 border-border border-l px-1.5 first:border-l-0";

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
  const upstream = pushTarget?.upstream;
  const outgoing = upstream === undefined || upstream.gone ? 0 : upstream.ahead;
  const ready = pull.canRun && pull.ready && !recoveryBusy && !pull.pulling;
  const canForcePush =
    pushTarget !== undefined &&
    pushAvailability(push, pushTarget, recoveryBusy).canForcePush;
  return (
    <>
      <SyncCounts incoming={incoming} outgoing={outgoing} />
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
        <Menu.Root>
          <Menu.Trigger
            aria-label="More sync actions"
            render={<Button className={segment} size="sm" variant="ghost" />}
          >
            <IconChevronDown aria-hidden="true" className="size-3.5" />
          </Menu.Trigger>
          <DropdownMenuContent>
            <DropdownMenuItem
              disabled={!ready || fetch.fetching}
              onClick={fetch.fetchNow}
            >
              Fetch
            </DropdownMenuItem>
            <DropdownMenuItem
              disabled={!canForcePush}
              onClick={() => {
                if (pushTarget !== undefined) push.requestForcePush(pushTarget);
              }}
            >
              Force push…
            </DropdownMenuItem>
          </DropdownMenuContent>
        </Menu.Root>
      </div>
      <FetchStatus
        connected={scope?.connected !== false}
        failed={fetch.failed}
        fetching={fetch.fetching}
      />
    </>
  );
}

function SyncCounts({
  incoming,
  outgoing,
}: {
  readonly incoming: number;
  readonly outgoing: number;
}) {
  if (incoming === 0 && outgoing === 0) return null;
  return (
    <span
      aria-hidden="true"
      className="inline-flex shrink-0 items-center gap-1 rounded-full bg-primary/15 px-1.5 text-badge leading-[1.15rem] text-primary tabular-nums"
    >
      {incoming === 0 ? null : (
        <span className="inline-flex items-center">
          <IconArrowDown className="size-3" />
          {incoming}
        </span>
      )}
      {outgoing === 0 ? null : (
        <span className="inline-flex items-center">
          <IconArrowUp className="size-3" />
          {outgoing}
        </span>
      )}
    </span>
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
