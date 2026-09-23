import type { EnvironmentAccessCapability } from "@rebase/contracts/environment-connection/environment-access-capability.contract";
import type { Schema } from "effect";

export interface EnvironmentHttpRoute {
  readonly capability: EnvironmentAccessCapability | null;
  readonly failure: Schema.Top;
  readonly failureStatuses: readonly (
    | 400
    | 401
    | 403
    | 404
    | 409
    | 410
    | 413
    | 422
  )[];
  readonly method: "GET" | "POST";
  readonly path: `/api/${string}`;
  readonly request?: Schema.Top;
  readonly success: Schema.Top;
  readonly successStatus: 200 | 201;
}
