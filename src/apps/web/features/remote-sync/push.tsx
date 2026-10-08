import { IconArrowUp } from "@tabler/icons-react";
import { useState } from "react";
import { RepositoryPushApi } from "#contracts/repository-push/repository-push.contract.ts";
import { ToolbarButton } from "#web/components/ui/toolbar-button.tsx";
import { ConfirmNotice } from "#web/features/notifications/components/persistent-notification.tsx";
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
  const command = useCommand(RepositoryPushApi.push);
  const [review, setReview] = useState<ForcePushReview | null>(null);
  const [pushing, setPushing] = useState(false);
  const running = command.running || pushing;
  const worktreePath = useRepositoryScope()?.worktreePath;
  const [reviewedIn, setReviewedIn] = useState(worktreePath);
  if (reviewedIn !== worktreePath) {
    setReviewedIn(worktreePath);
    if (!pushing) setReview(null);
  }

  const pushBranch = (request: PushRequest, reviewed: boolean) => {
    if (!command.canRun || running) return;
    if (reviewed) setPushing(true);
    else
      statusToast.progress("push", describeProgress(request), {
        cancel: command.cancel,
      });
    void command.run(request).then((result) => {
      if (result._tag === "Ok")
        statusToast.success("push", describePushed(request));
      else errorToast.failure("push", result, pushFailureMessages);
      if (!reviewed) return;
      setPushing(false);
      setReview(null);
    });
  };

  const requestForcePush = (target: PushTarget) => {
    const review = forcePushReview(target);
    if (review === undefined || running) return;
    setReview(review);
  };

  return {
    canRun: command.canRun,
    running,
    review,
    push: (target: PushTarget) => {
      const upstream = target.upstream;
      if (upstream !== undefined && !upstream.gone && upstream.behind > 0) {
        requestForcePush(target);
        return;
      }
      const request = fastForwardRequest(target);
      if (request !== undefined) pushBranch(request, false);
    },
    confirm: () => {
      if (review !== null) pushBranch(forcePushRequest(review), true);
    },
    cancel: () => setReview(null),
    stop: command.cancel,
  };
}

function canPush(push: Push, target: PushTarget, operationBusy: boolean) {
  const upstream = target.upstream;
  const tracked = upstream !== undefined && !upstream.gone;
  const busy = !push.canRun || operationBusy || push.running;
  return !busy && (!tracked || upstream.ahead > 0);
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
  const upstream = target.upstream;
  const outgoing = upstream === undefined || upstream.gone ? 0 : upstream.ahead;
  return (
    <ToolbarButton
      aria-label={push.running ? "Pushing" : pushLabel(target)}
      className={className}
      disabled={!canPush(push, target, operationBusy)}
      onClick={() => push.push(target)}
    >
      <IconArrowUp aria-hidden="true" className="size-3.5" />
      {outgoing === 0 ? null : (
        <span className="text-success tabular-nums">{outgoing}</span>
      )}
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
  if (push.review === null) return null;
  return <ForcePushConfirmation push={push} review={push.review} />;
}

function ForcePushConfirmation({
  push,
  review,
}: {
  readonly push: Push;
  readonly review: ForcePushReview;
}) {
  return (
    <ConfirmNotice
      notice="push"
      action="Force push"
      busy={push.running ? "Force pushing" : undefined}
      disabled={!push.canRun}
      onCancel={push.cancel}
      onConfirm={push.confirm}
      onStop={push.stop}
      title="Force push?"
    >
      {review.removed === 0 ? null : (
        <p>Commits on the remote that you don't have will be lost.</p>
      )}
    </ConfirmNotice>
  );
}
