import { createContext, type ReactNode, useContext, useMemo } from "react";
import { RefCommands } from "#web/features/ref-commands/index";
import type {
  RepositoryHistoryFetchCommands,
  RepositoryHistoryObservation,
  RepositoryHistorySnapshot,
} from "#web/features/repository-history/index";
import { usePullAttempts } from "#web/features/repository-pull/hooks/use-pull-attempts";
import { createPullBranchCommand } from "#web/features/repository-pull/pull-branch-command";
import { useRepositoryScope } from "#web/features/repository-scope/index";
import { createStore } from "#web/platform/store/store";
import { useStore } from "#web/platform/store/use-store";

interface RepositoryPullState {
  readonly execute: (branch: string) => void;
  readonly pulling: boolean;
  readonly activeBranch: string | undefined;
  readonly incoming: number;
  readonly freshnessReady: boolean;
}

interface RepositoryPullError {
  readonly id: number;
  readonly message: string;
}

const RepositoryPullContext = createContext<RepositoryPullState | undefined>(
  undefined,
);
const RepositoryPullErrorContext = createContext<
  RepositoryPullError | undefined
>(undefined);
const idleHistory = createStore<RepositoryHistorySnapshot>({
  revision: 0,
  historyRevision: 0,
  status: "empty",
});

export function RepositoryPullProvider({
  reader,
  activeBranch,
  incoming,
  children,
}: {
  readonly reader:
    | (Pick<RepositoryHistoryFetchCommands, "fetch"> &
        RepositoryHistoryObservation)
    | undefined;
  readonly activeBranch: string | undefined;
  readonly incoming: number;
  readonly children: ReactNode;
}) {
  const scope = useRepositoryScope();
  const { pull, pulling, error } = usePullAttempts(
    scope?.target.requests,
    scope?.target,
    reader,
  );
  const allowed = scope?.connected === true && scope.writable;
  const busy = pulling !== undefined;
  const freshnessReady = useStore(reader ?? idleHistory, isFreshnessReady);
  const state = useMemo(
    () =>
      pull === undefined
        ? undefined
        : {
            execute: pull,
            pulling: busy,
            activeBranch,
            incoming,
            freshnessReady,
          },
    [pull, busy, activeBranch, incoming, freshnessReady],
  );
  const refCommands = useMemo(
    () =>
      pull === undefined || !allowed
        ? []
        : [createPullBranchCommand(pull, busy)],
    [pull, busy, allowed],
  );
  return (
    <RepositoryPullContext.Provider value={state}>
      <RepositoryPullErrorContext.Provider value={error}>
        <RefCommands.Contribute commands={refCommands}>
          {children}
        </RefCommands.Contribute>
      </RepositoryPullErrorContext.Provider>
    </RepositoryPullContext.Provider>
  );
}

export function useRepositoryPull() {
  return useContext(RepositoryPullContext);
}

export function useRepositoryPulling() {
  return useContext(RepositoryPullContext)?.pulling ?? false;
}

export function useRepositoryPullError() {
  return useContext(RepositoryPullErrorContext);
}

function isFreshnessReady(snapshot: RepositoryHistorySnapshot) {
  return (
    snapshot.freshness !== undefined && snapshot.freshnessError === undefined
  );
}
