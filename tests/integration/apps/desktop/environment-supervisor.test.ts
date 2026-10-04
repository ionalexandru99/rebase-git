import { chmod, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { loginShellPath } from "#desktop/platform/environment/environment-supervisor.ts";
import { removeTemporaryDirectory } from "#tests-support/temporary-directory.ts";

vi.mock("electron", () => ({}));

const directories = new Set<string>();

afterEach(async () => {
  await Promise.all(
    [...directories].map((directory) => removeTemporaryDirectory(directory)),
  );
  directories.clear();
});

describe.skipIf(process.platform === "win32")("login shell PATH", () => {
  it("puts the login shell PATH ahead of the inherited one and ignores shell startup output", async () => {
    const directory = await mkdtemp(join(tmpdir(), "rebase-login-shell-"));
    directories.add(directory);
    const shell = join(directory, "shell");
    await writeFile(
      shell,
      '#!/bin/sh\necho "Welcome back"\nPATH=/opt/homebrew/bin:/usr/bin exec /bin/sh -c "$2"\n',
    );
    await chmod(shell, 0o755);

    const path = await loginShellPath(shell, "/usr/bin:/bin");

    expect(path).toBe("/opt/homebrew/bin:/usr/bin:/bin");
  });

  it("keeps the inherited PATH when the login shell cannot start", async () => {
    const path = await loginShellPath("/missing/shell", "/usr/bin:/bin");

    expect(path).toBe("/usr/bin:/bin");
  });
});
