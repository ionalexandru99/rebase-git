export interface Migration {
  readonly checksum: string;
  readonly name: string;
  readonly sql: string;
  readonly version: number;
}

export interface AppliedMigration {
  readonly checksum: string;
  readonly name: string;
  readonly version: number;
}
