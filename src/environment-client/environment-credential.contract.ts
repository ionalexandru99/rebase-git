export type EnvironmentCredential =
  | { readonly type: "browser-session" }
  | { readonly type: "bearer"; readonly value: string };
