"use client";

import { useMemo, useState } from "react";
import { Check, ChevronRight, SearchX } from "lucide-react";

import { buildCatalogTree, catalogItems, catalogNode, groupName, searchCatalog } from "../../lib/catalog";
import { cn } from "../../lib/cn";
import { ITEM_CATALOG } from "../../lib/data";
import type { Locale } from "../../lib/types";
import { SearchInput } from "./ui/controls";
import { Chip, EmptyState } from "./ui/primitives";

const ITEM_BY_ID = new Map(ITEM_CATALOG.map((item) => [item.id, item]));

export function ItemPicker({
  locale,
  selectedIds,
  onToggle,
}: {
  locale: Locale;
  selectedIds: string[];
  onToggle: (id: string, checked: boolean) => void;
}) {
  const [query, setQuery] = useState("");
  const [path, setPath] = useState<string[]>([]);
  const matchingItems = useMemo(() => searchCatalog(ITEM_CATALOG, query), [query]);
  const tree = useMemo(() => buildCatalogTree(matchingItems), [matchingItems]);
  const current = catalogNode(tree, path);
  const selected = new Set(selectedIds);

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
          {current.children.length > 0 && (
            <div className="grid grid-cols-2 gap-2 lg:grid-cols-3" role="group" aria-label="物品种类">
              {current.children.map((child) => {
                const items = catalogItems(child);
                const selectedCount = items.filter((item) => selected.has(item.id)).length;
                return (
                  <button
                    key={child.key}
                    type="button"
                    onClick={() => setPath(child.path)}
                    className="group flex min-h-[3.75rem] items-center gap-3 rounded-sm border border-line bg-surface-2/60 px-3.5 py-3 text-left transition duration-150 ease-out hover:-translate-y-0.5 hover:border-gold/50 focus-visible:outline-none"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13px] text-ink">{groupName(child.key, locale)}</span>
                      <small className="mt-1 block text-[10px] text-ink-muted">
                        {items.length} 项{selectedCount > 0 ? " · 已选 " + selectedCount : ""}
                      </small>
                    </span>
                    <ChevronRight aria-hidden="true" className="size-4 shrink-0 text-ink-muted transition group-hover:text-gold" />
                  </button>
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
                        onChange={(event) => onToggle(item.id, event.target.checked)}
                      />
                      <span
                        aria-hidden="true"
                        className="grid size-4 shrink-0 place-items-center rounded-sm border border-line-strong bg-surface-3 text-transparent transition peer-checked:border-gold peer-checked:bg-gold peer-checked:text-[#0b0805] peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-gold/50"
                      >
                        <Check className="size-3" strokeWidth={3} />
                      </span>
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
        {query.trim() ? "搜索匹配 " + matchingItems.length + " 项，请按种类展开选择。" : "按物品种类逐级选择，共 " + ITEM_CATALOG.length + " 项。"}
      </p>

      <div className="border-t border-line/70 pt-4">
        <h3 className="flex items-baseline gap-2 text-sm font-semibold text-ink">
          已选白名单
          <span className="font-mono text-[11px] font-normal text-ink-muted">{selected.size}</span>
        </h3>
        {selected.size === 0 ? (
          <p className="mt-2 text-[11px] text-ink-muted">在分类中勾选物品后，会显示在这里。</p>
        ) : (
          <div className="mt-3 flex max-h-44 flex-wrap gap-2 overflow-auto pr-1">
            {[...selected].map((id) => {
              const item = ITEM_BY_ID.get(id);
              return (
                <Chip
                  key={id}
                  onRemove={() => onToggle(id, false)}
                  removeLabel={"移除白名单：" + (item?.localeNames[locale] || id)}
                >
                  {item?.localeNames[locale] || id}
                </Chip>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
