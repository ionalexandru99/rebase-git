import { randomUUID } from "node:crypto";
import {
  access,
  mkdir,
  mkdtemp,
  readdir,
  realpath,
  writeFile,
} from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { Effect, Fiber } from "effect";
import { describe, expect, it, onTestFinished } from "vite-plus/test";
import { RepositoryCatalogApi } from "#contracts/repository-catalog/repository-catalog.contract.ts";
import { createRepository, git } from "#tests-support/git.ts";
import { waitForObservation } from "#tests-support/observation.ts";
import { openTestEnvironment } from "#tests-support/server.ts";
import { removeTemporaryDirectory } from "#tests-support/temporary-directory.ts";

describe("creating repositories", () => {
  it("clones a remote into a new folder and remembers it under the requested id", async () => {
    const root = await temporaryDirectory();
    const remote = await bareRemote(root);
    const { routes } = await environment();
    const repositoryId = randomUUID();

    const cloned = await Effect.runPromise(
      routes.clone({
        repositoryId,
        url: pathToFileURL(remote).href,
        path: join(root, "storefront"),
      }),
    );

    expect(cloned).toMatchObject({
      id: repositoryId,
      name: "storefront",
      path: join(root, "storefront"),
    });
    expect(await git(cloned.path, "log", "--format=%s")).toBe("initial");
    expect(
      (await Effect.runPromise(routes.list())).repositories.map(({ id }) => id),
    ).toEqual([repositoryId]);
  });

  it("refuses a folder that already holds files and leaves it alone", async () => {
    const root = await temporaryDirectory();
    const remote = await bareRemote(root);
    const destination = join(root, "taken");
    await mkdir(destination);
    await writeFile(join(destination, "notes.txt"), "keep");
    const { routes } = await environment();

    const failure = await Effect.runPromise(
      Effect.flip(
        routes.clone({
          repositoryId: randomUUID(),
          url: pathToFileURL(remote).href,
          path: destination,
        }),
      ),
    );

    expect(failure).toEqual({
      _tag: "RepositoryNotCreated",
      reason: "DestinationNotEmpty",
    });
    expect(await readdir(destination)).toEqual(["notes.txt"]);
  });

  it("removes the half-cloned folder when the clone is cancelled", async () => {
    const root = await temporaryDirectory();
    const destination = join(root, "stalled");
    const { routes } = await environment({
      GIT_SSH_COMMAND: "cat >/dev/null #",
    });

    const clone = Effect.runFork(
      routes.clone({
        repositoryId: randomUUID(),
        url: "ssh://git.example.test/stalled.git",
        path: destination,
      }),
    );
    await waitForObservation(() => access(destination));
    await Effect.runPromise(Fiber.interrupt(clone));

    await waitForObservation(async () =>
      expect(await exists(destination)).toBe(false),
    );
  });

  it("initializes a folder that already holds files on the chosen branch", async () => {
    const root = await temporaryDirectory();
    const folder = join(root, "notes app");
    await mkdir(folder);
    await writeFile(join(folder, "README.md"), "# notes");
    const { routes } = await environment();

    const created = await Effect.runPromise(
      routes.initialize({ path: folder, branch: "trunk" }),
    );

    expect(created).toMatchObject({ name: "notes app", path: folder });
    expect(await git(folder, "symbolic-ref", "--short", "HEAD")).toBe("trunk");
    expect(await git(folder, "status", "--porcelain")).toBe("?? README.md");
  });

  it("creates a missing folder but never a repository inside another one", async () => {
    const root = await temporaryDirectory();
    const outer = join(root, "outer");
    await createRepository(outer);
    const { routes } = await environment();

    const created = await Effect.runPromise(
      routes.initialize({ path: join(root, "fresh"), branch: "main" }),
    );
    const nested = await Effect.runPromise(
      Effect.flip(
        routes.initialize({ path: join(outer, "nested"), branch: "main" }),
      ),
    );

    expect(created.path).toBe(join(root, "fresh"));
    expect(nested).toEqual({
      _tag: "RepositoryNotCreated",
      reason: "InsideRepository",
    });
    expect(await exists(join(outer, "nested"))).toBe(false);
  });

  it("keeps the clone folder the user picked and refuses one that does not exist", async () => {
    const root = await temporaryDirectory();
    const { routes } = await environment();

    const before = await Effect.runPromise(routes.defaults());
    await Effect.runPromise(routes.setCloneFolder({ path: root }));
    const missing = await Effect.runPromise(
      Effect.flip(routes.setCloneFolder({ path: join(root, "missing") })),
    );

    expect(before.cloneFolder).toBe(homedir());
    expect((await Effect.runPromise(routes.defaults())).cloneFolder).toBe(root);
    expect(missing).toEqual({
      _tag: "RepositoryPathRejected",
      reason: "NotFound",
    });
  });
});

async function environment(gitEnvironment: Record<string, string> = {}) {
  const opened = await openTestEnvironment({
    git: (runner) => ({
      run: (command) =>
        runner.run({
          ...command,
          environment: { ...command.environment, ...gitEnvironment },
        }),
      stream: runner.stream,
    }),
  });
  return { routes: opened.routes(RepositoryCatalogApi) };
}

async function bareRemote(root: string) {
  const source = join(root, "source");
  const remote = join(root, "remote.git");
  await createRepository(source);
  await git(root, "clone", "--bare", source, remote);
  return remote;
}

async function temporaryDirectory() {
  const directory = await mkdtemp(join(tmpdir(), "rebase create "));
  onTestFinished(() => removeTemporaryDirectory(directory));
  return realpath(directory);
}

function exists(path: string) {
  return access(path).then(
    () => true,
    () => false,
  );
}
