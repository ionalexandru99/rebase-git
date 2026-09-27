import { access, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startEnvironmentServer } from "@rebase/server";
import { Effect, Exit, Scope } from "effect";
import { afterEach, describe, expect, it } from "vite-plus/test";
import {
  type DesktopApplication,
  type DesktopApplicationHost,
  type DesktopWindowOptions,
  startDesktopApplication,
} from "#desktop/app/desktop-application";
import type { ManagedEnvironmentServer } from "#desktop/platform/environment/environment-supervisor";
import { removeTemporaryDirectory } from "#tests-support/temporary-directory";
import { connectEnvironment } from "#web/platform/environment/environment-connection";

const directories = new Set<string>();

afterEach(async () => {
  await Promise.all(
    [...directories].map((directory) => removeTemporaryDirectory(directory)),
  );
  directories.clear();
});

describe("Electron application", () => {
  it("starts one ready Environment server, loads the renderer, and stops cleanly", async () => {
    const homeDirectory = await createTemporaryDirectory();
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
          return startEnvironmentInProcess(homeDirectory);
        },
      });
      const firstWindow = host.windows[0];

      expect(firstWindow).toMatchObject({ renderer });
      expect(firstWindow?.credential).toMatch(/^rebase\.v1\./);
      expect(serverStarts).toBe(1);

      await application.activate();
      expect(host.windows).toHaveLength(1);

      host.openWindowCount = 0;
      await application.activate();
      expect(host.windows).toHaveLength(2);
      expect(host.windows[1]?.environmentOrigin).toBe(
        firstWindow?.environmentOrigin,
      );
      expect(host.windows[1]?.credential).toBe(firstWindow?.credential);
      await expect(
        Effect.runPromise(
          Effect.scoped(
            connectEnvironment(
              firstWindow?.environmentOrigin ?? "",
              { type: "bearer", value: host.windows[1]?.credential ?? "" },
              { changed: () => {} },
            ),
          ),
        ),
      ).resolves.toHaveProperty("environmentId");
      expect(serverStarts).toBe(1);

      await application.windowAllClosed();

      expect(host.quitCalls).toBe(1);
      await expect(
        fetch(firstWindow?.environmentOrigin ?? ""),
      ).rejects.toThrow();
      await expect(
        access(join(homeDirectory, ".rebase", "runtime", "runtime.json")),
      ).rejects.toMatchObject({ code: "ENOENT" });
    } finally {
      await application?.stop();
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

async function startEnvironmentInProcess(
  home: string,
): Promise<ManagedEnvironmentServer> {
  const scope = Scope.makeUnsafe();
  const server = await Effect.runPromise(
    Scope.provide(startEnvironmentServer({ home }), scope),
  );
  return {
    ...server,
    stop: () => Effect.runPromise(Scope.close(scope, Exit.void)),
  };
}

async function createTemporaryDirectory() {
  const directory = await mkdtemp(join(tmpdir(), "rebase-desktop-test-"));
  directories.add(directory);
  return directory;
}
