import type { RepositoryCommit } from "@rebase/contracts";
import { describe, expect, it, vi } from "vite-plus/test";
import type {
  GraphCommandContext,
  GraphCommandHandlers,
} from "#web/features/commit-commands/graph-command.contract";
import { createGraphCommandDefinitions } from "#web/features/commit-commands/graph-command-definitions";
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
  it("renders a contributed command in its declared placement and rechecks it before execution", async () => {
    const execute = vi.fn(async () => ({ _tag: "Executed" as const }));
    const registry = createGraphCommandRegistry([
      {
        id: "commit.inspect",
        group: "Commit",
        order: 0,
        placement: "commit-menu",
        resolve: (target) => ({
          label: "Inspect commit",
          enabled: target.connected,
          execute,
        }),
      },
    ]);

    expect(registry.commands(context, "toolbar")).toEqual([]);
    expect(registry.commands(context, "commit-menu")).toMatchObject([
      { id: "commit.inspect", label: "Inspect commit", enabled: true },
    ]);
    expect(
      await registry.execute("commit.inspect", {
        ...context,
        connected: false,
      }),
    ).toMatchObject({ _tag: "Unavailable" });
    expect(execute).not.toHaveBeenCalled();
    expect(await registry.execute("commit.inspect", context)).toEqual({
      _tag: "Executed",
    });
    expect(execute).toHaveBeenCalledOnce();
  });

  it("keeps commit actions out of the fetch toolbar and preserves their display order", () => {
    const registry = createCommands({
      readCommit: async () => commit,
      writeClipboard: async () => {},
      openDetails: () => {},
      fetch: async () => {},
    });

    expect(
      registry.commands(context, "commit-menu").map(({ id }) => id),
    ).toEqual(["graph.openDetails", "graph.copySha", "graph.copySubject"]);
    expect(registry.commands(context, "toolbar").map(({ id }) => id)).toEqual([
      "graph.fetch",
    ]);
  });

  it("copies the invoking commit even when other commits are selected", async () => {
    const readCommit = vi.fn(async () => commit);
    const writeClipboard = vi.fn(async () => {});
    const registry = createCommands({ readCommit, writeClipboard });
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
    const registry = createCommands({
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
      const registry = createCommands({
        readCommit: async () => undefined,
        writeClipboard: async () => {},
        fetch: execute,
      });
      const unavailable = { ...context, ...override };
      expect(
        registry
          .commands(unavailable)
          .find((item) => item.id === "graph.fetch"),
      ).toMatchObject({
        enabled: false,
        disabledReason: reason,
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
});

function createCommands(handlers: GraphCommandHandlers) {
  return createGraphCommandRegistry(createGraphCommandDefinitions(handlers));
}
