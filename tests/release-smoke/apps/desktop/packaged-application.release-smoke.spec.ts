import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { _electron as electron, expect, test } from "@playwright/test";

test("launches the packaged application with its product identity", async () => {
  const packageMetadata = JSON.parse(
    await readFile("package.json", "utf8"),
  ) as {
    readonly version: string;
  };
  const testHome = await mkdtemp(join(tmpdir(), "rebase-release-smoke-"));
  const environment = createTestEnvironment(testHome);

  try {
    const application = await launchPackagedApplication(environment);
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
    } finally {
      await application.close();
    }
  } finally {
    await rm(testHome, { force: true, recursive: true });
  }
});

function createTestEnvironment(testHome: string) {
  const environment = Object.fromEntries(
    Object.entries(process.env).filter(
      (entry): entry is [string, string] => entry[1] !== undefined,
    ),
  );
  environment.APPDATA = join(testHome, "AppData", "Roaming");
  environment.HOME = testHome;
  environment.LOCALAPPDATA = join(testHome, "AppData", "Local");
  environment.USERPROFILE = testHome;
  environment.XDG_CONFIG_HOME = testHome;
  delete environment.ELECTRON_RUN_AS_NODE;
  return environment;
}

function launchPackagedApplication(environment: Record<string, string>) {
  return electron.launch({
    args: ["--headless", "--disable-gpu", "--no-sandbox"],
    env: environment,
    executablePath: packagedExecutable(),
  });
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
