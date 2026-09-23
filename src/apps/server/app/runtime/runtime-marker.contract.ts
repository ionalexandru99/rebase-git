export interface RuntimeMarker {
  readonly host: string;
  readonly origin: string;
  readonly pid: number;
  readonly port: number;
  readonly startedAt: string;
}
