"use client";

import { useEffect } from "react";

import { CommandPalette } from "./components/command-palette";
import { EditorWorkspace } from "./components/editor/editor-workspace";
import { AppFrame } from "./components/layout/app-frame";
import { SchemeLibrary } from "./components/manager/scheme-library";
import { useAppShortcuts } from "./hooks/use-shortcuts";
import { useAppBridge } from "./state/bridge";
import { useAppStore } from "./state/store";

export default function HomePage() {
  const view = useAppStore((state) => state.view);
  useAppBridge();
  useAppShortcuts();

  // 切换视图后回到顶部。
  useEffect(() => {
    document.getElementById("main")?.scrollTo(0, 0);
  }, [view]);

  return (
    <AppFrame>
      {view === "manager" ? <SchemeLibrary key="manager" /> : <EditorWorkspace key="editor" />}
      <CommandPalette />
    </AppFrame>
  );
}
