import { execFile } from "node:child_process";
import { mkdir, mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { createLocalGitCommandRunner } from "@rebase/server/adapters/local-git/local-git-command-runner";
import { createLocalRepositoryWatcher } from "@rebase/server/adapters/local-git/local-repository-watcher";
import { createEnvironmentAuthorization } from "@rebase/server/features/environment-authorization/environment-authorization";
import { createEnvironmentEventPublisher } from "@rebase/server/features/environment-connection/events/environment-event-publisher";
import { acquireEnvironmentListener } from "@rebase/server/features/environment-server/server/environment-listener";
import { createRepositoryCatalog } from "@rebase/server/features/repository-catalog/repository-catalog";
import { acquireRepositoryChangePublisher } from "@rebase/server/features/repository-refs/repository-change-publisher";
import { createRepositoryRefsService } from "@rebase/server/features/repository-refs/repository-refs";
import { acquireEnvironmentContext } from "@rebase/server/persistence/environment-context";
import { environmentPaths } from "@rebase/server/persistence/storage/environment-paths";
import { exchangeEnvironmentPairing } from "@rebase/web/features/environment-connection";
import { rememberEnvironmentRepository } from "@rebase/web/features/repository-catalog";
import {
  checkoutRepositoryRef,
  RepositoryRefsRejected,
  readRepositoryRefs,
} from "@rebase/web/features/repository-refs";
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

describe("repository refs transport", () => {
  it("serves refs to readers and reserves checkout for writers", async () => {
    await withRefsListener(async ({ authorization, origin, root }) => {
      const repositoryPath = join(root, "repository");
      await createRepository(repositoryPath);
      const owner = await pair(origin, authorization, "owner");
      const viewer = await pair(origin, authorization, "viewer");
      const remembered = await rememberEnvironmentRepository(
        origin,
        owner,
        repositoryPath,
      );

      const refs = await readRepositoryRefs(origin, viewer, remembered.id);
      expect(refs.repositoryId).toBe(remembered.id);
      expect(refs.branches.map((branch) => branch.name)).toEqual(
        expect.arrayContaining(["main", "feature"]),
      );

      await expect(
        checkoutRepositoryRef(origin, viewer, {
          repositoryId: remembered.id,
          target: { _tag: "LocalBranch", name: "feature" },
          worktreePath: repositoryPath,
        }),
      ).rejects.toEqual(
        new RepositoryRefsRejected({
          failure: { _tag: "CapabilityDenied", capability: "repository.write" },
          status: 403,
        }),
      );
      await expect(
        checkoutRepositoryRef(origin, owner, {
          repositoryId: remembered.id,
          target: { _tag: "LocalBranch", name: "feature" },
          worktreePath: repositoryPath,
        }),
      ).resolves.toMatchObject({ head: { branch: "feature" }, stash: "none" });
      await expect(
        readRepositoryRefs(
          origin,
          viewer,
          "00000000-0000-4000-8000-000000000099",
        ),
      ).rejects.toEqual(
        new RepositoryRefsRejected({
          failure: {
            _tag: "RepositoryMissing",
            repositoryId: "00000000-0000-4000-8000-000000000099",
          },
          status: 404,
        }),
      );
    });
  });
});

function withRefsListener(use: (fixture: ListenerFixture) => Promise<void>) {
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
        const catalog = createRepositoryCatalog(context);
        const events = createEnvironmentEventPublisher();
        const git = createLocalGitCommandRunner();
        const listener = yield* acquireEnvironmentListener({
          authorization,
          catalog,
          environmentId,
          events,
          productVersion: "0.0.0",
          refs: createRepositoryRefsService({
            catalog,
            changes: yield* acquireRepositoryChangePublisher(
              git,
              createLocalRepositoryWatcher(),
              events,
            ),
            git,
          }),
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
  await git(path, "branch", "feature");
}

async function git(path: string, ...arguments_: string[]) {
  await execFilePromise("git", ["-C", path, ...arguments_]);
}

async function createTemporaryDirectory() {
  const directory = await mkdtemp(join(tmpdir(), "rebase refs transport "));
  directories.add(directory);
  return realpath(directory);
}

interface ListenerFixture {
  readonly authorization: ReturnType<typeof createEnvironmentAuthorization>;
  readonly origin: string;
  readonly root: string;
}
