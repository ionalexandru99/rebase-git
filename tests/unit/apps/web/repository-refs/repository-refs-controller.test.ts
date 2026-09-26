import type { RepositoryCheckedOut, RepositoryRefs } from "@rebase/contracts";
import { Deferred, Effect } from "effect";
import { describe, expect, it, vi } from "vite-plus/test";
import { RepositoryRefsRejected } from "#web/features/repository-refs/repository-refs-client.contract";
import { createRepositoryRefsController } from "#web/features/repository-refs/repository-refs-controller";
import {
  RepositoryRefsBusy,
  type RepositoryRefsGateway,
} from "#web/features/repository-refs/repository-refs-controller.contract";

const alphaId = "00000000-0000-4000-8000-000000000001";
const bravoId = "00000000-0000-4000-8000-000000000002";

describe("repository refs controller", () => {
  it("does not overwrite a completed checkout with a read started before the mutation", async () => {
    const gateway = createGateway({ [alphaId]: refs(alphaId) });
    const controller = createRepositoryRefsController(gateway);
    controller.select(alphaId);
    await whenReady(controller);
    const beforeCheckout = Deferred.makeUnsafe<RepositoryRefs>();
    const afterCheckout = Deferred.makeUnsafe<RepositoryRefs>();
    gateway.read.mockReturnValueOnce(Deferred.await(beforeCheckout));
    gateway.read.mockReturnValueOnce(Deferred.await(afterCheckout));
    const refresh = controller.refresh();
    await controller.checkout("/repo", {
      _tag: "LocalBranch",
      name: "feature",
    });
    const checkedOutRefs = controller.getSnapshot().refs;
    expect(checkedOutRefs?.worktrees[0]?.head.branch).toBe("feature");

    Deferred.doneUnsafe(beforeCheckout, Effect.succeed(refs(alphaId)));
    await refresh;
    expect(controller.getSnapshot().refs).toEqual(checkedOutRefs);
    expect(gateway.read).toHaveBeenCalledTimes(3);
    Deferred.doneUnsafe(
      afterCheckout,
      Effect.succeed(checkedOutRefs ?? refs(alphaId)),
    );
  });

  it("retries stale cached refs after a failed refresh when the repository is selected again", async () => {
    const gateway = createGateway({
      [alphaId]: refs(alphaId),
      [bravoId]: refs(bravoId),
    });
    const controller = createRepositoryRefsController(gateway);
    controller.select(alphaId);
    await whenReady(controller);
    gateway.read.mockReturnValueOnce(
      Effect.fail(
        new RepositoryRefsRejected({
          failure: {
            _tag: "RepositoryRejected",
            reason: "Missing",
            detail: "This repository is no longer available.",
          },
        }),
      ),
    );
    controller.invalidate([alphaId]);
    await vi.waitFor(() =>
      expect(controller.getSnapshot().status).toBe("error"),
    );
    expect(gateway.read).toHaveBeenCalledTimes(2);

    controller.select(bravoId);
    await whenReady(controller);
    controller.select(alphaId);
    await vi.waitFor(() => expect(gateway.read).toHaveBeenCalledTimes(4));
    expect(gateway.read).toHaveBeenLastCalledWith(alphaId);
  });

  it("keeps a background read stale when its repository changes before the response arrives", async () => {
    const pending = Deferred.makeUnsafe<RepositoryRefs>();
    const gateway = createGateway({
      [alphaId]: refs(alphaId),
      [bravoId]: refs(bravoId),
    });
    gateway.read.mockImplementationOnce(() => Deferred.await(pending));
    const controller = createRepositoryRefsController(gateway);
    controller.select(alphaId);
    controller.select(bravoId);
    await whenReady(controller);
    controller.invalidate([alphaId]);
    Deferred.doneUnsafe(pending, Effect.succeed(refs(alphaId)));
    await new Promise((resolve) => setTimeout(resolve, 0));

    controller.select(alphaId);
    await vi.waitFor(() => expect(gateway.read).toHaveBeenCalledTimes(3));
    expect(gateway.read).toHaveBeenLastCalledWith(alphaId);
  });

  it("invalidates a background repository without reloading the selected repository", async () => {
    const gateway = createGateway({
      [alphaId]: refs(alphaId),
      [bravoId]: refs(bravoId),
    });
    const controller = createRepositoryRefsController(gateway);
    controller.select(alphaId);
    await whenReady(controller);
    controller.select(bravoId);
    await whenReady(controller);

    controller.invalidate([alphaId]);
    await Promise.resolve();

    expect(gateway.read).toHaveBeenCalledTimes(2);
    controller.select(alphaId);
    await vi.waitFor(() => expect(gateway.read).toHaveBeenCalledTimes(3));
    expect(gateway.read).toHaveBeenLastCalledWith(alphaId);
  });

  it("loads refs for the selected repository with its private credential", async () => {
    const gateway = createGateway({ [alphaId]: refs(alphaId) });
    const controller = createRepositoryRefsController(gateway);

    controller.select(alphaId);
    expect(controller.getSnapshot()).toEqual({
      checkingOut: false,
      repositoryId: alphaId,
      status: "loading",
    });
    await controller.refresh();

    expect(gateway.read).toHaveBeenCalledWith(alphaId);
    expect(controller.getSnapshot()).toEqual({
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
    const controller = createRepositoryRefsController(gateway);

    controller.select(alphaId);
    controller.select(bravoId);
    await controller.refresh();
    Deferred.doneUnsafe(alphaRead, Effect.succeed(refs(alphaId)));
    await Promise.resolve();

    expect(controller.getSnapshot()).toMatchObject({
      refs: refs(bravoId),
      repositoryId: bravoId,
      status: "ready",
    });
  });

  it("coalesces invalidations that arrive while a read is in flight", async () => {
    const firstRead = Deferred.makeUnsafe<RepositoryRefs>();
    const gateway = createGateway({ [alphaId]: refs(alphaId) });
    gateway.read.mockImplementationOnce(() => Deferred.await(firstRead));
    const controller = createRepositoryRefsController(gateway);
    controller.select(alphaId);

    controller.invalidate();
    controller.invalidate();
    Deferred.doneUnsafe(firstRead, Effect.succeed(refs(alphaId)));
    await whenReady(controller);

    expect(gateway.read).toHaveBeenCalledTimes(2);
  });

  it("applies a checkout to the cached refs without re-reading them", async () => {
    const gateway = createGateway({ [alphaId]: refs(alphaId) });
    const controller = createRepositoryRefsController(gateway);
    controller.select(alphaId);
    await whenReady(controller);

    await expect(
      controller.checkout("/repo", {
        _tag: "LocalBranch",
        name: "feature",
      }),
    ).resolves.toEqual(checkedOut);

    expect(gateway.checkout).toHaveBeenCalledWith({
      repositoryId: alphaId,
      target: { _tag: "LocalBranch", name: "feature" },
      worktreePath: "/repo",
    });
    expect(gateway.read).toHaveBeenCalledTimes(1);
    expect(controller.getSnapshot()).toMatchObject({
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
    });
    gateway.checkout.mockReturnValueOnce(Effect.fail(rejected));
    await expect(
      controller.checkout("/repo", {
        _tag: "LocalBranch",
        name: "ghost",
      }),
    ).rejects.toBe(rejected);
    expect(controller.getSnapshot()).toMatchObject({
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
    const controller = createRepositoryRefsController(gateway);
    controller.select(alphaId);
    await whenReady(controller);
    controller.select(bravoId);
    await whenReady(controller);

    controller.select(alphaId);
    expect(controller.getSnapshot()).toMatchObject({
      refs: refs(alphaId),
      status: "ready",
    });
    expect(gateway.read).toHaveBeenCalledTimes(2);

    controller.invalidate();
    await vi.waitFor(() => expect(gateway.read).toHaveBeenCalledTimes(3));
    controller.select(bravoId);
    await vi.waitFor(() => expect(gateway.read).toHaveBeenCalledTimes(4));
    controller.select(alphaId);
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(gateway.read).toHaveBeenCalledTimes(4);
  });

  it("refuses a second checkout while one is in flight", async () => {
    const pending = Deferred.makeUnsafe<RepositoryCheckedOut>();
    const gateway = createGateway({ [alphaId]: refs(alphaId) });
    gateway.checkout.mockImplementationOnce(() => Deferred.await(pending));
    const controller = createRepositoryRefsController(gateway);
    controller.select(alphaId);
    await whenReady(controller);

    const first = controller.checkout("/repo", {
      _tag: "LocalBranch",
      name: "feature",
    });
    await expect(
      controller.checkout("/repo", {
        _tag: "LocalBranch",
        name: "main",
      }),
    ).rejects.toBeInstanceOf(RepositoryRefsBusy);
    Deferred.doneUnsafe(pending, Effect.succeed(checkedOut));

    await expect(first).resolves.toEqual(checkedOut);
    expect(gateway.checkout).toHaveBeenCalledTimes(1);
    expect(controller.getSnapshot().checkingOut).toBe(false);
  });

  it("keeps a finishing checkout from touching another repository's snapshot", async () => {
    const pending = Deferred.makeUnsafe<RepositoryCheckedOut>();
    const gateway = createGateway({
      [alphaId]: refs(alphaId),
      [bravoId]: refs(bravoId),
    });
    gateway.checkout.mockImplementationOnce(() => Deferred.await(pending));
    const controller = createRepositoryRefsController(gateway);
    controller.select(alphaId);
    await whenReady(controller);

    const first = controller.checkout("/repo", {
      _tag: "LocalBranch",
      name: "feature",
    });
    controller.select(bravoId);
    await whenReady(controller);
    await expect(
      controller.checkout("/repo", {
        _tag: "LocalBranch",
        name: "main",
      }),
    ).rejects.toBeInstanceOf(RepositoryRefsBusy);
    Deferred.doneUnsafe(pending, Effect.succeed(checkedOut));
    await first;

    expect(controller.getSnapshot()).toMatchObject({
      checkingOut: false,
      refs: refs(bravoId),
      repositoryId: bravoId,
    });
    controller.select(alphaId);
    expect(controller.getSnapshot().refs?.branches).toEqual([
      { name: "main" },
      { name: "feature", worktreePath: "/repo" },
    ]);
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
    read: vi.fn<RepositoryRefsGateway["read"]>((repositoryId) => {
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
