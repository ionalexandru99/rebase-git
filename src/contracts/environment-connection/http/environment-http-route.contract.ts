import type { EnvironmentAccessCapability } from "@rebase/contracts/environment-connection/environment-access-capability.contract";
import type { Schema } from "effect";

const environmentTransportFailureStatuses = [400, 401, 403, 410, 413] as const;

type EnvironmentTransportFailureStatus =
  (typeof environmentTransportFailureStatuses)[number];

export interface EnvironmentHttpRoute {
  readonly capability: EnvironmentAccessCapability | null;
  readonly failure: Schema.Top;
  readonly failureStatuses?: readonly (404 | 409 | 422)[];
  readonly method: "GET" | "POST";
  readonly path: `/api/${string}`;
  readonly request?: Schema.Top;
  readonly success: Schema.Top;
  readonly successStatus: 200 | 201;
}

export type EnvironmentHttpFailureStatus<
  Route extends EnvironmentHttpRoute = EnvironmentHttpRoute,
> =
  | EnvironmentTransportFailureStatus
  | ("failureStatuses" extends keyof Route
      ? NonNullable<Route["failureStatuses"]>[number]
      : never);

export function isEnvironmentHttpFailureStatus(
  route: EnvironmentHttpRoute,
  status: number,
) {
  return [
    ...environmentTransportFailureStatuses,
    ...(route.failureStatuses ?? []),
  ].some((failureStatus) => failureStatus === status);
}
