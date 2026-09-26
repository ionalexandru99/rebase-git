import {
  type ConflictList,
  type ConflictPath,
  RepositoryConflictsHttpApi,
  type WholeFileChoice,
} from "@rebase/contracts";
import { useState } from "react";
import type { MergeDocument } from "#web/features/merge-view/hooks/use-merge-document";
import { conflictReason } from "#web/features/working-changes/changes-messages";
import {
  type SettledCommand,
  settleCommand,
  useCommand,
} from "#web/platform/query/use-command";

type ListRoute =
  | typeof RepositoryConflictsHttpApi.stage
  | typeof RepositoryConflictsHttpApi.choose
  | typeof RepositoryConflictsHttpApi.mergeTool;

export function useResolveFile({
  input,
  document,
  onOpen,
  onClose,
}: {
  readonly input: ConflictPath;
  readonly document: MergeDocument;
  readonly onOpen: (path: string) => void;
  readonly onClose: () => void;
}) {
  const repository = {
    repositoryId: input.repositoryId,
    worktreePath: input.worktreePath,
  };
  const stage = useCommand(RepositoryConflictsHttpApi.stage, { repository });
  const choose = useCommand(RepositoryConflictsHttpApi.choose, { repository });
  const mergeTool = useCommand(RepositoryConflictsHttpApi.mergeTool, {
    repository,
  });
  const [confirming, setConfirming] = useState(false);
  const { queue } = document;
  const revision = () =>
    queue.revision() ??
    document.list.data?.files.find(({ path }) => path === input.path)
      ?.revision ??
    "";

  function openNext(list: ConflictList) {
    const next = list.files.find(
      ({ path, openRegions }) => path !== input.path && openRegions > 0,
    );
    if (next === undefined) onClose();
    else onOpen(next.path);
  }

  function settle(
    result: SettledCommand<ListRoute>,
    onOk: (list: ConflictList) => void,
  ) {
    if (result._tag === "Ok") {
      document.storeList(result.value);
      return onOk(result.value);
    }
    const reason = conflictReason(result.failure);
    if (reason === "Markers") return setConfirming(true);
    if (reason === "Stale") return document.stale();
    document.fail(result.failure);
  }

  async function markResolved(allowMarkers: boolean) {
    setConfirming(false);
    await queue.settled();
    const result = await settleCommand(
      RepositoryConflictsHttpApi.stage,
      stage.mutateAsync,
      { ...input, revision: revision(), allowMarkers },
    );
    settle(result, openNext);
  }

  async function chooseWholeFile(choice: WholeFileChoice) {
    await queue.settled();
    const result = await settleCommand(
      RepositoryConflictsHttpApi.choose,
      choose.mutateAsync,
      { ...input, revision: revision(), choice },
    );
    settle(result, openNext);
  }

  async function openMergeTool() {
    await queue.settled();
    const result = await settleCommand(
      RepositoryConflictsHttpApi.mergeTool,
      mergeTool.mutateAsync,
      input,
    );
    settle(result, (list) =>
      list.files.some(({ path }) => path === input.path)
        ? document.reload()
        : openNext(list),
    );
  }

  return {
    busy: stage.isPending || choose.isPending || mergeTool.isPending,
    confirming,
    cancelConfirmation: () => setConfirming(false),
    markResolved,
    chooseWholeFile,
    openMergeTool,
  };
}

export type ResolveFile = ReturnType<typeof useResolveFile>;
