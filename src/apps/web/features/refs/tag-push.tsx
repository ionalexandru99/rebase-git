import { useState } from "react";
import {
  type PushRejected,
  RepositoryPushApi,
  type TagsPushed,
} from "#contracts/repository-push/repository-push.contract.ts";
import { PersistentNotification } from "#web/features/notifications/components/persistent-notification.tsx";
import { useErrorToast } from "#web/features/notifications/notifications.tsx";
import type { TagPushHandler } from "#web/features/refs/ref-actions.ts";
import { DoneNotice } from "#web/features/refs/ref-editing-status.tsx";
import { gitMessage } from "#web/platform/query/request-failure.ts";
import { useCommand } from "#web/platform/query/use-command.ts";

export type TagPush = ReturnType<typeof useTagPush>;

export function useTagPush() {
  const command = useCommand(RepositoryPushApi.pushTags);
  const errorToast = useErrorToast();
  const [pushed, setPushed] = useState<TagsPushed>();
  const handler: TagPushHandler | undefined = command.canRun
    ? {
        pushing: command.running,
        run: (tags, remote) => {
          if (command.running) return;
          setPushed(undefined);
          void command.run({ remote, tags }).then((result) => {
            if (result._tag === "Ok") setPushed(result.value);
            errorToast.failure("pushTags", result, {
              PushRejected: (rejected) => describeRejection(rejected, remote),
            });
          });
        },
      }
    : undefined;
  return {
    handler,
    pushing: command.running ? command.input : undefined,
    pushed,
    dismiss: () => setPushed(undefined),
  };
}

export function TagPushStatus({ push }: { readonly push: TagPush }) {
  if (push.pushing !== undefined)
    return (
      <PersistentNotification>
        <p className="px-3 py-2 text-sm font-medium" role="status">
          Pushing {tagList(push.pushing.tags)} to {push.pushing.remote}
        </p>
      </PersistentNotification>
    );
  if (push.pushed === undefined) return null;
  return (
    <DoneNotice
      message={describePushed(push.pushed)}
      onDismiss={push.dismiss}
    />
  );
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
