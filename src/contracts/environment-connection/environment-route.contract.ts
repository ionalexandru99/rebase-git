import { z } from "zod";
import { RepositoryRejected } from "#contracts/git/git-failures.contract.ts";

interface Route<
  Tag extends string,
  Request extends z.ZodType,
  Success extends z.ZodType,
  Failure extends z.ZodType,
> {
  readonly _tag: Tag;
  readonly request: Request;
  readonly success: Success;
  readonly failure: Failure;
}

export interface EnvironmentRoute<
  Tag extends string = string,
  Request extends z.ZodType = z.ZodType,
  Success extends z.ZodType = z.ZodType,
  Failure extends z.ZodType = z.ZodType,
> extends Route<Tag, Request, Success, Failure> {
  readonly stream: false;
}

export interface EnvironmentStreamRoute<
  Tag extends string = string,
  Request extends z.ZodType = z.ZodType,
  Value extends z.ZodType = z.ZodType,
  Failure extends z.ZodType = z.ZodType,
> extends Route<Tag, Request, Value, Failure> {
  readonly stream: true;
}

export type AnyEnvironmentRoute = EnvironmentRoute | EnvironmentStreamRoute;

export type RouteInput<Route extends AnyEnvironmentRoute> =
  Route["request"]["_zod"]["output"];
export type RouteSuccess<Route extends EnvironmentRoute> =
  Route["success"]["_zod"]["output"];
export type RouteFailure<Route extends AnyEnvironmentRoute> =
  Route["failure"]["_zod"]["output"];
export type StreamValue<Route extends EnvironmentStreamRoute> =
  Route["success"]["_zod"]["output"];

interface RouteDefinition<
  Request extends z.ZodType,
  Success extends z.ZodType,
  Failure extends z.ZodType,
> {
  readonly request?: Request;
  readonly success: Success;
  readonly failure?: Failure;
}

type RepositoryRouteDefinition<
  Request extends z.ZodType,
  Success extends z.ZodType,
  Failure extends z.ZodType,
> = RouteDefinition<Request, Success, Failure> & { readonly request: Request };

type WithRejection<Failure extends z.ZodType> = z.ZodUnion<
  [Failure, typeof RepositoryRejected]
>;

export function route<
  const Tag extends string,
  Success extends z.ZodType,
  Failure extends z.ZodType = z.ZodNever,
  Request extends z.ZodType = z.ZodVoid,
>(
  tag: Tag,
  definition: RouteDefinition<Request, Success, Failure>,
): EnvironmentRoute<Tag, Request, Success, Failure> {
  return { ...describe(tag, definition), stream: false };
}

export function streamRoute<
  const Tag extends string,
  Value extends z.ZodType,
  Failure extends z.ZodType = z.ZodNever,
  Request extends z.ZodType = z.ZodVoid,
>(
  tag: Tag,
  definition: RouteDefinition<Request, Value, Failure>,
): EnvironmentStreamRoute<Tag, Request, Value, Failure> {
  return { ...describe(tag, definition), stream: true };
}

export function repositoryQuery<
  const Tag extends string,
  Request extends z.ZodType,
  Success extends z.ZodType,
  Failure extends z.ZodType = z.ZodNever,
>(
  tag: Tag,
  definition: RepositoryRouteDefinition<Request, Success, Failure>,
): EnvironmentRoute<Tag, Request, Success, WithRejection<Failure>> {
  return route(tag, {
    ...definition,
    failure: withRejection(definition.failure),
  });
}

export const repositoryCommand = repositoryQuery;

function describe<
  Tag extends string,
  Request extends z.ZodType,
  Success extends z.ZodType,
  Failure extends z.ZodType,
>(tag: Tag, definition: RouteDefinition<Request, Success, Failure>) {
  return {
    _tag: tag,
    request: (definition.request ?? z.void()) as Request,
    success: definition.success,
    failure: (definition.failure ?? z.never()) as Failure,
  };
}

function withRejection<Failure extends z.ZodType>(failure?: Failure) {
  return z.union([
    failure ?? z.never(),
    RepositoryRejected,
  ]) as WithRejection<Failure>;
}
