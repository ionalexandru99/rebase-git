import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { _electron as electron, expect, test } from "@playwright/test";

test("pairs the packaged renderer with its managed Environment", async () => {
  const packageMetadata = JSON.parse(
    await readFile("package.json", "utf8"),
  ) as {
    readonly version: string;
  };
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
      await window.getByRole("button", { name: "Settings" }).click();
      await expect(
        window.getByText(packageMetadata.version, { exact: true }),
      ).toBeVisible();
      await expect(
        window.getByRole("combobox", { name: "Release channel" }),
      ).toBeEnabled();
      await expect(
        window.getByRole("switch", { name: "Check automatically" }),
      ).toBeEnabled();
      await expect(
        window.getByRole("button", { name: "Update now" }),
      ).toBeVisible();
    } finally {
      await application.close();
    }
  } finally {
    await rm(testHome, { force: true, recursive: true });
  }
});
