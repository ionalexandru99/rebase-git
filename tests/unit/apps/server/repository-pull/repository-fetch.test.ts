import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  onTestFinished,
  vi,
} from "vite-plus/test";
import type { RepositoryCatalogEntry } from "#contracts/repository-catalog/repository-catalog.contract.ts";
import { createEnvironmentEventPublisher } from "#server/adapters/environment-transport/environment-event-publisher.ts";
import {
  type GitCommandRunner,
  gitFailed,
} from "#server/adapters/local-git/git-commands.ts";
import { createCommandProgress } from "#server/features/command-progress/command-progress.ts";
import { acquireRepositoryFetch } from "#server/features/repository-pull/repository-fetch.ts";
import type { RepositoryAccess } from "#server/repository/repository-access.ts";

const repositoryId = "00000000-0000-4000-8000-000000000001";
const linkedId = "00000000-0000-4000-8000-000000000002";

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("repository fetch", () => {
  it("fetches when a repository is first shown and again on its interval while a client listens", async () => {
    const { fetch, git, events } = withFetch({ setting: "inherit" });

    await fetch.status(repositoryId);
    await vi.advanceTimersByTimeAsync(0);
    expect(git.fetch).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(300_000);
    expect(git.fetch).toHaveBeenCalledTimes(1);
    const unsubscribe = events.subscribe(() => {});
    await vi.advanceTimersByTimeAsync(300_000);
    expect(git.fetch).toHaveBeenCalledTimes(2);
    unsubscribe();
  });

  it("shares one Git fetch between callers of linked worktrees", async () => {
    const { fetch, git } = withFetch({});
    const finish = Promise.withResolvers<void>();
    git.fetch.mockImplementation(async () => {
      await finish.promise;
      return output();
    });

    const first = fetch.fetch(repositoryId);
    const second = fetch.fetch(linkedId);
    await vi.advanceTimersByTimeAsync(0);
    expect(git.fetch).toHaveBeenCalledOnce();
    finish.resolve();

    expect(await first).toMatchObject({ fetching: false });
    expect(await second).toMatchObject({ fetching: false });
  });

  it("reports failed fetches, including runner defects, and recovers", async () => {
    const { fetch, git, events } = withFetch({});
    const changed = vi.fn();
    events.subscribe(changed);
    git.fetch
      .mockRejectedValueOnce(new Error("defect"))
      .mockRejectedValueOnce(gitFailed("Timeout"));

    await expect(fetch.fetch(repositoryId)).rejects.toEqual({
      _tag: "FetchFailed",
      reason: "Failed",
    });
    await expect(fetch.fetch(repositoryId)).rejects.toEqual({
      _tag: "FetchFailed",
      reason: "Timeout",
    });
    expect(await fetch.status(repositoryId)).toMatchObject({
      failure: { _tag: "FetchFailed", reason: "Timeout" },
    });
    expect(await fetch.fetch(repositoryId)).not.toHaveProperty("failure");
    expect(changed).toHaveBeenCalledWith(
      expect.any(Number),
      [repositoryId],
      "Fetch",
    );
  });

  it("replaces the schedule when configured and stops when disabled", async () => {
    const { fetch, git, events } = withFetch({ setting: "0" });
    events.subscribe(() => {});

    await fetch.configure(repositoryId, { _tag: "Interval", seconds: 10 });
    await vi.advanceTimersByTimeAsync(5_000);
    await fetch.configure(repositoryId, { _tag: "Interval", seconds: 20 });
    await vi.advanceTimersByTimeAsync(19_000);
    expect(git.fetch).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(git.fetch).toHaveBeenCalledOnce();
    await fetch.configure(repositoryId, { _tag: "Disabled" });
    await vi.advanceTimersByTimeAsync(60_000);
    expect(git.fetch).toHaveBeenCalledOnce();
    expect(git.configured).toEqual(["10", "20", "0"]);
  });
});

function output(stdout = "") {
  return { exitCode: 0, stdout, stderr: "" };
}

function withFetch(options: { readonly setting?: string }) {
  const git = {
    fetch: vi.fn<GitCommandRunner["run"]>(async () => output()),
    configured: [] as string[],
  };
  const runner: GitCommandRunner = {
    stream: async function* () {},
    run: async (command) => {
      if (command.arguments[0] === "fetch") return git.fetch(command);
      const [, , key, value] = command.arguments;
      if (key === "rebase.autoFetchIntervalSeconds" && value !== undefined)
        git.configured.push(value);
      return output(options.setting ?? "inherit");
    },
  };
  const entry = (id: string): RepositoryCatalogEntry => ({
    id,
    logicalRepositoryId: repositoryId,
    path: id === linkedId ? "/linked" : "/repo",
    name: "repo",
    addedAt: "2026-09-04T00:00:00.000Z",
    color: "blue",
    lastOpenedAt: "2026-09-04T00:00:00.000Z",
  });
  const access: RepositoryAccess = {
    repository: async (id) => entry(id),
    worktrees: async () => [],
    requireWorktree: async () => {},
  };
  const events = createEnvironmentEventPublisher();
  const fetch = acquireRepositoryFetch({
    access,
    afterFetch: async () => {},
    coordination: {
      run: (_directory, _policy, operation) => operation(),
      operation: () => {
        throw new Error("Fetch never reads operations.");
      },
    },
    events,
    git: runner,
    progress: createCommandProgress(),
  });
  onTestFinished(fetch.close);
  return { fetch, git, events };
}
