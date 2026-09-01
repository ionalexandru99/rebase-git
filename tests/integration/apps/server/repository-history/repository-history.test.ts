import { execFile } from "node:child_process";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import {
  createBinaryMessageReassembler,
  createCurrentEnvironmentHello,
  decodeRepositoryHistoryPage,
  type EnvironmentAccessCapability,
  type EnvironmentHello,
  environmentLivePath,
} from "@rebase/contracts";
import { createLocalGitCommandRunner } from "@rebase/server/adapters/local-git/local-git-command-runner";
import type { RepositoryHistoryService } from "@rebase/server/domain/repository-history.contract";
import type { EnvironmentAuthorization } from "@rebase/server/features/environment-authorization/environment-authorization.contract";
import { createEnvironmentEventPublisher } from "@rebase/server/features/environment-connection/events/environment-event-publisher";
import { acquireEnvironmentListener } from "@rebase/server/features/environment-server/server/environment-listener";
import { createRepositoryCatalog } from "@rebase/server/features/repository-catalog/repository-catalog";
import { createRepositoryHistoryService } from "@rebase/server/features/repository-history/repository-history";
import { acquireEnvironmentContext } from "@rebase/server/persistence/environment-context";
import { environmentPaths } from "@rebase/server/persistence/storage/environment-paths";
import { Effect } from "effect";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

const execFilePromise = promisify(execFile);
const directories = new Set<string>();
const environmentId = "00000000-0000-4000-8000-000000000001";
const requestId = "00000000-0000-4000-8000-000000000011";

afterEach(async () => {
  await Promise.all(
    [...directories].map((directory) =>
      rm(directory, { force: true, recursive: true }),
    ),
  );
  directories.clear();
});

describe("repository history", { timeout: 30_000 }, () => {
  it.each(["sha1", "sha256"] as const)(
    "delivers the first 100 %s commits through fragmented binary messages",
    async (objectFormat) => {
      await withHistoryListener(async ({ catalog, origin, root }) => {
        const repositoryPath = join(root, objectFormat);
        await createRepository(repositoryPath, objectFormat, 110);
        const repository = await Effect.runPromise(
          catalog.remember(repositoryPath),
        );
        const head = await gitOutput(repositoryPath, "rev-parse", "main");
        const socket = await openHistorySocket(origin, smallFrameHello());
        const reassembler = createBinaryMessageReassembler();
        const fragments: Uint8Array[] = [];
        const received = collectBinaryMessage(socket, reassembler, fragments);
        socket.send(
          JSON.stringify({
            _tag: "ReadRepositoryHistory",
            limit: 100,
            order: "topological",
            repositoryId: repository.id,
            requestId,
            roots: [{ name: "main", oid: head, type: "branch" }],
          }),
        );

        const complete = await received;
        socket.close();

        expect(fragments.length).toBeGreaterThan(1);
        const page = decodeRepositoryHistoryPage(complete.payload);
        expect(page.objectFormat).toBe(objectFormat);
        expect(page.commits).toHaveLength(100);
        expect(page.commits[0]?.subject).toBe("commit 109");
        expect(page.commits.at(-1)?.subject).toBe("commit 10");
        expect(
          page.commits.every(
            (commit) =>
              commit.oid.length === (objectFormat === "sha1" ? 40 : 64),
          ),
        ).toBe(true);
      });
    },
  );

  it("cancels an in-flight history request without closing the connection", async () => {
    const canceled = vi.fn();
    const history: RepositoryHistoryService = {
      read: () => Effect.never.pipe(Effect.ensuring(Effect.sync(canceled))),
    };
    await withHistoryListener(async ({ catalog, origin, root }) => {
      const repositoryPath = join(root, "cancel");
      await createRepository(repositoryPath, "sha1", 1);
      const repository = await Effect.runPromise(
        catalog.remember(repositoryPath),
      );
      const head = await gitOutput(repositoryPath, "rev-parse", "main");
      const socket = await openHistorySocket(
        origin,
        createCurrentEnvironmentHello("0.0.0"),
      );
      socket.send(
        JSON.stringify({
          _tag: "ReadRepositoryHistory",
          limit: 100,
          order: "topological",
          repositoryId: repository.id,
          requestId,
          roots: [{ name: "main", oid: head, type: "branch" }],
        }),
      );
      socket.send(
        JSON.stringify({ _tag: "CancelRepositoryHistory", requestId }),
      );

      await vi.waitFor(() => expect(canceled).toHaveBeenCalledOnce());
      expect(socket.readyState).toBe(WebSocket.OPEN);
      socket.close();
    }, history);
  });

  it("preserves nested and octopus merge topology", async () => {
    await withHistoryListener(async ({ catalog, origin, root }) => {
      const repositoryPath = join(root, "merges");
      await createMergeRepository(repositoryPath);
      const repository = await Effect.runPromise(
        catalog.remember(repositoryPath),
      );
      const head = await gitOutput(repositoryPath, "rev-parse", "main");

      const page = await readHistoryPage(origin, repository.id, head);

      expect(page.commits[0]?.subject).toBe("octopus");
      expect(page.commits[0]?.parents).toHaveLength(3);
      expect(
        page.commits.find((commit) => commit.subject === "nested merge")
          ?.parents,
      ).toHaveLength(2);
      const positions = new Map(
        page.commits.map((commit, index) => [commit.oid, index]),
      );
      expect(
        page.commits.every((commit, index) =>
          commit.parents.every(
            (parent) => (positions.get(parent) ?? index + 1) > index,
          ),
        ),
      ).toBe(true);
    });
  });

  it("stops at a shallow repository boundary", async () => {
    await withHistoryListener(async ({ catalog, origin, root }) => {
      const source = join(root, "shallow-source");
      const repositoryPath = join(root, "shallow-clone");
      await createRepository(source, "sha1", 5);
      await execFilePromise("git", [
        "clone",
        "--branch=main",
        "--depth=2",
        pathToFileURL(source).href,
        repositoryPath,
      ]);
      const repository = await Effect.runPromise(
        catalog.remember(repositoryPath),
      );
      const head = await gitOutput(repositoryPath, "rev-parse", "main");

      const page = await readHistoryPage(origin, repository.id, head);

      expect(page.commits).toHaveLength(2);
      expect(page.commits.at(-1)?.parents).toEqual([]);
    });
  });

  it("rejects history reads without closing an authorized environment connection", async () => {
    await withHistoryListener(
      async ({ catalog, origin, root }) => {
        const repositoryPath = join(root, "denied");
        await createRepository(repositoryPath, "sha1", 1);
        const repository = await Effect.runPromise(
          catalog.remember(repositoryPath),
        );
        const head = await gitOutput(repositoryPath, "rev-parse", "main");
        const socket = await openHistorySocket(
          origin,
          createCurrentEnvironmentHello("0.0.0"),
        );
        socket.send(
          JSON.stringify({
            _tag: "ReadRepositoryHistory",
            limit: 100,
            order: "topological",
            repositoryId: repository.id,
            requestId,
            roots: [{ name: "main", oid: head, type: "branch" }],
          }),
        );

        expect(JSON.parse(await nextTextMessage(socket))).toEqual({
          _tag: "RepositoryHistoryFailed",
          failure: { _tag: "AuthorizationDenied" },
          requestId,
        });
        expect(socket.readyState).toBe(WebSocket.OPEN);
        socket.close();
      },
      undefined,
      testAuthorization(["environment.read"]),
    );
  });

  it("bounds concurrent history reads within one connection", async () => {
    const history: RepositoryHistoryService = {
      read: vi.fn(() => Effect.never),
    };
    await withHistoryListener(async ({ origin }) => {
      const socket = await openHistorySocket(
        origin,
        createCurrentEnvironmentHello("0.0.0"),
      );
      const requestIds = [
        "00000000-0000-4000-8000-000000000021",
        "00000000-0000-4000-8000-000000000022",
        "00000000-0000-4000-8000-000000000023",
      ];
      for (const currentRequestId of requestIds) {
        socket.send(
          JSON.stringify({
            _tag: "ReadRepositoryHistory",
            limit: 100,
            order: "topological",
            repositoryId: "00000000-0000-4000-8000-000000000001",
            requestId: currentRequestId,
            roots: [{ name: "main", oid: "a".repeat(40), type: "branch" }],
          }),
        );
      }

      expect(JSON.parse(await nextTextMessage(socket))).toEqual({
        _tag: "RepositoryHistoryFailed",
        failure: {
          _tag: "GitFailed",
          detail: "Too many concurrent repository history requests",
          reason: "Failed",
        },
        requestId: requestIds[2],
      });
      expect(history.read).toHaveBeenCalledTimes(2);
      expect(socket.readyState).toBe(WebSocket.OPEN);
      socket.close();
    }, history);
  });
});

function withHistoryListener(
  use: (fixture: ListenerFixture) => Promise<void>,
  historyOverride?: RepositoryHistoryService,
  authorization: EnvironmentAuthorization = testAuthorization(),
) {
  return Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const root = yield* Effect.promise(createTemporaryDirectory);
        const context = yield* acquireEnvironmentContext(
          environmentPaths(join(root, ".rebase")),
        );
        const catalog = createRepositoryCatalog(context);
        const history =
          historyOverride ??
          createRepositoryHistoryService({
            catalog,
            git: createLocalGitCommandRunner(),
          });
        const listener = yield* acquireEnvironmentListener({
          authorization,
          environmentId,
          events: createEnvironmentEventPublisher(),
          history,
          productVersion: "0.0.0",
        });
        listener.readiness.value = true;
        yield* Effect.promise(() =>
          use({ catalog, origin: listener.origin, root }),
        );
      }),
    ),
  );
}

async function createRepository(
  path: string,
  objectFormat: "sha1" | "sha256",
  commitCount: number,
) {
  await mkdir(path, { recursive: true });
  await git(path, "init", `--object-format=${objectFormat}`, "-b", "main");
  for (let index = 0; index < commitCount; index += 1) {
    await git(path, "commit", "--allow-empty", "-m", `commit ${index}`);
  }
}

async function createMergeRepository(path: string) {
  await mkdir(path, { recursive: true });
  await git(path, "init", "-b", "main");
  await commitFile(path, "base.txt", "base", "base");
  await git(path, "checkout", "-b", "feature");
  await commitFile(path, "feature.txt", "one", "feature one");
  await git(path, "checkout", "-b", "nested");
  await commitFile(path, "nested.txt", "nested", "nested");
  await git(path, "checkout", "feature");
  await commitFile(path, "feature.txt", "two", "feature two");
  await git(path, "merge", "--no-ff", "nested", "-m", "nested merge");
  await git(path, "checkout", "main");
  await commitFile(path, "main.txt", "main", "main");
  await git(path, "merge", "--no-ff", "feature", "-m", "feature merge");
  await git(path, "checkout", "-b", "octo-a");
  await commitFile(path, "octo-a.txt", "a", "octo a");
  await git(path, "checkout", "main");
  await git(path, "checkout", "-b", "octo-b");
  await commitFile(path, "octo-b.txt", "b", "octo b");
  await git(path, "checkout", "main");
  await git(path, "merge", "--no-ff", "octo-a", "octo-b", "-m", "octopus");
}

async function commitFile(
  path: string,
  name: string,
  value: string,
  subject: string,
) {
  await writeFile(join(path, name), value);
  await git(path, "add", name);
  await git(path, "commit", "-m", subject);
}

async function readHistoryPage(
  origin: string,
  repositoryId: string,
  oid: string,
) {
  const socket = await openHistorySocket(
    origin,
    createCurrentEnvironmentHello("0.0.0"),
  );
  const received = collectBinaryMessage(
    socket,
    createBinaryMessageReassembler(),
    [],
  );
  socket.send(
    JSON.stringify({
      _tag: "ReadRepositoryHistory",
      limit: 100,
      order: "topological",
      repositoryId,
      requestId,
      roots: [{ name: "main", oid, type: "branch" }],
    }),
  );
  const complete = await received;
  socket.close();
  return decodeRepositoryHistoryPage(complete.payload);
}

function smallFrameHello(): EnvironmentHello {
  return {
    ...createCurrentEnvironmentHello("0.0.0"),
    receiveLimits: {
      maxCapturedOutputBytes: 1_048_576,
      maxHttpResponseBytes: 1_048_576,
      maxWebSocketResponseBytes: 1_024,
    },
  };
}

async function openHistorySocket(origin: string, hello: EnvironmentHello) {
  const socket = await new Promise<WebSocket>((resolveOpen, rejectOpen) => {
    const current = new WebSocket(
      `${origin.replace("http://", "ws://")}${environmentLivePath}?ticket=test-ticket`,
    );
    current.binaryType = "arraybuffer";
    current.addEventListener("open", () => resolveOpen(current), {
      once: true,
    });
    current.addEventListener(
      "error",
      () => rejectOpen(new Error("WebSocket failed")),
      { once: true },
    );
  });
  socket.send(JSON.stringify(hello));
  await nextTextMessage(socket);
  return socket;
}

function nextTextMessage(socket: WebSocket) {
  return nextMessage(socket, (data) =>
    typeof data === "string" ? data : undefined,
  );
}

function collectBinaryMessage(
  socket: WebSocket,
  reassembler: ReturnType<typeof createBinaryMessageReassembler>,
  fragments: Uint8Array[],
) {
  return new Promise<NonNullable<ReturnType<typeof reassembler.accept>>>(
    (resolveMessage, rejectMessage) => {
      const timeout = setTimeout(() => {
        cleanup();
        rejectMessage(new Error("Timed out waiting for binary history"));
      }, 10_000);
      const received = (event: MessageEvent) => {
        void binaryBytes(event.data).then(
          (fragment) => {
            fragments.push(fragment);
            const complete = reassembler.accept(fragment);
            if (complete === undefined) {
              return;
            }
            cleanup();
            resolveMessage(complete);
          },
          (error: unknown) => {
            cleanup();
            rejectMessage(error);
          },
        );
      };
      const cleanup = () => {
        clearTimeout(timeout);
        socket.removeEventListener("message", received);
      };
      socket.addEventListener("message", received);
    },
  );
}

async function binaryBytes(data: unknown) {
  if (data instanceof ArrayBuffer) {
    return new Uint8Array(data);
  }
  if (data instanceof Blob) {
    return new Uint8Array(await data.arrayBuffer());
  }
  if (ArrayBuffer.isView(data)) {
    return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  }
  throw new Error(`Expected binary history, received ${String(data)}`);
}

function nextMessage<T>(
  socket: WebSocket,
  select: (data: unknown) => T | undefined,
) {
  return new Promise<T>((resolveMessage, rejectMessage) => {
    const timeout = setTimeout(() => {
      cleanup();
      rejectMessage(new Error("Timed out waiting for WebSocket message"));
    }, 10_000);
    const received = (event: MessageEvent) => {
      const selected = select(event.data);
      if (selected === undefined) {
        return;
      }
      cleanup();
      resolveMessage(selected);
    };
    const cleanup = () => {
      clearTimeout(timeout);
      socket.removeEventListener("message", received);
    };
    socket.addEventListener("message", received);
  });
}

function testAuthorization(
  capabilities: readonly EnvironmentAccessCapability[] = [
    "environment.read",
    "repository.read",
  ],
): EnvironmentAuthorization {
  const authorization = {
    capabilities,
    id: "00000000-0000-4000-8000-000000000002",
    label: "Test device",
    role: "custom" as const,
  };
  return {
    authorize: () => Effect.succeed(authorization),
    consumeTicket: () => Effect.succeed(authorization),
    createPairing: () => Effect.die("unused"),
    exchangePairing: () => Effect.die("unused"),
    mintTicket: () => Effect.die("unused"),
    revoke: () => Effect.die("unused"),
  };
}

async function git(path: string, ...arguments_: string[]) {
  await execFilePromise("git", [
    "-C",
    path,
    "-c",
    "user.name=Rebase test",
    "-c",
    "user.email=rebase@example.test",
    ...arguments_,
  ]);
}

async function gitOutput(path: string, ...arguments_: string[]) {
  const result = await execFilePromise("git", ["-C", path, ...arguments_]);
  return result.stdout.trim();
}

async function createTemporaryDirectory() {
  const directory = await realpath(
    await mkdtemp(join(tmpdir(), "rebase history ")),
  );
  directories.add(directory);
  return directory;
}

interface ListenerFixture {
  readonly catalog: ReturnType<typeof createRepositoryCatalog>;
  readonly origin: string;
  readonly root: string;
}
