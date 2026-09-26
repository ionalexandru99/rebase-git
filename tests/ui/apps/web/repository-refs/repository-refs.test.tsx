import {
  type CheckoutRepositoryRef,
  type RepositoryCheckedOut,
  type RepositoryRefs,
  RepositoryRefsHttpApi,
} from "@rebase/contracts";
import { EnvironmentHttpRejected } from "@rebase/environment-client";
import { describe, expect, it, vi } from "vite-plus/test";
import { repositoryScope } from "#tests-ui/apps/web/repository-scope/repository-scope-fixture";
import {
  fakeRequests,
  idleOperation,
  respond,
} from "#tests-ui/runtime/fake-requests";
import { fakeRpc } from "#tests-ui/runtime/fake-rpc";
import { render } from "#tests-ui/runtime/render";
import { useRefActivation } from "#web/features/repository-refs/hooks/use-ref-activation";
import { useRepositoryRefs } from "#web/features/repository-refs/hooks/use-repository-refs";
import { RepositoryScopeProvider } from "#web/features/repository-scope/index";
import type { EnvironmentChangeListener } from "#web/platform/environment/environment-protocol.contract";

const repositoryId = "00000000-0000-4000-8000-000000000001";
const mainPath = "/repo";
const topicPath = "/repo/.worktrees/topic";
const commit = "a".repeat(40);

describe("repository refs", () => {
  it("reads refs over the environment connection and re-reads them after a ref change", async () => {
    const reads = queuedReads();
    const environment = await refsEnvironment(reads.next);
    const screen = await renderRefs(environment);

    await expect
      .element(screen.getByRole("status"))
      .toHaveTextContent("Loading");
    await reads.resolve(refs("main"));
    await expect
      .element(screen.getByRole("status"))
      .toHaveTextContent("On main");

    environment.publish([repositoryId]);
    await reads.resolve(refs("feature"));
    await expect
      .element(screen.getByRole("status"))
      .toHaveTextContent("On feature");
  });

  it("applies a checkout to the shown refs and explains a rejected one", async () => {
    const reads = queuedReads();
    const checkout = vi.fn(
      async (
        command: CheckoutRepositoryRef,
      ): Promise<RepositoryCheckedOut> => ({
        head: { branch: command.target.name, commit },
        stash: "none",
        worktreePath: command.worktreePath,
      }),
    );
    const environment = await refsEnvironment(reads.next, checkout);
    const screen = await renderRefs(environment);
    await reads.resolve(refs("main"));
    await expect
      .element(screen.getByRole("status"))
      .toHaveTextContent("On main");

    environment.publish([repositoryId]);
    await vi.waitFor(() => expect(reads.pending()).toBe(1));
    await screen.getByRole("button", { name: "Checkout feature" }).click();
    await expect
      .element(screen.getByRole("status"))
      .toHaveTextContent("On feature");
    await vi.waitFor(() => expect(reads.pending()).toBe(2));
    await reads.resolve(refs("main"));
    await reads.resolve(refs("feature"));
    await expect
      .element(screen.getByRole("status"))
      .toHaveTextContent("On feature");

    checkout.mockRejectedValueOnce(
      new EnvironmentHttpRejected({
        failure: {
          _tag: "CheckoutRejected",
          detail: "",
          reason: "LocalChanges",
        },
      }),
    );
    await screen.getByRole("button", { name: "Checkout release" }).click();
    await expect
      .element(screen.getByRole("alert"))
      .toHaveTextContent("Local changes would be overwritten.");
    await expect
      .element(screen.getByRole("status"))
      .toHaveTextContent("On feature");
  });

  it("explains a refs read that ends without an answer", async () => {
    const reads = queuedReads();
    const screen = await renderRefs(await refsEnvironment(reads.next));

    await reads.fail(new Error("connection closed"));

    await expect
      .element(screen.getByRole("alert"))
      .toHaveTextContent("The Environment did not answer.");
  });

  it("ignores a second checkout while one is in flight", async () => {
    const reads = queuedReads();
    const checkout = vi.fn(
      (): Promise<RepositoryCheckedOut> => new Promise(() => undefined),
    );
    const screen = await renderRefs(
      await refsEnvironment(reads.next, checkout),
    );
    await reads.resolve(refs("main"));
    await expect
      .element(screen.getByRole("status"))
      .toHaveTextContent("On main");

    await screen.getByRole("button", { name: "Checkout feature" }).click();
    await vi.waitFor(() => expect(checkout).toHaveBeenCalledOnce());
    await screen.getByRole("button", { name: "Checkout release" }).click();

    expect(checkout).toHaveBeenCalledOnce();
  });

  it("switches to the worktree that holds a branch instead of checking it out", async () => {
    const reads = queuedReads();
    const checkout = vi.fn(
      async (): Promise<RepositoryCheckedOut> => Promise.reject(new Error()),
    );
    const switchWorktree = vi.fn<(worktreePath: string) => void>();
    const screen = await renderRefs(
      await refsEnvironment(reads.next, checkout),
      switchWorktree,
    );
    await reads.resolve(refs("main"));
    await expect
      .element(screen.getByRole("status"))
      .toHaveTextContent("On main");

    await screen.getByRole("button", { name: "Checkout topic" }).click();

    expect(switchWorktree).toHaveBeenCalledExactlyOnceWith(topicPath);
    expect(checkout).not.toHaveBeenCalled();
  });
});

function Refs({
  switchWorktree,
}: {
  readonly switchWorktree: (worktreePath: string) => void;
}) {
  const repositoryRefs = useRepositoryRefs(repositoryId, repositoryId);
  const activation = useRefActivation(repositoryRefs, switchWorktree);
  const head = repositoryRefs.refs?.worktrees.find(
    ({ path }) => path === mainPath,
  )?.head.branch;
  return (
    <div>
      <p role="status">{head === undefined ? "Loading" : `On ${head}`}</p>
      {activation.error === null ? null : (
        <p role="alert">{activation.error}</p>
      )}
      {repositoryRefs.error === null ? null : (
        <p role="alert">{repositoryRefs.error}</p>
      )}
      {["feature", "release", "topic"].map((name) => (
        <button
          key={name}
          type="button"
          onClick={() => activation.select({ _tag: "LocalBranch", name })}
        >
          Checkout {name}
        </button>
      ))}
    </div>
  );
}

function renderRefs(
  environment: Awaited<ReturnType<typeof refsEnvironment>>,
  switchWorktree: (worktreePath: string) => void = () => undefined,
) {
  return render(
    <RepositoryScopeProvider
      scope={repositoryScope({
        repositoryId,
        logicalRepositoryId: repositoryId,
        worktreePath: mainPath,
      })}
    >
      <Refs switchWorktree={switchWorktree} />
    </RepositoryScopeProvider>,
    { environment: environment.value },
  );
}

async function refsEnvironment(
  readRefs: () => Promise<RepositoryRefs>,
  checkout: (
    command: CheckoutRepositoryRef,
  ) => Promise<RepositoryCheckedOut> = async () =>
    Promise.reject(new Error("Unexpected checkout")),
) {
  const listeners = new Set<EnvironmentChangeListener>();
  return {
    publish: (repositoryIds: readonly string[]) => {
      for (const listener of listeners) listener(repositoryIds, "Refs");
    },
    value: {
      rpc: await fakeRpc(readRefs),
      requests: fakeRequests(
        idleOperation,
        respond(RepositoryRefsHttpApi.checkout, checkout),
      ),
      changes: {
        subscribe: (listener: EnvironmentChangeListener) => {
          listeners.add(listener);
          return () => listeners.delete(listener);
        },
      },
    },
  };
}

function queuedReads() {
  const waiting: PromiseWithResolvers<RepositoryRefs>[] = [];
  const settle = async () => {
    await vi.waitFor(() => expect(waiting.length).toBeGreaterThan(0));
    return waiting.shift();
  };
  return {
    next: () => {
      const read = Promise.withResolvers<RepositoryRefs>();
      waiting.push(read);
      return read.promise;
    },
    pending: () => waiting.length,
    resolve: async (refs: RepositoryRefs) => (await settle())?.resolve(refs),
    fail: async (error: Error) => (await settle())?.reject(error),
  };
}

function refs(head: string): RepositoryRefs {
  return {
    branches: [
      { name: "main", target: commit },
      { name: "feature", target: commit },
      { name: "release", target: commit },
      { name: "topic", target: commit, worktreePath: topicPath },
    ].map((branch) =>
      branch.name === head ? { ...branch, worktreePath: mainPath } : branch,
    ),
    remoteBranches: [],
    repositoryId,
    tags: [],
    truncated: { branches: false, remoteBranches: false, tags: false },
    worktrees: [
      { head: { branch: head, commit }, main: true, path: mainPath },
      { head: { branch: "topic", commit }, main: false, path: topicPath },
    ],
  };
}
