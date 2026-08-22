import { access, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  type DesktopApplication,
  type DesktopApplicationHost,
  type DesktopWindowOptions,
  startDesktopApplication,
  startManagedEnvironmentServer,
} from "@rebase/desktop";
import { afterEach, describe, expect, it } from "vite-plus/test";

const directories = new Set<string>();

afterEach(async () => {
  await Promise.all(
    [...directories].map((directory) =>
      rm(directory, { force: true, recursive: true }),
    ),
  );
  directories.clear();
});

describe("Electron application", () => {
  it("starts one ready Environment server, loads the renderer, and stops cleanly", async () => {
    const homeDirectory = await createTemporaryDirectory();
    const previousHome = process.env.HOME;
    const previousUserProfile = process.env.USERPROFILE;
    process.env.HOME = homeDirectory;
    process.env.USERPROFILE = homeDirectory;
    let application: DesktopApplication | undefined;

    try {
      const renderer = {
        type: "url" as const,
        url: "http://127.0.0.1:4173",
      };
      const host = new TestDesktopHost();
      let serverStarts = 0;
      application = await startDesktopApplication({
        host,
        renderer,
        startEnvironment: async () => {
          serverStarts += 1;
          return startManagedEnvironmentServer();
        },
      });
      const firstWindow = host.windows[0];

      expect(firstWindow).toMatchObject({ renderer });
      expect(firstWindow?.pairingMaterial).toMatch(/^\d{3}-\d{3}$/);
      expect(serverStarts).toBe(1);
      await expect(
        fetch(`${firstWindow?.environmentOrigin}/health`),
      ).resolves.toMatchObject({ status: 200 });

      await application.activate();
      expect(host.windows).toHaveLength(1);

      host.openWindowCount = 0;
      await application.activate();
      expect(host.windows).toHaveLength(2);
      expect(host.windows[1]?.environmentOrigin).toBe(
        firstWindow?.environmentOrigin,
      );
      expect(host.windows[1]?.pairingMaterial).toBe(
        firstWindow?.pairingMaterial,
      );
      expect(serverStarts).toBe(1);

      await application.windowAllClosed();

      expect(host.quitCalls).toBe(1);
      await expect(
        fetch(`${firstWindow?.environmentOrigin}/health`),
      ).rejects.toThrow();
      await expect(
        access(join(homeDirectory, ".rebase", "runtime", "runtime.json")),
      ).rejects.toMatchObject({ code: "ENOENT" });
    } finally {
      try {
        await application?.stop();
      } finally {
        restoreEnvironmentVariable("HOME", previousHome);
        restoreEnvironmentVariable("USERPROFILE", previousUserProfile);
      }
    }
  });
});

class TestDesktopHost implements DesktopApplicationHost {
  readonly platform = "linux";
  readonly windows: DesktopWindowOptions[] = [];
  openWindowCount = 0;
  quitCalls = 0;

  hasOpenWindows() {
    return this.openWindowCount > 0;
  }

  openWindow(options: DesktopWindowOptions) {
    this.windows.push(options);
    this.openWindowCount += 1;
  }

  quit() {
    this.quitCalls += 1;
  }
}

async function createTemporaryDirectory() {
  const directory = await mkdtemp(join(tmpdir(), "rebase-desktop-test-"));
  directories.add(directory);
  return directory;
}

function restoreEnvironmentVariable(name: string, value: string | undefined) {
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
}
