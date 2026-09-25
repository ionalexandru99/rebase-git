import type { LocalBranch } from "@rebase/contracts";

export function branchNameProblem(
  name: string,
  branches: readonly Pick<LocalBranch, "name">[],
  current?: string,
): string | undefined {
  if (name.length === 0) return "Enter a branch name.";
  if (!isValidBranchName(name)) return `${name} is not a valid branch name.`;
  for (const { name: existing } of branches) {
    if (existing === current) continue;
    if (existing === name) return `${name} already exists.`;
    if (name.startsWith(`${existing}/`))
      return `${existing} is a branch, not a folder.`;
    if (existing.startsWith(`${name}/`))
      return `${name} is a folder of branches.`;
  }
  return undefined;
}

function isValidBranchName(name: string) {
  if (name === "HEAD" || name === "@" || name.startsWith("-")) return false;
  if ([...name].some(isControlOrSpace)) return false;
  if (/[~^:?*[\\]|\.\.|@\{|\/\/|^\/|\/$|\.$/.test(name)) return false;
  return name
    .split("/")
    .every((part) => !part.startsWith(".") && !part.endsWith(".lock"));
}

function isControlOrSpace(character: string) {
  const code = character.charCodeAt(0);
  return code <= 0x20 || code === 0x7f;
}
