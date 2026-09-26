import {
  type ConflictDocument,
  type ConflictPath,
  RepositoryConflictsHttpApi,
} from "@rebase/contracts";
import { useCallback, useLayoutEffect, useMemo, useRef } from "react";
import {
  type ConflictRequestFailure,
  conflictReason,
} from "#web/features/merge-view/merge-view-messages";
import { settleCommand, useCommand } from "#web/platform/query/use-command";

export interface WriteQueueHandlers {
  readonly onWritten: (document: ConflictDocument) => void;
  readonly onStale: () => void;
  readonly onFailed: (failure: ConflictRequestFailure) => void;
}

export interface WriteQueue {
  readonly enqueue: (content: string) => void;
  readonly settled: () => Promise<void>;
  readonly acknowledge: (revision: string, content: string) => void;
  readonly revision: () => string | null;
  readonly idle: () => boolean;
}

interface QueueState {
  revision: string | null;
  latest: string | null;
  pending: string | null;
  running: boolean;
  waiters: (() => void)[];
}

const route = RepositoryConflictsHttpApi.write;

export function useWriteQueue(
  input: ConflictPath,
  handlers: WriteQueueHandlers,
): WriteQueue {
  const write = useCommand(route, { repository: input });
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
    const result = await settleCommand(route, mutate, {
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
