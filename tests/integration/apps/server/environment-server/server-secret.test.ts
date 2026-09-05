import {
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect } from "effect";
import { afterEach, describe, expect, it, vi } from "vitest";
import { environmentPaths } from "#server/persistence/storage/environment-paths";
import { ensureServerSecret } from "#server/persistence/storage/server-secret";

const pendingWrite = vi.hoisted(() => ({
  pause: undefined as (() => Promise<void>) | undefined,
}));

vi.mock("node:fs/promises", async (importOriginal) => {
  const filesystem = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...filesystem,
    writeFile: async (...args: Parameters<typeof filesystem.writeFile>) => {
      const pause = pendingWrite.pause;
      const options = args[2];
      if (
        pause === undefined ||
        typeof args[0] !== "string" ||
        typeof options !== "object" ||
        options?.flag !== "wx"
      )
        return filesystem.writeFile(...args);
      const file = await filesystem.open(args[0], "wx", options.mode);
      try {
        await pause();
        await file.writeFile(args[1]);
      } finally {
        await file.close();
      }
    },
  };
});

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true })),
  );
});

describe("server secret publication", () => {
  it("lets another starter finish while the first writer is paused", async () => {
    const paths = await temporaryPaths();
    const opened = Promise.withResolvers<void>();
    const resume = Promise.withResolvers<void>();
    pendingWrite.pause = async () => {
      opened.resolve();
      await resume.promise;
    };
    const first = Effect.runPromise(ensureServerSecret(paths));
    await opened.promise;
    pendingWrite.pause = undefined;
    try {
      const second = await Effect.runPromise(ensureServerSecret(paths));
      expect(second).toMatch(/^[A-Za-z0-9_-]{43}$/);
      resume.resolve();
      await expect(first).resolves.toBe(second);
    } finally {
      resume.resolve();
      await first;
    }
  });

  it("publishes one complete private secret to concurrent first starts", async () => {
    const paths = await temporaryPaths();
    const secrets = await Promise.all(
      Array.from({ length: 64 }, async (_, index) => {
        if (index > 0)
          await new Promise((resolve) => setTimeout(resolve, index % 4));
        return Effect.runPromise(ensureServerSecret(paths));
      }),
    );
    expect(new Set(secrets).size).toBe(1);
    expect(secrets[0]).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect((await readFile(paths.serverSecret, "utf8")).trim()).toBe(
      secrets[0],
    );
    expect(await readdir(paths.secretsDirectory)).toEqual(["server.key"]);
    if (process.platform !== "win32")
      expect((await stat(paths.serverSecret)).mode & 0o777).toBe(0o600);
  });

  it("keeps an existing secret and rejects malformed stored content", async () => {
    const paths = await temporaryPaths();
    const original = "a".repeat(43);
    await writeFile(paths.serverSecret, `${original}\n`);
    await expect(Effect.runPromise(ensureServerSecret(paths))).resolves.toBe(
      original,
    );
    await writeFile(paths.serverSecret, "invalid");
    await expect(Effect.runPromise(ensureServerSecret(paths))).rejects.toThrow(
      "The server secret is invalid.",
    );
    expect(await readFile(paths.serverSecret, "utf8")).toBe("invalid");
  });
});

async function temporaryPaths() {
  const directory = await mkdtemp(join(tmpdir(), "rebase-secret-"));
  directories.push(directory);
  const paths = environmentPaths(directory);
  await mkdir(paths.secretsDirectory);
  return paths;
}
