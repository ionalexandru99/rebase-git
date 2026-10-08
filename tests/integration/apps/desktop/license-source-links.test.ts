import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { licenseSourceLinks } from "#desktop/platform/renderer-trust.ts";
import { thirdPartyLicense } from "#tests-support/fixtures.ts";
import { removeTemporaryDirectory } from "#tests-support/temporary-directory.ts";

vi.mock("electron", () => ({ BrowserWindow: {} }));

describe("license source links", () => {
  let directory: string | undefined;

  afterEach(async () => {
    if (directory !== undefined) await removeTemporaryDirectory(directory);
  });

  it("opens only the source links of the shipped licenses", async () => {
    directory = await mkdtemp(join(tmpdir(), "rebase-licenses-"));
    await writeFile(
      join(directory, "third-party-licenses.json"),
      JSON.stringify([
        thirdPartyLicense(),
        thirdPartyLicense({ name: "font", sourceUrl: null }),
      ]),
    );

    const links = await licenseSourceLinks({
      type: "file",
      path: join(directory, "index.html"),
    });

    expect([...links]).toEqual(["https://github.com/facebook/react"]);
  });
});
