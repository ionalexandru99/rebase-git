export const hostAliases = ["lan", "tailscale"] as const;
export type HostAlias = (typeof hostAliases)[number];

export type NetworkAddresses = Readonly<
  Record<
    string,
    | readonly { readonly address: string; readonly internal: boolean }[]
    | undefined
  >
>;
