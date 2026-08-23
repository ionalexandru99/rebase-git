import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import {
  type DesktopUpdateSettings,
  DesktopUpdateSettingsSchema,
} from "@rebase/contracts";
import { Schema } from "effect";
import type { ApplicationUpdateSettingsStore } from "#desktop/features/application-updates/application-update-settings-store.contract";

const defaultSettings: DesktopUpdateSettings = {
  checkAutomatically: true,
  releaseChannel: "stable",
};

export function createApplicationUpdateSettingsStore(
  path: string,
): ApplicationUpdateSettingsStore {
  return {
    read: async () => {
      try {
        const source = await readFile(path, "utf8");
        try {
          return Schema.decodeUnknownSync(DesktopUpdateSettingsSchema)(
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
    write: async (settings) => {
      await mkdir(dirname(path), { recursive: true });
      const temporaryPath = `${path}.${randomUUID()}.tmp`;
      try {
        await writeFile(temporaryPath, JSON.stringify(settings), "utf8");
        await rename(temporaryPath, path);
      } catch (error) {
        await rm(temporaryPath, { force: true });
        throw error;
      }
    },
  };
}

function isMissingFile(error: unknown): error is NodeJS.ErrnoException {
  return (
    error instanceof Error &&
    "code" in error &&
    (error as NodeJS.ErrnoException).code === "ENOENT"
  );
}
