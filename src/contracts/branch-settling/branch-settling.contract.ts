import { z } from "zod";
import {
  repositoryCommand,
  repositoryQuery,
} from "#contracts/environment-connection/environment-route.contract.ts";
import { RefName, WorktreeScope } from "#contracts/git/git-values.contract.ts";

export const SettledDay = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
export type SettledDay = z.infer<typeof SettledDay>;

export const SettleBranches = z.object({
  ...WorktreeScope.shape,
  names: z.array(RefName).min(1).max(1_000).readonly(),
  settled: z.boolean(),
});
export type SettleBranches = z.infer<typeof SettleBranches>;

export const defaultDeleteSettledAfter = 3;

export const BranchSettings = z.object({
  autoSettle: z.boolean(),
  deleteSettledAfter: z.int().min(0).max(365),
});
export type BranchSettings = z.infer<typeof BranchSettings>;

export const BranchSettlingApi = {
  settle: repositoryCommand("repositories/branches/settle", {
    request: SettleBranches,
    success: z.object({}),
  }),
  settings: repositoryQuery("repositories/branch-settings", {
    request: WorktreeScope,
    success: BranchSettings,
  }),
  saveSettings: repositoryCommand("repositories/branch-settings/save", {
    request: z.object({ ...WorktreeScope.shape, ...BranchSettings.shape }),
    success: BranchSettings,
  }),
};
