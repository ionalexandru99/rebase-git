import type { RepositoryCommit } from "@rebase/contracts";
import { describe, expect, it, vi } from "vite-plus/test";
import type { GraphCommandContext } from "#web/features/commit-commands/graph-command.contract";
import { createGraphCommandRegistry } from "#web/features/commit-commands/graph-command-registry";

const context: GraphCommandContext = {
  environmentId: "local",
  logicalRepositoryId: "logical",
  repositoryId: "worktree",
  activeWorktreePath: "/worktree",
  activeBranch: "main",
  selectedOids: ["a", "b"],
  invokingOid: "b",
  connected: true,
  freshnessReady: true,
  operationState: "idle",
  capabilities: new Set(["repository.write"]),
};
const commit: RepositoryCommit = {
  oid: "b",
  subject: "Chosen commit",
  parents: [],
  author: {
    name: "Alex",
    email: "a@example.com",
    timestampSeconds: 1,
    timezoneOffsetMinutes: 0,
  },
  committer: {
    name: "Alex",
    email: "a@example.com",
    timestampSeconds: 1,
    timezoneOffsetMinutes: 0,
  },
};

describe("graph commands", () => {
  it("copies the invoking commit even when other commits are selected", async () => {
    const readCommit = vi.fn(async () => commit);
    const writeClipboard = vi.fn(async () => {});
    const registry = createGraphCommandRegistry({ readCommit, writeClipboard });
    expect(await registry.execute("graph.copySha", context)).toEqual({
      _tag: "Executed",
    });
    expect(readCommit).not.toHaveBeenCalled();
    expect(writeClipboard).toHaveBeenLastCalledWith("b");
    await registry.execute("graph.copySubject", context);
    expect(readCommit).toHaveBeenCalledWith("b");
    expect(writeClipboard).toHaveBeenLastCalledWith("Chosen commit");
  });

  it("hides unsupported and irrelevant actions", async () => {
    const registry = createGraphCommandRegistry({
      readCommit: async () => undefined,
      writeClipboard: async () => {},
    });
    const { invokingOid: _, ...withoutTarget } = context;
    expect(registry.commands(withoutTarget)).toEqual([]);
    expect(await registry.execute("graph.fetch", context)).toMatchObject({
      _tag: "Unavailable",
    });
    expect(await registry.execute("graph.copySubject", context)).toEqual({
      _tag: "Unavailable",
      reason: "Commit metadata is not available yet",
    });
  });

  it.each([
    [{ connected: false }, "Reconnect to fetch"],
    [{ capabilities: new Set<never>() }, "Repository write access is required"],
    [{ operationState: "fetching" }, "A fetch is already running"],
    [{ operationState: "busy" }, "Wait for the current operation to finish"],
    [{ freshnessReady: false }, "Waiting for repository status"],
  ] as const)(
    "disables fetch and rechecks execution for %o",
    async (override, reason) => {
      const execute = vi.fn(async () => {});
      const registry = createGraphCommandRegistry({
        readCommit: async () => undefined,
        writeClipboard: async () => {},
        actions: { "graph.fetch": { execute } },
      });
      const unavailable = { ...context, ...override };
      expect(
        registry
          .commands(unavailable)
          .find((item) => item.id === "graph.fetch"),
      ).toMatchObject({
        enabled: false,
        disabledReason: reason,
        shortcutId: "graph.fetch",
      });
      expect(await registry.execute("graph.fetch", unavailable)).toEqual({
        _tag: "Unavailable",
        reason,
      });
      expect(execute).not.toHaveBeenCalled();
      await registry.execute("graph.fetch", context);
      expect(execute).toHaveBeenCalledWith(context);
    },
  );

  it("routes ref inclusion through the supplied history handler", async () => {
    const toggleHistoryRef = vi.fn(async () => {});
    const registry = createGraphCommandRegistry({
      readCommit: async () => undefined,
      writeClipboard: async () => {},
      toggleHistoryRef,
    });
    const target = { _tag: "LocalBranch", name: "main" } as const;
    const included = { ...context, ref: { target, included: true } };
    expect(
      registry
        .commands(included)
        .find((item) => item.id === "history.toggleRef")?.label,
    ).toBe("Remove from history");
    expect(
      registry
        .commands({ ...context, ref: { target, included: false } })
        .find((item) => item.id === "history.toggleRef")?.label,
    ).toBe("Add to history");
    await registry.execute("history.toggleRef", included);
    expect(toggleHistoryRef).toHaveBeenCalledWith(target, included);
  });

  it("preserves typed context and caller availability for implemented graph actions", async () => {
    const execute = vi.fn(async () => {});
    const registry = createGraphCommandRegistry({
      readCommit: async () => undefined,
      writeClipboard: async () => {},
      actions: {
        "graph.nextMatch": {
          execute,
          disabledReason: () => "No matching commits",
        },
      },
    });
    expect(await registry.execute("graph.nextMatch", context)).toEqual({
      _tag: "Unavailable",
      reason: "No matching commits",
    });
    expect(execute).not.toHaveBeenCalled();
  });
});
