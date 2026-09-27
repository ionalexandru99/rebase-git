import { spawn } from "node:child_process";

export default async function virtualDisplay() {
  if (process.platform !== "linux") return;
  const server = spawn(
    "Xvfb",
    ["-displayfd", "1", "-screen", "0", "1920x1080x24", "-nolisten", "tcp"],
    { stdio: ["ignore", "pipe", "ignore"] },
  );
  const display = await new Promise<string>((resolve, reject) => {
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
    server.stdout.once("data", (chunk: Buffer) =>
      resolve(`:${chunk.toString().trim()}`),
    );
  });
  process.env.DISPLAY = display;
  delete process.env.WAYLAND_DISPLAY;
  return () => {
    server.kill();
  };
}
