"use client";

import type { ReactNode } from "react";

import { ErrorBoundary } from "../ui/error-boundary";
import { InspectorDock } from "./inspector";
import { StatusBar } from "./status-bar";
import { TopBar } from "./top-bar";

export function AppFrame({ children }: { children: ReactNode }) {
  return (
    <div className="app-frame flex h-dvh flex-col overflow-hidden">
      <TopBar />
      <div className="flex min-h-0 flex-1">
        <main id="main" tabIndex={-1} className="relative min-w-0 flex-1 overflow-y-auto outline-none">
          <ErrorBoundary>{children}</ErrorBoundary>
        </main>
        <InspectorDock />
      </div>
      <StatusBar />
    </div>
  );
}
