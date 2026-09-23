import { Effect, Stream } from "effect";
import { expect, it } from "vite-plus/test";
import type { GitCommandRunner } from "#server/domain/git-command.contract";
import { createObjectFormatCache } from "#server/features/repository-history/git/read-object-format";

it("asks Git for each repository's object format once", async () => {
  const directories: string[] = [];
  const git: GitCommandRunner = {
    stream: () => Stream.empty,
    run: (command) =>
      Effect.sync(() => {
        directories.push(command.directory);
        return { exitCode: 0, stderr: "", stdout: "sha256\n" };
      }),
  };
  const objectFormat = createObjectFormatCache(git);

  const formats = await Effect.runPromise(
    Effect.all([
      objectFormat("/first"),
      objectFormat("/first"),
      objectFormat("/second"),
    ]),
  );

  expect(formats).toEqual(["sha256", "sha256", "sha256"]);
  expect(directories).toEqual(["/first", "/second"]);
});
