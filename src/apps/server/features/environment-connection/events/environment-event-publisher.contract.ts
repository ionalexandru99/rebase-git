export interface EnvironmentEventPublisher {
  readonly currentSequence: () => number;
  readonly publishChanged: () => number;
  readonly subscribe: (subscriber: (sequence: number) => void) => () => void;
}
