import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { _electron as electron, expect, test } from "@playwright/test";

const executable = process.env.REBASE_PACKAGED_EXECUTABLE;

test.skip(
  executable === undefined,
  "A packaged Electron executable is required.",
);

test("loads and persists updater settings in the packaged application", async () => {
  const packageMetadata = JSON.parse(
    await readFile("package.json", "utf8"),
  ) as {
    readonly version: string;
  };
  const testHome = await mkdtemp(join(tmpdir(), "rebase-packaged-e2e-"));
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
    const firstApplication = await launchPackagedApplication(environment);
    try {
      const window = await firstApplication.firstWindow();
      await window.getByRole("button", { name: "Settings" }).click();
      await expect(
        window.getByText(packageMetadata.version, { exact: true }),
      ).toBeVisible();
      const releaseChannel = window.getByRole("combobox", {
        name: "Release channel",
      });
      await expect(releaseChannel).toBeEnabled();
      await releaseChannel.click();
      await window.getByRole("option", { name: "Nightly" }).click();
      await expect(releaseChannel).toHaveText("Nightly");
      await expect(
        window.getByRole("button", { name: "Check for updates" }),
      ).toBeDisabled();
      await expect(
        window.getByText("Updates are unavailable for this installation."),
      ).toBeVisible();
    } finally {
      await firstApplication.close();
    }

    const secondApplication = await launchPackagedApplication(environment);
    try {
      const window = await secondApplication.firstWindow();
      await window.getByRole("button", { name: "Settings" }).click();
      await expect(
        window.getByRole("combobox", { name: "Release channel" }),
      ).toHaveText("Nightly");
    } finally {
      await secondApplication.close();
    }
  } finally {
    await rm(testHome, { force: true, recursive: true });
  }
});

function launchPackagedApplication(environment: Record<string, string>) {
  return electron.launch({
    args: ["--headless", "--disable-gpu", "--no-sandbox"],
    env: environment,
    executablePath: resolve(executable ?? ""),
  });
}
