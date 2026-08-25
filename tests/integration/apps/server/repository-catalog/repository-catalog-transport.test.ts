import { execFile } from "node:child_process";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { createEnvironmentAuthorization } from "@rebase/server/features/environment-authorization/environment-authorization";
import { createEnvironmentEventPublisher } from "@rebase/server/features/environment-connection/events/environment-event-publisher";
import { createEnvironmentFilesystem } from "@rebase/server/features/environment-filesystem/environment-filesystem";
import { acquireEnvironmentListener } from "@rebase/server/features/environment-server/server/environment-listener";
import { createRepositoryCatalog } from "@rebase/server/features/repository-catalog/repository-catalog";
import { acquireEnvironmentContext } from "@rebase/server/persistence/environment-context";
import { environmentPaths } from "@rebase/server/persistence/storage/environment-paths";
import { exchangeEnvironmentPairing } from "@rebase/web/features/environment-connection";
import {
  EnvironmentFilesystemRejected,
  listEnvironmentDirectory,
} from "@rebase/web/features/environment-filesystem";
import {
  listEnvironmentRepositories,
  RepositoryCatalogRejected,
  recordEnvironmentRepositoryOpened,
  rememberEnvironmentRepository,
  removeEnvironmentRepository,
} from "@rebase/web/features/repository-catalog";
import { Effect } from "effect";
import { afterEach, describe, expect, it } from "vite-plus/test";

const execFilePromise = promisify(execFile);
const directories = new Set<string>();
const environmentId = "00000000-0000-4000-8000-000000000001";

afterEach(async () => {
  await Promise.all(
    [...directories].map((directory) =>
      rm(directory, { force: true, recursive: true }),
    ),
  );
  directories.clear();
});

describe("repository catalog transport", () => {
  it("lists and records opens for readers while writes require repository.write", async () => {
    await withCatalogListener(async ({ authorization, origin, root }) => {
      const repositoryPath = join(root, "repository");
      await createRepository(repositoryPath);
      const owner = await pair(origin, authorization, "owner");
      const viewer = await pair(origin, authorization, "viewer");

      const remembered = await rememberEnvironmentRepository(
        origin,
        owner,
        repositoryPath,
      );
      await expect(
        listEnvironmentRepositories(origin, viewer),
      ).resolves.toEqual([remembered]);
      const opened = await recordEnvironmentRepositoryOpened(
        origin,
        viewer,
        remembered.id,
      );
      expect(opened.lastOpenedAt >= remembered.lastOpenedAt).toBe(true);

      await expect(
        removeEnvironmentRepository(origin, viewer, remembered.id),
      ).rejects.toEqual(
        new RepositoryCatalogRejected({
          failure: {
            _tag: "CapabilityDenied",
            capability: "repository.write",
          },
          status: 403,
        }),
      );
      await expect(
        removeEnvironmentRepository(origin, owner, remembered.id),
      ).resolves.toEqual({
        repositoryId: remembered.id,
      });
      await expect(
        listEnvironmentRepositories(origin, viewer),
      ).resolves.toEqual([]);
    });
  });

  it("returns typed path and missing-entry failures", async () => {
    await withCatalogListener(async ({ authorization, origin, root }) => {
      const owner = await pair(origin, authorization, "owner");

      await expect(
        rememberEnvironmentRepository(origin, owner, join(root, "missing")),
      ).rejects.toEqual(
        new RepositoryCatalogRejected({
          failure: {
            _tag: "RepositoryPathRejected",
            reason: "NotFound",
          },
          status: 404,
        }),
      );
      const missingId = "00000000-0000-4000-8000-000000000099";
      await expect(
        recordEnvironmentRepositoryOpened(origin, owner, missingId),
      ).rejects.toEqual(
        new RepositoryCatalogRejected({
          failure: { _tag: "RepositoryMissing", repositoryId: missingId },
          status: 404,
        }),
      );
    });
  });

  it("browses server directories for owners without exposing them to viewers", async () => {
    await withCatalogListener(async ({ authorization, origin, root }) => {
      await mkdir(join(root, "projects"));
      await writeFile(join(root, "notes.md"), "notes");
      const owner = await pair(origin, authorization, "owner");
      const viewer = await pair(origin, authorization, "viewer");

      const listing = await listEnvironmentDirectory(origin, owner);

      expect(listing.path).toBe(root);
      expect(listing.entries).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ kind: "Folder", name: "projects" }),
          expect.objectContaining({ kind: "Markdown", name: "notes.md" }),
        ]),
      );
      await expect(
        listEnvironmentDirectory(origin, viewer, root),
      ).rejects.toEqual(
        new EnvironmentFilesystemRejected({
          failure: {
            _tag: "CapabilityDenied",
            capability: "repository.write",
          },
          status: 403,
        }),
      );
    });
  });
});

function withCatalogListener(
  use: (fixture: CatalogListenerFixture) => Promise<void>,
) {
  return Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const root = yield* Effect.promise(createTemporaryDirectory);
        const context = yield* acquireEnvironmentContext(
          environmentPaths(join(root, ".rebase")),
        );
        const authorization = createEnvironmentAuthorization(
          context,
          context.serverSecret,
        );
        const listener = yield* acquireEnvironmentListener({
          authorization,
          catalog: createRepositoryCatalog(context),
          environmentId,
          events: createEnvironmentEventPublisher(),
          filesystem: createEnvironmentFilesystem(root),
          productVersion: "0.0.0",
        });
        listener.readiness.value = true;
        yield* Effect.promise(() =>
          use({ authorization, origin: listener.origin, root }),
        );
      }),
    ),
  );
}

async function pair(
  origin: string,
  authorization: ReturnType<typeof createEnvironmentAuthorization>,
  role: "owner" | "viewer",
) {
  const pairing = await Effect.runPromise(
    authorization.createPairing({ capabilities: [], role }),
  );
  return (
    await exchangeEnvironmentPairing(origin, {
      label: `${role} browser`,
      pairingMaterial: pairing.material,
    })
  ).credential;
}

async function createRepository(path: string) {
  await mkdir(path, { recursive: true });
  await git(path, "init", "-b", "main");
  await git(
    path,
    "-c",
    "user.name=Rebase test",
    "-c",
    "user.email=rebase@example.test",
    "commit",
    "--allow-empty",
    "-m",
    "initial",
  );
}

async function git(path: string, ...arguments_: string[]) {
  await execFilePromise("git", ["-C", path, ...arguments_]);
}

async function createTemporaryDirectory() {
  const directory = await mkdtemp(join(tmpdir(), "rebase catalog transport "));
  directories.add(directory);
  return realpath(directory);
}

interface CatalogListenerFixture {
  readonly authorization: ReturnType<typeof createEnvironmentAuthorization>;
  readonly origin: string;
  readonly root: string;
}
