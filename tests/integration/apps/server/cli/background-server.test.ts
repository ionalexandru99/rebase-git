import { spawn } from "node:child_process";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vite-plus/test";
import { startEnvironmentServer } from "#server/app/server/start-environment-server.ts";
import { exchangePairing } from "#tests-support/server.ts";
import { removeTemporaryDirectory } from "#tests-support/temporary-directory.ts";

const cliPath = resolve("src/apps/server/cli.ts");
const homes = new Set<string>();

afterEach(async () => {
  for (const home of homes) {
    await runCli(home, ["stop"]);
    await removeTemporaryDirectory(home);
  }
  homes.clear();
});

describe("rebase", () => {
  it("starts one background server, reuses it for new pairings and stops it", async () => {
    const home = await mkdtemp(join(tmpdir(), "rebase cli șț "));
    homes.add(home);
    await expect(runCli(home, ["status"])).resolves.toMatchObject({
      code: 1,
      stdout: "Rebase is not running.\n",
    });

    const started = await runCli(home, []);
    expect(started.code).toBe(0);
    const startedPairing = pairingUrl(started.stdout);
    const status = await runCli(home, ["status"]);
    expect(status.code).toBe(0);
    expect(status.stdout).toContain(`URL: ${new URL(startedPairing).origin}\n`);
    const pid = processId(status.stdout);

    const reused = await runCli(home, ["open"]);
    const reusedPairing = pairingUrl(reused.stdout);
    expect(reusedPairing).not.toBe(startedPairing);
    await expect(
      exchangePairing(new URL(reusedPairing).origin, reusedPairing, "CLI"),
    ).resolves.toMatchObject({ type: "bearer" });
    expect(processId((await runCli(home, ["status"])).stdout)).toBe(pid);

    await expect(runCli(home, ["stop"])).resolves.toMatchObject({
      code: 0,
      stdout: `Stopped Rebase (PID ${pid}).\n`,
    });
    await expect(runCli(home, ["status"])).resolves.toMatchObject({ code: 1 });
  });

  it("leaves a server without a shutdown endpoint to the desktop app", async () => {
    const home = await mkdtemp(join(tmpdir(), "rebase cli desktop "));
    homes.add(home);
    const server = await startEnvironmentServer({ home });
    try {
      await expect(runCli(home, ["stop"])).resolves.toMatchObject({
        code: 1,
        stdout: `The Rebase desktop app is running the server (PID ${process.pid}). Quit the desktop app to stop it.\n`,
      });
      await expect(runCli(home, ["status"])).resolves.toMatchObject({
        code: 0,
      });
    } finally {
      await server.close();
    }
  });
});

function pairingUrl(stdout: string) {
  const url = stdout.match(
    /^Pairing URL: (http:\/\/localhost:\d+\/pair#\S+)$/m,
  )?.[1];
  if (url === undefined) throw new Error(`No pairing URL in:\n${stdout}`);
  return url;
}

function processId(stdout: string) {
  return Number(stdout.match(/^PID: (\d+)$/m)?.[1]);
}

function runCli(home: string, arguments_: readonly string[]) {
  const child = spawn(process.execPath, [cliPath, ...arguments_], {
    env: { ...process.env, BROWSER: "none", HOME: home, USERPROFILE: home },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => {
    stdout += chunk.toString();
  });
  child.stderr.on("data", (chunk) => {
    stderr += chunk.toString();
  });
  return new Promise<{ code: number | null; stderr: string; stdout: string }>(
    (resolveRun, rejectRun) => {
      child.once("error", rejectRun);
      child.once("close", (code) => resolveRun({ code, stderr, stdout }));
    },
  );
}
