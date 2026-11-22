import {
  FetchPruneApi,
  PullStrategy,
  PullStrategyApi,
} from "#contracts/repository-pull/repository-pull.contract.ts";
import type { SelectSetting } from "#web/features/settings/setting-rows.tsx";

const strategyLabels: Record<PullStrategy, string> = {
  ask: "Ask",
  rebase: "Rebase",
  merge: "Merge",
};

export const pullStrategySetting: SelectSetting<PullStrategy> = {
  title: "Diverged pull",
  action: "savePullStrategy",
  api: PullStrategyApi,
  choices: PullStrategy.options.map((value) => ({
    label: strategyLabels[value],
    value,
  })),
};

export const fetchPruneSetting: SelectSetting<boolean> = {
  title: "Remove deleted remote branches",
  action: "saveFetchPrune",
  api: FetchPruneApi,
  choices: [
    { label: "On", value: true },
    { label: "Off", value: false },
  ],
};
