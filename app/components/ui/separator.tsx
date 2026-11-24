import type { ComponentPropsWithoutRef } from "react";

import { cn } from "../../../lib/cn";

export function Separator({
  orientation = "vertical",
  className,
  ...props
}: ComponentPropsWithoutRef<"div"> & { orientation?: "horizontal" | "vertical" }) {
  return (
    <div
      role="separator"
      aria-orientation={orientation}
      className={cn("shrink-0 bg-line", orientation === "vertical" ? "mx-2 h-5 w-px self-center" : "my-2 h-px w-full", className)}
      {...props}
    />
  );
}
