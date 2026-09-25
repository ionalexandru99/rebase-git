export interface PullConditions {
  readonly connected: boolean;
  readonly writable: boolean;
  readonly activeBranch: string | undefined;
  readonly recoveryBusy: boolean;
  readonly pulling: boolean;
  readonly freshnessReady: boolean;
}

export function canPull(conditions: PullConditions): boolean {
  return (
    conditions.connected &&
    conditions.writable &&
    conditions.activeBranch !== undefined &&
    !conditions.recoveryBusy &&
    !conditions.pulling &&
    conditions.freshnessReady
  );
}
