import {
  type ConflictList,
  type ConflictPath,
  RepositoryConflictsHttpApi,
  type WholeFileChoice,
} from "@rebase/contracts";
import { useState } from "react";
import type { WriteQueue } from "#web/features/merge-view/hooks/use-write-queue";
import {
  type ConflictRequestFailure,
  conflictReason,
} from "#web/features/merge-view/merge-view-messages";
import {
  type SettledCommand,
  settleCommand,
  useCommand,
} from "#web/platform/query/use-command";

type ListRoute =
  | typeof RepositoryConflictsHttpApi.stage
  | typeof RepositoryConflictsHttpApi.choose
  | typeof RepositoryConflictsHttpApi.mergeTool;

export interface ResolutionOptions {
  readonly input: ConflictPath;
  readonly queue: WriteQueue;
  readonly listedRevision: string | undefined;
  readonly onList: (list: ConflictList) => void;
  readonly onResolved: (list: ConflictList) => void;
  readonly onReload: () => void;
  readonly onStale: () => void;
  readonly onFailed: (failure: ConflictRequestFailure) => void;
}

export function useResolution({
  input,
  queue,
  listedRevision,
  onList,
  onResolved,
  onReload,
  onStale,
  onFailed,
}: ResolutionOptions) {
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
  const revision = () => queue.revision() ?? listedRevision ?? "";

  function settle(
    result: SettledCommand<ListRoute>,
    onOk: (list: ConflictList) => void,
  ) {
    if (result._tag === "Ok") {
      onList(result.value);
      return onOk(result.value);
    }
    const reason = conflictReason(result.failure);
    if (reason === "Markers") return setConfirming(true);
    if (reason === "Stale") return onStale();
    onFailed(result.failure);
  }

  async function markResolved(allowMarkers: boolean) {
    setConfirming(false);
    await queue.settled();
    const result = await settleCommand(
      RepositoryConflictsHttpApi.stage,
      stage.mutateAsync,
      { ...input, revision: revision(), allowMarkers },
    );
    settle(result, onResolved);
  }

  async function chooseWholeFile(choice: WholeFileChoice) {
    await queue.settled();
    const result = await settleCommand(
      RepositoryConflictsHttpApi.choose,
      choose.mutateAsync,
      { ...input, revision: revision(), choice },
    );
    settle(result, onResolved);
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
        ? onReload()
        : onResolved(list),
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
