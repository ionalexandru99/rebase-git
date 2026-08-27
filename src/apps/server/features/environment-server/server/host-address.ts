import { isIP, isIPv4 } from "node:net";
import { networkInterfaces } from "node:os";

export const hostAliases = ["lan", "tailscale"] as const;
export type HostAlias = (typeof hostAliases)[number];

const unspecifiedAddresses = new Set(["0.0.0.0", "::"]);

export function resolveHostAddress(
  requested: string,
  interfaces: NetworkAddresses = networkInterfaces(),
): string {
  if (isHostAlias(requested)) {
    const address = firstAddress(interfaces, addressMatchers[requested]);
    if (address === undefined) {
      throw new Error(
        `No ${requested} IPv4 address was found on this machine.`,
      );
    }
    return address;
  }
  if (isIP(requested) === 0 || unspecifiedAddresses.has(requested)) {
    throw new Error(
      `Host must be "lan", "tailscale", or a specific IPv4 or IPv6 address of this machine. Found "${requested}".`,
    );
  }
  return requested;
}

export function isHostAlias(value: string): value is HostAlias {
  return (hostAliases as readonly string[]).includes(value);
}

const addressMatchers: Record<HostAlias, (address: string) => boolean> = {
  lan: (address) => isPrivateLanAddress(address),
  tailscale: (address) => isCarrierGradeNatAddress(address),
};

function firstAddress(
  interfaces: NetworkAddresses,
  matches: (address: string) => boolean,
) {
  for (const addresses of Object.values(interfaces)) {
    const match = addresses?.find(
      (candidate) =>
        !candidate.internal &&
        isIPv4(candidate.address) &&
        matches(candidate.address),
    );
    if (match !== undefined) return match.address;
  }
  return undefined;
}

function isPrivateLanAddress(address: string) {
  const [first, second] = octets(address);
  return (
    first === 10 ||
    (first === 172 && second !== undefined && second >= 16 && second <= 31) ||
    (first === 192 && second === 168)
  );
}

function isCarrierGradeNatAddress(address: string) {
  const [first, second] = octets(address);
  return first === 100 && second !== undefined && second >= 64 && second <= 127;
}

function octets(address: string) {
  return address.split(".").map(Number);
}

export type NetworkAddresses = Readonly<
  Record<
    string,
    | readonly { readonly address: string; readonly internal: boolean }[]
    | undefined
  >
>;
