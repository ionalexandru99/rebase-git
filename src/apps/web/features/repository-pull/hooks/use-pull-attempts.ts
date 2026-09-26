import type { EnvironmentRequestClient } from "@rebase/environment-client";
import { Effect } from "effect";
import { useCallback, useMemo, useRef, useState } from "react";
import type { RepositoryHistoryFetchCommands } from "#web/features/repository-history/index";
import { describeRepositoryPullError } from "#web/features/repository-pull/repository-pull-messages";
import { repositoryPullClient } from "#web/features/repository-pull/transport/repository-pull-client";

interface PullAttempt {
  readonly id: number;
  readonly branch: string;
  readonly pending: boolean;
  readonly error?: string;
}

export function usePullAttempts(
  requests: EnvironmentRequestClient | undefined,
  scope:
    | { readonly repositoryId: string; readonly worktreePath: string }
    | undefined,
  reader: Pick<RepositoryHistoryFetchCommands, "fetch"> | undefined,
) {
  const client = useMemo(
    () => (requests === undefined ? undefined : repositoryPullClient(requests)),
    [requests],
  );
  const [attempt, setAttempt] = useState<PullAttempt>();
  const running = useRef(false);
  const attempts = useRef(0);
  const pull = useCallback(
    (branch: string) => {
      if (
        client === undefined ||
        scope === undefined ||
        reader === undefined ||
        running.current
      )
        return;
      running.current = true;
      const id = ++attempts.current;
      setAttempt({ id, branch, pending: true });
      void reader
        .fetch()
        .then((freshness) =>
          freshness.failure === undefined
            ? Effect.runPromise(
                client.pull({
                  repositoryId: scope.repositoryId,
                  worktreePath: scope.worktreePath,
                  branch,
                }),
              )
            : undefined,
        )
        .then(
          () => setAttempt({ id, branch, pending: false }),
          (error: unknown) =>
            setAttempt({
              id,
              branch,
              pending: false,
              error: describeRepositoryPullError(branch, error),
            }),
        )
        .finally(() => {
          running.current = false;
        });
    },
    [client, scope, reader],
  );
  const error = useMemo(
    () =>
      attempt?.error === undefined
        ? undefined
        : { id: attempt.id, message: attempt.error },
    [attempt],
  );
  return {
    pull:
      client === undefined || scope === undefined || reader === undefined
        ? undefined
        : pull,
    pulling: attempt?.pending === true ? attempt.branch : undefined,
    error,
  };
}
