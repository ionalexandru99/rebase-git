import type { WholeFileChoice } from "@rebase/contracts";
import { IconChevronDown } from "@tabler/icons-react";
import { Button } from "#web/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "#web/components/ui/dropdown-menu";

const choiceLabels: Partial<Record<WholeFileChoice, string>> = {
  current: "Use current",
  incoming: "Use incoming",
  delete: "Keep deletion",
};

export function WholeFileMenu({
  choices,
  mergeTool,
  disabled,
  onChoose,
  onMergeTool,
}: {
  readonly choices: readonly WholeFileChoice[];
  readonly mergeTool: boolean;
  readonly disabled: boolean;
  readonly onChoose: (choice: WholeFileChoice) => void;
  readonly onMergeTool: () => void;
}) {
  const entries = choices.flatMap((choice) => {
    const label = choiceLabels[choice];
    return label === undefined ? [] : [{ choice, label }];
  });
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        disabled={disabled || (entries.length === 0 && !mergeTool)}
        render={<Button variant="outline" size="xs" />}
      >
        Whole file
        <IconChevronDown aria-hidden="true" className="size-3.5" />
      </DropdownMenuTrigger>
      <DropdownMenuContent>
        {entries.map(({ choice, label }) => (
          <DropdownMenuItem key={choice} onClick={() => onChoose(choice)}>
            {label}
          </DropdownMenuItem>
        ))}
        {mergeTool && entries.length > 0 && <DropdownMenuSeparator />}
        {mergeTool && (
          <DropdownMenuItem onClick={onMergeTool}>
            Open in merge tool
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
