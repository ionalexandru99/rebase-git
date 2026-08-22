import type { EnvironmentHelloResult } from "@rebase/contracts";
import { Data } from "effect";

export class EnvironmentWebSocketSessionClosed extends Data.TaggedError(
  "EnvironmentWebSocketSessionClosed",
)<Record<never, never>> {}

export class EnvironmentWebSocketSessionRejected extends Data.TaggedError(
  "EnvironmentWebSocketSessionRejected",
)<{
  readonly result: EnvironmentHelloResult;
}> {}

export class EnvironmentWebSocketWriteError extends Data.TaggedError(
  "EnvironmentWebSocketWriteError",
)<{
  readonly closeCode: number;
  readonly reason: string;
}> {}
