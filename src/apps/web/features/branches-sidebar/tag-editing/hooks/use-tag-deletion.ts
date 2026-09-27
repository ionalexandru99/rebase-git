import type { RepositoryTagsHttpApi } from "@rebase/contracts";
import { useCallback, useRef, useState } from "react";
import { describeFailure } from "#web/platform/query/request-failure";
import type { Command, CommandFailure } from "#web/platform/query/use-command";

type TagRoute =
  (typeof RepositoryTagsHttpApi)[keyof typeof RepositoryTagsHttpApi];

export interface PendingTagDeletion {
  readonly busy: boolean;
  readonly name: string;
}

export interface TagDeletionFailure {
  readonly id: number;
  readonly message: string;
}

export function useTagDeletion({
  deleteTag,
  focusTree,
}: {
  readonly deleteTag: Command<typeof RepositoryTagsHttpApi.delete>;
  readonly focusTree: () => void;
}) {
  const [pending, setPending] = useState<PendingTagDeletion>();
  const [failure, setFailure] = useState<TagDeletionFailure>();
  const latest = useRef(pending);
  latest.current = pending;

  const remove = async (name: string) => {
    const result = await deleteTag.run({ name });
    if (result._tag !== "Ok")
      setFailure((current) => ({
        id: (current?.id ?? 0) + 1,
        message: describeTagFailure(name, result),
      }));
    if (latest.current?.name !== name) return;
    setPending(undefined);
    focusTree();
  };

  const cancel = useCallback(() => {
    setPending(undefined);
    focusTree();
  }, [focusTree]);

  return {
    cancel,
    confirm: () => {
      if (pending === undefined || pending.busy) return;
      if (!deleteTag.canRun) {
        cancel();
        return;
      }
      setPending({ ...pending, busy: true });
      void remove(pending.name);
    },
    failure,
    pending,
    request: (name: string) => setPending({ busy: false, name }),
  };
}

export function describeTagFailure(
  name: string,
  failure: CommandFailure<TagRoute>,
) {
  return describeFailure(failure, {
    TagRejected: ({ reason }) =>
      reason === "Exists"
        ? `${name} already exists.`
        : `${name} is not a valid tag name.`,
  });
}
