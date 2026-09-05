import {
  type ChildProcessWithoutNullStreams,
  execFile,
  spawn,
} from "node:child_process";
import { once } from "node:events";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { promisify } from "node:util";
import {
  type CDPSession,
  expect,
  type Page,
  test,
  type WebSocketRoute,
} from "@playwright/test";
import { WebSocketServer } from "ws";
import { assertTimingBudget } from "#tests-performance/timing-budget";

const execFileAsync = promisify(execFile);
const cliPath = resolve("src/apps/server/cli.ts");
const megabitsPerSecond = 20;
const networkBytesPerSecond = (megabitsPerSecond * 1_000_000) / 8;

const scenarios = [
  {
    firstContentLimit: 250,
    correctedContentLimit: 500,
    latency: 0,
    name: "localhost",
  },
  {
    firstContentLimit: 450,
    correctedContentLimit: 700,
    latency: 80,
    name: "80ms-rtt-20mbps",
  },
] as const;

for (const scenario of scenarios) {
  test(`${scenario.name} commit graph budgets`, async ({ context }) => {
    const samples: Awaited<ReturnType<typeof measureCommitGraph>>[] = [];
    for (let sample = 1; sample <= 3; sample += 1) {
      const page = await context.newPage();
      try {
        samples.push(await measureCommitGraph(page, scenario, sample));
      } finally {
        await page.close();
      }
    }
    const timing = (
      metric: keyof (typeof samples)[number],
      targetMilliseconds: number,
    ) =>
      assertTimingBudget(
        `${scenario.name} ${metric}`,
        samples.map((sample) => sample[metric]),
        targetMilliseconds,
      );
    timing("firstContentMilliseconds", scenario.firstContentLimit);
    timing("openingFeedbackMilliseconds", 50);
    timing("selectionFeedbackMilliseconds", 50);
    timing("scopeFeedbackMilliseconds", 100);
    timing("uncachedScopeFeedbackMilliseconds", scenario.firstContentLimit);
    timing("postGitRenderMilliseconds", 100);
    timing("correctedContentMilliseconds", scenario.correctedContentLimit);
    timing("frameWorkP95Milliseconds", 8.3);
    timing("frameWorkP99Milliseconds", 16.7);
  });
}

async function measureCommitGraph(
  page: Page,
  scenario: (typeof scenarios)[number],
  sample: number,
) {
  const testHome = await mkdtemp(join(tmpdir(), "rebase-performance-"));
  const repositoryPath = join(testHome, "rebase-performance");
  await createRepository(repositoryPath);
  const server = startServer(testHome);
  const session = await page.context().newCDPSession(page);
  let historyReads = 0;
  session.on("Network.webSocketFrameSent", ({ response }) => {
    if (response.payloadData.includes('"ReadRepositoryHistory"'))
      historyReads += 1;
  });

  try {
    const socketProfile =
      scenario.latency === 0
        ? undefined
        : await shapeGraphWebSockets(page, scenario.latency);
    const readCount = () => socketProfile?.historyReads ?? historyReads;
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
    await page.evaluate(() => window.__startGraphMeasurement());
    await page.keyboard.press("Control+Enter");
    const history = page.getByRole("grid", { name: "Commit history" });
    await page.evaluate(async () => {
      while (window.__graphMetrics.firstContent === undefined)
        await new Promise(requestAnimationFrame);
    });
    const selectionFeedback = await measureSelectionFeedback(page);
    const uncachedScopeFeedback = await measureHistoryScopeFeedback(page, true);
    const trace = await startTrace(session, sample);
    await exerciseVirtualRows(page);
    const frameWork = await trace.stop();
    await expect(history.getByRole("row").first()).toBeVisible();
    const browserMetrics = await page.evaluate(() => window.__graphMetrics);
    await measureHistoryScopeFeedback(page, false);
    const readsBeforeCachedScope = readCount();
    expect(readsBeforeCachedScope).toBeGreaterThan(0);
    const scopeFeedback = await measureHistoryScopeFeedback(page, true);
    expect(readCount()).toBe(readsBeforeCachedScope);
    const correctedContentMilliseconds = await measureCorrectedContent(
      page,
      repositoryPath,
    );
    const metrics = {
      correctedContentMilliseconds,
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
        required(browserMetrics.lastHistoryMessage),
      selectionFeedbackMilliseconds: selectionFeedback,
      scopeFeedbackMilliseconds: scopeFeedback,
      uncachedScopeFeedbackMilliseconds: uncachedScopeFeedback,
    };
    process.stdout.write(
      `${scenario.name} sample ${sample} ${JSON.stringify(metrics)}\n`,
    );
    if (socketProfile !== undefined) {
      expect(socketProfile.sent).toBeGreaterThan(0);
      expect(socketProfile.received).toBeGreaterThan(0);
      expect(socketProfile.errors).toEqual([]);
    }
    return metrics;
  } finally {
    if (server.child.exitCode === null && server.child.signalCode === null) {
      server.child.kill("SIGTERM");
      await once(server.child, "exit");
    }
    await rm(testHome, { force: true, recursive: true });
  }
}

test("calibrates WebSocket frame latency and bandwidth", async ({ page }) => {
  const profile = await shapeGraphWebSockets(page, 80);
  const http = createServer((_request, response) => {
    response.setHeader("content-type", "text/html");
    response.end("<title>Graph network calibration</title>");
  });
  const server = new WebSocketServer({ server: http });
  server.on("connection", (socket) => {
    socket.on("message", (message) => socket.send(message));
  });
  try {
    http.listen(0, "127.0.0.1");
    await once(http, "listening");
    const address = http.address();
    if (address === null || typeof address === "string")
      throw new Error("Expected TCP address");
    await page.goto(`http://127.0.0.1:${address.port}`);
    const timings = await page.evaluate(async (port) => {
      const socket = new WebSocket(`ws://127.0.0.1:${port}`);
      await new Promise((resolve, reject) => {
        socket.addEventListener("open", resolve, { once: true });
        socket.addEventListener("error", reject, { once: true });
      });
      const samples: number[] = [];
      for (const bytes of [4, 4, 256 * 1_024]) {
        const received = new Promise((resolve) =>
          socket.addEventListener("message", resolve, { once: true }),
        );
        const started = performance.now();
        socket.send(new Uint8Array(bytes));
        await received;
        samples.push(performance.now() - started);
      }
      socket.close();
      return samples;
    }, address.port);
    process.stdout.write(`WebSocket round trips ${JSON.stringify(timings)}\n`);
    expect(timings[0]).toBeGreaterThanOrEqual(80);
    expect(timings[1]).toBeGreaterThanOrEqual(80);
    expect(timings[2]).toBeGreaterThanOrEqual(
      80 + ((2 * 256 * 1_024) / networkBytesPerSecond) * 1_000,
    );
    expect(profile.errors).toEqual([]);
  } finally {
    for (const socket of server.clients) socket.terminate();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await new Promise<void>((resolve) => http.close(() => resolve()));
  }
});

async function shapeGraphWebSockets(page: Page, latency: number) {
  const frames = {
    sent: 0,
    received: 0,
    historyReads: 0,
    errors: [] as string[],
  };
  await page.routeWebSocket("**/*", (browser) => {
    const server = browser.connectToServer();
    const controller = new AbortController();
    browser.onClose(async (code, reason) => {
      controller.abort();
      await server.close({
        ...(code === undefined ? {} : { code }),
        ...(reason === undefined ? {} : { reason }),
      });
    });
    server.onClose(async (code, reason) => {
      controller.abort();
      await browser.close({
        ...(code === undefined ? {} : { code }),
        ...(reason === undefined ? {} : { reason }),
      });
    });
    const shapeDirection = (
      source: WebSocketRoute,
      target: WebSocketRoute,
      direction: "sent" | "received",
    ) => {
      let transmissionEnd = 0;
      let pending = Promise.resolve();
      source.onMessage((message) => {
        if (
          direction === "sent" &&
          typeof message === "string" &&
          message.includes('"ReadRepositoryHistory"')
        )
          frames.historyReads += 1;
        transmissionEnd =
          Math.max(performance.now(), transmissionEnd) +
          (Buffer.byteLength(message) / networkBytesPerSecond) * 1_000;
        const deliverAt = transmissionEnd + latency / 2;
        pending = pending.then(async () => {
          try {
            while (!controller.signal.aborted && performance.now() < deliverAt)
              await delay(Math.ceil(deliverAt - performance.now()), undefined, {
                signal: controller.signal,
              });
            if (!controller.signal.aborted) {
              target.send(message);
              frames[direction] += 1;
            }
          } catch (error) {
            if (!controller.signal.aborted)
              frames.errors.push(`${direction}: ${String(error)}`);
          }
        });
      });
    };
    shapeDirection(browser, server, "sent");
    shapeDirection(server, browser, "received");
  });
  return frames;
}

async function measureCorrectedContent(page: Page, repositoryPath: string) {
  const subject = "externally amended commit";
  await git(
    repositoryPath,
    "commit",
    "--amend",
    "--allow-empty",
    "-m",
    subject,
  );
  const completed = performance.now();
  await page.evaluate(async (updatedSubject) => {
    const started = performance.now();
    while (performance.now() - started < 5_000) {
      const history = document.querySelector<HTMLElement>(
        '[role="grid"][aria-label="Commit history"]',
      );
      const row = [
        ...(history?.querySelectorAll("tr[aria-rowindex]") ?? []),
      ].find((candidate) => candidate.textContent?.includes(updatedSubject));
      if (row !== undefined && history !== null) {
        const rowBounds = row.getBoundingClientRect();
        const historyBounds = history.getBoundingClientRect();
        if (
          rowBounds.height > 0 &&
          rowBounds.bottom > historyBounds.top &&
          rowBounds.top < historyBounds.bottom
        )
          return;
      }
      await new Promise(requestAnimationFrame);
    }
    throw new Error("The externally amended commit did not become visible");
  }, subject);
  return performance.now() - completed;
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
              typeof message.data === "string" &&
              message.data.includes('"_tag":"JsonMessageFragment"')
            ) {
              window.__graphMetrics.lastHistoryMessage = performance.now();
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

async function measureHistoryScopeFeedback(page: Page, include: boolean) {
  return page.evaluate(async (add) => {
    const action = add
      ? "Add feature to history"
      : "Remove feature from history";
    const completed = add
      ? "Remove feature from history"
      : "Add feature to history";
    const button = document.querySelector<HTMLButtonElement>(
      `button[aria-label="${action}"]`,
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
      document.querySelector(`button[aria-label="${completed}"]`) === null ||
      history.getAttribute("aria-busy") !== "false"
    ) {
      await new Promise(requestAnimationFrame);
    }
    return performance.now() - started;
  }, include);
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

async function startTrace(session: CDPSession, sample: number) {
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
      const path = test.info().outputPath(`renderer-trace-${sample}.json`);
      await writeFile(path, trace);
      await test.info().attach(`renderer-trace-${sample}`, {
        path,
        contentType: "application/json",
      });
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
  lastHistoryMessage?: number;
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
