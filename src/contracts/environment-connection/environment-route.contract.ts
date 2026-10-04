import { Schema } from "effect";
import { Rpc, type RpcSchema } from "effect/rpc";
import { RepositoryRejected } from "#contracts/git/git-failures.contract.ts";

export interface EnvironmentRoute extends Rpc.Any {
  readonly payloadSchema: Schema.Top;
  readonly successSchema: Schema.Top;
  readonly errorSchema: Schema.Top;
}

export type RouteInput<Route extends EnvironmentRoute> =
  Route["payloadSchema"]["Type"];
export type RouteSuccess<Route extends EnvironmentRoute> =
  Route["successSchema"]["Type"];
export type RouteFailure<Route extends EnvironmentRoute> =
  Route["errorSchema"]["Type"];

export interface EnvironmentStreamRoute extends EnvironmentRoute {
  readonly successSchema: RpcSchema.Stream<Schema.Top, Schema.Top>;
}

export type StreamValue<Route extends EnvironmentStreamRoute> =
  Route["successSchema"]["success"]["Type"];

interface RouteDefinition<
  Request extends Schema.Top,
  Success extends Schema.Top,
  Failure extends Schema.Top,
> {
  readonly request?: Request;
  readonly success: Success;
  readonly failure?: Failure;
}

export function route<
  const Tag extends string,
  Success extends Schema.Top,
  Failure extends Schema.Top = Schema.Never,
  Request extends Schema.Top = Schema.Void,
>(
  tag: Tag,
  definition: RouteDefinition<Request, Success, Failure>,
): Rpc.Rpc<Tag, Request, Success, Failure> {
  return Rpc.make(tag, {
    payload: definition.request ?? Schema.Void,
    success: definition.success,
    error: definition.failure ?? Schema.Never,
  }) as unknown as Rpc.Rpc<Tag, Request, Success, Failure>;
}

export function repositoryQuery<
  const Tag extends string,
  Request extends Schema.Top,
  Success extends Schema.Top,
  Failure extends Schema.Top = Schema.Never,
>(
  tag: Tag,
  definition: RouteDefinition<Request, Success, Failure> & {
    readonly request: Request;
  },
) {
  return route(tag, {
    request: definition.request,
    success: definition.success,
    failure: Schema.Union([
      definition.failure ?? Schema.Never,
      RepositoryRejected,
    ]),
  });
}

export const repositoryCommand = repositoryQuery;
