import { Schema } from "effect";

export const RepositoryFetchSetting = Schema.Union([
  Schema.TaggedStruct("Inherit", {}),
  Schema.TaggedStruct("Disabled", {}),
  Schema.TaggedStruct("Interval", {
    seconds: Schema.Int.check(
      Schema.isBetween({ minimum: 1, maximum: 86_400 }),
    ),
  }),
]);
export type RepositoryFetchSetting = typeof RepositoryFetchSetting.Type;

export const RepositoryFreshness = Schema.Struct({
  fetching: Schema.Boolean,
  stale: Schema.Boolean,
  revision: Schema.Natural,
  defaultIntervalSeconds: Schema.Int.check(Schema.isGreaterThan(0)),
  setting: RepositoryFetchSetting,
  failure: Schema.optionalKey(
    Schema.TaggedStruct("FetchFailed", {
      reason: Schema.Literals([
        "GitUnavailable",
        "Timeout",
        "OutputTooLarge",
        "Failed",
      ]),
    }),
  ),
});
export type RepositoryFreshness = typeof RepositoryFreshness.Type;
