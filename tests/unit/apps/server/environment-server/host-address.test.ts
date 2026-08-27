import { resolveHostAddress } from "@rebase/server/features/environment-server/server/host-address";
import { describe, expect, it } from "vite-plus/test";

const interfaces = {
  eth0: [
    { address: "fe80::1", internal: false },
    { address: "192.168.1.20", internal: false },
  ],
  lo: [{ address: "127.0.0.1", internal: true }],
  tailscale0: [{ address: "100.113.91.98", internal: false }],
};

describe("host address", () => {
  it("resolves the lan and tailscale aliases to their IPv4 addresses", () => {
    expect(resolveHostAddress("lan", interfaces)).toBe("192.168.1.20");
    expect(resolveHostAddress("tailscale", interfaces)).toBe("100.113.91.98");
    expect(resolveHostAddress("10.0.0.5", interfaces)).toBe("10.0.0.5");
  });

  it("rejects hostnames, unspecified addresses, and missing aliases", () => {
    expect(() => resolveHostAddress("example.com", interfaces)).toThrow(
      /Host must be/,
    );
    expect(() => resolveHostAddress("0.0.0.0", interfaces)).toThrow(
      /Host must be/,
    );
    expect(() =>
      resolveHostAddress("tailscale", { lo: interfaces.lo }),
    ).toThrow("No tailscale IPv4 address was found on this machine.");
  });
});
