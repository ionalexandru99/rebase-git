import type { ComponentProps } from "react";
import { Button } from "#web/components/ui/button.tsx";
import { cn } from "#web/lib/utils.ts";

export function ToolbarButton({
  className,
  ...props
}: Omit<ComponentProps<typeof Button>, "size" | "variant">) {
  return (
    <Button
      className={cn("h-7 gap-1.5 text-control", className)}
      size="sm"
      variant="ghost"
      {...props}
    />
  );
}
