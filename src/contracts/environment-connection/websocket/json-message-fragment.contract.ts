import { EnvironmentRequestId } from "@rebase/contracts/environment-connection/negotiation/environment-protocol.contract";
import { Schema } from "effect";

export const maximumJsonFragmentCount = 4_096;
export const maximumJsonMessageBytes = 64 * 1_048_576;

export interface JsonLogicalMessage {
  readonly logicalMessageId: number;
  readonly payload: Uint8Array;
  readonly requestId: string;
}

export const JsonMessageFragment = Schema.TaggedStruct("JsonMessageFragment", {
  fragmentCount: Schema.Int.check(
    Schema.isBetween({ minimum: 1, maximum: maximumJsonFragmentCount }),
  ),
  fragmentIndex: Schema.Natural,
  logicalMessageId: Schema.Natural,
  payload: Schema.String,
  requestId: EnvironmentRequestId,
}).check(
  Schema.makeFilter(
    (fragment) => fragment.fragmentIndex < fragment.fragmentCount,
  ),
);
export type JsonMessageFragment = typeof JsonMessageFragment.Type;
