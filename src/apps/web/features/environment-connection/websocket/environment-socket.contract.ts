export type EnvironmentSocketEvent =
  | { readonly _tag: "Message"; readonly event: MessageEvent }
  | { readonly _tag: "Open" };
