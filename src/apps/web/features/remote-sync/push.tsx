import { IconArrowUp } from "@tabler/icons-react";
import { useEffect, useState } from "react";
import { RepositoryPushApi } from "#contracts/repository-push/repository-push.contract.ts";
import { Confirmation } from "#web/components/ui/confirmation.tsx";
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

export function pushAvailability(
  push: Push,
  target: PushTarget,
  operationBusy: boolean,
) {
  const upstream = target.upstream;
  const tracked = upstream !== undefined && !upstream.gone;
  const busy = !push.canRun || operationBusy || push.running;
  return {
    canPush: !busy && (!tracked || upstream.ahead > 0),
    canForcePush: !busy && tracked && upstream.remoteOid !== undefined,
  };
}

export function PushButton({
  push,
  target,
  operationBusy,
  className,
}: {
  readonly push: Push;
  readonly target: PushTarget;
  readonly operationBusy: boolean;
  readonly className?: string;
}) {
  return (
    <ToolbarButton
      aria-label={push.running ? "Pushing" : pushLabel(target)}
      className={className}
      disabled={!pushAvailability(push, target, operationBusy).canPush}
      onClick={() => push.push(target)}
    >
      <IconArrowUp aria-hidden="true" className="size-3.5" />
    </ToolbarButton>
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
