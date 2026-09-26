export type EnvironmentChangeScope = "refs" | "index" | "none";

export type EnvironmentQueryMeta = {
  readonly changes: EnvironmentChangeScope;
  readonly repositoryId: string | null;
};

declare module "@tanstack/react-query" {
  interface Register {
    queryMeta: EnvironmentQueryMeta;
  }
}
