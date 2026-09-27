import type { RepositoryCommit } from "@rebase/contracts";
import { describe, expect, it, vi } from "vite-plus/test";
import {
  type CommitAccess,
  type CommitActionHandlers,
  commitActions,
} from "#web/features/commit-graph/commit-actions";

const access: CommitAccess = { connected: true, readable: true };
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

describe("commit actions", () => {
  it("copies the invoking commit", async () => {
    const readCommit = vi.fn(async () => commit);
    const writeClipboard = vi.fn(async () => {});
    const actions = createActions({ readCommit, writeClipboard });
    expect(await run(actions, "copySha")).toBeUndefined();
    expect(readCommit).not.toHaveBeenCalled();
    expect(writeClipboard).toHaveBeenLastCalledWith("b");
    await run(actions, "copySubject");
    expect(readCommit).toHaveBeenCalledWith("b");
    expect(writeClipboard).toHaveBeenLastCalledWith("Chosen commit");
  });

  it("hides unsupported actions and explains missing commit metadata", async () => {
    const actions = createActions({
      readCommit: async () => undefined,
      writeClipboard: async () => {},
    });
    expect(actions.list.map(({ id }) => id)).toEqual([
      "copySha",
      "copySubject",
    ]);
    expect(await run(actions, "copySubject")).toBe(
      "Commit metadata is not available yet",
    );
  });

  it("requires a readable connection to open details", async () => {
    const openDetails = vi.fn();
    const handlers = {
      readCommit: async () => undefined,
      writeClipboard: async () => {},
      openDetails,
    };
    const unreadable = createActions(handlers, { ...access, readable: false });
    expect(
      unreadable.list.find(({ id }) => id === "openDetails")?.enabled,
    ).toBe(false);
    await run(createActions(handlers), "openDetails");
    expect(openDetails).toHaveBeenCalledWith("b");
  });
});

function createActions(
  handlers: Omit<CommitActionHandlers, "attempt">,
  commitAccess = access,
) {
  const outcomes: Promise<string | undefined>[] = [];
  return {
    outcomes,
    list: commitActions("b", commitAccess, {
      ...handlers,
      attempt: (work) => {
        outcomes.push(work());
      },
    }),
  };
}

async function run(actions: ReturnType<typeof createActions>, id: string) {
  actions.list.find((action) => action.id === id)?.run();
  return actions.outcomes.at(-1);
}
