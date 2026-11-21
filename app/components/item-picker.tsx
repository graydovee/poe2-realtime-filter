"use client";

import { useMemo, useState } from "react";
import { Check, ChevronRight, Minus, SearchX } from "lucide-react";

import { buildCatalogTree, catalogItems, catalogNode, groupName, groupOrder, searchCatalog } from "../../lib/catalog";
import { cn } from "../../lib/cn";
import { ITEM_CATALOG } from "../../lib/data";
import type { ItemDefinition, Locale } from "../../lib/types";
import { SearchInput } from "./ui/controls";
import { Button, Chip, EmptyState } from "./ui/primitives";

export type ItemPickerEntry = { id: string; label: string; itemIds: string[] };

export type ItemPickerToggle = {
  ids: string[];
  checked: boolean;
  label: string;
  key: string;
};

function selectionOf(items: ItemDefinition[], selected: Set<string>) {
  let count = 0;
  for (const item of items) if (selected.has(item.id)) count += 1;
  return { count, total: items.length, all: items.length > 0 && count === items.length, partial: count > 0 && count < items.length };
}

function SelectionMark({ state }: { state: "off" | "on" | "mixed" }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "grid size-4 shrink-0 place-items-center rounded-sm border transition",
        state === "off" ? "border-line-strong bg-surface-3 text-transparent" : "border-gold bg-gold text-[#0b0805]",
      )}
    >
      {state === "mixed" ? <Minus className="size-3" strokeWidth={3} /> : <Check className="size-3" strokeWidth={3} />}
    </span>
  );
}

export function ItemPicker({
  locale,
  entries,
  onToggle,
  onRemoveEntry,
}: {
  locale: Locale;
  entries: ItemPickerEntry[];
  onToggle: (toggle: ItemPickerToggle) => void;
  onRemoveEntry: (entryId: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [path, setPath] = useState<string[]>([]);
  const matchingItems = useMemo(() => searchCatalog(ITEM_CATALOG, query), [query]);
  const tree = useMemo(() => buildCatalogTree(matchingItems), [matchingItems]);
  const current = catalogNode(tree, path);
  const selected = useMemo(() => new Set(entries.flatMap((entry) => entry.itemIds)), [entries]);
  const selectedCount = entries.reduce((total, entry) => total + entry.itemIds.length, 0);
  const currentItems = current ? catalogItems(current) : [];
  const childNodes = current ? [...current.children].sort((left, right) => groupOrder(left.key) - groupOrder(right.key)) : [];
  const currentSelection = selectionOf(currentItems, selected);

  function toggle(items: ItemDefinition[], checked: boolean, label: string, key: string) {
    onToggle({ ids: items.map((item) => item.id), checked, label, key });
  }

  return (
    <div className="flex flex-col gap-4">
      <SearchInput
        value={query}
        aria-label="搜索物品"
        placeholder="搜索中文、繁中或英文名称"
        onChange={(event) => {
          setQuery(event.target.value);
          setPath([]);
        }}
      />

      <nav className="flex flex-wrap items-center gap-1 text-xs" aria-label="物品分类路径">
        <button
          type="button"
          onClick={() => setPath([])}
          aria-current={path.length === 0 ? "location" : undefined}
          className={cn("rounded-sm px-1.5 py-1 transition", path.length === 0 ? "font-semibold text-ink" : "text-ink-muted hover:text-ink")}
        >
          全部种类
        </button>
        {path.map((key, index) => (
          <span key={path.slice(0, index + 1).join("/")} className="flex items-center gap-1 text-ink-muted/70">
            <span aria-hidden="true">/</span>
            <button
              type="button"
              onClick={() => setPath(path.slice(0, index + 1))}
              aria-current={index === path.length - 1 ? "location" : undefined}
              className={cn("rounded-sm px-1.5 py-1 transition", index === path.length - 1 ? "font-semibold text-ink" : "hover:text-ink")}
            >
              {groupName(key, locale)}
            </button>
          </span>
        ))}
      </nav>

      {current && (
        <>
          {path.length > 0 && currentItems.length > 0 && (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-sm border border-line/70 bg-surface-2/40 px-3.5 py-2.5">
              <span className="text-[11px] text-ink-muted">
                本类 {currentSelection.total} 项 · 已选 <b className="font-mono font-normal text-ink">{currentSelection.count}</b>
              </span>
              <div className="flex gap-1.5">
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={currentSelection.all}
                  onClick={() => toggle(currentItems, true, groupName(path[path.length - 1], locale), path.join("/"))}
                >
                  选择本类
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={currentSelection.count === 0}
                  onClick={() => toggle(currentItems, false, groupName(path[path.length - 1], locale), path.join("/"))}
                >
                  取消本类
                </Button>
              </div>
            </div>
          )}

          {current.children.length > 0 && (
            <div className="grid grid-cols-2 gap-2 lg:grid-cols-3" role="group" aria-label="物品种类">
              {childNodes.map((child) => {
                const items = catalogItems(child);
                const state = selectionOf(items, selected);
                const name = groupName(child.key, locale);
                return (
                  <div
                    key={child.key}
                    className="flex min-h-[3.75rem] items-stretch overflow-hidden rounded-sm border border-line bg-surface-2/60 transition duration-150 ease-out hover:border-gold/50"
                  >
                    <button
                      type="button"
                      onClick={() => setPath(child.path)}
                      className="group flex min-w-0 flex-1 items-center gap-3 px-3.5 py-3 text-left focus-visible:outline-none"
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[13px] text-ink">{name}</span>
                        <small className="mt-1 block text-[10px] text-ink-muted">
                          {items.length} 项{state.count > 0 ? " · 已选 " + state.count : ""}
                        </small>
                      </span>
                      <ChevronRight aria-hidden="true" className="size-4 shrink-0 text-ink-muted transition group-hover:text-gold" />
                    </button>
                    <button
                      type="button"
                      role="checkbox"
                      aria-checked={state.all ? true : state.partial ? "mixed" : false}
                      aria-label={(state.all ? "取消本类：" : "选择本类：") + name}
                      onClick={() => toggle(items, !state.all, name, child.path.join("/"))}
                      className="grid w-10 shrink-0 place-items-center border-l border-line/70 transition hover:bg-gold/10 focus-visible:outline-none"
                    >
                      <SelectionMark state={state.all ? "on" : state.partial ? "mixed" : "off"} />
                    </button>
                  </div>
                );
              })}
            </div>
          )}

          {current.items.length > 0 && (
            <div className="overflow-hidden rounded-sm border border-line bg-surface-2/30" aria-label="当前分类物品">
              <div className="max-h-[26rem] overflow-auto">
                {current.items.map((item) => {
                  const checked = selected.has(item.id);
                  return (
                    <label
                      key={item.id}
                      className={cn(
                        "flex cursor-pointer items-center gap-3 border-b border-line/60 px-3.5 py-2.5 transition last:border-b-0 hover:bg-surface-3/60",
                        checked && "bg-gold/[0.05]",
                      )}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        className="peer sr-only"
                        onChange={(event) =>
                          toggle([item], event.target.checked, item.localeNames[locale] || item.name, item.id)
                        }
                      />
                      <SelectionMark state={checked ? "on" : "off"} />
                      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                        <b className="truncate text-[11px] font-medium leading-tight text-ink">{item.localeNames[locale]}</b>
                        <small className="truncate text-[10px] leading-tight text-ink-muted">{item.name}</small>
                      </span>
                      <em className="shrink-0 text-[10px] not-italic text-ink-muted">
                        {item.ambiguous ? "沿用原始规则" : checked ? "已加入白名单" : ""}
                      </em>
                    </label>
                  );
                })}
              </div>
            </div>
          )}

          {current.children.length === 0 && current.items.length === 0 && (
            <EmptyState
              className="min-h-[12rem] rounded-sm border border-line bg-surface-2/30"
              icon={<SearchX aria-hidden="true" className="size-5" />}
              title="没有匹配的物品"
              description="请返回上级分类或修改搜索词。"
            />
          )}
        </>
      )}

      {!current && (
        <EmptyState
          className="min-h-[12rem] rounded-sm border border-line bg-surface-2/30"
          icon={<SearchX aria-hidden="true" className="size-5" />}
          title="这个分类下没有匹配的物品"
          description="请返回上级分类或修改搜索词。"
        />
      )}

      <p className="font-mono text-[10px] tracking-tight text-ink-muted">
        {query.trim()
          ? "搜索匹配 " + matchingItems.length + " 项，可按分类整类勾选。"
          : "按玩法与种类逐级选择，整类或单件都可以直接勾选，共 " + ITEM_CATALOG.length + " 项。"}
      </p>

      <div className="border-t border-line/70 pt-4">
        <h3 className="flex items-baseline gap-2 text-sm font-semibold text-ink">
          已选白名单
          <span className="font-mono text-[11px] font-normal text-ink-muted">{selectedCount}</span>
        </h3>
        {entries.length === 0 ? (
          <p className="mt-2 text-[11px] text-ink-muted">勾选整类或单件物品后，会显示在这里。</p>
        ) : (
          <div className="mt-3 flex max-h-44 flex-wrap gap-2 overflow-auto pr-1">
            {entries.map((entry) => (
              <Chip key={entry.id} onRemove={() => onRemoveEntry(entry.id)} removeLabel={"移除白名单：" + entry.label}>
                {entry.label}
                {entry.itemIds.length > 1 ? <span className="ml-1 font-mono text-ink-muted">· {entry.itemIds.length} 项</span> : null}
              </Chip>
            ))}
          </div>
        )}
        <p className="mt-3 text-[10px] leading-relaxed text-ink-muted/80">
          整类条目会展开成对应的 BaseType 列表写进过滤器；单件物品按单条规则写入，两者可以混用。
        </p>
      </div>
    </div>
  );
}
