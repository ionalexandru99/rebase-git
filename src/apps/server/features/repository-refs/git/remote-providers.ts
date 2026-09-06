import type { RepositoryRefs } from "@rebase/contracts";

type Provider = NonNullable<
  RepositoryRefs["remoteProviders"]
>[number]["provider"];

export function remoteProvidersFromConfig(
  output: string,
): NonNullable<RepositoryRefs["remoteProviders"]> {
  const remotes = new Map<string, Provider>();
  for (const line of output.split("\n")) {
    const match = /^remote\.(.+)\.url\s+(.+)$/.exec(line.trim());
    const remote = match?.[1];
    const address = match?.[2];
    if (
      remote === undefined ||
      remote.length > 255 ||
      address === undefined ||
      remotes.has(remote)
    )
      continue;
    remotes.set(remote, providerForAddress(address));
    if (remotes.size === 256) break;
  }
  return [...remotes].map(([remote, provider]) => ({ remote, provider }));
}

function providerForAddress(address: string): Provider {
  let host: string;
  try {
    host = address.includes("://")
      ? new URL(address).hostname.toLowerCase()
      : (/^(?:[^@/]+@)?([^/:]+):/.exec(address)?.[1]?.toLowerCase() ?? "");
  } catch {
    return "git";
  }
  if (host === "github.com" || host === "ssh.github.com") return "github";
  if (host === "gitlab.com" || host === "altssh.gitlab.com") return "gitlab";
  if (host === "bitbucket.org" || host === "altssh.bitbucket.org")
    return "bitbucket";
  if (
    host === "dev.azure.com" ||
    host === "ssh.dev.azure.com" ||
    host.endsWith(".visualstudio.com")
  )
    return "azure";
  if (host === "codeberg.org") return "codeberg";
  if (/^git-codecommit\.[a-z0-9-]+\.amazonaws\.com(?:\.cn)?$/.test(host))
    return "aws";
  const label = host.split(".")[0];
  if (
    label === "gitlab" ||
    label === "gitea" ||
    label === "forgejo" ||
    label === "bitbucket"
  )
    return label;
  return "git";
}
