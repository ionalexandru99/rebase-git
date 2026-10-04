import { IconList, IconListTree, IconSearch } from "@tabler/icons-react";
import { IconSwitch } from "#web/components/ui/icon-switch.tsx";
import { Input } from "#web/components/ui/input.tsx";

const viewOptions = [
  { value: "list", label: "List view", Icon: IconList },
  { value: "tree", label: "Tree view", Icon: IconListTree },
] as const;

export function FileListToolbar({
  filter,
  onFilter,
  tree,
  onTree,
}: {
  readonly filter: string;
  readonly onFilter: (filter: string) => void;
  readonly tree: boolean;
  readonly onTree: (tree: boolean) => void;
}) {
  return (
    <div className="flex shrink-0 items-center gap-2 p-2">
      <div className="relative min-w-0 flex-1">
        <IconSearch
          aria-hidden="true"
          className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
        />
        <Input
          aria-label="Filter changed files"
          placeholder="Filter files"
          className="pl-9"
          value={filter}
          onChange={(event) => onFilter(event.target.value)}
        />
      </div>
      <IconSwitch
        label="File view"
        options={viewOptions}
        value={tree ? "tree" : "list"}
        onChange={(value) => onTree(value === "tree")}
      />
    </div>
  );
}
