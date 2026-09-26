import {
  type ChildProcessWithoutNullStreams,
  execFile,
  spawn,
} from "node:child_process";
import { once } from "node:events";
import { mkdir, mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { type Browser, chromium, expect, test } from "@playwright/test";
import { removeTemporaryDirectory } from "#tests-support/temporary-directory";

const execFileAsync = promisify(execFile);

interface PackagedApplication {
  readonly browser?: Browser;
  readonly process: ChildProcessWithoutNullStreams;
}

test("launches the packaged application with its product identity", async () => {
  const packageMetadata = JSON.parse(
    await readFile("package.json", "utf8"),
  ) as {
    readonly version: string;
  };
  const testHome = await mkdtemp(join(tmpdir(), "rebase-release-smoke-"));

  try {
    const environment = await createTestEnvironment(testHome);
    const application = await launchPackagedApplication(environment);
    try {
      const context = application.browser?.contexts()[0];
      if (context === undefined) {
        throw new Error("The packaged application did not create a context.");
      }
      const window = context.pages()[0] ?? (await context.waitForEvent("page"));
      await expect(window.getByRole("status")).toHaveAttribute(
        "data-connection-state",
        "Connected",
      );
      await window.bringToFront();
      await expect
        .poll(() =>
          window.evaluate(
            () => document.visibilityState === "visible" && document.hasFocus(),
          ),
        )
        .toBe(true);
      await window.getByRole("button", { name: "Settings" }).click();
      await expect(
        window.getByRole("navigation", { name: "Settings" }),
      ).toBeVisible();
      await expect(
        window.getByRole("heading", { level: 1, name: "General" }),
      ).toBeVisible();
      await expect(
        window.getByText(packageMetadata.version, { exact: true }),
      ).toBeVisible();
    } finally {
      await closePackagedApplication(application);
    }
  } finally {
    await removeTemporaryDirectory(testHome);
  }
});

async function createTestEnvironment(testHome: string) {
  const environment = Object.fromEntries(
    Object.entries(process.env).filter(
      (entry): entry is [string, string] => entry[1] !== undefined,
    ),
  );
  const applicationData = join(testHome, "AppData", "Roaming");
  const localApplicationData = join(testHome, "AppData", "Local");
  await Promise.all([
    mkdir(applicationData, { recursive: true }),
    mkdir(localApplicationData, { recursive: true }),
  ]);
  environment.APPDATA = applicationData;
  environment.HOME = testHome;
  environment.LOCALAPPDATA = localApplicationData;
  environment.USERPROFILE = testHome;
  environment.XDG_CONFIG_HOME = testHome;
  delete environment.ELECTRON_RUN_AS_NODE;
  return environment;
}

async function launchPackagedApplication(environment: Record<string, string>) {
  const childProcess = spawn(
    packagedExecutable(),
    ["--remote-debugging-port=0", "--disable-gpu-sandbox", "--no-sandbox"],
    {
      env: environment,
    },
  );
  const application: PackagedApplication = { process: childProcess };

  try {
    const devTools = await devToolsEndpoint(childProcess);
    reportStartup(devTools.milliseconds);
    try {
      const browser = await chromium.connectOverCDP(devTools.endpoint);
      return { browser, process: childProcess };
    } catch (error) {
      throw new Error(
        `Could not connect to the packaged application: ${errorMessage(error)}\n${devTools.output()}`,
      );
    }
  } catch (error) {
    await closePackagedApplication(application);
    throw error;
  }
}

function reportStartup(milliseconds: number) {
  const description = `${Math.round(milliseconds)} ms`;
  test.info().annotations.push({ type: "startup", description });
  console.log(
    `The packaged application printed its DevTools endpoint after ${description}.`,
  );
}

function devToolsEndpoint(childProcess: ChildProcessWithoutNullStreams) {
  const started = performance.now();
  return new Promise<{
    readonly endpoint: string;
    readonly milliseconds: number;
    readonly output: () => string;
  }>((resolveEndpoint, rejectEndpoint) => {
    let output = "";
    let settled = false;

    const read = (chunk: Buffer) => {
      if (settled) return;
      output += chunk.toString();
      process.stdout.write(chunk);
      const endpoint = /DevTools listening on (ws:\/\/\S+)/.exec(output)?.[1];
      if (endpoint !== undefined) succeed(endpoint);
    };
    const processError = (error: Error) => fail(error.message);
    const processExit = (
      code: number | null,
      signal: NodeJS.Signals | null,
    ) => {
      fail(
        `The packaged application exited before startup with code ${code} and signal ${signal}.`,
      );
    };
    const cleanUp = () => {
      childProcess.off("error", processError);
      childProcess.off("exit", processExit);
    };
    const succeed = (endpoint: string) => {
      if (settled) return;
      settled = true;
      cleanUp();
      resolveEndpoint({
        endpoint,
        milliseconds: performance.now() - started,
        output: () => output,
      });
    };
    const fail = (message: string) => {
      if (settled) return;
      settled = true;
      cleanUp();
      rejectEndpoint(new Error(`${message}\n${output}`));
    };

    childProcess.stdout.on("data", read);
    childProcess.stderr.on("data", read);
    childProcess.once("error", processError);
    childProcess.once("exit", processExit);
  });
}

async function closePackagedApplication(application: PackagedApplication) {
  await application.browser?.close().catch(() => undefined);
  if (hasExited(application.process)) return;

  const exited = once(application.process, "exit");
  if (process.platform === "win32") await forceProcessExit(application.process);
  else application.process.kill();
  await exited;
}

function hasExited(childProcess: ChildProcessWithoutNullStreams) {
  return childProcess.exitCode !== null || childProcess.signalCode !== null;
}

async function forceProcessExit(childProcess: ChildProcessWithoutNullStreams) {
  if (childProcess.pid === undefined) {
    throw new Error("The packaged application has no process identifier.");
  }
  try {
    await execFileAsync("taskkill.exe", [
      "/pid",
      childProcess.pid.toString(),
      "/t",
      "/f",
    ]);
  } catch (error) {
    if (isProcessNotFound(error) && hasExited(childProcess)) return;
    throw error;
  }
}

function isProcessNotFound(error: unknown) {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === 128
  );
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function packagedExecutable() {
  const architecture = process.arch === "arm" ? "armv7l" : process.arch;
  const architectureSuffix = architecture === "x64" ? "" : `-${architecture}`;

  switch (process.platform) {
    case "darwin":
      return resolve(
        "release",
        `mac${architectureSuffix}`,
        "Rebase.app",
        "Contents",
        "MacOS",
        "Rebase",
      );
    case "linux":
      return resolve(
        "release",
        `linux${architectureSuffix}-unpacked`,
        "rebase-git",
      );
    case "win32":
      return resolve(
        "release",
        `win${architectureSuffix}-unpacked`,
        "Rebase.exe",
      );
    default:
      throw new Error(
        `Unsupported release smoke platform: ${process.platform}`,
      );
  }
}
