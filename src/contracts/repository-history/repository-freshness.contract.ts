import { EnvironmentRequestId } from "@rebase/contracts/environment-connection/negotiation/environment-protocol.contract";
import { Schema } from "effect";

const RepositoryId = Schema.String.check(Schema.isUUID(4));

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

export const SubscribeRepositoryHistory = Schema.TaggedStruct(
  "SubscribeRepositoryHistory",
  {
    repositoryId: RepositoryId,
    requestId: EnvironmentRequestId,
  },
);
export const UnsubscribeRepositoryHistory = Schema.TaggedStruct(
  "UnsubscribeRepositoryHistory",
  {
    repositoryId: RepositoryId,
  },
);
export const FetchRepositoryHistory = Schema.TaggedStruct(
  "FetchRepositoryHistory",
  {
    repositoryId: RepositoryId,
    requestId: EnvironmentRequestId,
  },
);
export const ConfigureRepositoryFetch = Schema.TaggedStruct(
  "ConfigureRepositoryFetch",
  {
    repositoryId: RepositoryId,
    requestId: EnvironmentRequestId,
    setting: RepositoryFetchSetting,
  },
);
export const RepositoryFreshnessClientMessage = Schema.Union([
  SubscribeRepositoryHistory,
  UnsubscribeRepositoryHistory,
  FetchRepositoryHistory,
  ConfigureRepositoryFetch,
]);
export type RepositoryFreshnessClientMessage =
  typeof RepositoryFreshnessClientMessage.Type;

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

export const RepositoryHistoryFreshness = Schema.TaggedStruct(
  "RepositoryHistoryFreshness",
  {
    repositoryId: RepositoryId,
    requestId: EnvironmentRequestId,
    freshness: RepositoryFreshness,
  },
);
export type RepositoryHistoryFreshness = typeof RepositoryHistoryFreshness.Type;
