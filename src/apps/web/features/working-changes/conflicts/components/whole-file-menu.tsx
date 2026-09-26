import { Menu } from "@base-ui/react/menu";
import type { ConflictFile, WholeFileChoice } from "@rebase/contracts";
import { IconChevronDown } from "@tabler/icons-react";
import { Button } from "#web/components/ui/button";
import type { Conflicts } from "#web/features/working-changes/conflicts/hooks/use-conflicts";

const choiceLabels: Record<Exclude<WholeFileChoice, "worktree">, string> = {
  current: "Use current",
  incoming: "Use incoming",
  delete: "Keep deletion",
};

const choiceOrder = ["current", "incoming", "delete"] as const;

export function WholeFileMenu({
  file,
  conflicts,
  disabled,
}: {
  readonly file: ConflictFile;
  readonly conflicts: Conflicts;
  readonly disabled: boolean;
}) {
  const choices = choiceOrder.filter((choice) => file.choices.includes(choice));
  const resolvable = file.choices.includes("worktree");
  const mergeTool = conflicts.list?.mergeTool ?? null;
  if (choices.length === 0 && !resolvable && mergeTool === null) return null;
  const item =
    "rounded px-2 py-2 text-xs outline-none data-highlighted:bg-accent data-disabled:opacity-50";
  return (
    <Menu.Root>
      <Menu.Trigger
        render={<Button size="xs" variant="ghost" />}
        disabled={disabled}
      >
        Whole file
        <IconChevronDown />
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Positioner align="end" sideOffset={4} className="z-50">
          <Menu.Popup className="w-44 rounded-md border border-border bg-popover p-1 text-popover-foreground shadow-lg outline-none">
            {choices.map((choice) => (
              <Menu.Item
                key={choice}
                className={item}
                onClick={() => conflicts.choose(file.path, choice)}
              >
                {choiceLabels[choice]}
              </Menu.Item>
            ))}
            {resolvable ? (
              <Menu.Item
                className={item}
                onClick={() => conflicts.resolve(file.path, false)}
              >
                Mark resolved
              </Menu.Item>
            ) : null}
            {mergeTool !== null ? (
              <Menu.Item
                className={item}
                onClick={() => conflicts.openMergeTool(file.path)}
              >
                Open in merge tool
              </Menu.Item>
            ) : null}
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
}
