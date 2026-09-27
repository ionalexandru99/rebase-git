import type { RepositoryCommit } from "@rebase/contracts";
import type { ComponentProps } from "react";
import {
  type FakeRepositoryHistory,
  fakeRepositoryHistory,
  historyOid,
  linearHistory,
} from "#tests-support/history";
import { render } from "#tests-ui/runtime/render";
import { CommitGraph } from "#web/features/commit-graph/commit-graph";
import { saveRepositoryHistoryOrder } from "#web/features/repository-history/history-order";
import type { HistorySnapshot } from "#web/features/repository-history/history-worker-protocol";

export {
  historyIdentity as identity,
  historyOid,
} from "#tests-support/history";

const graphHistoryIdentity = {
  environmentId: "test-environment",
  repositoryId: "test-logical-repository",
};

export async function renderGraph(
  history: FakeRepositoryHistory,
  roots = [{ name: "main", oid: "0".repeat(40), type: "branch" as const }],
) {
  saveRepositoryHistoryOrder(graphHistoryIdentity, "topological");
  return render(
    <div style={{ height: 520, width: 900 }}>
      <CommitGraphFixture
        reader={history}
        repositoryName="rebase-test"
        roots={roots}
        historyIdentity={graphHistoryIdentity}
      />
    </div>,
  );
}

export function mergeHistory() {
  const commits = linearHistory(6);
  const parents = [[1, 2], [5], [3, 4], [5], [5], []];
  return commits.map((commit, index) => ({
    ...commit,
    parents: (parents[index] ?? []).map(historyOid),
  }));
}

export function historyReader({
  commits,
  pending,
  status,
}: {
  readonly commits: readonly RepositoryCommit[];
  readonly pending?: Promise<unknown>;
  readonly status: HistorySnapshot["status"];
}) {
  const history = fakeRepositoryHistory({
    commits,
    snapshot: {
      status,
      synchronization: status === "loading" ? "syncing" : "complete",
    },
  });
  if (pending !== undefined) history.hold = pending.then(() => undefined);
  return history;
}

export function history(count: number) {
  return linearHistory(count);
}

export function CommitGraphFixture({
  reader,
  ...props
}: Omit<ComponentProps<typeof CommitGraph>, "history"> & {
  readonly reader: FakeRepositoryHistory | undefined;
}) {
  return <CommitGraph {...props} history={reader} />;
}
