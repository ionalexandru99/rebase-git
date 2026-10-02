import {
  type PushRejected,
  RepositoryPushApi,
  type TagsPushed,
} from "#contracts/repository-push/repository-push.contract.ts";
import {
  useErrorToast,
  useStatusToast,
} from "#web/features/notifications/notifications.tsx";
import type { TagPushHandler } from "#web/features/refs/ref-actions.ts";
import { gitMessage } from "#web/platform/query/request-failure.ts";
import { useCommand } from "#web/platform/query/use-command.ts";

export function useTagPush(): TagPushHandler | undefined {
  const command = useCommand(RepositoryPushApi.pushTags);
  const errorToast = useErrorToast();
  const statusToast = useStatusToast();
  if (!command.canRun) return undefined;
  return {
    pushing: command.running,
    run: (tags, remote) => {
      if (command.running) return;
      statusToast.progress("pushTags", `Pushing ${tagList(tags)} to ${remote}`);
      void command.run({ remote, tags }).then((result) => {
        if (result._tag === "Ok")
          statusToast.success("pushTags", describePushed(result.value));
        else
          errorToast.failure("pushTags", result, {
            PushRejected: (rejected) => describeRejection(rejected, remote),
          });
      });
    },
  };
}

function describePushed({ remote, pushed, upToDate }: TagsPushed) {
  if (pushed.length === 0)
    return `${tagList(upToDate)} ${upToDate.length === 1 ? "is" : "are"} already on ${remote}`;
  const sent = `Pushed ${tagList(pushed)} to ${remote}`;
  return upToDate.length === 0
    ? sent
    : `${sent}. ${tagList(upToDate)} ${upToDate.length === 1 ? "was" : "were"} already there.`;
}

function describeRejection({ reason, detail }: PushRejected, remote: string) {
  switch (reason) {
    case "TagExists":
      return `${remote} already has ${detail} on another commit. Nothing was pushed.`;
    case "HookDeclined":
      return gitMessage(detail, `${remote} rejected the tags.`);
    case "Authentication":
      return `${remote} rejected the credentials.`;
    case "Network":
      return `Can't reach ${remote}.`;
    case "RemoteMissing":
      return `Remote ${remote} not found.`;
    default:
      return gitMessage(detail);
  }
}

function tagList(tags: readonly string[]) {
  return tags.length <= 2 ? tags.join(" and ") : `${tags.length} tags`;
}
