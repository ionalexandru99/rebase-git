import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import {
  chmod,
  cp,
  mkdir,
  readdir,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { releaseArchiveName, tarCommand } from "#server/cli/self-update.ts";

const execute = promisify(execFile);
const nodeVersion = "24.22.2";
const windows = process.platform === "win32";
const key = `${process.platform}-${process.arch}`;
const packageMetadata = JSON.parse(await readFile("package.json", "utf8")) as {
  readonly dependencies: Readonly<Record<string, string>>;
  readonly version: string;
};
const dist = resolve(process.argv[2] ?? "dist");
const stage = resolve("release", `archive-${key}`);
const archive = resolve("release", releaseArchiveName(packageMetadata.version));
const processMonitor = join(stage, "process-monitor", key);

if (!existsSync(join(dist, "runtime.js"))) await buildPackage();
await rm(stage, { force: true, recursive: true });
await mkdir(join(stage, "bin"), { recursive: true });
await Promise.all([
  cp(join(dist, "runtime.js"), join(stage, "runtime.js")),
  cp(join(dist, "web"), join(stage, "web"), { recursive: true }),
  cp(join(dist, "migrations"), join(stage, "migrations"), { recursive: true }),
  cp(join(dist, "process-monitor", key), processMonitor, { recursive: true }),
  cp("LICENSE", join(stage, "LICENSE")),
]);
if (!windows)
  await chmod(join(processMonitor, "rebase-process-monitor"), 0o755);
await installNode();
await installTerminal();
await writeFile(
  join(stage, "package.json"),
  `${JSON.stringify({ private: true, type: "module" })}\n`,
);
await writeLaunchers();
await rm(archive, { force: true });
const entries = await readdir(stage);
await execute(
  tarCommand(),
  windows
    ? ["-a", "-cf", archive, "-C", stage, ...entries]
    : ["-czf", archive, "-C", stage, ...entries],
  { env: { ...process.env, COPYFILE_DISABLE: "1" } },
);
await rm(stage, { force: true, recursive: true });
console.log(archive);

async function buildPackage() {
  await execute(
    windows ? (process.env.ComSpec ?? "cmd.exe") : "pnpm",
    windows ? ["/d", "/c", "pnpm.cmd", "build:package"] : ["build:package"],
  );
}

async function installNode() {
  const name = `node-v${nodeVersion}-${windows ? "win" : process.platform}-${process.arch}`;
  const file = `${name}.${windows ? "zip" : "tar.gz"}`;
  const release = `https://nodejs.org/dist/v${nodeVersion}`;
  const [checksums, download] = await Promise.all([
    fetchBytes(`${release}/SHASUMS256.txt`),
    fetchBytes(`${release}/${file}`),
  ]);
  const expected = checksums
    .toString("utf8")
    .split("\n")
    .find((line) => line.endsWith(`  ${file}`))
    ?.split(" ")[0];
  if (createHash("sha256").update(download).digest("hex") !== expected)
    throw new Error(`The checksum of ${file} does not match SHASUMS256.txt.`);

  const downloads = resolve("release", `node-${key}`);
  const binary = windows ? "node.exe" : "bin/node";
  await rm(downloads, { force: true, recursive: true });
  await mkdir(downloads, { recursive: true });
  await writeFile(join(downloads, file), download);
  await execute(tarCommand(), [
    "-xf",
    join(downloads, file),
    "-C",
    downloads,
    `${name}/${binary}`,
    `${name}/LICENSE`,
  ]);
  await cp(
    join(downloads, name, binary),
    join(stage, windows ? "node.exe" : "node"),
  );
  await cp(join(downloads, name, "LICENSE"), join(stage, "LICENSE.node"));
  await rm(downloads, { force: true, recursive: true });
}

async function installTerminal() {
  const terminal = "@lydell/node-pty";
  const npmArguments = [
    "install",
    "--prefix",
    stage,
    "--no-save",
    "--no-package-lock",
    "--omit=dev",
    "--ignore-scripts",
    "--no-audit",
    "--no-fund",
    `${terminal}@${packageMetadata.dependencies[terminal]}`,
  ];
  await execute(
    windows ? (process.env.ComSpec ?? "cmd.exe") : "npm",
    windows ? ["/d", "/c", "npm.cmd", ...npmArguments] : npmArguments,
  );
}

async function writeLaunchers() {
  if (windows) {
    await writeFile(
      join(stage, "bin", "rebase.cmd"),
      '@"%~dp0..\\node.exe" "%~dp0..\\runtime.js" %*\r\n',
    );
    return;
  }
  const launcher = join(stage, "bin", "rebase");
  await writeFile(
    launcher,
    [
      "#!/bin/sh",
      'dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)',
      'exec "$dir/../node" "$dir/../runtime.js" "$@"',
      "",
    ].join("\n"),
  );
  await chmod(launcher, 0o755);
}

async function fetchBytes(url: string) {
  const response = await fetch(url);
  if (!response.ok)
    throw new Error(`Could not download ${url}: HTTP ${response.status}.`);
  return Buffer.from(await response.arrayBuffer());
}
