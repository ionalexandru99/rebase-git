import type {
  EnvironmentDirectory,
  EnvironmentDirectoryRejected,
} from "@rebase/contracts";
import { Context, Data, type Effect } from "effect";

export interface EnvironmentFilesystem {
  readonly listDirectory: (
    path?: string,
    includeHidden?: boolean,
  ) => Effect.Effect<EnvironmentDirectory, EnvironmentFilesystemError>;
}

export class EnvironmentFilesystemError extends Data.TaggedError(
  "EnvironmentFilesystemError",
)<{
  readonly cause?: unknown;
  readonly failure: EnvironmentDirectoryRejected;
}> {}

export class EnvironmentFilesystemAccess extends Context.Service<
  EnvironmentFilesystemAccess,
  EnvironmentFilesystem
>()("EnvironmentFilesystemAccess") {}
