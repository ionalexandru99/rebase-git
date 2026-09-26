import { Menu } from "@base-ui/react/menu";
import {
  IconArrowDown,
  IconArrowUp,
  IconChevronDown,
} from "@tabler/icons-react";
import { useOperationCommandState } from "#web/features/operation-recovery/index";
import type { Push } from "#web/features/repository-push/hooks/use-push";
import {
  destinationName,
  type PushTarget,
} from "#web/features/repository-push/resolve-push-target";
import { useRepositoryScope } from "#web/features/repository-scope/index";
import { Button } from "#web-ui/components/ui/button";
import {
  DropdownMenuContent,
  DropdownMenuItem,
} from "#web-ui/components/ui/dropdown-menu";

export function PushButton({
  push,
  target,
}: {
  readonly push: Push;
  readonly target: PushTarget | undefined;
}) {
  const scope = useRepositoryScope();
  const operationBusy = useOperationCommandState() === "busy";
  if (scope === undefined || target === undefined) return null;
  const upstream = target.upstream;
  const tracked = upstream !== undefined && !upstream.gone;
  const busy =
    !scope.connected ||
    !scope.writable ||
    operationBusy ||
    push.running !== null;
  const canPush = !tracked || upstream.ahead > 0;
  const canForcePush = tracked && upstream.remoteOid !== undefined;
  return (
    <div className="flex h-7 items-center rounded-md border border-border">
      <Button
        aria-label={pushLabel(target)}
        className="h-full gap-1.5 rounded-r-none border-0 text-[.85rem] sm:text-[.85rem]"
        disabled={busy || !canPush}
        onClick={() => push.push(target)}
        size="sm"
        variant="ghost"
      >
        <IconArrowUp aria-hidden="true" className="size-3.5" />
        {push.running === null ? "Push" : "Pushing"}
        {tracked && upstream.ahead > 0 ? (
          <span className="text-status-available tabular-nums">
            {upstream.ahead}
          </span>
        ) : null}
        {tracked && upstream.behind > 0 ? (
          <span className="inline-flex items-center text-status-unavailable tabular-nums">
            <IconArrowDown aria-hidden="true" className="size-3" />
            {upstream.behind}
          </span>
        ) : null}
      </Button>
      <Menu.Root>
        <Menu.Trigger
          aria-label="More push actions"
          disabled={busy}
          render={
            <Button
              className="h-full rounded-l-none border-0 border-border border-l px-1.5"
              size="sm"
              variant="ghost"
            />
          }
        >
          <IconChevronDown aria-hidden="true" className="size-3.5" />
        </Menu.Trigger>
        <DropdownMenuContent>
          <DropdownMenuItem
            disabled={!canPush}
            onClick={() => push.push(target)}
          >
            Push
          </DropdownMenuItem>
          <DropdownMenuItem
            disabled={!canForcePush}
            onClick={() => push.requestForcePush(target)}
          >
            Force push…
          </DropdownMenuItem>
        </DropdownMenuContent>
      </Menu.Root>
    </div>
  );
}

function pushLabel({ branch, upstream }: PushTarget) {
  if (upstream === undefined || upstream.gone) return `Push ${branch}`;
  const name = destinationName(upstream.destination);
  if (upstream.ahead === 0) return `Push ${branch} to ${name}`;
  if (upstream.behind > 0)
    return `Force push ${branch} to ${name}, ${upstream.ahead} ahead and ${upstream.behind} behind`;
  return `Push ${upstream.ahead} commits to ${name}`;
}
