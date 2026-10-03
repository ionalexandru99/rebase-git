import { Schema } from "effect";
import {
  repositoryCommand,
  repositoryQuery,
} from "#contracts/environment-connection/environment-route.contract.ts";
import {
  RefName,
  RepositoryId,
  RepositoryPath,
} from "#contracts/git/git-values.contract.ts";

export const SettledDay = Schema.String.check(
  Schema.isPattern(/^\d{4}-\d{2}-\d{2}$/),
);
export type SettledDay = typeof SettledDay.Type;

const SettlingScope = {
  repositoryId: RepositoryId,
  worktreePath: RepositoryPath,
};

export const SettleBranches = Schema.Struct({
  ...SettlingScope,
  names: Schema.Array(RefName).check(
    Schema.isMinLength(1),
    Schema.isMaxLength(1_000),
  ),
  settled: Schema.Boolean,
});
export type SettleBranches = typeof SettleBranches.Type;

export const defaultDeleteSettledAfter = 3;

export const BranchSettings = Schema.Struct({
  autoSettle: Schema.Boolean,
  deleteSettledAfter: Schema.Int.check(
    Schema.isBetween({ minimum: 0, maximum: 365 }),
  ),
});
export type BranchSettings = typeof BranchSettings.Type;

export const BranchSettlingApi = {
  settle: repositoryCommand("repositories/branches/settle", {
    request: SettleBranches,
    success: Schema.Struct({}),
  }),
  settings: repositoryQuery("repositories/branch-settings", {
    request: Schema.Struct(SettlingScope),
    success: BranchSettings,
  }),
  saveSettings: repositoryCommand("repositories/branch-settings/save", {
    request: Schema.Struct({ ...SettlingScope, ...BranchSettings.fields }),
    success: BranchSettings,
  }),
};
