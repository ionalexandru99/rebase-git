import { describe, expect, it } from "vite-plus/test";
import { classifyPushFailure } from "#server/features/repository-push/git/push-failures";

describe("push failure classification", () => {
  it.each([
    [
      "Authentication",
      "fatal: could not read Username for 'https://github.com': terminal prompts disabled",
    ],
    [
      "Authentication",
      "git@github.com: Permission denied (publickey).\nfatal: Could not read from remote repository.",
    ],
    [
      "Network",
      "fatal: unable to access 'https://github.com/org/repo.git/': Could not resolve host: github.com",
    ],
    [
      "HookDeclined",
      "pre-push: tests failed\nerror: failed to push some refs to 'origin'",
    ],
  ] as const)("reports %s from Git's error output", (reason, stderr) => {
    expect(
      classifyPushFailure(
        { exitCode: 1, stdout: "", stderr },
        "refs/heads/main",
      ).reason,
    ).toBe(reason);
  });
});
