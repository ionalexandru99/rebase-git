import type { Effect, Schema } from "effect";
import type {
  EnvironmentHttpRejected,
  EnvironmentHttpResponseError,
} from "#environment-client/http/environment-http-json.contract";

export type EnvironmentRequestClient = <
  Failure extends Schema.ConstraintDecoder<unknown, never>,
  Error,
>(
  failure: Failure,
  errors: {
    readonly disconnected: () => Error;
    readonly response: (
      error:
        | EnvironmentHttpResponseError
        | EnvironmentHttpRejected<Failure["Type"]>,
    ) => Error;
  },
) => <
  Request extends Schema.ConstraintDecoder<unknown, never>,
  Success extends Schema.ConstraintDecoder<unknown, never>,
>(
  endpoint: {
    readonly path: string;
    readonly request: Request;
    readonly success: Success;
  },
  command: Request["Type"],
) => Effect.Effect<Success["Type"], Error>;
