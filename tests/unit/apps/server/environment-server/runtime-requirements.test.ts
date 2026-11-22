import { describe, expect, it } from "vite-plus/test";
import {
  type GitCommandRunner,
  gitFailed,
} from "#server/adapters/local-git/git-commands.ts";
import { verifyGitVersion } from "#server/app/runtime/runtime-requirements.ts";

describe("runtime requirements", () => {
  it.each([
    "git version 2.35.0",
    "git version 2.45.2.windows.1",
    "git version 2.39.3 (Apple Git-145)",
  ])("accepts %s", async (output) => {
    await expect(verifyGitVersion(gitAnswering(output))).resolves.toBe(
      undefined,
    );
  });

  it("rejects Git versions older than 2.35", async () => {
    await expect(
      verifyGitVersion(gitAnswering("git version 2.34.9")),
    ).rejects.toThrow("Git 2.35 or newer is required. Found Git 2.34.9.");
  });

  it("explains when Git starts but fails", async () => {
    await expect(
      verifyGitVersion(gitAnswering("fatal: bad config line 1", 128)),
    ).rejects.toThrow("Could not run Git: fatal: bad config line 1");
  });

  it("explains when Git is not installed", async () => {
    await expect(
      verifyGitVersion(gitAnswering(gitFailed("GitUnavailable"))),
    ).rejects.toThrow("Git 2.35 or newer is required, but Git was not found.");
  });
});

function gitAnswering(
  answer: string | ReturnType<typeof gitFailed>,
  exitCode = 0,
): GitCommandRunner {
  return {
    run: async () => {
      if (typeof answer !== "string") throw answer;
      return exitCode === 0
        ? { exitCode, stderr: "", stdout: answer }
        : { exitCode, stderr: answer, stdout: "" };
    },
    stream: () => {
      throw new Error("The version check never streams.");
    },
  };
}
