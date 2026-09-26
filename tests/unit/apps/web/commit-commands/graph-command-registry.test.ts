import type { RepositoryCommit } from "@rebase/contracts";
import { describe, expect, it, vi } from "vite-plus/test";
import { createCommitCommandDefinitions } from "#web/features/commit-commands/commit-command-definitions";
import type {
  CommitCommandHandlers,
  GraphCommandContext,
  GraphCommandDefinition,
} from "#web/features/commit-commands/graph-command.contract";
import { createCommandRegistry } from "#web/platform/menu-commands/menu-command";

const context: GraphCommandContext = {
  invokingOid: "b",
  selectedOids: ["a", "b"],
  connected: true,
  readable: true,
  writable: true,
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
  it("orders extra commands with commit commands and rechecks them before execution", async () => {
    const execute = vi.fn(async () => ({ _tag: "Executed" as const }));
    const extra: GraphCommandDefinition = {
      id: "feature.inspect",
      order: 0.5,
      resolve: (target) => ({
        label: "Inspect commit",
        enabled: target.connected,
        execute,
      }),
    };
    const registry = createCommandRegistry([
      ...createCommitCommandDefinitions({
        readCommit: async () => commit,
        writeClipboard: async () => {},
        openDetails: () => {},
      }),
      extra,
    ]);

    expect(registry.commands(context).map(({ id }) => id)).toEqual([
      "graph.openDetails",
      "graph.copySha",
      "feature.inspect",
      "graph.copySubject",
    ]);
    expect(
      await registry.execute("feature.inspect", {
        ...context,
        connected: false,
      }),
    ).toMatchObject({ _tag: "Unavailable" });
    expect(execute).not.toHaveBeenCalled();
    expect(await registry.execute("feature.inspect", context)).toEqual({
      _tag: "Executed",
    });
    expect(execute).toHaveBeenCalledOnce();
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

  it("hides unsupported actions and explains missing commit metadata", async () => {
    const registry = createCommands({
      readCommit: async () => undefined,
      writeClipboard: async () => {},
    });
    expect(registry.commands(context).map(({ id }) => id)).toEqual([
      "graph.copySha",
      "graph.copySubject",
    ]);
    expect(await registry.execute("graph.copySubject", context)).toEqual({
      _tag: "Unavailable",
      reason: "Commit metadata is not available yet",
    });
  });

  it("requires a readable connection to open details", async () => {
    const openDetails = vi.fn();
    const registry = createCommands({
      readCommit: async () => undefined,
      writeClipboard: async () => {},
      openDetails,
    });
    expect(
      await registry.execute("graph.openDetails", {
        ...context,
        readable: false,
      }),
    ).toMatchObject({ _tag: "Unavailable" });
    expect(openDetails).not.toHaveBeenCalled();
    await registry.execute("graph.openDetails", context);
    expect(openDetails).toHaveBeenCalledWith("b");
  });
});

function createCommands(handlers: CommitCommandHandlers) {
  return createCommandRegistry(createCommitCommandDefinitions(handlers));
}
