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

export function useRepositoryPull(
  requests: EnvironmentRequestClient | undefined,
  repositoryId: string | undefined,
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
        repositoryId === undefined ||
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
            ? Effect.runPromise(client.pull({ repositoryId, branch }))
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
    [client, repositoryId, reader],
  );
  return {
    pull:
      client === undefined || repositoryId === undefined || reader === undefined
        ? undefined
        : pull,
    pulling: attempt?.pending === true ? attempt.branch : undefined,
    error:
      attempt?.error === undefined
        ? undefined
        : { id: attempt.id, message: attempt.error },
  };
}
