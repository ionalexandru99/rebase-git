import { isRouteOk, type RouteFailure } from "@rebase/contracts";
import {
  type EnvironmentHttpRoutes,
  environmentHttpRoutesClient,
} from "@rebase/environment-client";
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

export function repositoryFeatureClient<Routes extends EnvironmentHttpRoutes>(
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

export function featureRoutesClient<Routes extends EnvironmentHttpRoutes>(
  routes: Routes,
  handlers: readonly EnvironmentHttpRouteHandler[],
) {
  return environmentHttpRoutesClient<
    Routes,
    RouteFailure<Routes[keyof Routes]>
  >(routes, (route, input) => {
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
  });
}
