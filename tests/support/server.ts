import { mkdtemp, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect, Exit, Schema, Scope } from "effect";
import { RpcClientError, RpcTest } from "effect/rpc";
import { onTestFinished } from "vite-plus/test";
import WebSocket from "ws";
import { EnvironmentAuthorizationApi } from "#contracts/environment-authorization/environment-authorization.contract.ts";
import type {
  EnvironmentRoute,
  RouteFailure,
  RouteInput,
  RouteSuccess,
} from "#contracts/environment-connection/environment-route.contract.ts";
import {
  EnvironmentRpc,
  environmentLivePath,
  environmentProtocol,
  environmentSubprotocol,
} from "#contracts/environment-connection/environment-rpc.contract.ts";
import { exchangeEnvironmentPairing } from "#desktop/app/desktop-application.ts";
import type { EnvironmentEventPublisher } from "#server/adapters/environment-transport/environment-event-publisher.ts";
import { environmentRpcHandlers } from "#server/adapters/environment-transport/environment-socket.ts";
import {
  createLocalGitCommandRunner,
  type GitCommandRunner,
} from "#server/adapters/local-git/git-commands.ts";
import {
  acquireEnvironment,
  environmentFeatures,
  serveEnvironment,
} from "#server/app/server/serve-environment.ts";
import type { EnvironmentAuthorization } from "#server/features/environment-authorization/environment-authorization.ts";
import type { GitHubCli } from "#server/features/pull-requests/pull-requests.ts";
import type { RepositoryCoordination } from "#server/repository/repository-coordination.ts";
import { removeTemporaryDirectory } from "#tests-support/temporary-directory.ts";
import {
  connectEnvironment,
  type EnvironmentCredential,
  environmentRequests,
} from "#web/platform/environment/environment-connection.ts";
import type { EnvironmentRequests } from "#web/platform/query/environment-context.tsx";
import type { EnvironmentInvalidation } from "#web/platform/query/environment-invalidation.ts";

type Routes = Record<string, EnvironmentRoute>;

export type RoutesClient<Api extends Routes> = {
  readonly [Name in keyof Api]: (
    input: RouteInput<Api[Name]>,
  ) => Effect.Effect<RouteSuccess<Api[Name]>, RouteFailure<Api[Name]>>;
};

type Procedures = Record<
  string,
  (input: unknown) => Effect.Effect<unknown, unknown>
>;

const testContext = {
  device: { id: "00000000-0000-4000-8000-000000000009", label: "Test device" },
  origin: "http://127.0.0.1",
};

const unchanged: EnvironmentInvalidation = { changed: () => {} };

interface EnvironmentOverrides {
  readonly authorization?: (
    authorization: EnvironmentAuthorization,
  ) => EnvironmentAuthorization;
  readonly events?:
    | ((events: EnvironmentEventPublisher) => EnvironmentEventPublisher)
    | undefined;
  readonly git?: ((git: GitCommandRunner) => GitCommandRunner) | undefined;
  readonly github?: GitHubCli;
  readonly coordination?: (
    coordination: RepositoryCoordination,
  ) => RepositoryCoordination;
}

export function openTestEnvironment(overrides: EnvironmentOverrides = {}) {
  return openInTestScope(
    Effect.gen(function* () {
      const dependencies = yield* acquireTestDependencies(overrides);
      const handlers = yield* environmentRpcHandlers(
        {
          authorization: dependencies.authorization,
          environmentId: "00000000-0000-4000-8000-000000000001",
          events: dependencies.events,
          features: yield* environmentFeatures(dependencies),
        },
        testContext,
      );
      const procedures = (yield* RpcTest.makeClient(EnvironmentRpc).pipe(
        Effect.provide(handlers),
      )) as unknown as Procedures;
      return {
        ...dependencies,
        remember: (path: string) =>
          Effect.runPromise(dependencies.catalog.remember(path)),
        routes: <Api extends Routes>(api: Api) => {
          const client: Partial<Record<keyof Api, unknown>> = {};
          for (const name of Object.keys(api) as (keyof Api)[])
            client[name] = (input: unknown) =>
              callRoute(procedures, api[name] as EnvironmentRoute, input);
          return client as RoutesClient<Api>;
        },
      };
    }),
  );
}

export function openTestServer(overrides: EnvironmentOverrides = {}) {
  return openInTestScope(
    Effect.gen(function* () {
      const scope = yield* Effect.scope;
      const dependencies = yield* acquireTestDependencies(overrides);
      const server = yield* serveEnvironment(dependencies, {});
      const owner = yield* Effect.promise(() =>
        exchangePairing(server.origin, server.pairingUrl, "Owner"),
      );
      const connect = (
        credential: EnvironmentCredential,
        invalidation = unchanged,
      ) =>
        Effect.runPromise(
          connectEnvironment(server.origin, credential, invalidation).pipe(
            Scope.provide(scope),
          ),
        );
      const requests = (credential: EnvironmentCredential) => {
        const connection = connect(credential);
        return (async (route, input, options) =>
          environmentRequests((await connection).rpc)(
            route,
            input,
            options,
          )) satisfies EnvironmentRequests as EnvironmentRequests;
      };
      return {
        ...server,
        events: dependencies.events,
        home: dependencies.home,
        owner,
        connect,
        requests,
        pair: async (label: string) => {
          const pairing = await requests(owner)(
            EnvironmentAuthorizationApi.createPairing,
            undefined,
          );
          return exchangePairing(server.origin, pairing.pairingUrl, label);
        },
      };
    }),
  );
}

export interface GitHubPullRequestNode {
  readonly number: number;
  readonly state?: "OPEN" | "CLOSED" | "MERGED";
  readonly isDraft?: boolean;
  readonly owner?: string;
  readonly checks?: string;
}

export function fakeGitHub(
  byHead: Readonly<Record<string, readonly GitHubPullRequestNode[]>> | null,
) {
  const requests: Readonly<Record<string, string>>[] = [];
  const github: GitHubCli = {
    graphql: (_query, variables) => {
      requests.push(variables);
      if (byHead === null)
        return Effect.fail({ _tag: "PullRequestsUnavailable" });
      const repository = Object.fromEntries(
        Object.entries(variables)
          .filter(([alias]) => /^b\d+$/.test(alias))
          .map(([alias, head]) => [
            alias,
            {
              nodes: (byHead[head] ?? []).map((node) => ({
                number: node.number,
                url: `https://github.com/${variables.owner}/${variables.name}/pull/${node.number}`,
                title: `Pull request ${node.number}`,
                state: node.state ?? "OPEN",
                isDraft: node.isDraft ?? false,
                headRepositoryOwner: { login: node.owner ?? variables.owner },
                commits: {
                  nodes: [
                    {
                      commit: {
                        statusCheckRollup:
                          node.checks === undefined
                            ? null
                            : { state: node.checks },
                      },
                    },
                  ],
                },
              })),
            },
          ]),
      );
      return Effect.succeed(JSON.stringify({ data: { repository } }));
    },
  };
  return { github, requests };
}

export async function exchangePairing(
  origin: string,
  pairingUrl: string,
  label: string,
) {
  const exchanged = await exchangeEnvironmentPairing(origin, {
    label,
    pairingMaterial: new URL(pairingUrl).hash.slice(1),
  });
  return {
    type: "bearer" as const,
    value: exchanged.credential,
    authorizationId: exchanged.authorization.id,
  };
}

export type SocketHello =
  | { readonly _tag: "Answered"; readonly message: unknown }
  | { readonly _tag: "Closed"; readonly code: number; readonly reason: string };

export function helloOverSocket(
  origin: string,
  {
    credential,
    headers = {},
    protocol = environmentProtocol,
  }: {
    readonly credential?: string;
    readonly headers?: Record<string, string>;
    readonly protocol?: number;
  } = {},
) {
  return new Promise<SocketHello>((resolveHello, rejectHello) => {
    const socket = new WebSocket(
      `${origin.replace("http://", "ws://")}${environmentLivePath}`,
      credential === undefined
        ? [environmentSubprotocol]
        : [environmentSubprotocol, credential],
      { headers },
    );
    socket.once("error", rejectHello);
    socket.once("close", (code, reason) =>
      resolveHello({ _tag: "Closed", code, reason: reason.toString() }),
    );
    socket.once("open", () =>
      socket.send(
        JSON.stringify({
          _tag: "Request",
          id: "1",
          tag: "Hello",
          payload: { protocol },
          headers: [],
        }),
      ),
    );
    socket.once("message", (data) => {
      resolveHello({ _tag: "Answered", message: JSON.parse(data.toString()) });
      socket.close();
    });
  });
}

function callRoute(
  procedures: Procedures,
  route: EnvironmentRoute,
  input: unknown,
) {
  const call = procedures[route._tag];
  if (call === undefined)
    return Effect.die(new Error(`No handler serves ${route._tag}.`));
  return call(input).pipe(
    Effect.catchIf(
      (error) => error instanceof RpcClientError.RpcClientError,
      Effect.die,
    ),
    Effect.map((value) => overTheWire(route.successSchema, value)),
    Effect.mapError((failure) => overTheWire(route.errorSchema, failure)),
  );
}

function overTheWire(schema: Schema.Top, value: unknown) {
  const codec = schema as Schema.Codec<unknown, unknown>;
  const encoded = JSON.stringify(Schema.encodeUnknownSync(codec)(value));
  return Schema.decodeUnknownSync(codec)(
    encoded === undefined ? undefined : JSON.parse(encoded),
  );
}

function acquireTestDependencies(overrides: EnvironmentOverrides) {
  return Effect.gen(function* () {
    const home = yield* acquireTemporaryHome;
    const git = createLocalGitCommandRunner();
    const environment = yield* acquireEnvironment(
      home,
      overrides.git?.(git) ?? git,
    );
    return {
      ...environment,
      authorization:
        overrides.authorization?.(environment.authorization) ??
        environment.authorization,
      coordination:
        overrides.coordination?.(environment.coordination) ??
        environment.coordination,
      events: overrides.events?.(environment.events) ?? environment.events,
      github: overrides.github ?? environment.github,
      home,
    };
  });
}

async function openInTestScope<A extends object, E>(
  acquire: Effect.Effect<A, E, Scope.Scope>,
) {
  const scope = Effect.runSync(Scope.make());
  const close = () => Effect.runPromise(Scope.close(scope, Exit.void));
  onTestFinished(close);
  const opened = await Effect.runPromise(
    acquire.pipe(Effect.orDie, Effect.provideService(Scope.Scope, scope)),
  );
  return { ...opened, close };
}

const acquireTemporaryHome = Effect.acquireRelease(
  Effect.promise(async () =>
    realpath(await mkdtemp(join(tmpdir(), "rebase server "))),
  ),
  (home) => Effect.promise(() => removeTemporaryDirectory(home)),
);
