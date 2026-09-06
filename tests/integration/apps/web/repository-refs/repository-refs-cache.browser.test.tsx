import { createBrowserRepositoryHistoryReader } from "#web/features/repository-history/browser-repository-history-reader";
import "@rebase/web/styles.css";
import type { RepositoryCommit, RepositoryRefs } from "@rebase/contracts";
import { expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import { createBrowserHistoryFilterStore } from "#web/features/commit-graph/scope/browser-history-filter-store";
import { resolveHistoryScope } from "#web/features/commit-graph/scope/history-scope";
import { browserKeyboardShortcutHost } from "#web/features/keyboard-shortcuts/browser-keyboard-shortcut-host";
import { createKeyboardShortcutStore } from "#web/features/keyboard-shortcuts/keyboard-shortcut-store";
import { storeRepositoryHistoryPage } from "#web/features/repository-history/replica/repository-history-store";
import { RepositoryHistoryOffline } from "#web/features/repository-history/repository-history-reader.contract";
import {
  cacheRepositoryRefs,
  readCachedRepositoryRefs,
} from "#web/features/repository-refs/browser-repository-refs-cache";
import { KeyboardShortcutsProvider } from "#web-ui/features/keyboard-shortcuts/keyboard-shortcuts-provider";
import { RepositoryWorkspace } from "#web-ui/features/repository-workspace/repository-workspace";

it("restores complete Automatic metadata and isolates real environment and repository identities", async () => {
  const environmentId = crypto.randomUUID();
  const refs = repositoryRefs();
  const logicalId = refs.logicalRepositoryId ?? "";
  await cacheRepositoryRefs(environmentId, logicalId, refs);
  const cached = await readCachedRepositoryRefs(environmentId, logicalId);
  expect(cached).toEqual(refs);
  await expect(
    readCachedRepositoryRefs(crypto.randomUUID(), logicalId),
  ).resolves.toBeUndefined();
  await expect(
    readCachedRepositoryRefs(environmentId, crypto.randomUUID()),
  ).resolves.toBeUndefined();
  if (cached === undefined) throw new Error("Missing cached refs");
  expect(
    resolveHistoryScope({ _tag: "Automatic" }, cached, "/feature").roots.map(
      ({ name }) => name,
    ),
  ).toEqual(["feature", "origin/feature", "main", "origin/main"]);
  expect(
    resolveHistoryScope({ _tag: "Automatic" }, cached, "/detached").roots,
  ).toContainEqual({ name: "HEAD", oid, type: "head" });
});

it.each(["Automatic", "Custom"] as const)(
  "renders cached %s history before live refs respond",
  async (mode) => {
    const environmentId = crypto.randomUUID();
    const refs = repositoryRefs();
    const logicalId = refs.logicalRepositoryId ?? "";
    await cacheRepositoryRefs(environmentId, logicalId, refs);
    const custom = {
      _tag: "Custom",
      selections: [
        { _tag: "LocalBranch", name: "feature" },
        { _tag: "Tag", name: "new-tag" },
      ],
    } as const;
    const filterStore = createBrowserHistoryFilterStore();
    if (mode === "Custom") filterStore.save(environmentId, logicalId, custom);
    const roots = resolveHistoryScope(
      { _tag: "Automatic" },
      refs,
      "/feature",
    ).roots;
    await storeRepositoryHistoryPage(
      environmentId,
      logicalId,
      {
        commits: [commit],
        objectFormat: "sha1",
        refTargets: roots,
        repositoryId: refs.repositoryId,
        requestId: crypto.randomUUID(),
      },
      { limit: 100, order: "topological", roots },
    );
    const read = vi.fn(() => Promise.reject(new RepositoryHistoryOffline()));
    const reader = createBrowserRepositoryHistoryReader({
      environmentId,
      repositoryId: refs.repositoryId,
      logicalRepositoryId: logicalId,
      gateway: {
        read,
        synchronize: async () => {
          throw new RepositoryHistoryOffline();
        },
      },
    });
    const screen = await render(
      <KeyboardShortcutsProvider
        runtime={{
          host: browserKeyboardShortcutHost(),
          store: createKeyboardShortcutStore({
            getItem: () => null,
            setItem: () => undefined,
            removeItem: () => undefined,
          }),
        }}
      >
        <div style={{ height: 720, width: 1280 }}>
          <RepositoryWorkspace
            activeWorktreePath="/feature"
            branchesFocusRequest={0}
            environmentId={environmentId}
            logicalRepositoryId={logicalId}
            repositoryId={refs.repositoryId}
            repositoryName="Cached repository"
            historyReader={reader}
            refs={{
              checkingOut: false,
              repositoryId: refs.repositoryId,
              status: "loading",
            }}
            retryRefs={() => undefined}
            selectRef={() => undefined}
          />
        </div>
      </KeyboardShortcutsProvider>,
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
    reader.close();
    expect(read).not.toHaveBeenCalled();
    expect(filterStore.load(environmentId, logicalId)).toEqual(
      mode === "Automatic" ? { _tag: "Automatic" } : custom,
    );
  },
);

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
