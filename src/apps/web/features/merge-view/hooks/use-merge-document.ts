import { useCallback, useEffect, useRef, useState } from "react";
import {
  type ConflictDocument,
  type ConflictPath,
  RepositoryConflictsApi,
} from "#contracts/repository-conflicts/repository-conflicts.contract.ts";
import {
  fileContent,
  type LinePick,
  type MergeModel,
  mergeModel,
  type Picks,
  picksOf,
  withTyped,
} from "#web/features/merge-view/conflict-document.ts";
import { editText } from "#web/features/merge-view/result-text.ts";
import {
  conflictReason,
  useConflictDocument,
  useConflictList,
} from "#web/features/working-changes/conflicts/hooks/use-conflicts.ts";
import { describeFailure } from "#web/platform/query/request-failure.ts";
import { answer, useCommand } from "#web/platform/query/use-command.ts";

interface WriteQueue {
  revision: string | null;
  sent: string | null;
  pending: string | null;
  running: boolean;
  waiters: (() => void)[];
}

const writeRoute = RepositoryConflictsApi.write;
const noPicks: Picks = new Map();

export function useMergeDocument(input: ConflictPath) {
  const { path } = input;
  const document = useConflictDocument(input);
  const list = useConflictList(input);
  const { run } = useCommand(writeRoute, {
    target: input,
    answers: (written, { repositoryId, worktreePath, path }) => [
      answer(
        RepositoryConflictsApi.document,
        { repositoryId, worktreePath, path },
        written,
      ),
    ],
  });
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
      const result = await run({
        path,
        revision: state.revision ?? "",
        content,
      });
      state.running = false;
      if (result._tag === "Ok") state.revision = result.value.file.revision;
      else {
        state.sent = null;
        state.pending = null;
        if (conflictReason(result) !== "Stale")
          setNotice(describeFailure(result));
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
    [run, path, reload],
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
