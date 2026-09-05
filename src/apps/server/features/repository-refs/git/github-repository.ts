import type { RepositoryRefs } from "@rebase/contracts";

export function githubRepositoryFromRemotes(
  output: string,
): RepositoryRefs["githubRepository"] {
  const remotes = output
    .trim()
    .split("\n")
    .flatMap((line) => {
      const match = /^remote\.(.+)\.url\s+(.+)$/.exec(line.trim());
      return match?.[1] === undefined || match[2] === undefined
        ? []
        : [{ remote: match[1], url: match[2] }];
    });
  const origin = remotes.find((remote) => remote.remote === "origin");
  const url =
    origin?.url ?? (remotes.length === 1 ? remotes[0]?.url : undefined);
  if (url === undefined) return undefined;
  const match =
    /^(?:https:\/\/github\.com\/|git@github\.com:|ssh:\/\/git@github\.com\/)([a-zA-Z0-9-]{1,39})\/([a-zA-Z0-9_.-]{1,100}?)\/?$/.exec(
      url,
    );
  const owner = match?.[1];
  const name = match?.[2]?.replace(/\.git$/, "");
  return owner === undefined ||
    name === undefined ||
    name === "" ||
    name === "." ||
    name === ".."
    ? undefined
    : { owner, name };
}
