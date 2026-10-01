import "#web/styles.css";
import {
  persistQueryClientRestore,
  persistQueryClientSave,
} from "@tanstack/react-query-persist-client";
import { expect, it } from "vite-plus/test";
import type { RepositoryCommit } from "#contracts/repository-history/repository-history.contract.ts";
import { RepositoryBranchesApi } from "#contracts/repository-refs/repository-branches.contract.ts";
import {
  type RepositoryRefs,
  RepositoryRefsApi,
} from "#contracts/repository-refs/repository-refs.contract.ts";
import {
  fakeRequests,
  respond,
  unanswered,
} from "#tests-support/fake-requests.ts";
import { repositoryScope } from "#tests-support/fixtures.ts";
import { render } from "#tests-support/render.tsx";
import { RepositoryWorkspace } from "#web/app/workspace/repository-workspace.tsx";
import { useRepositoryRefs } from "#web/features/refs/repository-refs.ts";
import {
  openRepository,
  storeCommits,
  updateRepository,
} from "#web/features/repository-history/history-database.ts";
import {
  createEnvironmentQueryClient,
  environmentQueryKey,
} from "#web/platform/query/environment-query.ts";
import { createEnvironmentQueryPersistence } from "#web/platform/query/environment-query-persistence.ts";
import { RepositoryScopeProvider } from "#web/platform/query/repository-scope.tsx";
import { useCommand } from "#web/platform/query/use-command.ts";

it("restores only persisted refs, unconfirmed, for the same protocol", async () => {
  const persistence = createEnvironmentQueryPersistence();
  const refs = repositoryRefs();
  const refsKey = ["repository-refs", crypto.randomUUID(), refs.repositoryId];
  const refsMeta = {
    changes: "refs",
    repositoryId: refs.repositoryId,
    persist: true,
  } as const;
  const saved = createEnvironmentQueryClient();
  await saved.fetchQuery({
    queryKey: refsKey,
    queryFn: async () => refs,
    meta: refsMeta,
  });
  await saved
    .fetchQuery({
      queryKey: refsKey,
      queryFn: () => Promise.reject(new Error("offline")),
      meta: refsMeta,
      staleTime: 0,
    })
    .catch(() => undefined);
  await saved.fetchQuery({
    queryKey: ["operation"],
    queryFn: async () => "idle",
    meta: { changes: "index", repositoryId: refs.repositoryId },
  });
  await persistQueryClientSave({ ...persistence, queryClient: saved });

  const restored = createEnvironmentQueryClient();
  await persistQueryClientRestore({ ...persistence, queryClient: restored });
  const query = restored.getQueryCache().find({ queryKey: refsKey });
  expect(query?.state.data).toEqual(refs);
  expect(query?.state.status).toBe("success");
  expect(query?.isFetched()).toBe(false);
  expect(query?.state.isInvalidated).toBe(true);
  expect(restored.getQueryData(["operation"])).toBeUndefined();

  const upgraded = createEnvironmentQueryClient();
  await persistQueryClientRestore({
    ...persistence,
    buster: "protocol-next",
    queryClient: upgraded,
  });
  expect(upgraded.getQueryData(refsKey)).toBeUndefined();
});

it("keeps restored refs unconfirmed until a live read answers", async () => {
  const environmentId = crypto.randomUUID();
  const refs = repositoryRefs();
  const queryClient = await restoredRefs(environmentId, refs);
  let online = false;
  const requests = fakeRequests(
    respond(RepositoryRefsApi.read, async () => {
      if (!online) throw unanswered;
      return refs;
    }),
  );
  const screen = await render(<RefsProbe repositoryId={refs.repositoryId} />, {
    environment: { environmentId, requests },
    queryClient,
  });

  await expect
    .element(screen.getByRole("alert"))
    .toHaveTextContent("The server did not answer.");
  await expect
    .element(screen.getByRole("status"))
    .toHaveTextContent("Restored feature, main");

  online = true;
  await screen.getByRole("button", { name: "Retry" }).click();
  await expect
    .element(screen.getByRole("status"))
    .toHaveTextContent("Live feature, main");
});

it("keeps restored refs restored through a branch write until a live read answers", async () => {
  const environmentId = crypto.randomUUID();
  const refs = repositoryRefs();
  const logicalId = refs.logicalRepositoryId ?? "";
  const queryClient = await restoredRefs(environmentId, refs);
  const reads: PromiseWithResolvers<RepositoryRefs>[] = [];
  const requests = fakeRequests(
    respond(RepositoryRefsApi.read, () => {
      const read = Promise.withResolvers<RepositoryRefs>();
      reads.push(read);
      return read.promise;
    }),
    respond(RepositoryBranchesApi.rename, async ({ newName }) => ({
      branch: { name: newName, target: oid },
      previousName: "main",
    })),
  );
  const screen = await render(
    <RepositoryScopeProvider
      scope={repositoryScope({
        repositoryId: refs.repositoryId,
        logicalRepositoryId: logicalId,
        worktreePath: "/feature",
      })}
    >
      <RefsProbe repositoryId={refs.repositoryId} />
      <RenameMain />
    </RepositoryScopeProvider>,
    { environment: { environmentId, requests }, queryClient },
  );
  await expect.poll(() => reads).toHaveLength(1);
  reads[0]?.reject(unanswered);
  await expect
    .element(screen.getByRole("alert"))
    .toHaveTextContent("The server did not answer.");

  await screen.getByRole("button", { name: "Rename main" }).click();
  await expect.poll(() => reads).toHaveLength(2);
  await expect
    .element(screen.getByRole("status"))
    .toHaveTextContent("Restored feature, main");

  reads[1]?.resolve(renameMain(refs));
  await expect
    .element(screen.getByRole("status"))
    .toHaveTextContent("Live feature, trunk");
});

it.each(["Automatic", "Custom"] as const)(
  "reopens %s history from browser storage while the server is unreachable",
  async (mode) => {
    const environmentId = crypto.randomUUID();
    const refs = repositoryRefs();
    const logicalId = refs.logicalRepositoryId ?? "";
    const queryClient = await restoredRefs(environmentId, refs);
    const filterKey = `rebase:history-filter:v1:${environmentId}:${logicalId}`;
    const custom = JSON.stringify({
      scope: {
        _tag: "Custom",
        selections: [
          { _tag: "LocalBranch", name: "feature" },
          { _tag: "Tag", name: "new-tag" },
        ],
      },
      version: 1,
    });
    if (mode === "Custom") localStorage.setItem(filterKey, custom);
    const record = await openRepository(environmentId, logicalId);
    await storeCommits({ ...record, commitCount: 1, minimumEpoch: -1 }, [
      { commit, epoch: -1, order: 0 },
    ]);
    await updateRepository({
      ...record,
      commitCount: 1,
      minimumEpoch: -1,
      tips: {
        _tag: "RepositoryHistoryTips",
        objectFormat: "sha1",
        rootOids: [oid],
        shallowOids: [],
        refTargets: [{ name: "feature", oid, type: "branch" }],
      },
    });
    const screen = await render(
      <div style={{ height: 720, width: 1280 }}>
        <RepositoryScopeProvider
          scope={repositoryScope({
            repositoryId: refs.repositoryId,
            logicalRepositoryId: logicalId,
            worktreePath: "/feature",
            connected: false,
          })}
        >
          <RepositoryWorkspace />
        </RepositoryScopeProvider>
      </div>,
      {
        environment: { environmentId, connected: false },
        queryClient,
      },
    );
    await expect
      .element(screen.getByRole("row", { name: /^Cached commit,/ }))
      .toBeVisible();
    await expect
      .element(
        screen
          .getByRole("group", { name: `${mode} history scope` })
          .getByRole("button", { name: "Copy feature", exact: true }),
      )
      .toBeVisible();
    await expect
      .element(
        screen
          .getByRole("group", { name: `${mode} history scope` })
          .getByRole("button", {
            name: `Copy ${mode === "Automatic" ? "main" : "new-tag"}`,
            exact: true,
          }),
      )
      .toBeVisible();
    expect(localStorage.getItem(filterKey)).toBe(
      mode === "Automatic" ? null : custom,
    );
  },
);

function RefsProbe({ repositoryId }: { readonly repositoryId: string }) {
  const { error, refs, restored, retry } = useRepositoryRefs(repositoryId);
  return (
    <div>
      <p role="status">
        {restored ? "Restored" : "Live"}{" "}
        {refs?.branches.map(({ name }) => name).join(", ")}
      </p>
      {error === null ? null : <p role="alert">{error}</p>}
      <button type="button" onClick={retry}>
        Retry
      </button>
    </div>
  );
}

function RenameMain() {
  const rename = useCommand(RepositoryBranchesApi.rename);
  return (
    <button
      type="button"
      onClick={() => void rename.run({ name: "main", newName: "trunk" })}
    >
      Rename main
    </button>
  );
}

function renameMain(refs: RepositoryRefs): RepositoryRefs {
  return {
    ...refs,
    branches: refs.branches.map((branch) =>
      branch.name === "main" ? { ...branch, name: "trunk" } : branch,
    ),
  };
}

async function restoredRefs(environmentId: string, refs: RepositoryRefs) {
  const persistence = createEnvironmentQueryPersistence();
  const saved = createEnvironmentQueryClient();
  const input = { repositoryId: refs.repositoryId };
  await saved.fetchQuery({
    queryKey: environmentQueryKey(
      environmentId,
      refs.repositoryId,
      RepositoryRefsApi.read,
      input,
    ),
    queryFn: async () => refs,
    meta: { changes: "refs", repositoryId: refs.repositoryId, persist: true },
  });
  await persistQueryClientSave({ ...persistence, queryClient: saved });
  const restored = createEnvironmentQueryClient();
  await persistQueryClientRestore({ ...persistence, queryClient: restored });
  return restored;
}

const oid = "a".repeat(40);
const identity = {
  email: "alex@example.test",
  name: "Alex",
  timestampSeconds: 1_777_777_777,
  timezoneOffsetMinutes: 0,
};
const commit: RepositoryCommit = {
  author: identity,
  committer: identity,
  oid,
  parents: [],
  subject: "Cached commit",
};

function repositoryRefs(): RepositoryRefs {
  return {
    repositoryId: crypto.randomUUID(),
    logicalRepositoryId: crypto.randomUUID(),
    branches: [
      {
        name: "feature",
        target: oid,
        worktreePath: "/feature",
        upstream: { name: "origin/feature", ahead: 0, behind: 0, gone: false },
      },
      {
        name: "main",
        target: oid,
        upstream: { name: "origin/main", ahead: 0, behind: 0, gone: false },
      },
    ],
    remoteBranches: [
      { remote: "origin", name: "feature", target: oid },
      { remote: "origin", name: "main", target: oid },
    ],
    remoteDefaultBranches: [{ remote: "origin", name: "main" }],
    remoteProviders: [{ remote: "origin", provider: "github" }],
    tags: [{ name: "v1.0.0", target: oid }],
    truncated: { branches: false, remoteBranches: false, tags: false },
    worktrees: [
      {
        path: "/feature",
        main: true,
        head: { branch: "feature", commit: oid },
      },
      { path: "/detached", main: false, head: { commit: oid } },
    ],
  };
}
