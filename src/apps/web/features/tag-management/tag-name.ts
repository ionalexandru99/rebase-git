import type { RepositoryTag } from "@rebase/contracts";
import { isValidRefName } from "#web/features/repository-refs/ref-name";

export function tagNameProblem(
  name: string,
  tags: readonly Pick<RepositoryTag, "name">[],
): string | undefined {
  if (name.length === 0) return "Enter a tag name.";
  if (!isValidRefName(name)) return `${name} is not a valid tag name.`;
  for (const { name: existing } of tags) {
    if (existing === name) return `${name} already exists.`;
    if (name.startsWith(`${existing}/`))
      return `${existing} is a tag, not a folder.`;
    if (existing.startsWith(`${name}/`)) return `${name} is a folder of tags.`;
  }
  return undefined;
}
