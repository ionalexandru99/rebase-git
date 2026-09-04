import {
  type ChildProcessWithoutNullStreams,
  execFile,
  spawn,
} from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { type CDPSession, expect, type Page, test } from "@playwright/test";

const execFileAsync = promisify(execFile);
const cliPath = resolve("src/apps/server/cli.ts");
const megabitsPerSecond = 20;
const networkBytesPerSecond = (megabitsPerSecond * 1_024 * 1_024) / 8;

const scenarios = [
  { firstContentLimit: 250, latency: 0, name: "localhost" },
  { firstContentLimit: 450, latency: 80, name: "80ms-rtt-20mbps" },
] as const;

for (const scenario of scenarios) {
  test(`${scenario.name} commit graph budgets`, async ({ page }) => {
    const testHome = await mkdtemp(join(tmpdir(), "rebase-performance-"));
    const repositoryPath = join(testHome, "rebase-performance");
    await createRepository(repositoryPath);
    const server = startServer(testHome);
    const session = await page.context().newCDPSession(page);

    try {
      await session.send("Network.enable");
      await session.send("Network.emulateNetworkConditions", {
        connectionType: scenario.latency === 0 ? "none" : "wifi",
        downloadThroughput: scenario.latency === 0 ? -1 : networkBytesPerSecond,
        latency: scenario.latency,
        offline: false,
        uploadThroughput: scenario.latency === 0 ? -1 : networkBytesPerSecond,
      });
      await installGraphMeasurements(page);
      const pairingUrl = await server.waitForPairingUrl();
      await page.goto(pairingUrl);
      await expect(page.getByRole("status")).toHaveAttribute(
        "data-connection-state",
        "Connected",
      );
      await page.keyboard.press("Control+o");
      const picker = page.getByRole("dialog", { name: "Choose repository" });
      await picker
        .getByRole("button", { name: /^rebase-performance Folder/ })
        .click();
      const trace = await startTrace(session);
      await page.evaluate(() => window.__startGraphMeasurement());
      await page.keyboard.press("Control+Enter");
      const history = page.getByRole("grid", { name: "Commit history" });
      await expect(history.getByRole("row").first()).toBeVisible();
      const selectionFeedback = await measureSelectionFeedback(page);
      const scopeFeedback = await measureHistoryScopeFeedback(page);
      await exerciseVirtualRows(page);
      const frameWork = await trace.stop();
      const browserMetrics = await page.evaluate(() => window.__graphMetrics);
      const metrics = {
        firstContentMilliseconds:
          required(browserMetrics.firstContent) - browserMetrics.started,
        frameWorkP95Milliseconds: percentile(frameWork, 0.95),
        frameWorkP99Milliseconds: percentile(frameWork, 0.99),
        graphLoadingMilliseconds:
          required(browserMetrics.loadingFeedback) - browserMetrics.started,
        openingFeedbackMilliseconds:
          required(browserMetrics.openingFeedback) - browserMetrics.started,
        postGitRenderMilliseconds:
          required(browserMetrics.firstContent) -
          required(browserMetrics.lastBinaryMessage),
        selectionFeedbackMilliseconds: selectionFeedback,
        scopeFeedbackMilliseconds: scopeFeedback,
      };
      process.stdout.write(`${scenario.name} ${JSON.stringify(metrics)}\n`);

      expect(metrics.firstContentMilliseconds).toBeLessThanOrEqual(
        scenario.firstContentLimit,
      );
      expect(metrics.openingFeedbackMilliseconds).toBeLessThanOrEqual(50);
      expect(metrics.selectionFeedbackMilliseconds).toBeLessThanOrEqual(50);
      expect(metrics.scopeFeedbackMilliseconds).toBeLessThanOrEqual(100);
      expect(metrics.postGitRenderMilliseconds).toBeLessThanOrEqual(100);
      expect(metrics.frameWorkP95Milliseconds).toBeLessThan(8.3);
      expect(metrics.frameWorkP99Milliseconds).toBeLessThan(16.7);
    } finally {
      server.child.kill("SIGTERM");
      await rm(testHome, { force: true, recursive: true });
    }
  });
}

async function installGraphMeasurements(page: Page) {
  await page.addInitScript(() => {
    window.__graphMetrics = { started: 0 };
    window.__startGraphMeasurement = () => {
      window.__graphMetrics = { started: performance.now() };
    };
    const inspect = () => {
      const metrics = window.__graphMetrics;
      if (metrics.started === 0) {
        return;
      }
      if (
        metrics.openingFeedback === undefined &&
        Array.from(document.querySelectorAll("button")).some((button) =>
          button.textContent?.includes("Opening…"),
        )
      ) {
        metrics.openingFeedback = performance.now();
      }
      if (
        metrics.loadingFeedback === undefined &&
        document.querySelector('[aria-label="Loading commit history"]') !== null
      ) {
        metrics.loadingFeedback = performance.now();
      }
      if (
        metrics.firstContent === undefined &&
        document.querySelector("tr[aria-rowindex]") !== null
      ) {
        metrics.firstContent = performance.now();
      }
    };
    new MutationObserver(inspect).observe(document, {
      attributes: true,
      childList: true,
      subtree: true,
    });
    const wrappers = new WeakMap<EventListener, EventListener>();
    const addEventListener = WebSocket.prototype.addEventListener;
    WebSocket.prototype.addEventListener = new Proxy(addEventListener, {
      apply(target, receiver, arguments_) {
        const [type, listener] = arguments_;
        if (type === "message" && typeof listener === "function") {
          const wrapped: EventListener = function (
            this: WebSocket,
            event: Event,
          ) {
            const message = event as MessageEvent;
            if (
              window.__graphMetrics.started > 0 &&
              window.__graphMetrics.firstContent === undefined &&
              typeof message.data !== "string"
            ) {
              window.__graphMetrics.lastBinaryMessage = performance.now();
            }
            return Reflect.apply(listener, this, [message]);
          };
          wrappers.set(listener, wrapped);
          arguments_[1] = wrapped;
        }
        return Reflect.apply(target, receiver, arguments_);
      },
    });
    const removeEventListener = WebSocket.prototype.removeEventListener;
    WebSocket.prototype.removeEventListener = new Proxy(removeEventListener, {
      apply(target, receiver, arguments_) {
        const listener = arguments_[1];
        if (typeof listener === "function") {
          arguments_[1] = wrappers.get(listener) ?? listener;
        }
        return Reflect.apply(target, receiver, arguments_);
      },
    });
  });
}

async function measureSelectionFeedback(page: Page) {
  return page.evaluate(async () => {
    const options = document.querySelectorAll<HTMLElement>("tr[aria-rowindex]");
    const target = options[1];
    if (target === undefined) {
      throw new Error("The second commit row is not rendered");
    }
    const started = performance.now();
    target.click();
    while (target.getAttribute("aria-selected") !== "true") {
      await new Promise(requestAnimationFrame);
    }
    return performance.now() - started;
  });
}

async function measureHistoryScopeFeedback(page: Page) {
  return page.evaluate(async () => {
    const button = document.querySelector<HTMLButtonElement>(
      'button[aria-label="Add feature to history"]',
    );
    const history = document.querySelector<HTMLElement>(
      '[role="grid"][aria-label="Commit history"]',
    );
    if (button === null || history === null) {
      throw new Error("The history scope controls are missing");
    }
    const started = performance.now();
    button.click();
    while (
      document.querySelector(
        'button[aria-label="Remove feature from history"]',
      ) === null ||
      history.getAttribute("aria-busy") !== "false"
    ) {
      await new Promise(requestAnimationFrame);
    }
    return performance.now() - started;
  });
}

async function exerciseVirtualRows(page: Page) {
  await page.evaluate(async () => {
    const history = document.querySelector<HTMLElement>(
      '[role="grid"][aria-label="Commit history"]',
    );
    if (history === null) {
      throw new Error("Commit history is missing");
    }
    for (let frame = 0; frame < 60; frame += 1) {
      history.scrollTop = frame % 2 === 0 ? history.scrollHeight : 0;
      await new Promise(requestAnimationFrame);
    }
  });
}

async function startTrace(session: CDPSession) {
  const completed = new Promise<string>((resolveTrace, rejectTrace) => {
    session.once("Tracing.tracingComplete", async ({ stream }) => {
      try {
        if (stream === undefined) {
          throw new Error("The trace stream is missing");
        }
        let trace = "";
        while (true) {
          const chunk = await session.send("IO.read", { handle: stream });
          trace += chunk.base64Encoded
            ? Buffer.from(chunk.data, "base64").toString("utf8")
            : chunk.data;
          if (chunk.eof) {
            break;
          }
        }
        await session.send("IO.close", { handle: stream });
        resolveTrace(trace);
      } catch (error) {
        rejectTrace(error);
      }
    });
  });
  await session.send("Tracing.start", {
    categories: "devtools.timeline,toplevel",
    transferMode: "ReturnAsStream",
  });
  return {
    stop: async () => {
      await session.send("Tracing.end");
      const trace = await completed;
      const path = test.info().outputPath("renderer-trace.json");
      await writeFile(path, trace);
      await test
        .info()
        .attach("renderer-trace", { path, contentType: "application/json" });
      return frameWorkloads(JSON.parse(trace) as Trace);
    },
  };
}

function frameWorkloads(trace: Trace) {
  const mainThread = trace.traceEvents.find(
    (event) =>
      event.name === "thread_name" && event.args?.name === "CrRendererMain",
  );
  if (mainThread === undefined) {
    throw new Error("Renderer main thread is missing from the trace");
  }
  const tasks = trace.traceEvents.filter(
    (event): event is TraceEvent & { dur: number } =>
      event.name.endsWith("RunTask") &&
      event.tid === mainThread.tid &&
      event.dur !== undefined,
  );
  if (tasks.length === 0) {
    throw new Error("No renderer tasks were captured");
  }
  const frameMicroseconds = 16_667;
  const started = Math.min(...tasks.map((task) => task.ts));
  const finished = Math.max(...tasks.map((task) => task.ts + task.dur));
  const frames = Array.from(
    { length: Math.ceil((finished - started) / frameMicroseconds) + 1 },
    () => 0,
  );
  for (const task of tasks) {
    let cursor = task.ts;
    const taskEnd = task.ts + task.dur;
    while (cursor < taskEnd) {
      const index = Math.floor((cursor - started) / frameMicroseconds);
      const frameEnd = started + (index + 1) * frameMicroseconds;
      const duration = Math.min(taskEnd, frameEnd) - cursor;
      frames[index] = (frames[index] ?? 0) + duration / 1_000;
      cursor += duration;
    }
  }
  return frames;
}

function percentile(values: readonly number[], quantile: number) {
  const sorted = values.toSorted((left, right) => left - right);
  return sorted[Math.ceil(sorted.length * quantile) - 1] ?? 0;
}

function required(value: number | undefined) {
  if (value === undefined) {
    throw new Error("A required browser measurement is missing");
  }
  return value;
}

async function createRepository(path: string) {
  await mkdir(path, { recursive: true });
  await git(path, "init", "-b", "main");
  for (let index = 0; index < 100; index += 1) {
    await git(path, "commit", "--allow-empty", "-m", `commit ${index}`);
  }
  await git(path, "branch", "feature", "HEAD~50");
}

async function git(path: string, ...arguments_: string[]) {
  await execFileAsync("git", [
    "-C",
    path,
    "-c",
    "user.name=Rebase performance",
    "-c",
    "user.email=rebase-performance@example.test",
    ...arguments_,
  ]);
}

function startServer(homeDirectory: string) {
  const child = spawn(
    process.execPath,
    ["--conditions=rebase-source", cliPath, "serve"],
    {
      env: {
        ...process.env,
        BROWSER: "none",
        HOME: homeDirectory,
        USERPROFILE: homeDirectory,
      },
      stdio: ["pipe", "pipe", "pipe"],
    },
  );
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => {
    stdout += chunk.toString();
  });
  child.stderr.on("data", (chunk) => {
    stderr += chunk.toString();
  });
  return {
    child,
    waitForPairingUrl: () =>
      waitForOutput(
        child,
        () => stdout.match(/^Pairing URL: (http:\/\/\S+)$/m)?.[1],
        () => stderr,
      ),
  };
}

function waitForOutput(
  child: ChildProcessWithoutNullStreams,
  read: () => string | undefined,
  readError: () => string,
) {
  return new Promise<string>((resolveOutput, rejectOutput) => {
    const timeout = setTimeout(() => {
      cleanup();
      rejectOutput(new Error("Timed out waiting for server output."));
    }, 15_000);
    const inspect = () => {
      const output = read();
      if (output !== undefined) {
        cleanup();
        resolveOutput(output);
      }
    };
    const exited = () => {
      cleanup();
      rejectOutput(new Error(`Server exited before ready. ${readError()}`));
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

interface GraphMetrics {
  firstContent?: number;
  lastBinaryMessage?: number;
  loadingFeedback?: number;
  openingFeedback?: number;
  started: number;
}

interface Trace {
  readonly traceEvents: readonly TraceEvent[];
}

interface TraceEvent {
  readonly args?: { readonly name?: string };
  readonly dur?: number;
  readonly name: string;
  readonly tid: number;
  readonly ts: number;
}

declare global {
  interface Window {
    __graphMetrics: GraphMetrics;
    __startGraphMeasurement: () => void;
  }
}
