import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { _electron as electron, expect, test } from "@playwright/test";

test("pairs the packaged renderer with its managed Environment", async () => {
  const testHome = await mkdtemp(join(tmpdir(), "rebase-electron-e2e-"));
  const environment = Object.fromEntries(
    Object.entries(process.env).filter(
      (entry): entry is [string, string] => entry[1] !== undefined,
    ),
  );
  environment.HOME = testHome;
  environment.USERPROFILE = testHome;
  environment.XDG_CONFIG_HOME = testHome;
  delete environment.ELECTRON_RUN_AS_NODE;

  try {
    const application = await electron.launch({
      args: [
        resolve("src/apps/desktop/dist/package/main.js"),
        "--headless",
        "--disable-gpu",
        "--no-sandbox",
      ],
      env: environment,
    });

    try {
      const window = await application.firstWindow();

      await expect(window.getByRole("status")).toHaveAttribute(
        "data-connection-state",
        "Connected",
      );
    } finally {
      await application.close();
    }
  } finally {
    await rm(testHome, { force: true, recursive: true });
  }
});
