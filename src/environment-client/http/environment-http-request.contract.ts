import type { EnvironmentHttpRoute } from "@rebase/contracts";
import type { Schema } from "effect";
import type { EnvironmentCredential } from "#environment-client/environment-credential.contract";

export type RequestableEnvironmentHttpRoute = EnvironmentHttpRoute & {
  readonly failure: Schema.ConstraintDecoder<unknown>;
  readonly request?: Schema.ConstraintEncoder<unknown>;
  readonly success: Schema.ConstraintDecoder<unknown>;
};

export type EnvironmentHttpCommand<
  Route extends RequestableEnvironmentHttpRoute,
> = Route extends {
  readonly request: infer Request extends Schema.ConstraintEncoder<unknown>;
}
  ? Request["Type"]
  : undefined;

export interface EnvironmentHttpRequestOptions<
  Route extends RequestableEnvironmentHttpRoute,
> {
  readonly command: EnvironmentHttpCommand<Route>;
  readonly credential?: EnvironmentCredential;
  readonly maxResponseBytes?: number;
  readonly signal?: AbortSignal;
}
