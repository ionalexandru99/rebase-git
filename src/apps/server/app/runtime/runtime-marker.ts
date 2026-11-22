import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { z } from "zod";
import { errorMessage, isFileSystemError } from "#server/error-inspection.ts";

const RuntimeMarker = z.object({
  controlToken: z.string(),
  host: z.string(),
  origin: z.string(),
  pid: z.int(),
  port: z.int(),
  startedAt: z.string(),
  version: z.string(),
});
export type RuntimeMarker = z.infer<typeof RuntimeMarker>;

export async function readRuntimeMarker(runtimePath: string) {
  try {
    return RuntimeMarker.parse(JSON.parse(await readFile(runtimePath, "utf8")));
  } catch {
    return undefined;
  }
}

export async function acquireRuntimeMarker(
  marker: RuntimeMarker,
  runtimePath: string,
) {
  await writeRuntimeMarker(runtimePath, marker);
  return {
    close: () =>
      removeRuntimeMarker(runtimePath, marker.pid).catch((error: unknown) => {
        process.stderr.write(`${errorMessage(error)}\n`);
      }),
  };
}

async function writeRuntimeMarker(runtimePath: string, marker: RuntimeMarker) {
  const temporaryPath = `${runtimePath}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await fileSystemOperation(() =>
      mkdir(dirname(runtimePath), { recursive: true }),
    );
    await fileSystemOperation(() =>
      writeFile(temporaryPath, `${JSON.stringify(marker)}\n`, { mode: 0o600 }),
    );
    await replaceFile(temporaryPath, runtimePath);
  } finally {
    await rm(temporaryPath, { force: true });
  }
}

async function removeRuntimeMarker(runtimePath: string, pid: number) {
  let contents: string;
  try {
    contents = await readFile(runtimePath, "utf8");
  } catch (error) {
    if (isMissingFile(error)) return;
    throw runtimeMarkerError(error);
  }
  const marker = await fileSystemOperation(
    async () => JSON.parse(contents) as { pid?: unknown },
  );
  if (marker.pid !== pid) return;
  try {
    await rm(runtimePath);
  } catch (error) {
    if (!isMissingFile(error)) throw runtimeMarkerError(error);
  }
}

async function replaceFile(source: string, destination: string) {
  try {
    await rename(source, destination);
  } catch (error) {
    if (!isReplaceConflict(error)) throw runtimeMarkerError(error);
    await fileSystemOperation(() => rm(destination, { force: true }));
    await fileSystemOperation(() => rename(source, destination));
  }
}

async function fileSystemOperation<A>(operation: () => Promise<A>) {
  try {
    return await operation();
  } catch (error) {
    throw runtimeMarkerError(error);
  }
}

function runtimeMarkerError(cause: unknown) {
  return new Error(
    `Could not update the runtime marker: ${errorMessage(cause)}`,
    { cause },
  );
}

function isMissingFile(error: unknown) {
  return isFileSystemError(error) && error.code === "ENOENT";
}

function isReplaceConflict(error: unknown) {
  return (
    isFileSystemError(error) &&
    (error.code === "EEXIST" || error.code === "EPERM")
  );
}
