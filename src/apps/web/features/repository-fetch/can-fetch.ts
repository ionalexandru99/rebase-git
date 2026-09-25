export interface FetchConditions {
  readonly connected: boolean;
  readonly writable: boolean;
  readonly fetching: boolean;
  readonly recoveryBusy: boolean;
  readonly pulling: boolean;
  readonly freshnessReady: boolean;
}

export function canFetch(conditions: FetchConditions): boolean {
  return (
    conditions.connected &&
    conditions.writable &&
    !conditions.fetching &&
    !conditions.recoveryBusy &&
    !conditions.pulling &&
    conditions.freshnessReady
  );
}
