import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createEnvironmentRequestClient,
  type EnvironmentCredential,
} from "@rebase/environment-client";
import { Effect } from "effect";
import { afterEach, describe, expect, it } from "vite-plus/test";
import { createEnvironmentEventPublisher } from "#server/adapters/environment-transport/events/environment-event-publisher";
import { createLocalGitCommandRunner } from "#server/adapters/local-git/local-git-command-runner";
import { acquireEnvironmentListener } from "#server/app/server/environment-listener";
import { EnvironmentAuthorizationAccess } from "#server/domain/environment-authorization.contract";
import { RepositoryCatalogAccess } from "#server/domain/repository-catalog.contract";
import {
  createEnvironmentAuthorization,
  environmentAuthorizationFeature,
} from "#server/features/environment-authorization/index";
import { environmentFilesystemFeature } from "#server/features/environment-filesystem/index";
import {
  createRepositoryCatalog,
  repositoryCatalogFeature,
} from "#server/features/repository-catalog/index";
import { acquireEnvironmentContext } from "#server/persistence/environment-context";
import { environmentPaths } from "#server/persistence/storage/environment-paths";
import { testEnvironmentFeatures } from "#tests-integration/apps/server/environment-connection/test-environment-features";
import { createRepository } from "#tests-support/git";
import { exchangeEnvironmentPairingEffect } from "#web/app/environment/connection/index";
import {
  EnvironmentFilesystemRejected,
  environmentFilesystemClient,
} from "#web/features/environment-filesystem/index";
import {
  RepositoryCatalogRejected,
  repositoryCatalogClient,
} from "#web/features/repository-catalog/index";

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

      const remembered = await Effect.runPromise(
        catalog(origin, owner).remember({ path: repositoryPath }),
      );
      await expect(
        Effect.runPromise(catalog(origin, viewer).list()),
      ).resolves.toEqual({ repositories: [remembered] });
      const opened = await Effect.runPromise(
        catalog(origin, viewer).recordOpened({ repositoryId: remembered.id }),
      );
      expect(opened.lastOpenedAt >= remembered.lastOpenedAt).toBe(true);

      await expect(
        Effect.runPromise(
          catalog(origin, viewer).remove({ repositoryId: remembered.id }),
        ),
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
        Effect.runPromise(
          catalog(origin, owner).remove({ repositoryId: remembered.id }),
        ),
      ).resolves.toEqual({
        repositoryId: remembered.id,
      });
      await expect(
        Effect.runPromise(catalog(origin, viewer).list()),
      ).resolves.toEqual({ repositories: [] });
    });
  });

  it("returns typed path and missing-entry failures", async () => {
    await withCatalogListener(async ({ authorization, origin, root }) => {
      const owner = await pair(origin, authorization, "owner");

      await expect(
        Effect.runPromise(
          catalog(origin, owner).remember({ path: join(root, "missing") }),
        ),
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
        Effect.runPromise(
          catalog(origin, owner).recordOpened({ repositoryId: missingId }),
        ),
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

      const listing = await Effect.runPromise(
        filesystem(origin, owner).listDirectory({ path: root }),
      );

      expect(listing.path).toBe(root);
      expect(listing.entries).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ kind: "Folder", name: "projects" }),
          expect.objectContaining({ kind: "Markdown", name: "notes.md" }),
        ]),
      );
      await expect(
        Effect.runPromise(
          filesystem(origin, viewer).listDirectory({ path: root }),
        ),
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
        const features = yield* Effect.all([
          environmentAuthorizationFeature,
          repositoryCatalogFeature,
          environmentFilesystemFeature,
        ]).pipe(
          Effect.provideService(EnvironmentAuthorizationAccess, authorization),
          Effect.provideService(
            RepositoryCatalogAccess,
            createRepositoryCatalog(context, createLocalGitCommandRunner()),
          ),
        );
        const listener = yield* acquireEnvironmentListener({
          authorization,
          environmentId,
          events: createEnvironmentEventPublisher(),
          features: testEnvironmentFeatures(features),
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
  const exchanged = await Effect.runPromise(
    exchangeEnvironmentPairingEffect(origin, {
      label: `${role} browser`,
      pairingMaterial: pairing.material,
    }),
  );
  return { type: "bearer" as const, value: exchanged.credential };
}

function catalog(origin: string, credential: EnvironmentCredential) {
  return repositoryCatalogClient(
    createEnvironmentRequestClient(origin, () => credential),
  );
}

function filesystem(origin: string, credential: EnvironmentCredential) {
  return environmentFilesystemClient(
    createEnvironmentRequestClient(origin, () => credential),
  );
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
