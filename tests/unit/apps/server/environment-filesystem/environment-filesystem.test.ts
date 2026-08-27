import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { currentTransportLimits } from "@rebase/contracts";
import { createEnvironmentFilesystem } from "@rebase/server/features/environment-filesystem/environment-filesystem";
import { Effect } from "effect";
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

describe("Environment filesystem", () => {
  it("lists the configured home with folders first and plain file kinds", async () => {
    const root = await createTemporaryDirectory();
    await mkdir(join(root, "workbench"));
    await mkdir(join(root, "docs"));
    await mkdir(join(root, ".hidden"));
    await writeFile(join(root, "notes.md"), "notes");
    await writeFile(join(root, "architecture.pdf"), "pdf");
    const filesystem = createEnvironmentFilesystem(root);

    const listing = await Effect.runPromise(filesystem.listDirectory());

    expect(listing.path).toBe(root);
    expect(listing.parentPath).toBeDefined();
    expect(
      listing.entries.map(({ kind, name, type }) => ({ kind, name, type })),
    ).toEqual([
      { kind: "Folder", name: "docs", type: "directory" },
      { kind: "Folder", name: "workbench", type: "directory" },
      { kind: "PDF", name: "architecture.pdf", type: "file" },
      { kind: "Markdown", name: "notes.md", type: "file" },
    ]);
    expect(listing.breadcrumbs.at(-1)).toEqual({
      name: basename(root),
      path: root,
    });
    expect(listing.breadcrumbs[0]?.name).not.toBe("/");
  });

  it("includes hidden entries only when requested", async () => {
    const root = await createTemporaryDirectory();
    await mkdir(join(root, ".hidden"));
    const filesystem = createEnvironmentFilesystem(root);

    await expect(
      Effect.runPromise(filesystem.listDirectory()),
    ).resolves.toMatchObject({
      entries: [],
    });
    await expect(
      Effect.runPromise(filesystem.listDirectory(undefined, true)),
    ).resolves.toMatchObject({
      entries: [expect.objectContaining({ name: ".hidden" })],
    });
  });

  it("keeps large listings within the HTTP response limit", async () => {
    const root = await createTemporaryDirectory();
    await Promise.all(
      Array.from({ length: 520 }, (_, index) =>
        writeFile(
          join(root, `${String(index).padStart(3, "0")}-${"x".repeat(180)}.md`),
          "notes",
        ),
      ),
    );
    const filesystem = createEnvironmentFilesystem(root);

    const listing = await Effect.runPromise(filesystem.listDirectory());

    expect(listing.truncated).toBe(true);
    expect(listing.entries).toHaveLength(500);
    expect(Buffer.byteLength(JSON.stringify(listing))).toBeLessThanOrEqual(
      currentTransportLimits.maxHttpResponseBytes,
    );
  });

  it("returns typed failures for malformed and missing paths", async () => {
    const root = await createTemporaryDirectory();
    const filesystem = createEnvironmentFilesystem(root);

    await expect(
      Effect.runPromise(filesystem.listDirectory("relative")),
    ).rejects.toMatchObject({
      failure: {
        _tag: "EnvironmentDirectoryRejected",
        reason: "MalformedPath",
      },
    });
    await expect(
      Effect.runPromise(filesystem.listDirectory(join(root, "missing"))),
    ).rejects.toMatchObject({
      failure: {
        _tag: "EnvironmentDirectoryRejected",
        reason: "NotFound",
      },
    });
  });
});

async function createTemporaryDirectory() {
  const directory = await mkdtemp(join(tmpdir(), "rebase filesystem "));
  directories.add(directory);
  return realpath(directory);
}
