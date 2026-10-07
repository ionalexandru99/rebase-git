"use client";

import { Menu } from "@base-ui/react/menu";
import { IconCheck } from "@tabler/icons-react";
import type { ComponentProps } from "react";
import { cn } from "#web/lib/utils.ts";

function DropdownMenu(props: Menu.Root.Props) {
  return <Menu.Root data-slot="dropdown-menu" {...props} />;
}

function DropdownMenuTrigger(props: Menu.Trigger.Props) {
  return <Menu.Trigger data-slot="dropdown-menu-trigger" {...props} />;
}

function DropdownMenuContent({
  align = "end",
  alignOffset = 0,
  anchor,
  children,
  className,
  side = "bottom",
  sideOffset = 4,
  ...props
}: Menu.Popup.Props &
  Pick<
    Menu.Positioner.Props,
    "align" | "alignOffset" | "anchor" | "side" | "sideOffset"
  >) {
  return (
    <Menu.Portal>
      <Menu.Positioner
        align={align}
        alignOffset={alignOffset}
        anchor={anchor}
        className="isolate z-110"
        side={side}
        sideOffset={sideOffset}
      >
        <Menu.Popup
          className={cn("w-50 elevation-menu p-1 outline-none", className)}
          data-slot="dropdown-menu-content"
          {...props}
        >
          {children}
        </Menu.Popup>
      </Menu.Positioner>
    </Menu.Portal>
  );
}

function DropdownMenuItem({ className, ...props }: Menu.Item.Props) {
  return (
    <Menu.Item
      className={cn(
        "flex h-8 cursor-default items-center gap-2 rounded-control px-2 text-body text-foreground/80 outline-none select-none data-disabled:pointer-events-none data-disabled:opacity-40 data-highlighted:bg-accent data-highlighted:text-foreground [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
        className,
      )}
      data-slot="dropdown-menu-item"
      {...props}
    />
  );
}

function DropdownMenuCheckboxItem({
  children,
  className,
  ...props
}: Menu.CheckboxItem.Props) {
  return (
    <Menu.CheckboxItem
      className={cn(
        "flex h-8 cursor-default items-center gap-2 rounded-control px-2 text-xs text-foreground/80 outline-none select-none data-disabled:pointer-events-none data-disabled:opacity-40 data-highlighted:bg-accent data-highlighted:text-foreground [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
        className,
      )}
      data-slot="dropdown-menu-checkbox-item"
      {...props}
    >
      {children}
      <Menu.CheckboxItemIndicator className="ml-auto">
        <IconCheck aria-hidden="true" className="size-3.5 text-foreground" />
      </Menu.CheckboxItemIndicator>
    </Menu.CheckboxItem>
  );
}

function DropdownMenuRadioGroup(props: Menu.RadioGroup.Props) {
  return <Menu.RadioGroup data-slot="dropdown-menu-radio-group" {...props} />;
}

function DropdownMenuRadioItem({
  children,
  className,
  ...props
}: Menu.RadioItem.Props) {
  return (
    <Menu.RadioItem
      className={cn(
        "flex h-8 cursor-default items-center gap-2 rounded-control px-2 text-body text-foreground/80 outline-none select-none data-highlighted:bg-accent data-highlighted:text-foreground",
        className,
      )}
      closeOnClick
      data-slot="dropdown-menu-radio-item"
      {...props}
    >
      <span className="min-w-0 flex-1 truncate">{children}</span>
      <Menu.RadioItemIndicator>
        <IconCheck aria-hidden="true" className="size-3.5 text-foreground" />
      </Menu.RadioItemIndicator>
    </Menu.RadioItem>
  );
}

function DropdownMenuSeparator({
  className,
  ...props
}: ComponentProps<typeof Menu.Separator>) {
  return (
    <Menu.Separator
      className={cn("mx-1 my-1 h-px bg-border", className)}
      data-slot="dropdown-menu-separator"
      {...props}
    />
  );
}

export {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
};
