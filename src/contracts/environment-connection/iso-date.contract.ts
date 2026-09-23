import { Schema } from "effect";

export const IsoDate = Schema.String.check(
  Schema.isPattern(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/),
  Schema.makeFilter(
    (value) =>
      new Date(value).toISOString() === value ||
      "must be a real calendar date and clock time",
  ),
);
export type IsoDate = typeof IsoDate.Type;
