import type {
  EnvironmentAccessFailure,
  EnvironmentDirectoryRejected,
  EnvironmentFilesystemHttpApi,
} from "@rebase/contracts";
import { Data } from "effect";
import type { EffectRoutesClient } from "#web/platform/environment/effect-routes-client";

export class EnvironmentFilesystemResponseError extends Data.TaggedError(
  "EnvironmentFilesystemResponseError",
) {}

export class EnvironmentFilesystemRejected extends Data.TaggedError(
  "EnvironmentFilesystemRejected",
)<{
  readonly failure: EnvironmentDirectoryRejected | EnvironmentAccessFailure;
}> {}

export type EnvironmentFilesystemClientError =
  | EnvironmentFilesystemRejected
  | EnvironmentFilesystemResponseError;

export type EnvironmentFilesystemClient = EffectRoutesClient<
  typeof EnvironmentFilesystemHttpApi,
  EnvironmentFilesystemClientError
>;
