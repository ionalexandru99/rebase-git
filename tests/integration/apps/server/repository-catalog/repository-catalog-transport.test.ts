import { mkdir, mkdtemp, realpath, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  EnvironmentFilesystemHttpApi,
  RepositoryCatalogHttpApi,
} from "@rebase/contracts";
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
import { removeTemporaryDirectory } from "#tests-support/temporary-directory";
import { exchangeEnvironmentPairingEffect } from "#web/app/environment/connection/index";

const directories = new Set<string>();
const environmentId = "00000000-0000-4000-8000-000000000001";

afterEach(async () => {
  await Promise.all(
    [...directories].map((directory) => removeTemporaryDirectory(directory)),
  );
  directories.clear();
});

describe("repository catalog transport", () => {
  it("lists and records opens for readers while writes require repository.write", async () => {
    await withCatalogListener(async ({ authorization, origin, root }) => {
      const repositoryPath = join(root, "repository");
      await createRepository(repositoryPath);
      const owner = requests(
        origin,
        await pair(origin, authorization, "owner"),
      );
      const viewer = requests(
        origin,
        await pair(origin, authorization, "viewer"),
      );

      const remembered = await owner(RepositoryCatalogHttpApi.remember, {
        path: repositoryPath,
      });
      await expect(
        viewer(RepositoryCatalogHttpApi.list, undefined),
      ).resolves.toEqual({ repositories: [remembered] });
      const opened = await viewer(RepositoryCatalogHttpApi.recordOpened, {
        repositoryId: remembered.id,
      });
      expect(opened.lastOpenedAt >= remembered.lastOpenedAt).toBe(true);

      await expect(
        viewer(RepositoryCatalogHttpApi.remove, {
          repositoryId: remembered.id,
        }),
      ).rejects.toMatchObject({
        failure: { _tag: "CapabilityDenied", capability: "repository.write" },
      });
      await expect(
        owner(RepositoryCatalogHttpApi.remove, { repositoryId: remembered.id }),
      ).resolves.toEqual({ repositoryId: remembered.id });
      await expect(
        viewer(RepositoryCatalogHttpApi.list, undefined),
      ).resolves.toEqual({ repositories: [] });
    });
  });

  it("returns typed path and missing-entry failures", async () => {
    await withCatalogListener(async ({ authorization, origin, root }) => {
      const owner = requests(
        origin,
        await pair(origin, authorization, "owner"),
      );

      await expect(
        owner(RepositoryCatalogHttpApi.remember, {
          path: join(root, "missing"),
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
  });

  it("browses server directories for owners without exposing them to viewers", async () => {
    await withCatalogListener(async ({ authorization, origin, root }) => {
      await mkdir(join(root, "projects"));
      await writeFile(join(root, "notes.md"), "notes");
      const owner = requests(
        origin,
        await pair(origin, authorization, "owner"),
      );
      const viewer = requests(
        origin,
        await pair(origin, authorization, "viewer"),
      );

      const listing = await owner(EnvironmentFilesystemHttpApi.listDirectory, {
        path: root,
      });

      expect(listing.path).toBe(root);
      expect(listing.entries).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ kind: "Folder", name: "projects" }),
          expect.objectContaining({ kind: "Markdown", name: "notes.md" }),
        ]),
      );
      await expect(
        viewer(EnvironmentFilesystemHttpApi.listDirectory, { path: root }),
      ).rejects.toMatchObject({
        failure: { _tag: "CapabilityDenied", capability: "repository.write" },
      });
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

function requests(origin: string, credential: EnvironmentCredential) {
  return createEnvironmentRequestClient(origin, () => credential);
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
