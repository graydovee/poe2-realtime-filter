"use client";

import { useMemo, useState } from "react";
import { ITEM_CATALOG } from "../../lib/data";
import { buildCatalogTree, catalogItems, catalogNode, groupName, searchCatalog } from "../../lib/catalog";
import type { Locale } from "../../lib/types";

const ITEM_BY_ID = new Map(ITEM_CATALOG.map((item) => [item.id, item]));

export function ItemPicker({ locale, selectedIds, onToggle }: { locale: Locale; selectedIds: string[]; onToggle: (id: string, checked: boolean) => void }) {
  const [query, setQuery] = useState("");
  const [path, setPath] = useState<string[]>([]);
  const matchingItems = useMemo(() => searchCatalog(ITEM_CATALOG, query), [query]);
  const tree = useMemo(() => buildCatalogTree(matchingItems), [matchingItems]);
  const current = catalogNode(tree, path);
  const selected = new Set(selectedIds);

  return <div className="item-picker">
    <label className="catalog-search">搜索物品<input type="search" value={query} placeholder="中文、繁中或英文名称" onChange={(event) => { setQuery(event.target.value); setPath([]); }} /></label>
    <nav className="catalog-breadcrumb" aria-label="物品分类路径">
      <button type="button" onClick={() => setPath([])} aria-current={path.length === 0 ? "location" : undefined}>全部种类</button>
      {path.map((key, index) => <span key={path.slice(0, index + 1).join("/")}><span aria-hidden="true">/</span><button type="button" onClick={() => setPath(path.slice(0, index + 1))} aria-current={index === path.length - 1 ? "location" : undefined}>{groupName(key, locale)}</button></span>)}
    </nav>
    {current && <>
      {current.children.length > 0 && <div className="category-grid" role="group" aria-label="物品种类">{current.children.map((child) => {
        const items = catalogItems(child);
        const selectedCount = items.filter((item) => selected.has(item.id)).length;
        return <button type="button" className="category-button" key={child.key} onClick={() => setPath(child.path)}><span>{groupName(child.key, locale)}</span><small>{items.length} 项{selectedCount > 0 ? " · 已选 " + selectedCount : ""}</small><span aria-hidden="true">›</span></button>;
      })}</div>}
      {current.items.length > 0 && <div className="catalog-list" aria-label="当前分类物品">{current.items.map((item) => <label className="catalog-row" key={item.id}><input type="checkbox" checked={selected.has(item.id)} onChange={(event) => onToggle(item.id, event.target.checked)} /><span><b>{item.localeNames[locale]}</b><small>{item.name}</small></span><em>{item.ambiguous ? "沿用原始规则" : selected.has(item.id) ? "已加入白名单" : ""}</em></label>)}</div>}
      {current.children.length === 0 && current.items.length === 0 && <p className="catalog-empty">没有匹配的物品。</p>}
    </>}
    {!current && <p className="catalog-empty">这个分类下没有匹配的物品，请返回上级分类或修改搜索词。</p>}
    <p className="catalog-count">{query.trim() ? "搜索匹配 " + matchingItems.length + " 项，请按种类展开选择。" : "按物品种类逐级选择，共 " + ITEM_CATALOG.length + " 项。"}</p>
    <div className="selected-items"><h3>已选白名单 <span>{selected.size}</span></h3>{selected.size === 0 ? <p>在分类中勾选物品后，会显示在这里。</p> : <div className="selected-chips">{[...selected].map((id) => {
      const item = ITEM_BY_ID.get(id);
      return <button type="button" key={id} aria-label={"移除白名单：" + (item?.localeNames[locale] || id)} onClick={() => onToggle(id, false)}>{item?.localeNames[locale] || id}<span aria-hidden="true">×</span></button>;
    })}</div>}</div>
  </div>;
}
