import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { currentClientReceiveLimits } from "@rebase/contracts";
import {
  EnvironmentFilesystemResponseError,
  listEnvironmentDirectoryEffect,
} from "@rebase/web/features/environment-filesystem";
import {
  listEnvironmentRepositoriesEffect,
  RepositoryCatalogResponseError,
} from "@rebase/web/features/repository-catalog";
import {
  RepositoryRefsResponseError,
  readRepositoryRefsEffect,
} from "@rebase/web/features/repository-refs";
import { Effect } from "effect";
import { describe, expect, it } from "vite-plus/test";

const clients = [
  {
    name: "catalog",
    request: (origin: string) =>
      listEnvironmentRepositoriesEffect(origin, "credential"),
    error: new RepositoryCatalogResponseError(),
  },
  {
    name: "refs",
    request: (origin: string) =>
      readRepositoryRefsEffect(
        origin,
        "credential",
        "00000000-0000-4000-8000-000000000001",
      ),
    error: new RepositoryRefsResponseError(),
  },
  {
    name: "filesystem",
    request: (origin: string) =>
      listEnvironmentDirectoryEffect(origin, "credential"),
    error: new EnvironmentFilesystemResponseError(),
  },
];

describe("feature HTTP clients", () => {
  it.each(clients)(
    "maps malformed JSON, invalid success, and unrelated failures to the $name response error",
    async ({ request, error }) => {
      for (const [status, body] of [
        [200, "{"],
        [200, "{}"],
        [403, '{"_tag":"InvalidPairing"}'],
      ] as const) {
        await withServer(
          (_, response) => {
            response.writeHead(status).end(body);
          },
          async (origin) => {
            await expect(
              Effect.runPromise<unknown, Error>(request(origin)),
            ).rejects.toEqual(error);
          },
        );
      }
    },
  );

  it.each(["declared", "streamed"])(
    "rejects a %s oversized response",
    async (mode) => {
      const body = " ".repeat(
        currentClientReceiveLimits.maxHttpResponseBytes + 1,
      );
      await withServer(
        (_, response) => {
          response.writeHead(
            200,
            mode === "declared"
              ? { "content-length": Buffer.byteLength(body) }
              : {},
          );
          response.write(body);
          response.end();
        },
        async (origin) => {
          await expect(
            Effect.runPromise(
              listEnvironmentRepositoriesEffect(origin, "credential"),
            ),
          ).rejects.toEqual(new RepositoryCatalogResponseError());
        },
      );
    },
  );

  it.each(["headers", "body"])(
    "cancels an HTTP request waiting for %s",
    async (phase) => {
      const received = Promise.withResolvers<void>();
      const closed = Promise.withResolvers<void>();
      await withServer(
        (_, response) => {
          response.on("close", () => closed.resolve());
          if (phase === "body") {
            response.writeHead(200);
            response.write('{"repositories":[');
          }
          received.resolve();
        },
        async (origin) => {
          const controller = new AbortController();
          const result = Effect.runPromiseExit(
            listEnvironmentRepositoriesEffect(origin, "credential"),
            { signal: controller.signal },
          );
          await received.promise;
          controller.abort();
          expect((await result)._tag).toBe("Failure");
          await closed.promise;
        },
      );
    },
  );
});

async function withServer(
  handle: (request: IncomingMessage, response: ServerResponse) => void,
  run: (origin: string) => Promise<void>,
) {
  const server = createServer(handle);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address === null || typeof address === "string")
    throw new Error("Expected a TCP address");
  try {
    await run(`http://127.0.0.1:${address.port}`);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
}
