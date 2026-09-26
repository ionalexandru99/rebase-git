import type { WholeFileChoice } from "@rebase/contracts";
import { IconChevronDown } from "@tabler/icons-react";
import { Button } from "#web/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "#web/components/ui/dropdown-menu";

const choiceLabels: Record<Exclude<WholeFileChoice, "worktree">, string> = {
  current: "Use current",
  incoming: "Use incoming",
  delete: "Keep deletion",
};

const choiceOrder = ["current", "incoming", "delete"] as const;

export function WholeFileMenu({
  choices,
  mergeTool,
  disabled,
  onChoose,
  onResolve,
  onMergeTool,
}: {
  readonly choices: readonly WholeFileChoice[];
  readonly mergeTool: boolean;
  readonly disabled: boolean;
  readonly onChoose: (choice: WholeFileChoice) => void;
  readonly onResolve?: () => void;
  readonly onMergeTool: () => void;
}) {
  const offered = choiceOrder.filter((choice) => choices.includes(choice));
  const resolvable = onResolve !== undefined && choices.includes("worktree");
  if (offered.length === 0 && !resolvable && !mergeTool) return null;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={<Button size="xs" variant="ghost" />}
        disabled={disabled}
      >
        Whole file
        <IconChevronDown aria-hidden="true" />
      </DropdownMenuTrigger>
      <DropdownMenuContent>
        {offered.map((choice) => (
          <DropdownMenuItem key={choice} onClick={() => onChoose(choice)}>
            {choiceLabels[choice]}
          </DropdownMenuItem>
        ))}
        {resolvable && (
          <DropdownMenuItem onClick={onResolve}>Mark resolved</DropdownMenuItem>
        )}
        {mergeTool && (
          <DropdownMenuItem onClick={onMergeTool}>
            Open in merge tool
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
