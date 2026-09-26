import type { EnvironmentAccessCapability } from "@rebase/contracts/environment-connection/environment-access-capability.contract";
import { RepositoryRejected } from "@rebase/contracts/git/git-failures.contract";
import { Schema } from "effect";

type RoutePath = `/api/${string}`;
type RouteMethod = "GET" | "POST";

export interface EnvironmentHttpRoute {
  readonly capability: EnvironmentAccessCapability | null;
  readonly method: RouteMethod;
  readonly path: RoutePath;
  readonly request?: Schema.Top;
  readonly response: Schema.Top;
}

export type RouteResultValue<Success, Failure> =
  | { readonly _tag: "Ok"; readonly value: Success }
  | { readonly _tag: "Rejected"; readonly failure: Failure };

export function RouteResult<
  Success extends Schema.Top,
  Failure extends Schema.Top,
>(success: Success, failure: Failure) {
  return Schema.Union([
    Schema.TaggedStruct("Ok", { value: success }),
    Schema.TaggedStruct("Rejected", { failure }),
  ]);
}

export type RouteResult<
  Success extends Schema.Top,
  Failure extends Schema.Top,
> = ReturnType<typeof RouteResult<Success, Failure>>;

export function isRouteOk<Result extends RouteResultValue<unknown, unknown>>(
  result: Result,
): result is Extract<Result, { readonly _tag: "Ok" }> {
  return result._tag === "Ok";
}

export interface ResultRoute {
  readonly response: { readonly Type: RouteResultValue<unknown, unknown> };
}

export type RouteSuccess<Route extends ResultRoute> = Extract<
  Route["response"]["Type"],
  { readonly _tag: "Ok" }
>["value"];

export type RouteFailure<Route extends ResultRoute> = Extract<
  Route["response"]["Type"],
  { readonly _tag: "Rejected" }
>["failure"];

export type RouteInput<Route> = Route extends {
  readonly request?: infer Request;
}
  ? Request extends Schema.Top
    ? Request["Type"]
    : undefined
  : undefined;

interface RouteDefinition<
  Capability extends EnvironmentAccessCapability | null,
  Success extends Schema.Top,
  Failure extends Schema.Top,
> {
  readonly capability: Capability;
  readonly method: RouteMethod;
  readonly path: RoutePath;
  readonly success: Success;
  readonly failure?: Failure;
}

export interface DeclaredRoute<
  Capability extends EnvironmentAccessCapability | null,
  Success extends Schema.Top,
  Failure extends Schema.Top,
> {
  readonly capability: Capability;
  readonly method: RouteMethod;
  readonly path: RoutePath;
  readonly response: RouteResult<Success, Failure>;
}

export function route<
  Capability extends EnvironmentAccessCapability | null,
  Request extends Schema.Top,
  Success extends Schema.Top,
  Failure extends Schema.Top = Schema.Never,
>(
  definition: RouteDefinition<Capability, Success, Failure> & {
    readonly request: Request;
  },
): DeclaredRoute<Capability, Success, Failure> & { readonly request: Request };
export function route<
  Capability extends EnvironmentAccessCapability | null,
  Success extends Schema.Top,
  Failure extends Schema.Top = Schema.Never,
>(
  definition: RouteDefinition<Capability, Success, Failure>,
): DeclaredRoute<Capability, Success, Failure>;
export function route(
  definition: RouteDefinition<
    EnvironmentAccessCapability | null,
    Schema.Top,
    Schema.Top
  > & { readonly request?: Schema.Top },
): EnvironmentHttpRoute {
  return {
    capability: definition.capability,
    method: definition.method,
    path: definition.path,
    ...(definition.request === undefined
      ? {}
      : { request: definition.request }),
    response: RouteResult(
      definition.success,
      definition.failure ?? Schema.Never,
    ),
  };
}

interface RepositoryRouteDefinition<
  Request extends Schema.Top,
  Success extends Schema.Top,
  Failure extends Schema.Top,
> {
  readonly request: Request;
  readonly success: Success;
  readonly failure?: Failure;
}

export function repositoryQuery<
  Request extends Schema.Top,
  Success extends Schema.Top,
  Failure extends Schema.Top = Schema.Never,
>(
  path: RoutePath,
  definition: RepositoryRouteDefinition<Request, Success, Failure>,
) {
  return repositoryRoute("repository.read", path, definition);
}

export function repositoryCommand<
  Request extends Schema.Top,
  Success extends Schema.Top,
  Failure extends Schema.Top = Schema.Never,
>(
  path: RoutePath,
  definition: RepositoryRouteDefinition<Request, Success, Failure>,
) {
  return repositoryRoute("repository.write", path, definition);
}

function repositoryRoute<
  Capability extends "repository.read" | "repository.write",
  Request extends Schema.Top,
  Success extends Schema.Top,
  Failure extends Schema.Top,
>(
  capability: Capability,
  path: RoutePath,
  {
    request,
    success,
    failure,
  }: RepositoryRouteDefinition<Request, Success, Failure>,
) {
  return route({
    capability,
    method: "POST",
    path,
    request,
    success,
    failure: Schema.Union([failure ?? Schema.Never, RepositoryRejected]),
  });
}
