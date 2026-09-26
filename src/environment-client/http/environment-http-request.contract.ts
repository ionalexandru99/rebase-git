import type {
  EnvironmentHttpRoute,
  RouteInput,
  RouteResultValue,
} from "@rebase/contracts";
import type { Schema } from "effect";
import type { EnvironmentCredential } from "#environment-client/environment-credential.contract";

export type RequestableEnvironmentHttpRoute = EnvironmentHttpRoute & {
  readonly request?: Schema.ConstraintEncoder<unknown>;
  readonly response: Schema.ConstraintDecoder<
    RouteResultValue<unknown, unknown>
  >;
};

export interface EnvironmentHttpRequestOptions<
  Route extends RequestableEnvironmentHttpRoute,
> {
  readonly command: RouteInput<Route>;
  readonly credential?: EnvironmentCredential;
  readonly maxResponseBytes?: number;
  readonly signal?: AbortSignal;
}
