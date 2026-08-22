import { type ChildProcessByStdio, spawn } from "node:child_process";
import { mkdtemp, readdir, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import process from "node:process";
import type { Readable } from "node:stream";

type RunningProcess = ChildProcessByStdio<null, Readable, Readable>;

interface CommandOutput {
  readonly stderr: string;
  readonly stdout: string;
}

const artifact = await findArtifact(resolve(process.argv[2] ?? "."));
const temporaryRoot = await mkdtemp(join(tmpdir(), "rebase-package-"));
const installRoot = join(temporaryRoot, "install");
const homeRoot = join(temporaryRoot, "home");

try {
  await run(
    npmCommand(),
    [
      "install",
      "--ignore-scripts",
      "--no-audit",
      "--no-fund",
      "--prefix",
      installRoot,
      artifact,
    ],
    temporaryRoot,
  );

  const packageRoot = join(installRoot, "node_modules", "rebase-git");
  await verifyPackageContents(packageRoot);
  await verifyVersionCommands(installRoot);
  await verifyServer(
    npxCommand(),
    ["--offline", "--no-install", "rebase-git"],
    installRoot,
    homeRoot,
  );
  await verifyServer(
    join(
      installRoot,
      "node_modules",
      ".bin",
      process.platform === "win32" ? "rebase.cmd" : "rebase",
    ),
    ["serve"],
    installRoot,
    homeRoot,
  );
} finally {
  await rm(temporaryRoot, { force: true, recursive: true });
}

async function findArtifact(path: string) {
  if ((await stat(path)).isFile()) return path;

  const artifacts = (await readdir(path))
    .filter((name) => /^rebase-git-.*\.tgz$/.test(name))
    .sort();
  const artifactName = artifacts.at(-1);
  if (artifactName === undefined) {
    throw new Error(`No rebase-git package was found in ${path}.`);
  }
  return join(path, artifactName);
}

async function verifyPackageContents(packageRoot: string) {
  const files = await listFiles(packageRoot);
  const requiredPatterns = [
    /^LICENSE$/,
    /^README\.md$/,
    /^package\.json$/,
    /^dist\/cli\.js$/,
    /^dist\/runtime\.js$/,
    /^dist\/migrations\/.*\/migration\.sql$/,
    /^dist\/web\/index\.html$/,
    /^dist\/web\/assets\/.*\.js$/,
    /^dist\/web\/assets\/.*\.css$/,
  ];

  for (const pattern of requiredPatterns) {
    if (!files.some((file) => pattern.test(file))) {
      throw new Error(`The package is missing ${pattern}.`);
    }
  }

  const forbidden = files.filter(
    (file) =>
      file.startsWith("src/") ||
      file.startsWith("tests/") ||
      file.includes("desktop") ||
      file.includes("electron") ||
      file.includes("agent"),
  );
  if (forbidden.length > 0) {
    throw new Error(
      `The package contains forbidden files: ${forbidden.join(", ")}`,
    );
  }

  const executables = await Promise.all(
    ["cli.js", "runtime.js"].map((file) =>
      readFile(join(packageRoot, "dist", file), "utf8"),
    ),
  );
  if (executables.some((executable) => executable.includes(process.cwd()))) {
    throw new Error("The executable contains the source workspace path.");
  }
}

async function verifyVersionCommands(installRoot: string) {
  const npxVersion = await run(
    npxCommand(),
    ["--offline", "--no-install", "rebase-git", "--version"],
    installRoot,
  );
  assertVersionOutput(npxVersion.stdout);

  const cliPath = join(
    installRoot,
    "node_modules",
    "rebase-git",
    "dist",
    "cli.js",
  );
  const installedVersion = await run(
    process.execPath,
    [cliPath, "--version"],
    installRoot,
  );
  assertVersionOutput(installedVersion.stdout);
}

function assertVersionOutput(output: string) {
  if (!/^Rebase \d+\.\d+\.\d+(?:-[^\s]+)?$/m.test(output)) {
    throw new Error(`The product version is missing from:\n${output}`);
  }
  if (!/^Environment protocol \d+\.\d+ \(minimum \d+\.\d+\)$/m.test(output)) {
    throw new Error(`The protocol version is missing from:\n${output}`);
  }
}

async function verifyServer(
  command: string,
  arguments_: readonly string[],
  cwd: string,
  home: string,
) {
  const child = spawnProcess(command, arguments_, cwd, {
    ...process.env,
    BROWSER: "none",
    HOME: home,
    USERPROFILE: home,
  });
  let stderr = "";
  let stdout = "";
  child.stderr.on("data", (chunk) => {
    stderr += chunk.toString();
  });
  child.stdout.on("data", (chunk) => {
    stdout += chunk.toString();
  });

  try {
    const origin = await waitForListeningUrl(
      child,
      () => stdout,
      () => stderr,
    );
    if (new URL(origin).hostname !== "127.0.0.1") {
      throw new Error(`The package listened outside loopback: ${origin}`);
    }

    await verifyBrowserAssets(origin);
  } finally {
    await stopServer(child, home);
  }
}

async function verifyBrowserAssets(origin: string) {
  const response = await fetch(`${origin}/pair`);
  if (!response.ok) {
    throw new Error(`The browser entry point returned ${response.status}.`);
  }
  const html = await response.text();
  const assetReferences = Array.from(
    html.matchAll(/(?:href|src)="([^"]+)"/g),
    (match) => match[1],
  ).filter((reference): reference is string => reference !== undefined);
  if (assetReferences.length === 0) {
    throw new Error("The browser entry point contains no local assets.");
  }

  for (const reference of assetReferences) {
    const assetUrl = new URL(reference, origin);
    if (assetUrl.origin !== origin) {
      throw new Error(`The browser uses an external asset: ${assetUrl}.`);
    }
    const assetResponse = await fetch(assetUrl);
    if (!assetResponse.ok) {
      throw new Error(
        `Browser asset ${assetUrl} returned ${assetResponse.status}.`,
      );
    }
  }
}

async function stopServer(child: RunningProcess, home: string) {
  const markerPath = join(home, ".rebase", "runtime", "runtime.json");
  try {
    const marker: unknown = JSON.parse(await readFile(markerPath, "utf8"));
    if (!hasProcessId(marker)) {
      throw new Error("The runtime marker contains no process ID.");
    }
    process.kill(marker.pid, "SIGTERM");
  } catch (error) {
    if (child.exitCode === null) child.kill("SIGTERM");
    if (
      !(
        error &&
        typeof error === "object" &&
        "code" in error &&
        error.code === "ENOENT"
      )
    ) {
      throw error;
    }
  }
  await waitForExit(child);
}

function waitForListeningUrl(
  child: RunningProcess,
  readOutput: () => string,
  readError: () => string,
) {
  return new Promise<string>((resolveOutput, rejectOutput) => {
    const timeout = setTimeout(() => {
      cleanup();
      rejectOutput(new Error(`Timed out waiting for Rebase. ${readError()}`));
    }, 20_000);
    const inspect = () => {
      const match = readOutput().match(/^Listening URL: (http:\/\/[^\s]+)$/m);
      if (match?.[1]) {
        cleanup();
        resolveOutput(match[1]);
      }
    };
    const exited = () => {
      cleanup();
      rejectOutput(
        new Error(`Rebase exited before it was ready. ${readError()}`),
      );
    };
    const cleanup = () => {
      clearTimeout(timeout);
      child.stdout.off("data", inspect);
      child.off("exit", exited);
    };
    child.stdout.on("data", inspect);
    child.once("exit", exited);
    inspect();
  });
}

function waitForExit(child: RunningProcess) {
  if (child.exitCode !== null || child.signalCode !== null) {
    return Promise.resolve();
  }
  return new Promise<void>((resolveExit, rejectExit) => {
    const timeout = setTimeout(() => {
      rejectExit(new Error("Timed out waiting for Rebase to stop."));
    }, 10_000);
    child.once("close", () => {
      clearTimeout(timeout);
      resolveExit();
    });
  });
}

async function listFiles(root: string, directory = ""): Promise<string[]> {
  const entries = await readdir(join(root, directory), { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const relativePath = join(directory, entry.name).replaceAll("\\", "/");
    if (entry.isDirectory()) {
      files.push(...(await listFiles(root, relativePath)));
    } else {
      files.push(relativePath);
    }
  }
  return files;
}

function run(command: string, arguments_: readonly string[], cwd: string) {
  return new Promise<CommandOutput>((resolveRun, rejectRun) => {
    const child = spawnProcess(command, arguments_, cwd);
    let stderr = "";
    let stdout = "";
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.once("error", rejectRun);
    child.once("close", (code) => {
      if (code === 0) {
        resolveRun({ stderr, stdout });
      } else {
        rejectRun(
          new Error(
            `${basename(command)} exited with ${code}.\n${stdout}${stderr}`,
          ),
        );
      }
    });
  });
}

function spawnProcess(
  command: string,
  arguments_: readonly string[],
  cwd: string,
  env: NodeJS.ProcessEnv = process.env,
): RunningProcess {
  const child = spawn(command, arguments_, {
    cwd,
    env,
    shell: process.platform === "win32" && command.endsWith(".cmd"),
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (child.stdout === null || child.stderr === null) {
    child.kill();
    throw new Error(`Could not capture output from ${command}.`);
  }
  return child as RunningProcess;
}

function hasProcessId(value: unknown): value is { readonly pid: number } {
  return (
    value !== null &&
    typeof value === "object" &&
    "pid" in value &&
    typeof value.pid === "number"
  );
}

function npmCommand() {
  return process.platform === "win32" ? "npm.cmd" : "npm";
}

function npxCommand() {
  return process.platform === "win32" ? "npx.cmd" : "npx";
}
