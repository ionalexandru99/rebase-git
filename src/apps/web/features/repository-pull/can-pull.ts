export interface PullConditions {
  readonly canRun: boolean;
  readonly activeBranch: string | undefined;
  readonly recoveryBusy: boolean;
  readonly pulling: boolean;
  readonly freshnessReady: boolean;
}

export function canPull(conditions: PullConditions): boolean {
  return (
    conditions.canRun &&
    conditions.activeBranch !== undefined &&
    !conditions.recoveryBusy &&
    !conditions.pulling &&
    conditions.freshnessReady
  );
}
