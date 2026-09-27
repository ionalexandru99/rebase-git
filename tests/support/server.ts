import { mkdtemp, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  EnvironmentAuthorizationHttpApi,
  isRouteOk,
  type RouteFailure,
  type RouteInput,
  type RouteSuccess,
} from "@rebase/contracts";
import {
  createEnvironmentRequestClient,
  type EnvironmentCredential,
  exchangeEnvironmentPairingEffect,
  type RequestableEnvironmentHttpRoute,
} from "@rebase/environment-client";
import { Effect, Exit, Schema, Scope } from "effect";
import { onTestFinished } from "vite-plus/test";
import type { EnvironmentEventPublisher } from "#server/adapters/environment-transport/environment-event-publisher";
import type { EnvironmentHttpRequestContext } from "#server/adapters/environment-transport/http/environment-http-route-handler";
import type { GitCommandRunner } from "#server/adapters/local-git/git-commands";
import {
  acquireEnvironment,
  environmentFeatures,
  serveEnvironment,
} from "#server/app/server/start-environment-server";
import type { RepositoryCoordination } from "#server/repository/repository-coordination";
import { removeTemporaryDirectory } from "#tests-support/temporary-directory";

type Routes = Record<string, RequestableEnvironmentHttpRoute>;

export type RoutesClient<Api extends Routes> = {
  readonly [Name in keyof Api]: Api[Name] extends {
    readonly request: Schema.ConstraintEncoder<unknown>;
  }
    ? (
        input: RouteInput<Api[Name]>,
      ) => Effect.Effect<RouteSuccess<Api[Name]>, RouteFailure<Api[Name]>>
    : () => Effect.Effect<RouteSuccess<Api[Name]>, RouteFailure<Api[Name]>>;
};

const requestContext: EnvironmentHttpRequestContext = {
  credential: undefined,
  device: { id: "00000000-0000-4000-8000-000000000009", label: "Test device" },
  establishBrowserSession: () => {},
  origin: "http://127.0.0.1",
};

interface EnvironmentOverrides {
  readonly events?:
    | ((events: EnvironmentEventPublisher) => EnvironmentEventPublisher)
    | undefined;
  readonly git?: ((git: GitCommandRunner) => GitCommandRunner) | undefined;
  readonly coordination?: (
    coordination: RepositoryCoordination,
  ) => RepositoryCoordination;
}

export function openTestEnvironment(overrides: EnvironmentOverrides = {}) {
  return openInTestScope(
    Effect.gen(function* () {
      const dependencies = yield* acquireTestDependencies(overrides);
      const features = yield* environmentFeatures(dependencies);
      return {
        ...dependencies,
        remember: (path: string) =>
          Effect.runPromise(dependencies.catalog.remember(path)),
        routes: <Api extends Routes>(api: Api) => {
          const client: Partial<Record<keyof Api, unknown>> = {};
          for (const name of Object.keys(api) as (keyof Api)[]) {
            const route = api[name];
            client[name] = (input: RouteInput<typeof route>) =>
              serveRoute(route, input, features.httpRoutes);
          }
          return client as RoutesClient<Api>;
        },
      };
    }),
  );
}

export function openTestServer(overrides: EnvironmentOverrides = {}) {
  return openInTestScope(
    Effect.gen(function* () {
      const dependencies = yield* acquireTestDependencies(overrides);
      const server = yield* serveEnvironment(dependencies, {});
      const owner = yield* exchangePairing(
        server.origin,
        new URL(server.pairingUrl).hash.slice(1),
        "Owner",
      );
      const requests = (credential: EnvironmentCredential) =>
        createEnvironmentRequestClient(server.origin, () => credential);
      return {
        ...server,
        events: dependencies.events,
        home: dependencies.home,
        owner,
        requests,
        pair: async (label: string) => {
          const pairing = await requests(owner)(
            EnvironmentAuthorizationHttpApi.createPairing,
            undefined,
          );
          return Effect.runPromise(
            exchangePairing(
              server.origin,
              new URL(pairing.pairingUrl).hash.slice(1),
              label,
            ),
          );
        },
      };
    }),
  );
}

function acquireTestDependencies(overrides: EnvironmentOverrides) {
  return Effect.gen(function* () {
    const home = yield* acquireTemporaryHome;
    const environment = yield* acquireEnvironment(home);
    return {
      ...environment,
      coordination:
        overrides.coordination?.(environment.coordination) ??
        environment.coordination,
      events: overrides.events?.(environment.events) ?? environment.events,
      git: overrides.git?.(environment.git) ?? environment.git,
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

function exchangePairing(
  origin: string,
  pairingMaterial: string,
  label: string,
) {
  return exchangeEnvironmentPairingEffect(origin, {
    label,
    pairingMaterial,
  }).pipe(
    Effect.map((exchanged) => ({
      type: "bearer" as const,
      value: exchanged.credential,
    })),
  );
}

function serveRoute<Route extends RequestableEnvironmentHttpRoute>(
  route: Route,
  input: RouteInput<Route>,
  handlers: Effect.Success<
    ReturnType<typeof environmentFeatures>
  >["httpRoutes"],
): Effect.Effect<RouteSuccess<Route>, RouteFailure<Route>> {
  const handler = handlers.find(
    (candidate) =>
      candidate.route.path === route.path &&
      candidate.route.method === route.method,
  );
  if (handler === undefined)
    return Effect.die(new Error(`No handler serves ${route.path}.`));
  return handler.respond(input, requestContext).pipe(
    Effect.orDie,
    Effect.map((result) =>
      Schema.decodeUnknownSync(route.response)(
        JSON.parse(
          JSON.stringify(Schema.encodeSync(handler.route.response)(result)),
        ),
      ),
    ),
    Effect.flatMap((result) =>
      isRouteOk(result)
        ? Effect.succeed(result.value)
        : Effect.fail(result.failure),
    ),
  );
}
