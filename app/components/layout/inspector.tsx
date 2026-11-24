"use client";

import { useEffect, useState, type KeyboardEvent, type PointerEvent } from "react";
import { PanelRightClose, PanelRightOpen, X } from "lucide-react";

import { toggleInspectorForViewport, useAppStore, useDockedInspector } from "../../state/store";
import { EditorInspector } from "../editor/editor-inspector";
import { ManagerInspector } from "../manager/manager-inspector";
import { Button, IconButton } from "../ui/button";
import { Dialog, SheetContent } from "../ui/dialog";
import { Tooltip } from "../ui/tooltip";

const MIN_WIDTH = 280;
const MAX_WIDTH = 440;

function InspectorBody() {
  const view = useAppStore((state) => state.view);
  return view === "editor" ? <EditorInspector /> : <ManagerInspector />;
}

/** 停靠在右侧的检查器：拖动左侧分隔条或在其上按左右方向键调整宽度。 */
function DockedInspector() {
  const width = useAppStore((state) => state.inspectorWidth);
  const setWidth = useAppStore((state) => state.setInspectorWidth);
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    if (!dragging) return;
    const previousCursor = document.body.style.cursor;
    const previousSelect = document.body.style.userSelect;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    const stop = () => setDragging(false);
    window.addEventListener("pointerup", stop);
    window.addEventListener("pointercancel", stop);
    return () => {
      window.removeEventListener("pointerup", stop);
      window.removeEventListener("pointercancel", stop);
      document.body.style.cursor = previousCursor;
      document.body.style.userSelect = previousSelect;
    };
  }, [dragging]);

  const resize = (clientX: number) =>
    setWidth(Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, window.innerWidth - clientX)));
  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragging(true);
    resize(event.clientX);
  };
  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (dragging) resize(event.clientX);
  };
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "ArrowLeft") setWidth(Math.min(MAX_WIDTH, width + 16));
    else if (event.key === "ArrowRight") setWidth(Math.max(MIN_WIDTH, width - 16));
    else return;
    event.preventDefault();
  };

  return (
    <aside aria-label="检查器" className="relative flex shrink-0 flex-col border-l border-line bg-surface" style={{ width }}>
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="调整检查器宽度"
        aria-valuenow={width}
        aria-valuemin={MIN_WIDTH}
        aria-valuemax={MAX_WIDTH}
        tabIndex={0}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onKeyDown={onKeyDown}
        className="absolute inset-y-0 -left-1.5 z-sticky w-3 cursor-col-resize after:absolute after:inset-y-0 after:left-1/2 after:w-px after:bg-transparent after:transition-colors hover:after:bg-gold/60 focus-visible:after:bg-gold"
      />
      <InspectorHeader title="检查器" onClose={() => useAppStore.getState().setInspectorOpen(false)} />
      <div className="min-h-0 flex-1 overflow-y-auto">
        <InspectorBody />
      </div>
    </aside>
  );
}

/** 宽窗口停靠在右侧；窄窗口默认收起，点按钮后从侧边滑出。 */
export function InspectorDock() {
  const docked = useDockedInspector();
  const open = useAppStore((state) => state.inspectorOpen);
  const setOpen = useAppStore((state) => state.setInspectorOpen);
  const peek = useAppStore((state) => state.inspectorPeek);
  const setPeek = useAppStore((state) => state.setInspectorPeek);

  if (docked) return open ? <DockedInspector /> : null;
  if (!peek) return null;
  return (
    <Dialog open onOpenChange={setPeek}>
      <SheetContent aria-label="检查器" hideClose>
        <InspectorHeader title="检查器" onClose={() => setPeek(false)} />
        <div className="min-h-0 flex-1 overflow-y-auto">
          <InspectorBody />
        </div>
      </SheetContent>
    </Dialog>
  );
}

export function InspectorToggleButton() {
  const docked = useDockedInspector();
  const open = useAppStore((state) => state.inspectorOpen);
  const peek = useAppStore((state) => state.inspectorPeek);
  const shown = docked ? open : peek;
  return (
    <Tooltip label={shown ? "收起检查器（Ctrl+\\）" : "展开检查器（Ctrl+\\）"}>
      <Button
        variant="ghost"
        size="icon"
        aria-label={shown ? "收起检查器" : "展开检查器"}
        aria-pressed={shown}
        onClick={toggleInspectorForViewport}
        className="text-ink-muted"
      >
        {shown ? <PanelRightClose aria-hidden="true" /> : <PanelRightOpen aria-hidden="true" />}
      </Button>
    </Tooltip>
  );
}

export function InspectorHeader({ title, onClose }: { title: string; onClose?: () => void }) {
  return (
    <header className="flex h-11 shrink-0 items-center justify-between gap-2 border-b border-line pr-2 pl-4">
      <h2 className="text-sm font-semibold text-ink">{title}</h2>
      {onClose && (
        <IconButton label="收起检查器" size="icon-sm" onClick={onClose}>
          <X aria-hidden="true" />
        </IconButton>
      )}
    </header>
  );
}
