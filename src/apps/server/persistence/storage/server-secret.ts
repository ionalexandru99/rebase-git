import { randomBytes } from "node:crypto";
import { chmod, readFile, writeFile } from "node:fs/promises";
import { Effect } from "effect";
import { errorMessage, isFileSystemError } from "#server/error-inspection";
import type { EnvironmentPaths } from "#server/persistence/storage/environment-paths.contract";
import { EnvironmentStorageError } from "#server/persistence/storage/storage-error.contract";

export function ensureServerSecret(paths: EnvironmentPaths) {
  return Effect.tryPromise({
    try: () => readOrCreateServerSecret(paths.serverSecret),
    catch: (cause) =>
      new EnvironmentStorageError({
        cause,
        message: `Could not prepare the server secret: ${errorMessage(cause)}`,
      }),
  });
}

async function readOrCreateServerSecret(path: string) {
  let secret: string;
  try {
    secret = await readFile(path, "utf8");
  } catch (error) {
    if (!isMissingFile(error)) {
      throw error;
    }

    const generated = `${randomBytes(32).toString("base64url")}\n`;
    try {
      await writeFile(path, generated, { flag: "wx", mode: 0o600 });
      secret = generated;
    } catch (writeError) {
      if (!isExistingFile(writeError)) {
        throw writeError;
      }
      secret = await readFile(path, "utf8");
    }
  }

  if (!/^[A-Za-z0-9_-]{43}$/.test(secret.trim())) {
    throw new Error("The server secret is invalid.");
  }
  if (process.platform !== "win32") {
    await chmod(path, 0o600);
  }
  return secret.trim();
}

function isMissingFile(error: unknown) {
  return isFileSystemError(error) && error.code === "ENOENT";
}

function isExistingFile(error: unknown) {
  return isFileSystemError(error) && error.code === "EEXIST";
}
