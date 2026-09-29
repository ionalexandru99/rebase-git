import { useCallback, useEffect, useRef, useState } from "react";
import {
  type ConflictDocument,
  type ConflictPath,
  RepositoryConflictsApi,
} from "#contracts/repository-conflicts/repository-conflicts.contract.ts";
import { conflictReason } from "#web/features/working-changes/conflicts/hooks/use-conflicts.ts";
import { describeFailure } from "#web/platform/query/request-failure.ts";
import { answer, useCommand } from "#web/platform/query/use-command.ts";

interface WriteQueue {
  revision: string;
  pending: string | null;
  running: boolean;
  waiters: (() => void)[];
}

export function useConflictWrites(
  input: ConflictPath,
  document: ConflictDocument,
  reload: () => void,
) {
  const { run } = useCommand(RepositoryConflictsApi.write, {
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
    revision: document.file.revision,
    pending: null,
    running: false,
    waiters: [],
  });
  const [problem, setProblem] = useState<string | null>(null);

  const revision = document.file.revision;
  useEffect(() => {
    const state = queue.current;
    if (!state.running && state.pending === null) state.revision = revision;
  }, [revision]);

  const send = useCallback(
    async (content: string) => {
      const state = queue.current;
      state.running = true;
      const result = await run({
        path: input.path,
        revision: state.revision,
        content,
      });
      state.running = false;
      if (result._tag === "Ok") state.revision = result.value.file.revision;
      else {
        state.pending = null;
        if (conflictReason(result) === "Stale") reload();
        else setProblem(describeFailure(result));
      }
      const next = state.pending;
      state.pending = null;
      if (next !== null) return void send(next);
      for (const waiter of state.waiters.splice(0)) waiter();
    },
    [run, input.path, reload],
  );

  return {
    problem,
    revision: () => queue.current.revision,
    save: (content: string) => {
      setProblem(null);
      const state = queue.current;
      if (state.running) state.pending = content;
      else void send(content);
    },
    settled: () => {
      const state = queue.current;
      if (!state.running && state.pending === null) return Promise.resolve();
      return new Promise<void>((resolve) => state.waiters.push(resolve));
    },
  };
}
