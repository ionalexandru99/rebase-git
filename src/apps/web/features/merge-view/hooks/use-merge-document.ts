import {
  type ConflictDocument,
  type ConflictPath,
  RepositoryConflictsHttpApi,
} from "@rebase/contracts";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  fileContent,
  type LinePick,
  type MergeModel,
  mergeModel,
  type Picks,
  picksOf,
  withTyped,
} from "#web/features/merge-view/conflict-document";
import { editText } from "#web/features/merge-view/result-text";
import {
  conflictReason,
  describeChangesFailure,
} from "#web/features/working-changes/changes-messages";
import {
  useConflictDocument,
  useConflictList,
} from "#web/features/working-changes/conflicts/hooks/use-conflicts";
import { invalidatedByChange } from "#web/platform/query/environment-invalidation";
import { settleCommand, useCommand } from "#web/platform/query/use-command";

interface WriteQueue {
  revision: string | null;
  sent: string | null;
  pending: string | null;
  running: boolean;
  waiters: (() => void)[];
}

const writeRoute = RepositoryConflictsHttpApi.write;
const noPicks: Picks = new Map();

export function useMergeDocument(input: ConflictPath) {
  const { repositoryId, worktreePath, path } = input;
  const document = useConflictDocument(input);
  const list = useConflictList(input);
  const { mutateAsync } = useCommand(writeRoute, { repository: input });
  const refreshIndex = useIndexRefresh(repositoryId);
  const queue = useRef<WriteQueue>({
    revision: null,
    sent: null,
    pending: null,
    running: false,
    waiters: [],
  });
  const [loaded, setLoaded] = useState<MergeModel | null>(null);
  const [model, setModel] = useState<MergeModel | null>(null);
  const [picks, setPicks] = useState<Picks>(noPicks);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback((document: ConflictDocument) => {
    queue.current.revision = document.file.revision;
    queue.current.sent = document.content;
    const next = mergeModel(document);
    setLoaded(next);
    setModel(next);
    setPicks(noPicks);
  }, []);
  const refetch = document.refetch;
  const reload = useCallback(async () => {
    const { data } = await refetch();
    if (data !== undefined) load(data);
  }, [load, refetch]);

  const send = useCallback(
    async (content: string) => {
      const state = queue.current;
      state.running = true;
      state.sent = content;
      const result = await settleCommand(writeRoute, mutateAsync, {
        repositoryId,
        worktreePath,
        path,
        revision: state.revision ?? "",
        content,
      });
      state.running = false;
      if (result._tag === "Ok") {
        state.revision = result.value.file.revision;
        refreshIndex();
      } else {
        state.sent = null;
        state.pending = null;
        if (conflictReason(result.failure) !== "Stale")
          setNotice(describeChangesFailure(result.failure));
        else {
          setNotice(
            `${path.split("/").at(-1) ?? path} changed on disk. Reloaded.`,
          );
          void reload();
        }
      }
      const next = state.pending;
      state.pending = null;
      if (next !== null) return void send(next);
      for (const waiter of state.waiters.splice(0)) waiter();
    },
    [mutateAsync, path, refreshIndex, reload, repositoryId, worktreePath],
  );

  const data = document.data;
  useEffect(() => {
    const state = queue.current;
    if (
      data === undefined ||
      state.running ||
      state.pending !== null ||
      data.file.revision === state.revision
    )
      return;
    load(data);
  }, [data, load]);

  useEffect(() => {
    if (model === null) return;
    const content = fileContent(model, picks);
    const state = queue.current;
    if (content === (state.pending ?? state.sent)) return;
    if (state.running) state.pending = content;
    else void send(content);
  }, [model, picks, send]);

  const choose = useCallback(
    (
      regionId: string,
      update: (picks: readonly LinePick[]) => readonly LinePick[],
    ) => {
      setNotice(null);
      setPicks((current) =>
        new Map(current).set(regionId, update(picksOf(current, regionId))),
      );
      setModel((current) => current && withTyped(current, regionId, null));
    },
    [],
  );

  return {
    document,
    list,
    loaded,
    model,
    picks,
    notice,
    choose,
    revision: () => queue.current.revision,
    settled: () => {
      const state = queue.current;
      if (!state.running && state.pending === null) return Promise.resolve();
      return new Promise<void>((resolve) => state.waiters.push(resolve));
    },
    edit: (text: string, caret: number) => {
      setNotice(null);
      setModel((current) => current && editText(current, picks, text, caret));
    },
    undo: (regionId: string) => {
      setNotice(null);
      setPicks((current) => {
        const next = new Map(current);
        next.delete(regionId);
        return next;
      });
      setModel((current) => current && withTyped(current, regionId, null));
    },
  };
}

type MergeDocument = ReturnType<typeof useMergeDocument>;

export type ChooseRegion = MergeDocument["choose"];

function useIndexRefresh(repositoryId: string) {
  const queryClient = useQueryClient();
  return useCallback(
    () =>
      void queryClient.invalidateQueries({
        predicate: (query) =>
          invalidatedByChange(query.meta, [repositoryId], "Index"),
      }),
    [queryClient, repositoryId],
  );
}
