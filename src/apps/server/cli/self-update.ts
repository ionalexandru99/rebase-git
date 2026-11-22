import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import {
  chmod,
  mkdir,
  readdir,
  realpath,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { promisify } from "node:util";
import { gt, valid } from "semver";
import {
  type ServerLaunch,
  startServer,
  stopServer,
} from "#server/cli/background-server.ts";
import { errorMessage } from "#server/error-inspection.ts";

const execute = promisify(execFile);
const defaultReleasesUrl =
  "https://github.com/ionalexandru99/rebase-git/releases";
const requestDeadlineMilliseconds = 30_000;
const downloadDeadlineMilliseconds = 10 * 60_000;
const windows = process.platform === "win32";

export function releaseArchiveName(version: string) {
  return `rebase-${version}-${process.platform}-${process.arch}.${windows ? "zip" : "tar.gz"}`;
}

export async function updateInstallation(
  home: string,
  currentVersion: string,
  requestedVersion: string | undefined,
) {
  const versions = join(home, ".rebase", "runtime", "versions");
  const current = await installedVersionDirectory(versions);
  if (current === undefined) {
    throw new Error(
      "Updates only work for installs made with install.sh or install.ps1.",
    );
  }
  const version =
    requestedVersion?.replace(/^v/, "") ?? (await latestVersion());
  if (valid(version) !== version)
    throw new Error(`${version} is not a Rebase release version.`);
  if (
    version === currentVersion ||
    (requestedVersion === undefined && !gt(version, currentVersion))
  ) {
    process.stdout.write(`Rebase ${currentVersion} is up to date.\n`);
    return;
  }
  const target = join(versions, version);
  if (!(await exists(target))) {
    process.stdout.write(`Downloading Rebase ${version}...\n`);
    await installRelease(versions, version);
  }
  await writeLauncher(home, versions, version);
  const stopped = await warnOnFailure("Could not stop the running server", () =>
    stopServer(home),
  );
  await removeVersionsExcept(versions, [basename(current), version]);
  process.stdout.write(`Updated Rebase to ${version}.\n`);
  if (stopped?.state === "desktop") {
    process.stdout.write(
      "The Rebase desktop app keeps running its own copy of the server.\n",
    );
    return;
  }
  if (stopped?.state !== "stopped") return;
  const restarted = await warnOnFailure("Could not restart the server", () =>
    startServer(home, versionLaunch(target)),
  );
  if (restarted !== undefined)
    process.stdout.write(`Restarted Rebase at ${restarted.origin}\n`);
}

async function warnOnFailure<A>(warning: string, action: () => Promise<A>) {
  try {
    return await action();
  } catch (error) {
    process.stderr.write(`Warning: ${warning}: ${errorMessage(error)}\n`);
    return undefined;
  }
}

async function installedVersionDirectory(versions: string) {
  const directory = dirname(process.execPath);
  try {
    return (await realpath(dirname(directory))) === (await realpath(versions))
      ? directory
      : undefined;
  } catch {
    return undefined;
  }
}

async function latestVersion() {
  const response = await fetch(`${releasesUrl()}/latest`, {
    redirect: "manual",
    signal: AbortSignal.timeout(requestDeadlineMilliseconds),
  });
  const tag = response.headers.get("location")?.match(/\/tag\/v([^/]+)$/)?.[1];
  if (tag === undefined) {
    throw new Error(
      `Could not find the latest release: HTTP ${response.status}.`,
    );
  }
  return decodeURIComponent(tag);
}

async function installRelease(versions: string, version: string) {
  const name = releaseArchiveName(version);
  const releaseUrl = `${releasesUrl()}/download/v${version}`;
  const checksums = await download(`${releaseUrl}/SHA256SUMS`);
  const archive = await download(`${releaseUrl}/${name}`);
  const expected = checksums
    .toString("utf8")
    .split(/\r?\n/)
    .map((line) => line.split(/\s+\*?/))
    .find(([, file]) => file === name)?.[0];
  if (expected === undefined) throw new Error(`SHA256SUMS has no ${name}.`);
  if (createHash("sha256").update(archive).digest("hex") !== expected) {
    throw new Error(`The checksum of ${name} does not match SHA256SUMS.`);
  }

  const staging = join(versions, `.${version}-${randomUUID()}`);
  try {
    await mkdir(staging, { recursive: true });
    await writeFile(join(staging, name), archive);
    await execute(tarCommand(), ["-xf", name], { cwd: staging });
    await rm(join(staging, name));
    await rename(staging, join(versions, version));
  } finally {
    await rm(staging, { force: true, recursive: true });
  }
}

async function writeLauncher(home: string, versions: string, version: string) {
  const launcher = windows
    ? join(home, ".rebase", "bin", "rebase.cmd")
    : join(home, ".local", "bin", "rebase");
  const contents = windows
    ? `@"%~dp0..\\runtime\\versions\\${version}\\bin\\rebase.cmd" %*\r\n`
    : `#!/bin/sh\nexec '${join(versions, version, "bin", "rebase").replaceAll("'", `'\\''`)}' "$@"\n`;
  const temporary = `${launcher}.${randomUUID()}.tmp`;
  await mkdir(dirname(launcher), { recursive: true });
  await writeFile(temporary, contents);
  await chmod(temporary, 0o755);
  await rename(temporary, launcher);
}

async function removeVersionsExcept(versions: string, kept: readonly string[]) {
  for (const entry of await readdir(versions).catch(() => [])) {
    if (kept.includes(entry)) continue;
    await rm(join(versions, entry), { force: true, recursive: true }).catch(
      () => undefined,
    );
  }
}

function versionLaunch(target: string): ServerLaunch {
  return {
    command: join(target, windows ? "node.exe" : "node"),
    arguments: [join(target, "runtime.js")],
  };
}

async function download(url: string) {
  const response = await fetch(url, {
    signal: AbortSignal.timeout(downloadDeadlineMilliseconds),
  });
  if (!response.ok) {
    throw new Error(`Could not download ${url}: HTTP ${response.status}.`);
  }
  return Buffer.from(await response.arrayBuffer());
}

function releasesUrl() {
  return process.env.REBASE_RELEASE_BASE_URL ?? defaultReleasesUrl;
}

export function tarCommand() {
  return windows
    ? join(process.env.SystemRoot ?? "C:\\Windows", "System32", "tar.exe")
    : "tar";
}

async function exists(path: string) {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}
