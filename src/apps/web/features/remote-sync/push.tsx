import { IconArrowUp } from "@tabler/icons-react";
import { skipToken } from "@tanstack/react-query";
import { useState } from "react";
import { RepositoryPushApi } from "#contracts/repository-push/repository-push.contract.ts";
import { RepositoryBranchesApi } from "#contracts/repository-refs/repository-branches.contract.ts";
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
import { useEnvironmentQuery } from "#web/platform/query/environment-query.ts";
import { useRepositoryScope } from "#web/platform/query/repository-scope.tsx";
import { useCommand } from "#web/platform/query/use-command.ts";

export type Push = ReturnType<typeof usePush>;

export function usePush() {
  const errorToast = useErrorToast();
  const statusToast = useStatusToast();
  const command = useCommand(RepositoryPushApi.push);
  const [review, setReview] = useState<ForcePushReview | null>(null);
  const worktreePath = useRepositoryScope()?.worktreePath;
  const [reviewedIn, setReviewedIn] = useState(worktreePath);
  if (reviewedIn !== worktreePath) {
    setReviewedIn(worktreePath);
    if (!command.running) setReview(null);
  }

  const pushBranch = (request: PushRequest, reviewed: boolean) => {
    if (!command.canRun || command.running) return;
    if (!reviewed)
      statusToast.progress("push", describeProgress(request), {
        cancel: command.cancel,
      });
    void command.run(request).then((result) => {
      if (result._tag === "Ok")
        statusToast.success("push", describePushed(request));
      else errorToast.failure("push", result, pushFailureMessages);
      if (reviewed) setReview(null);
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
      if (request !== undefined) pushBranch(request, false);
    },
    requestForcePush,
    confirm: () => {
      if (review !== null) pushBranch(forcePushRequest(review), true);
    },
    cancel: () => setReview(null),
    stop: command.cancel,
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
  const scope = useRepositoryScope();
  const replaced = useEnvironmentQuery(
    RepositoryBranchesApi.unmerged,
    scope === undefined || review.removed === 0
      ? skipToken
      : {
          repositoryId: scope.repositoryId,
          worktreePath: scope.worktreePath,
          branches: [
            {
              remote: {
                name: review.destination.branch,
                remote: review.destination.remote,
                target: review.expectedOid,
              },
            },
          ],
        },
    { changes: "refs", enabled: !push.running },
  ).data?.[0];
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
      {replaced === undefined ? null : (
        <p>Commits on the remote that you don't have will be lost.</p>
      )}
    </ConfirmNotice>
  );
}
