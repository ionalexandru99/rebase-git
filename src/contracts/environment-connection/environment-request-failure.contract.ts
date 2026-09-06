import { Schema } from "effect";

export const InvalidMessage = Schema.TaggedStruct("InvalidMessage", {});
export const PayloadTooLarge = Schema.TaggedStruct("PayloadTooLarge", {
  limitBytes: Schema.Natural,
});
