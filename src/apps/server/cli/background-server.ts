import { type ChildProcess, spawn } from "node:child_process";
import { watch } from "node:fs";
import { mkdir, open } from "node:fs/promises";
import { dirname, join } from "node:path";
import { z } from "zod";
import {
  EnvironmentLocalPairing,
  environmentLocalPairingPath,
  environmentShutdownPath,
} from "#contracts/environment-authorization/environment-authorization.contract.ts";
import {
  type RuntimeMarker,
  readRuntimeMarker,
} from "#server/app/runtime/runtime-marker.ts";
import { environmentPaths } from "#server/persistence/storage/environment-paths.ts";

export const ServerReady = z.object({
  origin: z.string(),
  pairingUrl: z.string(),
});
export type ServerReady = z.infer<typeof ServerReady>;

export type StopResult =
  | { readonly state: "not-running" }
  | { readonly state: "stopped" | "desktop"; readonly marker: RuntimeMarker };

export interface ServerLaunch {
  readonly command: string;
  readonly arguments: readonly string[];
}

const startDeadlineMilliseconds = 20_000;
const stopDeadlineMilliseconds = 20_000;
const requestDeadlineMilliseconds = 5_000;

export function serverLogPath(home: string) {
  return join(home, ".rebase", "logs", "server.log");
}

export function browserOrigin(marker: RuntimeMarker) {
  return marker.host === "127.0.0.1"
    ? `http://localhost:${marker.port}`
    : marker.origin;
}

export async function findRunningServer(home: string) {
  const marker = await readRuntimeMarker(markerPath(home));
  if (marker === undefined || !isProcessAlive(marker.pid)) return undefined;
  return (await answers(marker.origin)) ? marker : undefined;
}

export async function openServer(home: string) {
  const running = await findRunningServer(home);
  if (running !== undefined) return requestPairing(running);
  return startServer(home, {
    command: process.execPath,
    arguments: [process.argv[1] ?? ""],
  });
}

export async function startServer(home: string, launch: ServerLaunch) {
  const deadline = Date.now() + startDeadlineMilliseconds;
  const logPath = serverLogPath(home);
  await mkdir(dirname(logPath), { recursive: true });
  const log = await open(logPath, "a", 0o600);
  try {
    return await untilReady(
      spawn(launch.command, [...launch.arguments, "serve"], {
        cwd: home,
        detached: true,
        env: { ...process.env, BROWSER: "none" },
        stdio: ["ignore", log.fd, log.fd, "ipc"],
        windowsHide: true,
      }),
    );
  } catch (cause) {
    const running = await untilMarker(home, deadline - Date.now(), () =>
      findRunningServer(home),
    );
    if (running !== undefined) return requestPairing(running);
    throw new Error(`Rebase could not start. See ${logPath}.`, { cause });
  } finally {
    await log.close();
  }
}

export async function stopServer(home: string): Promise<StopResult> {
  const marker = await findRunningServer(home);
  if (marker === undefined) return { state: "not-running" };
  const response = await controlRequest(marker, environmentShutdownPath);
  if (response.status === 404) return { state: "desktop", marker };
  assertAccepted(marker, response);
  const stopped = await untilMarker(home, stopDeadlineMilliseconds, async () =>
    (await readRuntimeMarker(markerPath(home)))?.pid !== marker.pid ||
    !isProcessAlive(marker.pid)
      ? true
      : undefined,
  );
  if (stopped === undefined)
    throw new Error(`Rebase (PID ${marker.pid}) did not stop in time.`);
  return { state: "stopped", marker };
}

async function requestPairing(marker: RuntimeMarker): Promise<ServerReady> {
  const response = await controlRequest(marker, environmentLocalPairingPath);
  assertAccepted(marker, response);
  const { pairingUrl } = EnvironmentLocalPairing.parse(await response.json());
  const origin = browserOrigin(marker);
  return { origin, pairingUrl: pairingUrl.replace(marker.origin, origin) };
}

function controlRequest(marker: RuntimeMarker, path: string) {
  return fetch(`${marker.origin}${path}`, {
    headers: { authorization: `Bearer ${marker.controlToken}` },
    method: "POST",
    signal: AbortSignal.timeout(requestDeadlineMilliseconds),
  });
}

function assertAccepted(marker: RuntimeMarker, response: Response) {
  if (!response.ok) {
    throw new Error(
      `Rebase (PID ${marker.pid}) refused the request with HTTP ${response.status}.`,
    );
  }
}

function untilReady(child: ChildProcess) {
  return new Promise<ServerReady>((resolve, reject) => {
    const ready = (message: unknown) =>
      settle(() => {
        child.disconnect();
        child.unref();
        resolve(ServerReady.parse(message));
      });
    const exited = (code: number | null) =>
      settle(() => reject(new Error(`The server exited with ${code}.`)));
    const failed = (error: Error) => settle(() => reject(error));
    const settle = (finish: () => void) => {
      clearTimeout(deadline);
      child.off("message", ready);
      child.off("exit", exited);
      child.off("error", failed);
      finish();
    };
    const deadline = setTimeout(
      () =>
        settle(() => {
          child.kill();
          reject(new Error("The server did not report ready in time."));
        }),
      startDeadlineMilliseconds,
    );
    child.once("message", ready);
    child.once("exit", exited);
    child.once("error", failed);
  });
}

async function untilMarker<A>(
  home: string,
  deadlineMilliseconds: number,
  find: () => Promise<A | undefined>,
) {
  const path = markerPath(home);
  await mkdir(dirname(path), { mode: 0o700, recursive: true });
  return new Promise<A | undefined>((resolve) => {
    let settled = false;
    const watcher = watch(dirname(path));
    const settle = (value: A | undefined) => {
      if (settled) return;
      settled = true;
      clearTimeout(deadline);
      watcher.close();
      resolve(value);
    };
    const check = async () => {
      const found = await find();
      if (found !== undefined) settle(found);
    };
    const deadline = setTimeout(
      () => void find().then(settle),
      Math.max(deadlineMilliseconds, 0),
    );
    watcher.on("change", () => void check());
    watcher.on("error", () => void find().then(settle));
    void check();
  });
}

function markerPath(home: string) {
  return environmentPaths(join(home, ".rebase")).runtimeMarker;
}

function isProcessAlive(pid: number) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

async function answers(origin: string) {
  try {
    await fetch(origin, {
      method: "HEAD",
      signal: AbortSignal.timeout(requestDeadlineMilliseconds),
    });
    return true;
  } catch {
    return false;
  }
}
