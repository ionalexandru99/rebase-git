import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  EnvironmentFilesystemHttpApi,
  RepositoryCatalogHttpApi,
} from "@rebase/contracts";
import { describe, expect, it } from "vite-plus/test";
import { createRepository } from "#tests-support/git";
import { openTestServer } from "#tests-support/server";

describe("repository catalog transport", () => {
  it("remembers, lists, records opens and removes repositories", async () => {
    const server = await openTestServer();
    const repositoryPath = join(server.home, "repository");
    await createRepository(repositoryPath);
    const owner = server.requests(server.owner);
    const device = server.requests(await server.pair("Second browser"));

    const remembered = await owner(RepositoryCatalogHttpApi.remember, {
      path: repositoryPath,
    });
    await expect(
      device(RepositoryCatalogHttpApi.list, undefined),
    ).resolves.toEqual({ repositories: [remembered] });
    const opened = await device(RepositoryCatalogHttpApi.recordOpened, {
      repositoryId: remembered.id,
    });
    expect(opened.lastOpenedAt >= remembered.lastOpenedAt).toBe(true);

    await expect(
      device(RepositoryCatalogHttpApi.remove, { repositoryId: remembered.id }),
    ).resolves.toEqual({ repositoryId: remembered.id });
    await expect(
      owner(RepositoryCatalogHttpApi.list, undefined),
    ).resolves.toEqual({ repositories: [] });
  });

  it("returns typed path and missing-entry failures", async () => {
    const server = await openTestServer();
    const owner = server.requests(server.owner);

    await expect(
      owner(RepositoryCatalogHttpApi.remember, {
        path: join(server.home, "missing"),
      }),
    ).rejects.toMatchObject({
      _tag: "EnvironmentHttpRejected",
      failure: { _tag: "RepositoryPathRejected", reason: "NotFound" },
    });
    await expect(
      owner(RepositoryCatalogHttpApi.recordOpened, {
        repositoryId: "00000000-0000-4000-8000-000000000099",
      }),
    ).rejects.toMatchObject({
      _tag: "EnvironmentHttpRejected",
      failure: {
        _tag: "RepositoryRejected",
        reason: "Missing",
        detail: "This repository is no longer available.",
      },
    });
  });

  it("browses server directories", async () => {
    const server = await openTestServer();
    await mkdir(join(server.home, "projects"));
    await writeFile(join(server.home, "notes.md"), "notes");

    const listing = await server.requests(server.owner)(
      EnvironmentFilesystemHttpApi.listDirectory,
      { path: server.home },
    );

    expect(listing.path).toBe(server.home);
    expect(listing.entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "Folder", name: "projects" }),
        expect.objectContaining({ kind: "Markdown", name: "notes.md" }),
      ]),
    );
  });
});
