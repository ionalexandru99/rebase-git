import { IconChevronDown, IconLink } from "@tabler/icons-react";
import type { JSX, ReactNode } from "react";
import type { RepositoryCatalogEntry } from "#contracts/repository-catalog/repository-catalog.contract.ts";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "#web/components/ui/collapsible.tsx";
import { HiddenText } from "#web/components/ui/hidden-text.tsx";
import { CloneLine } from "#web/features/open-project/clone-line.tsx";
import {
  type CloneGroup,
  type CloneSource,
  formatLastOpened,
} from "#web/features/open-project/open-project-state.ts";
import { openProjectItemId } from "#web/features/open-project/project-list.tsx";
import { hostDescriptors } from "#web/features/settings/source-control-settings.tsx";
import { useNow } from "#web/lib/age-label.ts";

interface CloneSourceActions {
  readonly activeKey: string | undefined;
  readonly expandedKey: string | undefined;
  readonly onActivate: (key: string) => void;
  readonly onExpand: (key: string | undefined) => void;
  readonly onCloned: (repository: RepositoryCatalogEntry) => void;
}

export function HostRepositoriesGroup({
  group,
  open,
  onOpenChange,
  ...actions
}: CloneSourceActions & {
  readonly group: CloneGroup;
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
}): JSX.Element | null {
  if (group.sources.length === 0) return null;
  const { icon: HostIcon, label } = hostDescriptors[group.kind];
  const where = group.server === undefined ? "" : ` on ${group.server}`;
  return (
    <Collapsible onOpenChange={onOpenChange} open={open}>
      <GroupHeading
        icon={<HostIcon aria-hidden="true" className="size-4.5 shrink-0" />}
        toggle={
          <CollapsibleTrigger
            aria-label={`${open ? "Collapse" : "Expand"} ${label} ${group.account}${where}`}
            className="grid size-7 place-items-center rounded-[.4rem] outline-none hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/30"
          >
            <IconChevronDown
              aria-hidden="true"
              className={`size-4 transition-transform ${open ? "" : "-rotate-90"}`}
            />
          </CollapsibleTrigger>
        }
      >
        {label}
        <span className="font-normal text-muted-foreground">
          {" "}
          ·{" "}
          <HiddenText
            className="text-[.83rem]"
            hideLabel={`Hide ${label} account ${group.account}${where}`}
            showLabel={`Show ${label} account${where}`}
            value={group.account}
          />
          {where}
        </span>
      </GroupHeading>
      <CollapsibleContent>
        {group.sources.map((source) => (
          <CloneSourceRow key={source.key} source={source} {...actions} />
        ))}
      </CollapsibleContent>
    </Collapsible>
  );
}

export function UrlGroup({
  source,
  ...actions
}: CloneSourceActions & { readonly source: CloneSource }): JSX.Element {
  return (
    <div>
      <GroupHeading
        icon={<IconLink aria-hidden="true" className="size-4.5 shrink-0" />}
        toggle={<span />}
      >
        Repository URL
      </GroupHeading>
      <CloneSourceRow source={source} {...actions} />
    </div>
  );
}

function GroupHeading({
  icon,
  toggle,
  children,
}: {
  readonly icon: ReactNode;
  readonly toggle: ReactNode;
  readonly children: ReactNode;
}) {
  return (
    <div className="grid h-9 min-w-0 grid-cols-[1.75rem_1.125rem_minmax(0,1fr)] items-center gap-[.45rem] px-1 text-muted-foreground">
      {toggle}
      {icon}
      <strong className="truncate text-[.83rem] font-medium text-foreground">
        {children}
      </strong>
    </div>
  );
}

function CloneSourceRow({
  source,
  activeKey,
  expandedKey,
  onActivate,
  onExpand,
  onCloned,
}: CloneSourceActions & {
  readonly source: CloneSource;
}) {
  const now = useNow();
  const active = activeKey === source.key;
  const expanded = expandedKey === source.key;
  const slash = source.label.lastIndexOf("/");
  return (
    <div
      className="ml-8 rounded-md pr-9.5 pl-2.5 hover:bg-accent data-[active=true]:bg-accent"
      data-active={active || expanded}
    >
      <button
        aria-selected={active}
        className="grid h-9 w-full min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-[.7rem] text-left outline-none"
        id={openProjectItemId(source.key)}
        onClick={() => onExpand(expanded ? undefined : source.key)}
        onFocus={() => onActivate(source.key)}
        role="option"
        tabIndex={-1}
        type="button"
      >
        <span className="flex min-w-0 items-baseline gap-[.65rem]">
          <strong className="shrink-0 truncate text-[.8rem] font-medium text-foreground">
            <span className="font-normal text-muted-foreground">
              {source.label.slice(0, slash + 1)}
            </span>
            {source.label.slice(slash + 1)}
          </strong>
          {source.visibility === undefined ? null : (
            <span className="shrink-0 self-center rounded-sm border border-border px-1.5 text-[.68rem] leading-[1.125rem] text-muted-foreground">
              {source.visibility}
            </span>
          )}
          {source.description === undefined ? null : (
            <span className="min-w-0 truncate text-[.72rem] text-muted-foreground">
              {source.description}
            </span>
          )}
        </span>
        <span className="text-[.68rem] text-muted-foreground">
          {source.updatedAt === undefined
            ? null
            : formatLastOpened(source.updatedAt, now)}
        </span>
      </button>
      {expanded ? (
        <CloneLine
          key={source.url}
          onClose={() => onExpand(undefined)}
          onCloned={onCloned}
          source={source}
        />
      ) : null}
    </div>
  );
}
