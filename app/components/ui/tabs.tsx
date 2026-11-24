"use client";

import { forwardRef, type ComponentPropsWithoutRef } from "react";
import * as TabsPrimitive from "@radix-ui/react-tabs";

import { cn } from "../../../lib/cn";

export const Tabs = TabsPrimitive.Root;

export const TabsList = forwardRef<HTMLDivElement, ComponentPropsWithoutRef<typeof TabsPrimitive.List>>(function TabsList(
  { className, ...props },
  ref,
) {
  return (
    <TabsPrimitive.List
      ref={ref}
      className={cn("inline-flex h-8 items-center gap-0.5 rounded-md border border-line bg-surface-2 p-0.5", className)}
      {...props}
    />
  );
});

export const TabsTrigger = forwardRef<HTMLButtonElement, ComponentPropsWithoutRef<typeof TabsPrimitive.Trigger>>(
  function TabsTrigger({ className, ...props }, ref) {
    return (
      <TabsPrimitive.Trigger
        ref={ref}
        className={cn(
          "inline-flex h-7 flex-1 cursor-pointer items-center justify-center gap-1.5 whitespace-nowrap rounded-sm px-3 text-xs font-medium text-ink-muted transition-colors duration-150 hover:text-ink data-[state=active]:bg-surface-3 data-[state=active]:text-gold-bright data-[state=active]:shadow-panel [&_svg]:size-3.5",
          className,
        )}
        {...props}
      />
    );
  },
);

export const TabsContent = forwardRef<HTMLDivElement, ComponentPropsWithoutRef<typeof TabsPrimitive.Content>>(
  function TabsContent({ className, ...props }, ref) {
    return (
      <TabsPrimitive.Content
        ref={ref}
        className={cn("mt-3 outline-none data-[state=active]:animate-in data-[state=active]:fade-in-0", className)}
        {...props}
      />
    );
  },
);
