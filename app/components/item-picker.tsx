"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { Check, ChevronDown, ChevronRight, Coins, Gem, Package, SearchX, Shield, X } from "lucide-react";

import { canFollowBaselineItem } from "../../lib/baseline-effects";
import { buildCatalogTree, catalogItems, catalogNode, groupName, groupOrder, itemLabel, searchCatalog, type CatalogNode } from "../../lib/catalog";
import { cn } from "../../lib/cn";
import { FILTER_ITEMS_BY_ID, PICKER_ITEMS } from "../../lib/data";
import type { ItemDefinition, Locale } from "../../lib/types";
import { useAppStore } from "../state/store";
import type { ItemPickerToggle } from "../state/types";
import { CachedItemImage } from "./cached-item-image";
import { Button } from "./ui/button";
import { Checkbox } from "./ui/checkbox";
import { ConfirmDialog } from "./ui/dialog";
import { EmptyState } from "./ui/empty-state";
import { SearchInput } from "./ui/input";

const LOCALE: Locale = "cn";
/** 物品卡片固定高度，虚拟列表按这个高度估算。 */
const ROW_HEIGHT = 56;
const ROW_GAP = 8;

function ItemImage({ item }: { item: ItemDefinition }) {
  const [failed, setFailed] = useState(false);
  const group = item.categoryPath[0];
  const Icon = group === "gems" ? Gem : group === "equipment" ? Shield : item.stackable ? Coins : Package;
  return (
    <span aria-hidden="true" className="grid size-10 shrink-0 place-items-center rounded-md border border-line/60 bg-surface">
      {item.iconUrl && !failed ? (
        <CachedItemImage src={item.iconUrl} alt="" width={32} height={32} className="size-8 object-contain" onError={() => setFailed(true)} />
      ) : (
        <Icon className="size-4 text-ink-muted" />
      )}
    </span>
  );
}

function itemMeta(item: ItemDefinition) {
  const parts: string[] = [];
  if (item.category === "unique") parts.push(`传奇 · ${item.matcher.baseType}`);
  if (item.matcher.nonUnique) {
    parts.push(groupName(item.categoryPath.at(-1) ?? "equipment", LOCALE) + (item.dropLevel ? ` · 掉落等级 ${item.dropLevel}` : ""));
  }
  if (itemLabel(item, LOCALE) !== item.name) parts.push(item.name);
  return parts.join(" · ");
}

function ItemCard({ item, selected, selectedOnly, onToggle }: {
  item: ItemDefinition;
  selected: boolean;
  selectedOnly: boolean;
  onToggle: () => void;
}) {
  // 「仅看已选」视图里每一项都是已选状态，点击即移除。
  const checked = selected || selectedOnly;
  const label = itemLabel(item, LOCALE);
  return (
    <div
      className={cn(
        "flex items-center gap-1 rounded-md border p-1.5 transition-colors duration-150",
        checked ? "border-gold/60 bg-gold/8" : "border-line bg-surface hover:border-line-strong hover:bg-surface-2",
      )}
    >
      <button
        type="button"
        aria-pressed={checked}
        aria-label={selectedOnly ? `移除 ${label}` : label}
        onClick={onToggle}
        className="flex min-w-0 flex-1 cursor-pointer items-center gap-2.5 rounded-sm text-left outline-none"
      >
        <ItemImage item={item} />
        <span className="min-w-0 flex-1">
          <span className={cn("block truncate text-xs font-medium", checked ? "text-gold-bright" : "text-ink")} title={label}>
            {label}
          </span>
          <span className="block truncate text-xs text-ink-muted" title={itemMeta(item)}>
            {itemMeta(item)}
          </span>
        </span>
      </button>
      <span
        aria-hidden="true"
        className={cn(
          "grid size-4 shrink-0 place-items-center rounded-sm border",
          checked ? "border-gold bg-gold text-on-gold" : "border-line-strong",
        )}
      >
        {checked && (selectedOnly ? <X className="size-3" strokeWidth={3} /> : <Check className="size-3" strokeWidth={3} />)}
      </span>
    </div>
  );
}

type TreeRow = { node: CatalogNode; depth: number; open: boolean };

type ItemPickerProps = { itemIds: string[]; items?: ItemDefinition[]; flat?: boolean } & (
  | { onToggle: (toggle: ItemPickerToggle) => void; onClear: () => void; onPick?: never }
  | { onPick: (id: string) => void; onToggle?: never; onClear?: never }
);

function ItemPicker({ itemIds, items = PICKER_ITEMS, flat = false, onToggle, onClear, onPick }: ItemPickerProps) {
  const [query, setQuery] = useState("");
  const [path, setPath] = useState<string[]>([]);
  const [selectedOnly, setSelectedOnly] = useState(false);
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set([""]));
  const [columns, setColumns] = useState(2);
  const scrollRef = useRef<HTMLDivElement>(null);

  const search = query.trim();
  const tree = useMemo(() => buildCatalogTree(items), [items]);
  const selected = useMemo(() => new Set(itemIds), [itemIds]);
  const matching = useMemo(() => searchCatalog(items, query), [items, query]);
  const current = catalogNode(tree, path) ?? tree;
  const selectedItems = useMemo(
    () => [...selected].map((id) => FILTER_ITEMS_BY_ID.get(id)).filter((item): item is ItemDefinition => Boolean(item)),
    [selected],
  );
  const visibleItems = selectedOnly ? searchCatalog(selectedItems, query) : search || flat ? matching : current.items;
  const hasVisibleItems = visibleItems.length > 0;
  const scope = search ? matching : catalogItems(current);
  const stackables = scope.filter((item) => item.stackable);
  const canBatch = Boolean(search || path.length);
  const group = search ? "搜索结果" : path.length ? groupName(current.key, LOCALE) : "全部物品";
  const count = (items: ItemDefinition[]) => items.reduce((total, item) => total + (selected.has(item.id) ? 1 : 0), 0);

  // 每个分类的物品总数只和目录有关，算一次就够。
  const totals = useMemo(() => {
    const map = new Map<string, number>();
    const walk = (node: CatalogNode): number => {
      let total = node.items.length;
      for (const child of node.children) total += walk(child);
      map.set(node.path.join("/"), total);
      return total;
    };
    walk(tree);
    return map;
  }, [tree]);

  const rows = useMemo(() => {
    const list: TreeRow[] = [];
    const walk = (node: CatalogNode, depth: number) => {
      for (const child of [...node.children].sort((a, b) => groupOrder(a.key) - groupOrder(b.key))) {
        const open = expanded.has(child.path.join("/"));
        list.push({ node: child, depth, open });
        if (open) walk(child, depth + 1);
      }
    };
    walk(tree, 1);
    return list;
  }, [tree, expanded]);

  const toggleExpanded = (id: string) =>
    setExpanded((currentSet) => {
      const next = new Set(currentSet);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  function navigate(nextPath: string[]) {
    setPath(nextPath);
    setExpanded((currentSet) => {
      const next = new Set(currentSet);
      for (let index = 1; index <= nextPath.length; index += 1) next.add(nextPath.slice(0, index).join("/"));
      return next;
    });
  }

  function toggle(items: ItemDefinition[], checked: boolean, label: string, key: string) {
    onToggle?.({ ids: items.map((item) => item.id), checked, label, key });
  }

  const virtualizer = useVirtualizer({
    count: visibleItems.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT + ROW_GAP,
    overscan: 6,
    lanes: columns,
  });

  useEffect(() => {
    const element = scrollRef.current;
    if (!element) return;
    const update = () => setColumns(element.clientWidth >= 640 ? 2 : 1);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, [hasVisibleItems]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 0 });
  }, [query, path, selectedOnly]);

  const childNodes = [...current.children].sort((a, b) => groupOrder(a.key) - groupOrder(b.key));
  const showCategories = !flat && !selectedOnly && !search && childNodes.length > 0;

  return (
    <div className={cn("grid gap-3", !flat && "md:grid-cols-[14.5rem_minmax(0,1fr)]")}>
      {!flat && <nav aria-label="物品分类" className="max-h-[min(26rem,52dvh)] overflow-y-auto overscroll-contain rounded-md border border-line bg-surface-2/50 p-1.5">
        {/* 根节点固定展开，始终排在第一行。 */}
        <>
          <div className="flex h-8 items-center gap-1.5 rounded-sm px-1.5">
            <span className="w-4 shrink-0" />
            {onToggle && (
              <Checkbox
                aria-label="选择全部分类"
                checked={selectedItems.length === 0 ? false : selectedItems.length === totals.get("") ? true : "indeterminate"}
                onCheckedChange={(checked) => toggle(items, checked === true, "全部分类", "")}
              />
            )}
            <button
              type="button"
              aria-current={!path.length ? "location" : undefined}
              onClick={() => navigate([])}
              className={cn(
                "min-w-0 flex-1 cursor-pointer truncate rounded-sm py-1 text-left text-xs hover:text-gold-bright",
                !path.length ? "font-semibold text-gold-bright" : "text-ink",
              )}
            >
              全部分类
            </button>
            <span className="font-mono text-xs text-ink-faint">{totals.get("") ?? 0}</span>
          </div>
          {rows.map(({ node, depth, open }) => {
            const id = node.path.join("/");
            const name = groupName(node.key, LOCALE);
            const total = totals.get(id) ?? 0;
            const chosen = count(catalogItems(node));
            const active = id === path.join("/");
            return (
              <div
                key={id}
                className={cn("flex h-8 items-center gap-1.5 rounded-sm pr-1.5 transition-colors duration-150 hover:bg-surface-3", active && "bg-surface-3")}
                style={{ paddingLeft: 6 + depth * 12 }}
              >
                <button
                  type="button"
                  aria-label={open ? `收起${name}` : `展开${name}`}
                  aria-expanded={open}
                  disabled={!node.children.length}
                  onClick={() => toggleExpanded(id)}
                  className="grid w-4 shrink-0 cursor-pointer place-items-center rounded-sm text-ink-faint hover:text-ink disabled:cursor-default disabled:opacity-0"
                >
                  {open ? <ChevronDown aria-hidden="true" className="size-3.5" /> : <ChevronRight aria-hidden="true" className="size-3.5" />}
                </button>
                {onToggle && (
                  <Checkbox
                    aria-label={`选择分类 ${name}`}
                    checked={chosen === 0 ? false : chosen === total ? true : "indeterminate"}
                    onCheckedChange={(checked) => toggle(catalogItems(node), checked === true, name, id)}
                  />
                )}
                <button
                  type="button"
                  aria-current={active ? "location" : undefined}
                  onClick={() => navigate(node.path)}
                  className={cn("min-w-0 flex-1 cursor-pointer truncate rounded-sm py-1 text-left text-xs hover:text-gold-bright", active ? "font-semibold text-gold-bright" : "text-ink")}
                >
                  {name}
                </button>
                <span className={cn("font-mono text-xs", chosen ? "text-gold-bright" : "text-ink-faint")}>
                  {chosen ? `${chosen}/${total}` : total}
                </span>
              </div>
            );
          })}
        </>
      </nav>}

      <div className="flex min-w-0 flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <SearchInput
            className="min-w-40 flex-1"
            value={query}
            aria-label="搜索物品"
            placeholder="搜索中文或英文物品名"
            onChange={(event) => setQuery(event.target.value)}
          />
          {onToggle && (
            <Button
              size="sm"
              variant={selectedOnly ? "secondary" : "ghost"}
              aria-pressed={selectedOnly}
              onClick={() => setSelectedOnly(!selectedOnly)}
            >
              已选 {selected.size} 项
            </Button>
          )}
        </div>

        {!flat && !selectedOnly && (
          <nav aria-label="当前分类" className="flex min-w-0 flex-wrap items-center gap-1 text-xs text-ink-muted">
            <button type="button" onClick={() => navigate([])} className={cn("cursor-pointer rounded-sm px-1 py-0.5 hover:text-ink", !path.length && "text-gold-bright")}>
              全部分类
            </button>
            {path.map((key, index) => (
              <span key={key + index} className="flex min-w-0 items-center gap-1">
                <ChevronRight aria-hidden="true" className="size-3 shrink-0 text-ink-faint" />
                <button
                  type="button"
                  aria-current={index === path.length - 1 ? "location" : undefined}
                  onClick={() => navigate(path.slice(0, index + 1))}
                  className={cn("cursor-pointer truncate rounded-sm px-1 py-0.5 hover:text-ink", index === path.length - 1 && "font-medium text-gold-bright")}
                >
                  {groupName(key, LOCALE)}
                </button>
              </span>
            ))}
            <span className="ml-auto text-ink-faint">{group}</span>
          </nav>
        )}

        {onToggle && !selectedOnly && (canBatch || stackables.length > 0) && (
          <div className="flex flex-wrap items-center gap-1.5 rounded-md border border-line bg-surface-2 px-2 py-1.5">
            {canBatch && <span className="mr-auto px-1 text-xs text-ink-muted">已选 {count(scope)} / {scope.length}</span>}
            {canBatch && (
              <Button size="sm" variant="ghost" disabled={scope.length === count(scope)} onClick={() => toggle(scope, true, group, search ? "search" : path.join("/"))}>
                {search ? "全选搜索结果" : "全选本类"}
              </Button>
            )}
            {canBatch && (
              <Button size="sm" variant="ghost" disabled={count(scope) === 0} onClick={() => toggle(scope, false, group, path.join("/"))}>
                取消所选
              </Button>
            )}
            {stackables.length > 0 && (
              <Button
                size="sm"
                variant="ghost"
                disabled={stackables.length === count(stackables)}
                onClick={() => toggle(stackables, true, "可堆叠物品", `${path.join("/")}/stackable`)}
              >
                全选可堆叠物品
              </Button>
            )}
          </div>
        )}

        {showCategories && (
          // 列宽要放得下「未切割的技能宝石」这样的分类名：右边还有「全选」按钮，太窄会把名字截得分不清。
          <div className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,15rem),1fr))] gap-2" role="group" aria-label="物品分类">
            {childNodes.map((child) => {
              const items = catalogItems(child);
              const chosen = count(items);
              const name = groupName(child.key, LOCALE);
              return (
                <div key={child.path.join("/")} className="flex min-w-0 rounded-md border border-line bg-surface transition-colors duration-150 hover:border-line-strong">
                  <button
                    type="button"
                    onClick={() => navigate(child.path)}
                    className="flex min-w-0 flex-1 cursor-pointer items-center justify-between gap-2 px-2.5 py-2 text-left hover:text-gold-bright"
                  >
                    <span className="min-w-0">
                      <span className="line-clamp-2 text-sm leading-snug text-ink">{name}</span>
                      <span className="text-xs text-ink-muted">
                      {onPick ? `${items.length} 项物品` : `已选 ${chosen} / ${items.length}`}
                    </span>
                    </span>
                    <ChevronRight aria-hidden="true" className="size-4 shrink-0 text-ink-muted" />
                  </button>
                  {onToggle && (
                    <button
                      type="button"
                      aria-label={`选择分类 ${name}`}
                      aria-pressed={chosen === items.length ? true : chosen > 0 ? "mixed" : false}
                      onClick={() => toggle(items, chosen !== items.length, name, child.path.join("/"))}
                      className={cn(
                        "w-12 shrink-0 cursor-pointer border-l border-line text-xs transition-colors hover:bg-gold/10",
                        chosen ? "text-gold-bright" : "text-ink-muted",
                      )}
                    >
                      {chosen === items.length ? "已选" : chosen > 0 ? "部分" : "全选"}
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {hasVisibleItems && (
          <div
            ref={scrollRef}
            className={cn(
              "max-h-[min(26rem,52dvh)] overflow-y-auto overscroll-contain rounded-md border border-line bg-surface-2/50 p-2",
              !flat && "h-[min(26rem,52dvh)]",
            )}
            aria-label={selectedOnly ? "已选物品" : "物品列表"}
          >
            <div style={{ height: virtualizer.getTotalSize(), position: "relative" }}>
              {virtualizer.getVirtualItems().map((row) => {
                const item = visibleItems[row.index];
                if (!item) return null;
                const checked = selected.has(item.id);
                const label = itemLabel(item, LOCALE);
                return (
                  <div
                    key={item.id}
                    style={{
                      position: "absolute", top: 0, left: 0, width: "100%", height: ROW_HEIGHT, transform: `translateY(${row.start}px)`,
                      // 每行是独立的 grid，必须写死等宽列，否则两列会按各自内容分宽而错位。
                      gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
                    }}
                    // 每个格子是一条独立的虚拟行，都铺满整行；后面那条（右列）会盖住前面那条，
                    // 所以行容器不接收鼠标事件，只有自己的那一格可以点。
                    className="pointer-events-none grid gap-2 pr-1"
                  >
                    <div style={{ gridColumn: row.lane + 1 }} className="pointer-events-auto h-full">
                      <ItemCard
                        item={item}
                        selected={checked}
                        selectedOnly={selectedOnly}
                        onToggle={() => {
                          if (onPick) onPick(item.id);
                          else toggle([item], !checked, label, item.id);
                        }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {!hasVisibleItems && (flat || selectedOnly || search || childNodes.length === 0) && (
          <EmptyState
            compact
            className="rounded-md border border-line"
            icon={<SearchX className="size-4" aria-hidden="true" />}
            title={selectedOnly && !search ? "选中的物品显示在这里" : "试试其他物品名称"}
          />
        )}
        {onClear && selectedOnly && itemIds.length > 0 && (
          <Button size="sm" variant="ghost" className="self-start" onClick={onClear}>
            清空选择
          </Button>
        )}
      </div>
    </div>
  );
}

function applyToggle(current: string[], toggle: ItemPickerToggle) {
  const next = new Set(current);
  for (const id of toggle.ids) {
    if (toggle.checked) next.add(id);
    else next.delete(id);
  }
  return [...next];
}

/** 选择规则物品、跳过物品或单个特效来源。点选即时生效。 */
export function ItemPickerDialog() {
  const target = useAppStore((state) => state.picker);
  const closePicker = useAppStore((state) => state.closePicker);
  const profile = useAppStore((state) => state.profile);
  const activeRuleId = useAppStore((state) => state.activeRuleId);
  const updateRule = useAppStore((state) => state.updateRule);
  const setRuleAppearance = useAppStore((state) => state.setRuleAppearance);
  const toggleSkipped = useAppStore((state) => state.toggleSkipped);
  const clearSkipped = useAppStore((state) => state.clearSkipped);

  if (!target) return null;

  if (target === "skipped") {
    return (
      <ConfirmDialog
        open
        onOpenChange={(open) => {
          if (!open) closePicker();
        }}
        size="xl"
        title="编辑跳过物品"
        description="名单中的物品沿用基础过滤器的规则和特效。"
        footer={
          <>
            <span className="mr-auto text-xs text-ink-muted">已跳过 {profile.skippedItemIds.length} 项</span>
            <Button variant="primary" onClick={closePicker}>
              完成
            </Button>
          </>
        }
      >
        <ItemPicker itemIds={profile.skippedItemIds} onToggle={toggleSkipped} onClear={clearSkipped} />
      </ConfirmDialog>
    );
  }

  if (typeof target !== "string") {
    const rule = profile.rules.find((entry) => entry.id === target.ruleId);
    if (!rule) return null;
    const candidates = target.itemIds
      ? target.itemIds.flatMap((id) => FILTER_ITEMS_BY_ID.get(id) ?? [])
      : PICKER_ITEMS;
    return (
      <ConfirmDialog
        open
        onOpenChange={(open) => {
          if (!open) closePicker();
        }}
        size={target.itemIds ? "lg" : "xl"}
        title={target.itemIds ? "选择预设来源" : "选择特效来源物品"}
        description={target.itemIds
          ? "这些物品在当前基础过滤器中使用此预设。选择一个作为特效来源。"
          : profile.baseFilter
            ? "选择物品后，这条规则将使用该物品在基础过滤器中的特效。"
            : "绑定来源物品后，选择基础过滤器前将使用游戏默认样式。"}
        footer={<Button onClick={closePicker}>取消</Button>}
      >
        <ItemPicker
          items={candidates.filter(canFollowBaselineItem)}
          itemIds={rule.baselineEffectItemId ? [rule.baselineEffectItemId] : []}
          flat={Boolean(target.itemIds)}
          onPick={(itemId) => {
            setRuleAppearance(rule.id, { itemId });
            closePicker();
          }}
        />
      </ConfirmDialog>
    );
  }

  const rule = profile.rules.find((entry) => entry.id === activeRuleId) ?? profile.rules[0];
  if (!rule) return null;
  return (
    <ConfirmDialog
      open
      onOpenChange={(open) => {
        if (!open) closePicker();
      }}
      size="xl"
      title="选择物品"
      description={`为「${rule.name}」选择要匹配的物品。`}
      footer={
        <>
          <span className="mr-auto text-xs text-ink-muted">已选 {rule.target.itemIds.length} 项</span>
          <Button variant="primary" onClick={closePicker}>
            完成
          </Button>
        </>
      }
    >
      <ItemPicker
        itemIds={rule.target.itemIds}
        onToggle={(toggle) =>
          updateRule(rule.id, {
            target: { ...rule.target, itemIds: applyToggle(rule.target.itemIds, toggle), ...(toggle.checked ? { itemEnabled: true } : {}) },
          })
        }
        onClear={() => updateRule(rule.id, { target: { ...rule.target, itemIds: [] } })}
      />
    </ConfirmDialog>
  );
}
