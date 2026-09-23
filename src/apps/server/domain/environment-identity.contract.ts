import { Context, type Effect } from "effect";
import type { EnvironmentStorageError } from "#server/domain/environment-storage-error.contract";

export interface Environment {
  readonly automaticPort: number | null;
  readonly id: string;
}

export interface EnvironmentIdentityService {
  readonly current: () => Effect.Effect<Environment, EnvironmentStorageError>;
  readonly claimAutomaticPort: (
    port: number,
  ) => Effect.Effect<void, EnvironmentStorageError>;
}

export class EnvironmentIdentity extends Context.Service<
  EnvironmentIdentity,
  EnvironmentIdentityService
>()("EnvironmentIdentity") {}
