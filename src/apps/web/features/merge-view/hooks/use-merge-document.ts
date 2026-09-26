import {
  type ConflictDocument,
  type ConflictList,
  type ConflictPath,
  RepositoryConflictsHttpApi,
} from "@rebase/contracts";
import { useQueryClient } from "@tanstack/react-query";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  choosePicks,
  fileContent,
  type LinePick,
  type MergeModel,
  mergeModel,
  regionPicks,
  restoreRegion,
} from "#web/features/merge-view/conflict-document";
import { editText } from "#web/features/merge-view/result-text";
import {
  type ChangesRequestFailure,
  conflictReason,
  describeChangesFailure,
} from "#web/features/working-changes/changes-messages";
import {
  conflictScope,
  useConflictDocument,
  useConflictList,
} from "#web/features/working-changes/conflicts/hooks/use-conflict-queries";
import { useEnvironment } from "#web/platform/query/environment-context";
import { environmentQueryKey } from "#web/platform/query/environment-query";
import { settleCommand, useCommand } from "#web/platform/query/use-command";

export interface WriteQueue {
  readonly enqueue: (content: string) => void;
  readonly settled: () => Promise<void>;
  readonly acknowledge: (revision: string, content: string) => void;
  readonly revision: () => string | null;
  readonly idle: () => boolean;
}

interface WriteHandlers {
  readonly onWritten: (document: ConflictDocument) => void;
  readonly onStale: () => void;
  readonly onFailed: (failure: ChangesRequestFailure) => void;
}

interface QueueState {
  revision: string | null;
  latest: string | null;
  pending: string | null;
  running: boolean;
  waiters: (() => void)[];
}

const writeRoute = RepositoryConflictsHttpApi.write;

export function useMergeDocument(input: ConflictPath) {
  const document = useConflictDocument(input, input.path, true);
  const list = useConflictList(input, true, true);
  const cache = useConflictCache(input);
  const [model, setModel] = useState<MergeModel | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const fail = (failure: ChangesRequestFailure) =>
    setNotice(describeChangesFailure(failure));
  const queue = useWriteQueue(input, {
    onWritten: (written) => {
      cache.storeDocument(written);
      void cache.refreshList();
    },
    onStale: () => stale(),
    onFailed: fail,
  });
  const load = useCallback(
    (loaded: ConflictDocument) => {
      queue.acknowledge(loaded.file.revision, loaded.content);
      setModel(mergeModel(loaded));
    },
    [queue],
  );
  const refetchDocument = document.refetch;
  const reload = useCallback(async () => {
    const { data } = await refetchDocument();
    if (data !== undefined) load(data);
  }, [load, refetchDocument]);
  const stale = () => {
    setNotice(
      `${input.path.split("/").at(-1) ?? input.path} changed on disk. Reloaded.`,
    );
    void reload();
  };
  useDocumentLoading(document.data, queue, load);
  useEffect(() => {
    if (model !== null) queue.enqueue(fileContent(model));
  }, [model, queue]);

  const change = useCallback((update: (model: MergeModel) => MergeModel) => {
    setNotice(null);
    setModel((current) => (current === null ? current : update(current)));
  }, []);
  const choose = useCallback(
    (
      regionId: string,
      update: (picks: readonly LinePick[]) => readonly LinePick[],
    ) =>
      change((current) =>
        choosePicks(current, regionId, update(regionPicks(current, regionId))),
      ),
    [change],
  );

  return {
    document,
    list,
    model,
    notice,
    queue,
    storeList: cache.storeList,
    reload: () => void reload(),
    stale,
    fail,
    choose,
    edit: (text: string, caret: number) =>
      change((current) => editText(current, text, caret)),
    undo: (regionId: string) =>
      change((current) => restoreRegion(current, regionId)),
  };
}

export type MergeDocument = ReturnType<typeof useMergeDocument>;

export type ChooseRegion = MergeDocument["choose"];

function useDocumentLoading(
  document: ConflictDocument | undefined,
  queue: WriteQueue,
  load: (document: ConflictDocument) => void,
) {
  useEffect(() => {
    if (
      document === undefined ||
      !queue.idle() ||
      document.file.revision === queue.revision()
    )
      return;
    load(document);
  }, [document, load, queue]);
}

function useConflictCache(input: ConflictPath) {
  const { environmentId } = useEnvironment();
  const queryClient = useQueryClient();
  const { repositoryId, worktreePath, path } = input;
  return useMemo(() => {
    const scope = conflictScope({ repositoryId, worktreePath });
    const listKey = environmentQueryKey(
      environmentId,
      repositoryId,
      RepositoryConflictsHttpApi.list,
      scope,
    );
    const documentKey = environmentQueryKey(
      environmentId,
      repositoryId,
      RepositoryConflictsHttpApi.document,
      { ...scope, path },
    );
    return {
      storeDocument: (value: ConflictDocument) =>
        queryClient.setQueryData(documentKey, value),
      storeList: (value: ConflictList) =>
        queryClient.setQueryData(listKey, value),
      refreshList: () => queryClient.invalidateQueries({ queryKey: listKey }),
    };
  }, [environmentId, path, queryClient, repositoryId, worktreePath]);
}

function useWriteQueue(
  input: ConflictPath,
  handlers: WriteHandlers,
): WriteQueue {
  const write = useCommand(writeRoute, { repository: input });
  const state = useRef<QueueState>({
    revision: null,
    latest: null,
    pending: null,
    running: false,
    waiters: [],
  });
  const current = useRef({ input, handlers, mutate: write.mutateAsync });
  useLayoutEffect(() => {
    current.current = { input, handlers, mutate: write.mutateAsync };
  });

  const send = useCallback(async (content: string) => {
    const queue = state.current;
    const { input, mutate } = current.current;
    queue.running = true;
    const result = await settleCommand(writeRoute, mutate, {
      ...input,
      revision: queue.revision ?? "",
      content,
    });
    queue.running = false;
    if (result._tag === "Ok") {
      queue.revision = result.value.file.revision;
      current.current.handlers.onWritten(result.value);
    } else {
      queue.pending = null;
      queue.latest = null;
      if (conflictReason(result.failure) === "Stale")
        current.current.handlers.onStale();
      else current.current.handlers.onFailed(result.failure);
    }
    const next = queue.pending;
    queue.pending = null;
    if (next !== null) return void send(next);
    for (const waiter of queue.waiters.splice(0)) waiter();
  }, []);

  return useMemo(
    () => ({
      enqueue: (content) => {
        const queue = state.current;
        if (content === queue.latest) return;
        queue.latest = content;
        if (queue.running) queue.pending = content;
        else void send(content);
      },
      settled: () => {
        const queue = state.current;
        if (!queue.running && queue.pending === null) return Promise.resolve();
        return new Promise<void>((resolve) => queue.waiters.push(resolve));
      },
      acknowledge: (revision, content) => {
        state.current.revision = revision;
        state.current.latest = content;
      },
      revision: () => state.current.revision,
      idle: () => !state.current.running && state.current.pending === null,
    }),
    [send],
  );
}
