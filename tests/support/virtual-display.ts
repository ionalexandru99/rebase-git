import { type ChildProcessByStdio, spawn } from "node:child_process";
import type { Readable } from "node:stream";
import { test } from "@playwright/test";

export function runOnVirtualDisplay() {
  if (process.platform !== "linux") return;
  let server: ChildProcessByStdio<null, Readable, null> | undefined;
  test.beforeAll(async () => {
    server = spawn(
      "Xvfb",
      ["-displayfd", "1", "-screen", "0", "1920x1080x24", "-nolisten", "tcp"],
      { stdio: ["ignore", "pipe", "ignore"] },
    );
    process.env.DISPLAY = await displayOf(server);
    delete process.env.WAYLAND_DISPLAY;
  });
  test.afterAll(() => {
    server?.kill();
  });
}

function displayOf(server: ChildProcessByStdio<null, Readable, null>) {
  return new Promise<string>((resolve, reject) => {
    let output = "";
    server.once("error", (error) =>
      reject(
        new Error(
          `Desktop tests run on a virtual display and need Xvfb installed: ${error.message}`,
        ),
      ),
    );
    server.once("exit", (code) =>
      reject(
        new Error(`Xvfb exited with code ${code} before opening a display.`),
      ),
    );
    server.stdout.on("data", (chunk: Buffer) => {
      output += chunk.toString();
      const line = output.split("\n", 2);
      if (line.length === 2) resolve(`:${line[0]?.trim()}`);
    });
  });
}
