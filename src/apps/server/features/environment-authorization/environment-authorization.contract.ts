export interface EnvironmentAuthorizationClock {
  readonly now: () => Date;
}

export interface EnvironmentAuthorizationOptions {
  readonly clock?: EnvironmentAuthorizationClock;
}
