import {
  isRouteOk,
  type RouteFailure,
  type RouteInput,
  type RouteSuccess,
} from "@rebase/contracts";
import type { RequestableEnvironmentHttpRoute } from "@rebase/environment-client";
import { Effect, Schema } from "effect";
import type { EnvironmentFeature } from "#server/adapters/environment-transport/environment-feature.contract";
import type {
  EnvironmentHttpRequestContext,
  EnvironmentHttpRouteHandler,
} from "#server/adapters/environment-transport/http/environment-http-route-handler.contract";
import {
  type GitCommandRunner,
  GitCommands,
} from "#server/domain/git-command.contract";
import {
  RepositoryAccess,
  type RepositoryAccessService,
} from "#server/domain/repository-access.contract";
import {
  RepositoryCoordination,
  type RepositoryCoordinationService,
} from "#server/domain/repository-coordination.contract";

export interface RepositoryServices {
  readonly access: RepositoryAccessService;
  readonly git: GitCommandRunner;
  readonly coordination: RepositoryCoordinationService;
}

const context: EnvironmentHttpRequestContext = {
  credential: undefined,
  device: {
    capabilities: ["repository.read", "repository.write"],
    id: "00000000-0000-4000-8000-000000000009",
    label: "Feature test device",
    role: "custom",
  },
  establishBrowserSession: () => {},
  origin: "http://127.0.0.1",
};

type FeatureRoutes = Record<string, RequestableEnvironmentHttpRoute>;

type FeatureRoutesClient<Routes extends FeatureRoutes> = {
  readonly [Name in keyof Routes]: Routes[Name] extends {
    readonly request: Schema.ConstraintEncoder<unknown>;
  }
    ? (
        command: RouteInput<Routes[Name]>,
      ) => Effect.Effect<RouteSuccess<Routes[Name]>, RouteFailure<Routes[Name]>>
    : () => Effect.Effect<
        RouteSuccess<Routes[Name]>,
        RouteFailure<Routes[Name]>
      >;
};

export function repositoryFeatureClient<Routes extends FeatureRoutes>(
  routes: Routes,
  feature: Effect.Effect<
    EnvironmentFeature,
    never,
    RepositoryAccess | GitCommands | RepositoryCoordination
  >,
  services: RepositoryServices,
) {
  const served = Effect.runSync(
    feature.pipe(provideRepositoryServices(services)),
  );
  return featureRoutesClient(routes, served.httpRoutes);
}

export function provideRepositoryServices(services: RepositoryServices) {
  return <A, E, R>(effect: Effect.Effect<A, E, R>) =>
    effect.pipe(
      Effect.provideService(RepositoryAccess, services.access),
      Effect.provideService(GitCommands, services.git),
      Effect.provideService(RepositoryCoordination, services.coordination),
    );
}

export function featureRoutesClient<Routes extends FeatureRoutes>(
  routes: Routes,
  handlers: readonly EnvironmentHttpRouteHandler[],
): FeatureRoutesClient<Routes> {
  const client: Partial<Record<keyof Routes, unknown>> = {};
  for (const name of Object.keys(routes) as (keyof Routes)[]) {
    const route = routes[name];
    client[name] = (input: RouteInput<typeof route>) =>
      serveRoute(route, input, handlers);
  }
  return client as FeatureRoutesClient<Routes>;
}

function serveRoute<Route extends RequestableEnvironmentHttpRoute>(
  route: Route,
  input: RouteInput<Route>,
  handlers: readonly EnvironmentHttpRouteHandler[],
): Effect.Effect<RouteSuccess<Route>, RouteFailure<Route>> {
  const handler = handlers.find(
    (candidate) => candidate.route.path === route.path,
  );
  if (handler === undefined)
    return Effect.die(new Error(`No handler serves ${route.path}.`));
  return handler.respond(input, context).pipe(
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
