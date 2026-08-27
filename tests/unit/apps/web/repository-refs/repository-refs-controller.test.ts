import type { RepositoryCheckedOut, RepositoryRefs } from "@rebase/contracts";
import { Deferred, Effect } from "effect";
import { describe, expect, it, vi } from "vite-plus/test";
import { RepositoryRefsRejected } from "#web/features/repository-refs/repository-refs-client.contract";
import { createRepositoryRefsController } from "#web/features/repository-refs/repository-refs-controller";
import {
  type RepositoryRefsGateway,
  RepositoryRefsUnavailable,
} from "#web/features/repository-refs/repository-refs-controller.contract";

const alphaId = "00000000-0000-4000-8000-000000000001";
const bravoId = "00000000-0000-4000-8000-000000000002";

describe("repository refs controller", () => {
  it("loads refs for the selected repository with its private credential", async () => {
    const gateway = createGateway({ [alphaId]: refs(alphaId) });
    const session = createRepositoryRefsController(gateway);
    session.authorize("private-credential");

    session.controller.select(alphaId);
    expect(session.controller.getSnapshot()).toEqual({
      checkingOut: false,
      repositoryId: alphaId,
      status: "loading",
    });
    await session.controller.refresh();

    expect(gateway.read).toHaveBeenCalledWith("private-credential", alphaId);
    expect(session.controller.getSnapshot()).toEqual({
      checkingOut: false,
      refs: refs(alphaId),
      repositoryId: alphaId,
      status: "ready",
    });
  });

  it("drops responses that arrive after another repository was selected", async () => {
    const alphaRead = Deferred.makeUnsafe<RepositoryRefs>();
    const gateway = createGateway({ [bravoId]: refs(bravoId) });
    gateway.read.mockImplementationOnce(() => Deferred.await(alphaRead));
    const session = createRepositoryRefsController(gateway);
    session.authorize("private-credential");

    session.controller.select(alphaId);
    session.controller.select(bravoId);
    await session.controller.refresh();
    Deferred.doneUnsafe(alphaRead, Effect.succeed(refs(alphaId)));
    await Promise.resolve();

    expect(session.controller.getSnapshot()).toMatchObject({
      refs: refs(bravoId),
      repositoryId: bravoId,
      status: "ready",
    });
  });

  it("coalesces invalidations that arrive while a read is in flight", async () => {
    const firstRead = Deferred.makeUnsafe<RepositoryRefs>();
    const gateway = createGateway({ [alphaId]: refs(alphaId) });
    gateway.read.mockImplementationOnce(() => Deferred.await(firstRead));
    const session = createRepositoryRefsController(gateway);
    session.authorize("private-credential");
    session.controller.select(alphaId);

    session.controller.invalidate();
    session.controller.invalidate();
    Deferred.doneUnsafe(firstRead, Effect.succeed(refs(alphaId)));
    await whenReady(session.controller);

    expect(gateway.read).toHaveBeenCalledTimes(2);
  });

  it("applies a checkout to the cached refs without re-reading them", async () => {
    const gateway = createGateway({ [alphaId]: refs(alphaId) });
    const session = createRepositoryRefsController(gateway);
    session.authorize("private-credential");
    session.controller.select(alphaId);
    await whenReady(session.controller);

    await expect(
      session.controller.checkout("/repo", {
        _tag: "LocalBranch",
        name: "feature",
      }),
    ).resolves.toEqual(checkedOut);

    expect(gateway.checkout).toHaveBeenCalledWith("private-credential", {
      repositoryId: alphaId,
      target: { _tag: "LocalBranch", name: "feature" },
      worktreePath: "/repo",
    });
    expect(gateway.read).toHaveBeenCalledTimes(1);
    expect(session.controller.getSnapshot()).toMatchObject({
      checkingOut: false,
      refs: {
        branches: [
          { name: "main" },
          { name: "feature", worktreePath: "/repo" },
        ],
        worktrees: [expect.objectContaining({ head: checkedOut.head })],
      },
      status: "ready",
    });

    const rejected = new RepositoryRefsRejected({
      failure: { _tag: "RefMissing", name: "ghost" },
      status: 404,
    });
    gateway.checkout.mockReturnValueOnce(Effect.fail(rejected));
    await expect(
      session.controller.checkout("/repo", {
        _tag: "LocalBranch",
        name: "ghost",
      }),
    ).rejects.toBe(rejected);
    expect(session.controller.getSnapshot()).toMatchObject({
      checkingOut: false,
      checkoutError: rejected,
      status: "ready",
    });
  });

  it("serves cached refs instantly and re-reads only stale repositories", async () => {
    const gateway = createGateway({
      [alphaId]: refs(alphaId),
      [bravoId]: refs(bravoId),
    });
    const session = createRepositoryRefsController(gateway);
    session.authorize("private-credential");
    session.controller.select(alphaId);
    await whenReady(session.controller);
    session.controller.select(bravoId);
    await whenReady(session.controller);

    session.controller.select(alphaId);
    expect(session.controller.getSnapshot()).toMatchObject({
      refs: refs(alphaId),
      status: "ready",
    });
    expect(gateway.read).toHaveBeenCalledTimes(2);

    session.controller.invalidate();
    await vi.waitFor(() => expect(gateway.read).toHaveBeenCalledTimes(3));
    session.controller.select(bravoId);
    await vi.waitFor(() => expect(gateway.read).toHaveBeenCalledTimes(4));
    session.controller.select(alphaId);
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(gateway.read).toHaveBeenCalledTimes(4);
  });

  it("reports unavailability before authorization without calling the gateway", async () => {
    const gateway = createGateway({ [alphaId]: refs(alphaId) });
    const session = createRepositoryRefsController(gateway);

    session.controller.select(alphaId);
    await session.controller.refresh();

    expect(session.controller.getSnapshot()).toMatchObject({
      error: expect.any(RepositoryRefsUnavailable),
      status: "error",
    });
    expect(gateway.read).not.toHaveBeenCalled();

    session.authorize("private-credential");
    session.controller.invalidate();
    await whenReady(session.controller);
    expect(gateway.read).toHaveBeenCalledTimes(1);
  });
});

async function whenReady(controller: {
  readonly getSnapshot: () => { readonly status: string };
}) {
  await vi.waitFor(() => expect(controller.getSnapshot().status).toBe("ready"));
}

const checkedOut: RepositoryCheckedOut = {
  head: { branch: "feature", commit: "a".repeat(40) },
  stash: "none",
  worktreePath: "/repo",
};

function createGateway(values: Record<string, RepositoryRefs> = {}) {
  return {
    checkout: vi.fn<RepositoryRefsGateway["checkout"]>(() =>
      Effect.succeed(checkedOut),
    ),
    read: vi.fn<RepositoryRefsGateway["read"]>((_credential, repositoryId) => {
      const value = values[repositoryId];
      return value === undefined
        ? Effect.die(`No refs were provided for ${repositoryId}.`)
        : Effect.succeed(value);
    }),
  } satisfies RepositoryRefsGateway;
}

function refs(repositoryId: string): RepositoryRefs {
  return {
    branches: [{ name: "main", worktreePath: "/repo" }, { name: "feature" }],
    remoteBranches: [],
    repositoryId,
    tags: [],
    truncated: { branches: false, remoteBranches: false, tags: false },
    worktrees: [
      {
        head: { branch: "main", commit: "a".repeat(40) },
        main: true,
        path: "/repo",
      },
    ],
  };
}
