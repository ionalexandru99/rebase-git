import { Schema } from "effect";

export const AuthorizationDenied = Schema.TaggedStruct(
  "AuthorizationDenied",
  {},
);
export type AuthorizationDenied = typeof AuthorizationDenied.Type;

export const AlreadyWatching = Schema.TaggedStruct("AlreadyWatching", {});

export const EnvironmentRpcFailure = Schema.Union([
  AuthorizationDenied,
  AlreadyWatching,
]);
export type EnvironmentRpcFailure = typeof EnvironmentRpcFailure.Type;
