import { mkdtemp, readdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vite-plus/test";
import { createApplicationUpdateSettingsStore } from "#desktop/features/application-updates/application-update-settings-store";
import { removeTemporaryDirectory } from "#tests-support/temporary-directory";

describe("application update settings store", () => {
  let directory: string | undefined;

  afterEach(async () => {
    if (directory !== undefined) {
      await removeTemporaryDirectory(directory);
    }
  });

  it("keeps concurrent writes atomic", async () => {
    directory = await mkdtemp(join(tmpdir(), "rebase-update-settings-"));
    const path = join(directory, "update-settings.json");
    const store = createApplicationUpdateSettingsStore(path);
    const settings = [
      { checkAutomatically: false, releaseChannel: "stable" as const },
      { checkAutomatically: true, releaseChannel: "nightly" as const },
    ];

    await Promise.all(settings.map(store.write));

    expect(await store.read()).toEqual(settings.at(-1));
    expect(JSON.parse(await readFile(path, "utf8"))).toBeDefined();
    expect(await readdir(directory)).toEqual(["update-settings.json"]);
  });

  it("recovers from malformed settings", async () => {
    directory = await mkdtemp(join(tmpdir(), "rebase-update-settings-"));
    const path = join(directory, "update-settings.json");
    const store = createApplicationUpdateSettingsStore(path);
    await writeFile(path, "not json", "utf8");

    await expect(store.read()).resolves.toEqual({
      checkAutomatically: true,
      releaseChannel: "stable",
    });
  });
});
