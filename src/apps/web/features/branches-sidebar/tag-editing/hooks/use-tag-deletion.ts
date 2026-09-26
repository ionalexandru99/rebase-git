import { useCallback, useRef, useState } from "react";
import { describeTagFailure } from "#web/features/branches-sidebar/tag-editing/tag-edit-messages";
import type { TagCommands } from "#web/features/tag-management/hooks/use-tag-commands";

export interface PendingTagDeletion {
  readonly busy: boolean;
  readonly name: string;
}

export interface TagDeletionFailure {
  readonly id: number;
  readonly message: string;
}

export function useTagDeletion({
  commands,
  focusTree,
}: {
  readonly commands: TagCommands | null;
  readonly focusTree: () => void;
}) {
  const [pending, setPending] = useState<PendingTagDeletion>();
  const [failure, setFailure] = useState<TagDeletionFailure>();
  const latest = useRef(pending);
  latest.current = pending;

  const remove = async (write: TagCommands, name: string) => {
    const result = await write.delete(name);
    if (result._tag === "Failed")
      setFailure((current) => ({
        id: (current?.id ?? 0) + 1,
        message: describeTagFailure(name, result.failure),
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
      if (commands === null) {
        cancel();
        return;
      }
      setPending({ ...pending, busy: true });
      void remove(commands, pending.name);
    },
    failure,
    pending,
    request: (name: string) => setPending({ busy: false, name }),
  };
}
