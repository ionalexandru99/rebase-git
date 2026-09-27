import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { Schema } from "effect";
import { DesktopUpdateSettings } from "#contracts/desktop-updates/desktop-updates.contract.ts";

export interface ApplicationUpdateSettingsStore {
  read(): Promise<DesktopUpdateSettings>;
  write(settings: DesktopUpdateSettings): Promise<void>;
}

const defaultSettings: DesktopUpdateSettings = {
  checkAutomatically: true,
  releaseChannel: "stable",
};

export function createApplicationUpdateSettingsStore(
  path: string,
): ApplicationUpdateSettingsStore {
  let pendingWrite: Promise<void> = Promise.resolve();
  return {
    read: async () => {
      try {
        const source = await readFile(path, "utf8");
        try {
          return Schema.decodeUnknownSync(DesktopUpdateSettings)(
            JSON.parse(source),
          );
        } catch {
          return defaultSettings;
        }
      } catch (error) {
        if (isMissingFile(error)) return defaultSettings;
        throw error;
      }
    },
    write: (settings) => {
      const written = pendingWrite.then(() => writeAtomically(path, settings));
      pendingWrite = written.catch(() => undefined);
      return written;
    },
  };
}

async function writeAtomically(path: string, settings: DesktopUpdateSettings) {
  await mkdir(dirname(path), { recursive: true });
  const temporaryPath = `${path}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporaryPath, JSON.stringify(settings), "utf8");
    await rename(temporaryPath, path);
  } catch (error) {
    await rm(temporaryPath, { force: true });
    throw error;
  }
}

function isMissingFile(error: unknown): error is NodeJS.ErrnoException {
  return (
    error instanceof Error &&
    "code" in error &&
    (error as NodeJS.ErrnoException).code === "ENOENT"
  );
}
