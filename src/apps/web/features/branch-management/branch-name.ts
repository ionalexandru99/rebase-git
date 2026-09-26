import type { LocalBranch } from "@rebase/contracts";
import { isValidRefName } from "#web/features/repository-refs/ref-name";

export function branchNameProblem(
  name: string,
  branches: readonly Pick<LocalBranch, "name">[],
  current?: string,
): string | undefined {
  if (name.length === 0) return "Enter a branch name.";
  if (!isValidRefName(name)) return `${name} is not a valid branch name.`;
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
