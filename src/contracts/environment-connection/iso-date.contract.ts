import { Schema } from "effect";

export const IsoDate = Schema.String.check(
  Schema.isPattern(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/),
);
export type IsoDate = typeof IsoDate.Type;
