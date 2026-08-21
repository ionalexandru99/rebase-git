import { randomBytes } from "node:crypto";
import { chmod, readFile, writeFile } from "node:fs/promises";
import { setTimeout } from "node:timers/promises";
import { Effect } from "effect";
import { errorMessage, isFileSystemError } from "#server/error-inspection";
import type { EnvironmentPaths } from "#server/persistence/storage/environment-paths.contract";
import { EnvironmentStorageError } from "#server/persistence/storage/storage-error.contract";

const secretCreationRetryCount = 10;
const secretCreationRetryDelayMilliseconds = 10;

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
      secret = await readSecretCreatedByAnotherProcess(path);
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

async function readSecretCreatedByAnotherProcess(path: string) {
  for (let attempt = 0; attempt <= secretCreationRetryCount; attempt += 1) {
    const secret = await readFile(path, "utf8");
    if (/^[A-Za-z0-9_-]{43}$/.test(secret.trim())) {
      return secret;
    }
    if (attempt === secretCreationRetryCount) {
      break;
    }
    await setTimeout(secretCreationRetryDelayMilliseconds);
  }
  throw new Error("The server secret is invalid.");
}

function isMissingFile(error: unknown) {
  return isFileSystemError(error) && error.code === "ENOENT";
}

function isExistingFile(error: unknown) {
  return isFileSystemError(error) && error.code === "EEXIST";
}
