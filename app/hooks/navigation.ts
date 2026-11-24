/** 滚动到编辑器里的某个模块。 */
export function scrollToModule(id: "season" | "base" | "rules") {
  window.requestAnimationFrame(() => {
    document.getElementById(`module-${id}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
  });
}

/** 焦点在输入类控件里时不响应列表导航快捷键。 */
export function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  return Boolean(
    target.closest(
      "input, textarea, select, [contenteditable]:not([contenteditable='false']), [role='combobox'], [role='listbox'], [role='menu']",
    ),
  );
}
