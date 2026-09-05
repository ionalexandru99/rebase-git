# Browser request IDs and reader leases

The CLI supports loopback HTTP and plain HTTP on addresses selected by `--host`, including LAN and
Tailscale addresses. Electron loads the bundled client from a file URL, or a local development URL
when running from source.

History request IDs use `crypto.randomUUID()` when available. Plain HTTP on a network address is
not a [secure context](https://www.w3.org/TR/secure-contexts/), so the client generates UUIDs with
`crypto.getRandomValues()` there. Both paths require Web Crypto. Runtimes without it are unsupported.
The [Web Crypto specification](https://www.w3.org/TR/webcrypto-2/) restricts `randomUUID()` to secure
contexts, but allows `getRandomValues()` outside them.

Reader leases use Web Locks when available. Without Web Locks, readers connect without a lease and
use their existing explicit disconnect lifecycle. The request-ID fallback does not emulate leases.

For issue #394, capability checks ran against temporary Rebase instances on Linux using Chromium
and Electron 43.4.1. Each configuration produced 100 distinct valid request UUIDs.

| Runtime | Secure context | `randomUUID` | `getRandomValues` | Reader lease |
| --- | --- | --- | --- | --- |
| Chromium, loopback HTTP | Yes | Available | Available | Acquired and released |
| Chromium, LAN HTTP | No | Unavailable | Available | Connects without a lease |
| Chromium, Tailscale HTTP | No | Unavailable | Available | Connects without a lease |
| Electron, bundled file URL | Yes | Available | Available | Acquired and released |

These results justify retaining the cryptographic fallback for network HTTP. No supported runtime
found in this investigation needs the removed `Math.random` fallback or sequence mixing.
