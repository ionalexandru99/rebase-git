"use client";

import { Menu } from "@base-ui/react/menu";
import type { ComponentProps } from "react";
import { cn } from "#web/lib/utils";

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
        className="isolate z-50"
        side={side}
        sideOffset={sideOffset}
      >
        <Menu.Popup
          className={cn(
            "w-50 rounded-[.55rem] border border-border bg-popover p-[.3rem] text-popover-foreground shadow-[0_.75rem_2.5rem_rgb(0_0_0/45%)] outline-none",
            className,
          )}
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
        "flex h-8 cursor-default items-center gap-2 rounded-[.35rem] px-2 text-xs text-foreground/80 outline-none select-none data-disabled:pointer-events-none data-disabled:opacity-45 data-highlighted:bg-accent data-highlighted:text-foreground [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
        className,
      )}
      data-slot="dropdown-menu-item"
      {...props}
    />
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
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
};
