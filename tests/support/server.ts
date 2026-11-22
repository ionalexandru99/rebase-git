import { mkdtemp, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createORPCClient, ORPCError } from "@orpc/client";
import { RPCLink } from "@orpc/client/websocket";
import { createRouterClient } from "@orpc/server";
import { onTestFinished } from "vite-plus/test";
import WebSocket from "ws";
import { EnvironmentAuthorizationApi } from "#contracts/environment-authorization/environment-authorization.contract.ts";
import type {
  EnvironmentRoute,
  RouteInput,
  RouteSuccess,
} from "#contracts/environment-connection/environment-route.contract.ts";
import {
  EnvironmentSessionApi,
  environmentLivePath,
  environmentProtocol,
  environmentSubprotocol,
} from "#contracts/environment-connection/environment-rpc.contract.ts";
import { exchangeEnvironmentPairing } from "#desktop/app/desktop-application.ts";
import type { EnvironmentEventPublisher } from "#server/adapters/environment-transport/environment-event-publisher.ts";
import { environmentRouter } from "#server/adapters/environment-transport/environment-socket.ts";
import {
  createLocalGitCommandRunner,
  type GitCommand,
  type GitCommandRunner,
  gitFailed,
} from "#server/adapters/local-git/git-commands.ts";
import {
  createResourceScope,
  type ResourceScope,
} from "#server/app/server/resource-scope.ts";
import {
  acquireEnvironment,
  environmentFeatures,
  serveEnvironment,
} from "#server/app/server/serve-environment.ts";
import type { AvatarImages } from "#server/features/author-avatars/author-avatars.ts";
import type { EnvironmentAuthorization } from "#server/features/environment-authorization/environment-authorization.ts";
import type { GitHostClients } from "#server/features/source-control/source-control.ts";
import type { RepositoryCoordination } from "#server/repository/repository-coordination.ts";
import { removeTemporaryDirectory } from "#tests-support/temporary-directory.ts";
import {
  connectEnvironment,
  type EnvironmentConnection,
  type EnvironmentCredential,
} from "#web/platform/environment/environment-connection.ts";
import type { EnvironmentRequests } from "#web/platform/query/environment-context.tsx";
import type { EnvironmentInvalidation } from "#web/platform/query/environment-invalidation.ts";

type Routes = Record<string, EnvironmentRoute>;

export type RoutesClient<Api extends Routes> = {
  readonly [Name in keyof Api]: (
    input: RouteInput<Api[Name]>,
  ) => Promise<RouteSuccess<Api[Name]>>;
};

type Procedures = Readonly<
  Record<string, (input: unknown) => Promise<unknown>>
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
  readonly gitHosts?: Partial<GitHostClients>;
  readonly avatarImages?: AvatarImages;
  readonly coordination?: (
    coordination: RepositoryCoordination,
  ) => RepositoryCoordination;
}

export function interruptGit(command: string, applied: boolean) {
  return (runner: GitCommandRunner): GitCommandRunner => ({
    ...runner,
    run: async (next) => {
      if (!`${next.arguments.join(" ")} `.startsWith(`${command} `))
        return runner.run(next);
      if (applied) await runner.run(next);
      throw gitFailed("Timeout");
    },
  });
}

export async function openTestEnvironment(
  overrides: EnvironmentOverrides = {},
) {
  const scope = openTestScope();
  const dependencies = await acquireTestDependencies(scope, overrides);
  const router = environmentRouter({
    environmentId: "00000000-0000-4000-8000-000000000001",
    events: dependencies.events,
    features: environmentFeatures(dependencies, scope),
  });
  const procedures = createRouterClient(router, {
    context: testContext,
  }) as unknown as Procedures;
  return {
    ...dependencies,
    close: scope.close,
    remember: (path: string) => dependencies.catalog.remember(path),
    routes: <Api extends Routes>(api: Api) => {
      const client: Partial<Record<keyof Api, unknown>> = {};
      for (const name of Object.keys(api) as (keyof Api)[])
        client[name] = (input: unknown) =>
          callRoute(procedures, api[name] as EnvironmentRoute, input);
      return client as RoutesClient<Api>;
    },
  };
}

export async function openIsolatedTestEnvironment(
  prefix: string,
  extra: Readonly<Record<string, string>> = {},
) {
  const home = await realpath(await mkdtemp(join(tmpdir(), prefix)));
  onTestFinished(() => removeTemporaryDirectory(home));
  const isolated = {
    HOME: home,
    XDG_CONFIG_HOME: join(home, ".config"),
    GIT_CONFIG_GLOBAL: join(home, ".gitconfig"),
    GIT_CONFIG_NOSYSTEM: "1",
    ...extra,
  };
  const isolate = (command: GitCommand): GitCommand => ({
    ...command,
    environment: { ...command.environment, ...isolated },
  });
  const environment = await openTestEnvironment({
    git: (runner) => ({
      run: (command) => runner.run(isolate(command)),
      stream: (command) => runner.stream(isolate(command)),
    }),
  });
  return { environment, home, env: { ...process.env, ...isolated } };
}

export async function openTestServer(overrides: EnvironmentOverrides = {}) {
  const scope = openTestScope();
  const dependencies = await acquireTestDependencies(scope, overrides);
  const { close, ...server } = await serveEnvironment(dependencies, {});
  scope.defer(close);
  const owner = await exchangePairing(
    server.origin,
    server.pairingUrl,
    "Owner",
  );
  const connect = async (
    credential: EnvironmentCredential,
    invalidation = unchanged,
  ): Promise<EnvironmentConnection> => {
    const connection = await connectEnvironment(
      server.origin,
      credential,
      invalidation,
    );
    scope.defer(connection.close);
    return connection;
  };
  const requests = (credential: EnvironmentCredential) => {
    const connection = connect(credential);
    return (async (route, input, options) =>
      (await connection).requests(
        route,
        input,
        options,
      )) satisfies EnvironmentRequests as EnvironmentRequests;
  };
  return {
    ...server,
    close: scope.close,
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
  | { readonly _tag: "Answered"; readonly greeting: unknown }
  | { readonly _tag: "Rejected"; readonly failure: unknown }
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
    const procedures = createORPCClient<Procedures>(
      new RPCLink({ websocket: socket as unknown as globalThis.WebSocket }),
    );
    socket.once("error", rejectHello);
    socket.once("close", (code, reason) =>
      resolveHello({ _tag: "Closed", code, reason: reason.toString() }),
    );
    socket.once("open", () =>
      procedures[EnvironmentSessionApi.hello._tag]?.({ protocol }).then(
        (greeting) => {
          resolveHello({ _tag: "Answered", greeting });
          socket.close();
        },
        (error) => {
          if (error instanceof ORPCError && error.code === "Rejected")
            resolveHello({ _tag: "Rejected", failure: error.data });
          socket.close();
        },
      ),
    );
  });
}

async function callRoute(
  procedures: Procedures,
  route: EnvironmentRoute,
  input: unknown,
) {
  const call = procedures[route._tag];
  if (call === undefined) throw new Error(`No handler serves ${route._tag}.`);
  try {
    return overTheWire(await call(input));
  } catch (error) {
    if (error instanceof ORPCError && error.code === "Rejected")
      throw overTheWire(error.data);
    throw error;
  }
}

function overTheWire(value: unknown) {
  const encoded = JSON.stringify(value);
  return encoded === undefined ? undefined : JSON.parse(encoded);
}

async function acquireTestDependencies(
  scope: ResourceScope,
  overrides: EnvironmentOverrides,
) {
  const home = await realpath(await mkdtemp(join(tmpdir(), "rebase server ")));
  scope.defer(() => removeTemporaryDirectory(home));
  const git = createLocalGitCommandRunner();
  const environment = scope.use(
    await acquireEnvironment(home, overrides.git?.(git) ?? git),
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
    gitHosts: { ...environment.gitHosts, ...overrides.gitHosts },
    avatarImages: overrides.avatarImages ?? environment.avatarImages,
    home,
  };
}

function openTestScope() {
  const scope = createResourceScope();
  onTestFinished(scope.close);
  return scope;
}
