import { Menu } from "@base-ui/react/menu";
import {
  IconArrowDown,
  IconArrowUp,
  IconChevronDown,
} from "@tabler/icons-react";
import { useEffect, useState } from "react";
import { RepositoryPushApi } from "#contracts/repository-push/repository-push.contract.ts";
import { Button } from "#web/components/ui/button.tsx";
import { Confirmation } from "#web/components/ui/confirmation.tsx";
import {
  DropdownMenuContent,
  DropdownMenuItem,
} from "#web/components/ui/dropdown-menu.tsx";
import { ToolbarButton } from "#web/components/ui/toolbar-button.tsx";
import { PersistentNotification } from "#web/features/notifications/components/persistent-notification.tsx";
import {
  useErrorToast,
  useStatusToast,
} from "#web/features/notifications/notifications.tsx";
import {
  describeProgress,
  describePushed,
  destinationName,
  type ForcePushReview,
  fastForwardRequest,
  forcePushRequest,
  forcePushReview,
  type PushRequest,
  type PushTarget,
  pushFailureMessages,
} from "#web/features/remote-sync/push-target.ts";
import { useRepositoryScope } from "#web/platform/query/repository-scope.tsx";
import { useCommand } from "#web/platform/query/use-command.ts";

export type Push = ReturnType<typeof usePush>;

export function usePush() {
  const errorToast = useErrorToast();
  const statusToast = useStatusToast();
  const command = useCommand(RepositoryPushApi.push, {
    progress: (percent) => statusToast.advance("push", percent),
  });
  const [review, setReview] = useState<ForcePushReview | null>(null);
  const worktreePath = useRepositoryScope()?.worktreePath;
  useEffect(() => {
    if (worktreePath === undefined) return;
    return () => setReview(null);
  }, [worktreePath]);

  const pushBranch = (request: PushRequest) => {
    if (!command.canRun || command.running) return;
    setReview(null);
    statusToast.progress("push", describeProgress(request), {
      cancel: command.cancel,
      percent: 0,
    });
    void command.run(request).then((result) => {
      if (result._tag === "Ok")
        statusToast.success("push", describePushed(request));
      else
        errorToast.failure(
          "push",
          result,
          pushFailureMessages(request.destination),
        );
    });
  };

  const requestForcePush = (target: PushTarget) => {
    const review = forcePushReview(target);
    if (review === undefined || command.running) return;
    setReview(review);
  };

  return {
    canRun: command.canRun,
    running: command.running,
    review,
    push: (target: PushTarget) => {
      const upstream = target.upstream;
      if (upstream !== undefined && !upstream.gone && upstream.behind > 0) {
        requestForcePush(target);
        return;
      }
      const request = fastForwardRequest(target);
      if (request !== undefined) pushBranch(request);
    },
    requestForcePush,
    confirm: () => {
      if (review !== null) pushBranch(forcePushRequest(review));
    },
    cancel: () => setReview(null),
  };
}

export function PushButton({
  push,
  target,
  operationBusy,
}: {
  readonly push: Push;
  readonly target: PushTarget;
  readonly operationBusy: boolean;
}) {
  const upstream = target.upstream;
  const tracked = upstream !== undefined && !upstream.gone;
  const busy = !push.canRun || operationBusy || push.running;
  const canPush = !tracked || upstream.ahead > 0;
  const canForcePush = tracked && upstream.remoteOid !== undefined;
  return (
    <div className="flex h-7 items-center rounded-control border border-border">
      <ToolbarButton
        aria-label={pushLabel(target)}
        className="h-full rounded-r-none border-0"
        disabled={busy || !canPush}
        onClick={() => push.push(target)}
      >
        <IconArrowUp aria-hidden="true" className="size-3.5" />
        {push.running ? "Pushing" : "Push"}
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
      </ToolbarButton>
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

export function PushNotice({ push }: { readonly push: Push }) {
  if (push.review !== null)
    return (
      <PersistentNotification>
        <ForcePushConfirmation
          review={push.review}
          disabled={!push.canRun}
          cancel={push.cancel}
          confirm={push.confirm}
        />
      </PersistentNotification>
    );
  return null;
}

function ForcePushConfirmation({
  review,
  disabled,
  cancel,
  confirm,
}: {
  readonly review: ForcePushReview;
  readonly disabled: boolean;
  readonly cancel: () => void;
  readonly confirm: () => void;
}) {
  return (
    <Confirmation
      title={`Force push to ${destinationName(review.destination)}?`}
      action="Force push"
      disabled={disabled}
      onCancel={cancel}
      onConfirm={confirm}
      className="px-3 py-2"
    >
      Overwrites{" "}
      <span className="font-mono text-foreground">
        {review.expectedOid.slice(0, 8)}
      </span>
      {review.removed > 0 ? (
        <span className="text-destructive">
          {" "}
          · drops {review.removed} remote{" "}
          {review.removed === 1 ? "commit" : "commits"}
        </span>
      ) : null}
    </Confirmation>
  );
}
