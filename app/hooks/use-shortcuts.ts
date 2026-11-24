"use client";

import { useEffect } from "react";

import { toggleInspectorForViewport, useAppStore } from "../state/store";
import { isEditableTarget } from "./navigation";

/** 有未保存修改时先确认，再返回方案库。 */
export function requestLeaveEditor() {
  const state = useAppStore.getState();
  if (state.editorDialog || state.schemeBusy) return;
  if (state.dirty) state.setEditorDialog("discard");
  else state.leaveEditor();
}

/** 全局快捷键。输入法组字过程中一律不响应。 */
export function useAppShortcuts() {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.isComposing || event.keyCode === 229) return;
      const state = useAppStore.getState();
      const mod = event.ctrlKey || event.metaKey;
      const key = event.key.toLowerCase();

      if (mod && key === "k") {
        event.preventDefault();
        state.setPaletteOpen(!state.paletteOpen);
        return;
      }
      if (mod && event.key === "\\") {
        event.preventDefault();
        toggleInspectorForViewport();
        return;
      }
      if (state.paletteOpen) return;

      if (state.view === "editor") {
        if (mod && key === "s" && !event.shiftKey) {
          event.preventDefault();
          state.requestSave();
          return;
        }
        if (mod && event.key === "Enter") {
          event.preventDefault();
          if (!state.editorDialog && !state.schemeBusy) void state.generate();
          return;
        }
        if (event.altKey && event.key === "ArrowLeft") {
          event.preventDefault();
          requestLeaveEditor();
          return;
        }
        // ↑/↓ 切换规则、Ctrl+↑/↓ 移动规则：只在规则模块内或焦点不在控件上时生效。
        if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
        if (state.editorDialog || state.picker || state.previewOpen || state.schemeBusy) return;
        if (isEditableTarget(event.target)) return;
        if (!(event.target instanceof Element) || !event.target.closest("#module-rules")) return;
        const { activeRuleId } = state;
        if (!activeRuleId) return;
        event.preventDefault();
        if (mod) state.moveRule(activeRuleId, event.key === "ArrowDown" ? 1 : -1);
        else state.selectRule(event.key === "ArrowDown" ? 1 : -1);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);
}
