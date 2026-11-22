import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { once } from "node:events";
import { mkdtemp, readdir, readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import process from "node:process";
import { inc } from "semver";
import { releaseArchiveName } from "#server/cli/self-update.ts";
import { removeTemporaryDirectory } from "#tests-support/temporary-directory.ts";

interface CommandOutput {
  readonly code: number | null;
  readonly stderr: string;
  readonly stdout: string;
}

const windows = process.platform === "win32";
const { version } = JSON.parse(await readFile("package.json", "utf8")) as {
  readonly version: string;
};
const updateVersion = inc(version, "patch") ?? "";
const archive = await readFile(
  resolve(process.argv[2] ?? "release", releaseArchiveName(version)),
);
const root = await mkdtemp(join(tmpdir(), "rebase archive șț "));
const home = join(root, "home");
const versions = join(home, ".rebase", "runtime", "versions");
const launcher = windows
  ? join(home, ".rebase", "bin", "rebase.cmd")
  : join(home, ".local", "bin", "rebase");
const release = await serveRelease();
const environment = {
  ...process.env,
  BROWSER: "none",
  HOME: home,
  REBASE_RELEASE_BASE_URL: release.url,
  USERPROFILE: home,
};
const userPath = windows ? await readUserPath() : undefined;

try {
  await install();
  await verifyTerminal(join(versions, version));
  expect(
    (await readdir(join(versions, version, "process-monitor"))).join(),
    `${process.platform}-${process.arch}`,
    "process monitors",
  );
  expectOutput(await rebase(["--version"]), 0, `Rebase ${version}`);
  expectOutput(await rebase(["status"]), 1, "Rebase is not running.");

  const opened = await rebase([]);
  expectOutput(opened, 0, "Pairing URL: http://localhost:");
  const origin = opened.stdout.match(/^Listening URL: (\S+)$/m)?.[1];
  const entry = await fetch(`${origin}/pair`);
  expect(entry.status, 200, "browser entry status");
  const started = await rebase(["status"]);
  expectOutput(started, 0, `Rebase ${version} is running.`);

  const updated = await rebase(["update"]);
  expectOutput(updated, 0, `Updated Rebase to ${updateVersion}.`);
  expectOutput(updated, 0, "Restarted Rebase at http://localhost:");
  expect(
    (await readFile(launcher, "utf8")).includes(updateVersion),
    true,
    "launcher points at the update",
  );
  expect(
    (await readdir(versions)).sort().join(),
    [version, updateVersion].sort().join(),
    "installed versions",
  );
  const restarted = await rebase(["status"]);
  expectOutput(restarted, 0, "is running.");
  expect(
    processId(restarted) !== processId(started),
    true,
    "the update restarted the server",
  );

  expectOutput(await rebase(["stop"]), 0, "Stopped Rebase");
  expectOutput(await rebase(["status"]), 1, "Rebase is not running.");
} finally {
  await rebase(["stop"]).catch(() => undefined);
  release.server.close();
  if (userPath !== undefined) await writeUserPath(userPath);
  await removeTemporaryDirectory(root);
}

async function install() {
  const installEnvironment = { ...environment, REBASE_VERSION: version };
  const output = windows
    ? await run(
        "powershell.exe",
        [
          "-NoProfile",
          "-ExecutionPolicy",
          "Bypass",
          "-File",
          resolve("packaging/install/install.ps1"),
        ],
        installEnvironment,
      )
    : await run(
        "sh",
        [resolve("packaging/install/install.sh")],
        installEnvironment,
      );
  expectOutput(output, 0, `Installed Rebase ${version}.`);
}

async function verifyTerminal(versionDirectory: string) {
  const output = await run(
    join(versionDirectory, windows ? "node.exe" : "node"),
    [
      "-e",
      [
        'const shell = process.platform === "win32" ? process.env.ComSpec : "/bin/sh";',
        'const terminal = require("@lydell/node-pty").spawn(shell, [], { cols: 80, rows: 24 });',
        "terminal.onExit(() => process.exit(0));",
        'terminal.write("exit\\r");',
      ].join("\n"),
    ],
    environment,
    versionDirectory,
  );
  expectOutput(output, 0, "");
}

function rebase(arguments_: readonly string[]) {
  return windows
    ? run(
        process.env.ComSpec ?? "cmd.exe",
        ["/d", "/c", "rebase.cmd", ...arguments_],
        environment,
        dirname(launcher),
      )
    : run(launcher, arguments_, environment);
}

async function serveRelease() {
  const files = new Map<string, Buffer>();
  const checksum = createHash("sha256").update(archive).digest("hex");
  for (const releaseVersion of [version, updateVersion]) {
    const name = releaseArchiveName(releaseVersion);
    files.set(`/download/v${releaseVersion}/${name}`, archive);
    files.set(
      `/download/v${releaseVersion}/SHA256SUMS`,
      Buffer.from(`${checksum}  ${name}\n`),
    );
  }
  const server = createServer((request, response) => {
    if (request.url === "/latest") {
      response
        .writeHead(302, { location: `${url}/tag/v${updateVersion}` })
        .end();
      return;
    }
    const file = files.get(request.url ?? "");
    if (request.url?.startsWith("/tag/")) response.writeHead(200).end();
    else if (file === undefined) response.writeHead(404).end();
    else response.writeHead(200).end(file);
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (address === null || typeof address === "string")
    throw new Error("The release server has no TCP address.");
  const url = `http://127.0.0.1:${address.port}`;
  return { server, url };
}

async function readUserPath() {
  const output = await run(
    "powershell.exe",
    [
      "-NoProfile",
      "-Command",
      "[Environment]::GetEnvironmentVariable('Path', 'User')",
    ],
    process.env,
  );
  return output.stdout.trim();
}

async function writeUserPath(value: string) {
  await run(
    "powershell.exe",
    [
      "-NoProfile",
      "-Command",
      "[Environment]::SetEnvironmentVariable('Path', $env:REBASE_USER_PATH, 'User')",
    ],
    { ...process.env, REBASE_USER_PATH: value },
  );
}

function processId(output: CommandOutput) {
  return output.stdout.match(/^PID: (\d+)$/m)?.[1];
}

function expectOutput(output: CommandOutput, code: number, text: string) {
  if (output.code !== code || !output.stdout.includes(text)) {
    throw new Error(
      `Expected exit ${code} and "${text}", got exit ${output.code}:\n${output.stdout}${output.stderr}`,
    );
  }
}

function expect(actual: unknown, expected: unknown, what: string) {
  if (actual !== expected)
    throw new Error(`Unexpected ${what}: ${actual}, expected ${expected}.`);
}

function run(
  command: string,
  arguments_: readonly string[],
  env: NodeJS.ProcessEnv,
  cwd = root,
) {
  return new Promise<CommandOutput>((resolveRun, rejectRun) => {
    const child = spawn(command, arguments_, {
      cwd,
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stderr = "";
    let stdout = "";
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.once("error", rejectRun);
    child.once("close", (code) => resolveRun({ code, stderr, stdout }));
  });
}
