import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vite-plus/test";
import { createDiagnosticsActivity } from "#server/features/diagnostics/diagnostics-activity.ts";

const repositoryId = "00000000-0000-4000-8000-000000000001";

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date", "performance"] });
});

afterEach(() => {
  vi.useRealTimers();
});

function activityAt() {
  const activity = createDiagnosticsActivity();
  const advance = (milliseconds: number) => {
    vi.advanceTimersByTime(milliseconds);
  };
  const git = (
    arguments_: readonly string[],
    duration: number,
    outcome:
      | { exitCode: number; stderr?: string }
      | { reason: string; detail: string },
    expectedExitCodes: readonly number[] = [0],
  ) => {
    const run = activity.gitStarted({
      directory: "/work/linux",
      arguments: arguments_,
      repositoryId,
      expectedExitCodes,
    });
    advance(duration);
    run.finished(
      "exitCode" in outcome
        ? {
            _tag: "Exited",
            exitCode: outcome.exitCode,
            stderr: outcome.stderr ?? "",
          }
        : { _tag: "Failed", ...outcome },
    );
  };
  return { activity, advance, git };
}

describe("diagnostics activity", () => {
  it("names a Git command by its subcommand and option names", () => {
    const { activity, git } = activityAt();

    git(
      [
        "diff-tree",
        "-r",
        "-M",
        "--format=%H%x00%P",
        "3e45621^",
        "3e45621",
        "--",
        "-file",
      ],
      10,
      { exitCode: 0 },
    );

    expect(activity.slowestGit()[0]?.name).toBe("git diff-tree -r -M --format");
  });

  it("ranks the slowest commands with their typical time", () => {
    const { activity, git } = activityAt();

    git(["status", "--porcelain", "-z"], 100, { exitCode: 0 });
    git(["status", "--porcelain", "-z"], 300, { exitCode: 0 });
    git(["status", "--porcelain", "-z"], 900, { exitCode: 0 });
    git(["rev-list", "--stdin"], 400, { exitCode: 0 });

    expect(activity.slowestGit()).toEqual([
      {
        name: "git status --porcelain -z",
        repositoryId,
        runs: 3,
        longest: 900,
        typical: 300,
      },
      {
        name: "git rev-list --stdin",
        repositoryId,
        runs: 1,
        longest: 400,
        typical: 400,
      },
    ]);
  });

  it("counts unexpected exits and spawn failures as failures, not exits the caller expects", () => {
    const { activity, git } = activityAt();

    git(["merge-base", "--is-ancestor"], 10, { exitCode: 1 }, [0, 1]);
    git(["cat-file", "blob"], 10, { exitCode: 128 }, [0, 128]);
    git(["fetch", "origin"], 10, {
      exitCode: 128,
      stderr:
        "fatal: unable to access 'https://github.com/x.git/': Could not resolve host: github.com\n",
    });
    git(["log"], 10, {
      reason: "Timeout",
      detail: "Git could not complete the operation (Timeout).",
    });

    expect(activity.gitSummary("15m")).toMatchObject({ runs: 4, failures: 2 });
    expect(activity.errors()).toEqual([
      expect.objectContaining({
        kind: "Git",
        title: "git log timed out",
        count: 1,
      }),
      expect.objectContaining({
        kind: "Git",
        title: "git fetch exited with 128",
        where:
          "fatal: unable to access 'https://github.com/x.git/': Could not resolve host: github.com",
        repositoryId,
      }),
    ]);
  });

  it("groups repeated errors and moves the latest to the top", () => {
    const { activity, advance } = activityAt();
    const changes: number[] = [];
    activity.onErrorsChanged(() => changes.push(activity.errors().length));
    const report = (title: string) =>
      activity.reportError({
        kind: "Server",
        title,
        where: "repositories/stashes/list",
        detail: title,
      });

    report("TypeError: a");
    advance(10);
    report("TypeError: b");
    advance(10);
    report("TypeError: a");

    expect(activity.errors().map(({ title, count }) => [title, count])).toEqual(
      [
        ["TypeError: a", 2],
        ["TypeError: b", 1],
      ],
    );
    expect(changes).toEqual([1, 2, 2]);
  });

  it("places runs in the bucket they started in and forgets them after an hour", () => {
    const { activity, advance, git } = activityAt();

    git(["status"], 10, { exitCode: 0 });
    advance(4 * 60_000);
    git(["status"], 10, { exitCode: 0 });

    const recent = activity.gitSummary("5m");
    expect(recent.runsPerBucket).toHaveLength(30);
    expect(recent.runsPerBucket.reduce((total, runs) => total + runs, 0)).toBe(
      2,
    );
    expect(recent.runsPerBucket[5]).toBe(1);

    advance(61 * 60_000);
    git(["status"], 10, { exitCode: 0 });

    expect(activity.slowestGit()).toEqual([
      expect.objectContaining({ name: "git status", runs: 1 }),
    ]);
  });

  it("lists running processes until they finish and does not count a stopped run as a failure", () => {
    const { activity } = activityAt();
    const stopped: number[] = [];
    const run = activity.gitStarted({
      directory: "/work/linux",
      arguments: ["fetch", "--prune", "origin"],
      repositoryId,
    });

    run.spawned(4242, () => stopped.push(4242));
    activity.stop(4242);
    activity.stop(1);

    expect(activity.running().get(4242)).toMatchObject({
      command: "git fetch --prune",
      repositoryId,
    });
    expect(stopped).toEqual([4242]);

    run.finished({
      _tag: "Failed",
      reason: "Failed",
      detail: "Stopped from Diagnostics.",
    });

    expect(activity.running().size).toBe(0);
    expect(activity.errors()).toEqual([]);
    expect(activity.gitSummary("5m").failures).toBe(0);
  });
});
