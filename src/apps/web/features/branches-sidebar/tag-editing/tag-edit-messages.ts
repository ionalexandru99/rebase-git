import type { TagCommandFailure } from "#web/features/tag-management/hooks/use-tag-commands";
import { describeUndeliveredCommand } from "#web/platform/query/command-failure-message";

export function describeTagFailure(
  name: string,
  error: TagCommandFailure,
): string {
  if (error._tag !== "EnvironmentHttpRejected")
    return describeUndeliveredCommand(error);
  const failure = error.failure;
  switch (failure._tag) {
    case "TagRejected":
      return failure.reason === "Exists"
        ? `${name} already exists.`
        : `${name} is not a valid tag name.`;
    case "RefMissing":
      return `${name} no longer exists.`;
    case "RepositoryRejected":
      return failure.detail.length === 0
        ? "Git could not complete the operation."
        : failure.detail;
  }
}
