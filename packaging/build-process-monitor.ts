import { execFile } from "node:child_process";
import { chmod, cp, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";

const execute = promisify(execFile);
const manifest = "native/process-monitor/Cargo.toml";
const rustTargets: Readonly<Record<string, string>> = {
  "darwin-arm64": "aarch64-apple-darwin",
  "darwin-x64": "x86_64-apple-darwin",
  "linux-arm64": "aarch64-unknown-linux-gnu",
  "linux-x64": "x86_64-unknown-linux-gnu",
  "win32-arm64": "aarch64-pc-windows-msvc",
  "win32-x64": "x86_64-pc-windows-msvc",
};

export const processMonitorBinaries = "native/process-monitor/dist";

export async function buildProcessMonitor(
  key = `${process.platform}-${process.arch}`,
) {
  const target = rustTargets[key];
  if (target === undefined)
    throw new Error(`The process monitor has no Rust target for ${key}.`);
  const executable = key.startsWith("win32-")
    ? "rebase-process-monitor.exe"
    : "rebase-process-monitor";
  await execute(
    "cargo",
    [
      "build",
      "--release",
      "--locked",
      "--manifest-path",
      manifest,
      "--target",
      target,
    ],
    { maxBuffer: 16 * 1_048_576 },
  );
  const destination = join(processMonitorBinaries, key);
  await mkdir(destination, { recursive: true });
  await cp(
    join("native/process-monitor/target", target, "release", executable),
    join(destination, executable),
  );
  if (!key.startsWith("win32-"))
    await chmod(join(destination, executable), 0o755);
  return destination;
}

if (import.meta.main) {
  const keys = process.argv.slice(2);
  for (const key of keys.length === 0 ? [undefined] : keys)
    console.log(await buildProcessMonitor(key));
}
