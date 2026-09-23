import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import {
  currentClientReceiveLimits,
  RepositoryCatalogHttpApi,
} from "@rebase/contracts";
import {
  EnvironmentHttpRejected,
  EnvironmentResponseError,
  requestEnvironmentHttp,
} from "@rebase/environment-client";
import { Effect } from "effect";
import { describe, expect, it } from "vite-plus/test";

const credential = { type: "bearer", value: "credential" } as const;
const entry = {
  addedAt: "2026-09-01T10:00:00.000Z",
  id: "00000000-0000-4000-8000-000000000001",
  lastOpenedAt: "2026-09-01T10:00:00.000Z",
  name: "repository",
  path: "/home/alex/repository",
};

describe("environment HTTP request", () => {
  it("sends the route's method, credential and encoded command, then decodes the success status", async () => {
    const received: { method?: string; body: string; headers: object }[] = [];
    await withServer(
      async (request, response) => {
        received.push({
          ...(request.method === undefined ? {} : { method: request.method }),
          body: await readBody(request),
          headers: {
            authorization: request.headers.authorization,
            "content-type": request.headers["content-type"],
          },
        });
        const remember = request.method === "POST";
        response
          .writeHead(remember ? 201 : 200)
          .end(JSON.stringify(remember ? entry : { repositories: [entry] }));
      },
      async (origin) => {
        await expect(
          Effect.runPromise(
            requestEnvironmentHttp(origin, RepositoryCatalogHttpApi.remember, {
              command: { path: entry.path },
              credential,
            }),
          ),
        ).resolves.toEqual(entry);
        await expect(
          Effect.runPromise(
            requestEnvironmentHttp(origin, RepositoryCatalogHttpApi.list, {
              command: undefined,
              credential,
            }),
          ),
        ).resolves.toEqual({ repositories: [entry] });
      },
    );
    expect(received).toEqual([
      {
        method: "POST",
        body: JSON.stringify({ path: entry.path }),
        headers: {
          authorization: "Bearer credential",
          "content-type": "application/json",
        },
      },
      {
        method: "GET",
        body: "",
        headers: { authorization: "Bearer credential" },
      },
    ]);
  });

  it("decodes a declared failure status into a rejection", async () => {
    await withServer(
      (_, response) => {
        response.writeHead(401).end(JSON.stringify({ _tag: "InvalidGrant" }));
      },
      async (origin) => {
        await expect(
          Effect.runPromise(
            requestEnvironmentHttp(origin, RepositoryCatalogHttpApi.list, {
              command: undefined,
              credential,
            }),
          ),
        ).rejects.toEqual(
          new EnvironmentHttpRejected({
            failure: { _tag: "InvalidGrant" },
            status: 401,
          }),
        );
      },
    );
  });

  it.each([
    ["a malformed body", 200, "{"],
    ["a success body that does not match the route", 200, "{}"],
    ["an undeclared status", 500, '{"_tag":"InvalidGrant"}'],
    [
      "a failure that does not belong to the route",
      403,
      '{"_tag":"InvalidPairing"}',
    ],
  ])("reports %s as a response error", async (_, status, body) => {
    await withServer(
      (_, response) => {
        response.writeHead(status).end(body);
      },
      async (origin) => {
        await expect(
          Effect.runPromise(
            requestEnvironmentHttp(origin, RepositoryCatalogHttpApi.list, {
              command: undefined,
              credential,
            }),
          ),
        ).rejects.toEqual(
          new EnvironmentResponseError({
            responseTag: RepositoryCatalogHttpApi.list.path,
          }),
        );
      },
    );
  });

  it.each(["declared", "streamed"])(
    "rejects a %s oversized response",
    async (mode) => {
      const body = JSON.stringify({ repositories: [] }).padEnd(
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
              requestEnvironmentHttp(origin, RepositoryCatalogHttpApi.list, {
                command: undefined,
                credential,
              }),
            ),
          ).rejects.toEqual(
            new EnvironmentResponseError({
              responseTag: RepositoryCatalogHttpApi.list.path,
            }),
          );
        },
      );
    },
  );

  it.each(["headers", "body"])(
    "cancels a request waiting for %s",
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
            requestEnvironmentHttp(origin, RepositoryCatalogHttpApi.list, {
              command: undefined,
              credential,
            }),
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

function readBody(request: IncomingMessage) {
  return new Promise<string>((resolve) => {
    let body = "";
    request.on("data", (chunk: Buffer) => {
      body += chunk.toString("utf8");
    });
    request.on("end", () => resolve(body));
  });
}

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
