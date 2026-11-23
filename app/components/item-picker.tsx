"use client";

import { useMemo, useState } from "react";
import { ChevronRight, Coins, Gem, Package, SearchX, Shield, X } from "lucide-react";

import { buildCatalogTree, catalogItems, catalogNode, groupName, groupOrder, searchCatalog } from "../../lib/catalog";
import { cn } from "../../lib/cn";
import { FILTER_ITEMS_BY_ID, PICKER_ITEMS } from "../../lib/data";
import type { ItemDefinition, Locale } from "../../lib/types";
import { SearchInput } from "./ui/controls";
import { Button, EmptyState } from "./ui/primitives";
import { CachedItemImage } from "./cached-item-image";

export type ItemPickerEntry = { id: string; label: string; itemIds: string[] };
export type ItemPickerToggle = { ids: string[]; checked: boolean; label: string; key: string };

function ItemImage({ item }: { item: ItemDefinition }) {
  const [failed, setFailed] = useState(false);
  const group = item.categoryPath[0];
  const Icon = group === "gems" ? Gem : group === "equipment" ? Shield : item.stackable ? Coins : Package;
  return (
    <span aria-hidden="true" className="flex size-10 shrink-0 items-center justify-center rounded-lg border border-line/60 bg-surface">
      {item.iconUrl && !failed ? (
        <CachedItemImage
          src={item.iconUrl}
          alt=""
          width={36}
          height={36}
          className="size-9 object-contain"
          onError={() => setFailed(true)}
        />
      ) : <Icon className="size-5 text-ink-muted" />}
    </span>
  );
}

export function ItemPicker({ locale, entries, onToggle, onRemoveEntry, onGemLevel }: {
  locale: Locale;
  entries: ItemPickerEntry[];
  onToggle: (toggle: ItemPickerToggle) => void;
  onRemoveEntry: (entryId: string) => void;
  onGemLevel?: (id: string, level: number) => void;
}) {
  const [query, setQuery] = useState("");
  const [path, setPath] = useState<string[]>([]);
  const [selectedOnly, setSelectedOnly] = useState(false);
  const [limit, setLimit] = useState(60);
  const [gemLevel, setGemLevel] = useState(20);
  const search = query.trim();
  const matching = useMemo(() => searchCatalog(PICKER_ITEMS, query), [query]);
  const tree = useMemo(() => buildCatalogTree(PICKER_ITEMS), []);
  const current = catalogNode(tree, path) ?? tree;
  const selected = useMemo(() => new Set(entries.flatMap((entry) => entry.itemIds)), [entries]);
  const classified = catalogItems(current);
  const count = (items: ItemDefinition[]) => items.filter((item) => selected.has(item.id)).length;
  const childNodes = [...current.children].sort((a, b) => groupOrder(a.key) - groupOrder(b.key));
  const selectedItems = [...selected].map((id) => FILTER_ITEMS_BY_ID.get(id)).filter((item): item is ItemDefinition => Boolean(item));
  const visibleItems = selectedOnly ? searchCatalog(selectedItems, query) : search ? matching : current.items;
  const scope = search ? matching : classified;
  const stackables = scope.filter((item) => item.stackable);
  const canBatch = Boolean(search || path.length);
  const group = search ? "搜索结果" : groupName(current.key, locale);

  function toggle(items: ItemDefinition[], checked: boolean, label: string, key: string) {
    onToggle({ ids: items.map((item) => item.id), checked, label, key });
  }

  function navigate(nextPath: string[]) {
    setPath(nextPath);
    setLimit(60);
  }

  return (
    <div className="flex min-w-0 flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-line bg-surface-2/45 p-2">
        <SearchInput className="min-w-40 flex-1" value={query} aria-label="搜索物品" placeholder="搜索中文或英文物品名" onChange={(event) => { setQuery(event.target.value); setLimit(60); }} />
        <Button size="sm" variant={selectedOnly ? "secondary" : "ghost"} className="rounded-lg" aria-pressed={selectedOnly} onClick={() => { setSelectedOnly(!selectedOnly); setLimit(60); }}>
          已选 {selected.size} 项
        </Button>
      </div>
      {!selectedOnly && !search && (
        <nav className="flex flex-wrap items-center gap-1 rounded-lg border border-line bg-surface-2/35 px-2 py-1.5 text-xs text-ink-muted" aria-label="物品分类路径">
          <button type="button" className="rounded-sm px-1.5 py-1 hover:text-ink" aria-current={!path.length ? "location" : undefined} onClick={() => navigate([])}>全部分类</button>
          {path.map((key, index) => (
            <span key={key} className="flex items-center gap-1">
              <ChevronRight className="size-3" aria-hidden="true" />
              <button type="button" className="rounded-sm px-1.5 py-1 hover:text-ink" aria-current={index === path.length - 1 ? "location" : undefined} onClick={() => navigate(path.slice(0, index + 1))}>{groupName(key, locale)}</button>
            </span>
          ))}
        </nav>
      )}
      {!selectedOnly && (canBatch || stackables.length > 0) && (
        <div className="flex flex-wrap items-center gap-1.5 rounded-lg border border-line bg-surface-2 px-2 py-1.5">
          {canBatch && <span className="mr-auto px-1 text-xs text-ink-muted">已选 {count(scope)} / {scope.length}</span>}
          {canBatch && <Button size="sm" variant="ghost" disabled={scope.length === count(scope)} onClick={() => toggle(scope, true, group, search ? "search" : path.join("/"))}>{search ? "全选搜索结果" : "全选本类"}</Button>}
          {canBatch && <Button size="sm" variant="ghost" disabled={count(scope) === 0} onClick={() => toggle(scope, false, group, path.join("/"))}>取消所选</Button>}
          {stackables.length > 0 && <Button size="sm" variant="ghost" disabled={stackables.length === count(stackables)} onClick={() => toggle(stackables, true, "可堆叠物品", `${path.join("/")}/stackable`)}>全选可堆叠物品</Button>}
        </div>
      )}
      {!selectedOnly && !search && childNodes.length > 0 && (
        <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,11rem),1fr))] gap-2" role="group" aria-label="物品分类">
          {childNodes.map((child) => {
            const items = catalogItems(child);
            const chosen = count(items);
            const name = groupName(child.key, locale);
            return (
              <div key={child.key} className="flex min-w-0 rounded-sm border border-line bg-surface-2/60">
                <button type="button" onClick={() => navigate(child.path)} className="flex min-w-0 flex-1 items-center justify-between gap-2 px-2.5 py-2 text-left hover:text-gold-bright">
                  <span className="min-w-0"><span className="block truncate text-sm">{name}</span><span className="text-xs text-ink-muted">已选 {chosen} / {items.length}</span></span>
                  <ChevronRight className="size-4 shrink-0 text-ink-muted" aria-hidden="true" />
                </button>
                <button type="button" aria-label={`选择分类 ${name}`} aria-pressed={chosen === items.length ? true : chosen > 0 ? "mixed" : false} onClick={() => toggle(items, chosen !== items.length, name, child.path.join("/"))} className={cn("shrink-0 border-l border-line px-2 text-xs hover:bg-gold/10", chosen ? "text-gold-bright" : "text-ink-muted")}>
                  {chosen === items.length ? "已选" : chosen > 0 ? "部分" : "全选"}
                </button>
              </div>
            );
          })}
        </div>
      )}
      {visibleItems.length > 0 && (
        <div className="max-h-[29rem] overflow-auto rounded-sm border border-line bg-surface-2/30 p-2" aria-label={selectedOnly ? "已选物品" : "物品网格"}>
          <div className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,12rem),1fr))] gap-2">
            {visibleItems.slice(0, limit).map((item) => {
              const checked = selected.has(item.id);
              const label = item.localeNames[locale] || item.name;
              const gemShortcut = onGemLevel && ["uncut-skill-gem", "uncut-spirit-gem"].includes(item.id);
              return (
                <div key={item.id} className={cn("min-w-0 rounded-sm border", checked ? "border-gold/60 bg-gold/[0.08]" : "border-line bg-surface-2")}>
                  <button type="button" aria-pressed={checked} aria-label={selectedOnly ? `移除 ${label}` : label} onClick={() => toggle([item], !checked, label, item.id)} className="flex min-h-14 w-full items-center gap-2 p-2 text-left hover:bg-surface-3/60">
                    <ItemImage item={item} />
                    <span className="min-w-0 flex-1">
                      <span className="line-clamp-2 break-words text-xs font-medium text-ink">{label}</span>
                      {item.category === "unique" && <span className="block text-xs text-gold">传奇 · {item.matcher.baseType}</span>}
                      {item.matcher.nonUnique && <span className="block text-xs text-ink-muted">{groupName(item.categoryPath.at(-1) ?? "equipment", locale)}{item.dropLevel ? ` · 掉落等级 ${item.dropLevel}` : ""}</span>}
                      {label !== item.name && <span className="block truncate text-xs text-ink-muted">{item.name}</span>}
                    </span>
                    {selectedOnly && <X className="size-4 shrink-0 text-ink-muted" aria-hidden="true" />}
                  </button>
                  {gemShortcut && <div className="flex items-center gap-1 border-t border-line p-1.5">
                    <label className="flex min-w-0 items-center gap-1 text-xs text-ink-muted">等级 <select aria-label={`${label}等级`} value={gemLevel} onChange={(event) => setGemLevel(Number(event.target.value))} className="rounded-sm border border-line bg-surface px-1 py-1 text-ink">{Array.from({ length: 20 }, (_, i) => <option key={i} value={i + 1}>{i + 1}</option>)}</select></label>
                    <Button size="sm" variant="ghost" onClick={() => onGemLevel(item.id, gemLevel)}>应用等级</Button>
                  </div>}
                </div>
              );
            })}
          </div>
          {visibleItems.length > limit && <Button className="mt-2 w-full" size="sm" variant="ghost" onClick={() => setLimit(limit + 60)}>加载更多 · {limit} / {visibleItems.length}</Button>}
        </div>
      )}
      {visibleItems.length === 0 && (selectedOnly || search || childNodes.length === 0) && (
        <EmptyState className="min-h-28 rounded-sm border border-line" icon={<SearchX className="size-5" aria-hidden="true" />} title={selectedOnly && !search ? "选中的物品显示在这里" : "试试其他物品名称"} />
      )}
      {selectedOnly && entries.length > 0 && <Button size="sm" variant="ghost" onClick={() => entries.forEach((entry) => onRemoveEntry(entry.id))}>清空选择</Button>}
    </div>
  );
}
