import { IconChevronDown } from "@tabler/icons-react";
import type { WholeFileChoice } from "#contracts/repository-conflicts/repository-conflicts.contract.ts";
import { Button } from "#web/components/ui/button.tsx";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "#web/components/ui/dropdown-menu.tsx";

const choiceLabels: Record<WholeFileChoice, string> = {
  current: "Use current",
  incoming: "Use incoming",
  delete: "Keep deletion",
};

const choiceOrder = ["current", "incoming", "delete"] as const;

export function WholeFileMenu({
  choices,
  disabled,
  onChoose,
}: {
  readonly choices: readonly WholeFileChoice[];
  readonly disabled: boolean;
  readonly onChoose: (choice: WholeFileChoice) => void;
}) {
  const offered = choiceOrder.filter((choice) => choices.includes(choice));
  if (offered.length === 0) return null;
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
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
