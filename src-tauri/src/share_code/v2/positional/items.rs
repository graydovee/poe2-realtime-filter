//! Category paths, stable slots, and list references for the positional body.

use super::wire::{invalid, put_uint, Reader};
use crate::engine::{self, Result};
use serde::Deserialize;
use std::{
    collections::{BTreeMap, HashMap, HashSet},
    ops::Range,
    sync::LazyLock,
};

const LIST_GROUPS: usize = 0;
const LIST_REFERENCE: usize = 1;
const LIST_CATEGORIES: usize = 2;
const LIST_MIXED: usize = 3;
const PATH_MORE: u8 = 0x80;
const PATH_WIDE: u8 = 0x7e;
const PATH_ROOT: u8 = 0x7f;
const PATH_HIDDEN: u8 = 0xff;
const ALL: usize = 0;
const EXCEPT: usize = 1;
const RANGES: usize = 2;
const SPARSE: usize = 3;

pub(super) type Address = (usize, usize);

#[derive(Deserialize)]
pub(super) struct Catalog {
    groups: Vec<Group>,
    current: HashMap<String, Address>,
    tree: Node,
}

#[derive(Deserialize)]
struct Node {
    group: Option<usize>,
    children: Vec<Node>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Group {
    id: usize,
    slots: Vec<Option<String>>,
    path: Option<Vec<usize>>,
    active_slots: Vec<usize>,
}

impl Catalog {
    pub(super) fn address(&self, id: &str) -> Result<Address> {
        self.current
            .get(id)
            .copied()
            .ok_or_else(|| format!("当前物品目录没有「{id}」的分享地址"))
    }

    fn group(&self, id: usize) -> Result<&Group> {
        self.groups
            .get(id)
            .filter(|group| group.id == id)
            .ok_or_else(|| format!("分享码包含未知的物品分类编号 {id}，请升级客户端"))
    }

    fn hidden_group(&self) -> Result<&Group> {
        self.groups
            .iter()
            .find(|group| group.path.is_none())
            .ok_or_else(invalid)
    }
}

impl Group {
    fn id_at(&self, slot: usize) -> Result<&str> {
        self.slots
            .get(slot)
            .ok_or_else(|| self.unknown(slot))?
            .as_deref()
            .ok_or_else(|| {
                format!(
                    "分享码中的物品地址 {}:{slot} 已退役，当前目录无法还原",
                    self.id
                )
            })
    }

    fn check_upper(&self, upper: usize) -> Result<()> {
        if upper > self.slots.len() {
            return Err(self.unknown(upper - 1));
        }
        Ok(())
    }

    fn unknown(&self, slot: usize) -> String {
        format!("分享码包含未知的物品地址 {}:{slot}，请升级客户端", self.id)
    }
}

static CATALOG: LazyLock<Result<Catalog>> = LazyLock::new(|| {
    engine::call("shareCatalog", ()).map_err(|error| format!("无法读取分享码的物品目录：{error}"))
});

pub(super) fn catalog() -> Result<&'static Catalog> {
    CATALOG.as_ref().map_err(Clone::clone)
}

pub(super) fn write_list(
    out: &mut Vec<u8>,
    slots: Vec<Address>,
    prior: &mut HashMap<Vec<Address>, usize>,
    index: usize,
    catalog: &Catalog,
) -> Result<()> {
    if slots.is_empty() {
        put_uint(out, 0);
        return Ok(());
    }
    if let Some(&previous) = prior.get(&slots) {
        put_uint(out, (previous << 2) | LIST_REFERENCE);
        return Ok(());
    }
    let (mode, body) = encode_selection(&slots, catalog)?;
    put_uint(out, (body.len() << 2) | mode);
    out.extend(body);
    prior.insert(slots, index);
    Ok(())
}

struct GroupSelection<'a> {
    addresses: &'a [Address],
    bytes: Vec<u8>,
}

fn encode_selection(slots: &[Address], catalog: &Catalog) -> Result<(usize, Vec<u8>)> {
    let mut remaining = BTreeMap::new();
    let mut flat = Vec::new();
    for addresses in slots.chunk_by(|a, b| a.0 == b.0) {
        let group = catalog.group(addresses[0].0)?;
        let mut bytes = Vec::new();
        write_slot_block(&mut bytes, group.path.as_deref(), addresses);
        flat.extend_from_slice(&bytes);
        remaining.insert(group.id, GroupSelection { addresses, bytes });
    }
    let mut categories = Vec::new();
    collect_categories(
        &catalog.tree,
        catalog,
        &mut remaining,
        &mut Vec::new(),
        &mut categories,
    )?;
    if categories.is_empty() {
        return Ok((LIST_GROUPS, flat));
    }
    if remaining.is_empty() {
        return Ok((LIST_CATEGORIES, categories));
    }
    let mut mixed = Vec::new();
    put_uint(&mut mixed, categories.len());
    mixed.extend(categories);
    for group in remaining.into_values() {
        mixed.extend(group.bytes);
    }
    if mixed.len() < flat.len() {
        Ok((LIST_MIXED, mixed))
    } else {
        Ok((LIST_GROUPS, flat))
    }
}

fn write_slot_block(out: &mut Vec<u8>, path: Option<&[usize]>, addresses: &[Address]) {
    let positions = addresses.iter().map(|&(_, slot)| slot).collect::<Vec<_>>();
    let (mode, payload) = encode_group(&positions);
    write_path(out, path);
    put_uint(out, (payload.len() << 2) | mode);
    out.extend(payload);
}

fn whole_node_selected(
    node: &Node,
    catalog: &Catalog,
    selected: &BTreeMap<usize, GroupSelection<'_>>,
) -> Result<Option<bool>> {
    let mut has_items = false;
    if let Some(id) = node.group {
        let active = &catalog.group(id)?.active_slots;
        if !active.is_empty() {
            has_items = true;
            let whole = selected.get(&id).is_some_and(|selection| {
                selection
                    .addresses
                    .iter()
                    .map(|&(_, slot)| slot)
                    .eq(active.iter().copied())
            });
            if !whole {
                return Ok(Some(false));
            }
        }
    }
    for child in &node.children {
        match whole_node_selected(child, catalog, selected)? {
            Some(false) => return Ok(Some(false)),
            Some(true) => has_items = true,
            None => (),
        }
    }
    Ok(has_items.then_some(true))
}

fn collect_categories(
    node: &Node,
    catalog: &Catalog,
    remaining: &mut BTreeMap<usize, GroupSelection<'_>>,
    path: &mut Vec<usize>,
    out: &mut Vec<u8>,
) -> Result<()> {
    match whole_node_selected(node, catalog, remaining)? {
        Some(true) => {
            write_path(out, Some(path));
            remove_covered_groups(node, remaining);
        }
        Some(false) => {
            for (ordinal, child) in node.children.iter().enumerate() {
                path.push(ordinal);
                collect_categories(child, catalog, remaining, path, out)?;
                path.pop();
            }
        }
        None => (),
    }
    Ok(())
}

fn remove_covered_groups(node: &Node, remaining: &mut BTreeMap<usize, GroupSelection<'_>>) {
    if let Some(id) = node.group {
        remaining.remove(&id);
    }
    for child in &node.children {
        remove_covered_groups(child, remaining);
    }
}

fn write_path(out: &mut Vec<u8>, path: Option<&[usize]>) {
    let Some(path) = path else {
        out.push(PATH_HIDDEN);
        return;
    };
    if path.is_empty() {
        out.push(PATH_ROOT);
        return;
    }
    for (index, &ordinal) in path.iter().enumerate() {
        let more = if index + 1 < path.len() { PATH_MORE } else { 0 };
        let threshold = usize::from(PATH_WIDE);
        if ordinal < threshold {
            out.push(more | ordinal as u8);
        } else {
            out.push(more | PATH_WIDE);
            put_uint(out, ordinal - threshold);
        }
    }
}

fn encode_group(slots: &[usize]) -> (usize, Vec<u8>) {
    let upper = slots.last().unwrap() + 1;
    if upper == slots.len() {
        let mut all = Vec::new();
        put_uint(&mut all, upper);
        return (ALL, all);
    }
    let ranges = consecutive_ranges(slots);
    let mut range_bytes = Vec::new();
    put_uint(&mut range_bytes, ranges.len());
    let mut end = 0;
    for range in &ranges {
        put_uint(&mut range_bytes, range.start - end);
        put_uint(&mut range_bytes, range.len());
        end = range.end;
    }
    let mut sparse = Vec::new();
    write_slots(&mut sparse, slots.len(), slots.iter().copied());
    let (mode, bytes) = if sparse.len() < range_bytes.len() {
        (SPARSE, sparse)
    } else {
        (RANGES, range_bytes)
    };
    // A prefix ending at the highest selected slot has the fewest exceptions. Every inactive
    // slot before it must be skipped explicitly, even if it resolves to a current ID elsewhere.
    let missing = upper - slots.len();
    if missing < bytes.len() {
        let mut except = Vec::new();
        put_uint(&mut except, upper);
        let mut start = 0;
        let omitted = ranges.iter().flat_map(|range| {
            let gap = start..range.start;
            start = range.end;
            gap
        });
        write_slots(&mut except, missing, omitted);
        if except.len() <= bytes.len() {
            return (EXCEPT, except);
        }
    }
    (mode, bytes)
}

fn consecutive_ranges(slots: &[usize]) -> Vec<Range<usize>> {
    slots
        .chunk_by(|&a, &b| a + 1 == b)
        .map(|run| run[0]..run[run.len() - 1] + 1)
        .collect()
}

fn write_slots(out: &mut Vec<u8>, count: usize, slots: impl IntoIterator<Item = usize>) {
    put_uint(out, count);
    let mut next = 0;
    for slot in slots {
        put_uint(out, slot - next);
        next = slot + 1;
    }
}

pub(super) fn read_list<'a>(
    reader: &mut Reader<'_>,
    catalog: &'a Catalog,
    prior: &[Vec<&'a str>],
    cap: usize,
) -> Result<Vec<&'a str>> {
    let tag = reader.uint()?;
    let mode = tag & 3;
    let value = tag >> 2;
    if mode == LIST_REFERENCE {
        return prior
            .get(value)
            .filter(|items| items.len() <= cap)
            .cloned()
            .ok_or_else(invalid);
    }
    let mut list = Reader(reader.take(value)?);
    let mut ids = Vec::new();
    match mode {
        LIST_GROUPS => read_groups(&mut list, catalog, &mut ids, cap)?,
        LIST_CATEGORIES => read_categories(&mut list, catalog, &mut ids, cap)?,
        LIST_MIXED => {
            let mut categories = Reader(list.segment()?);
            read_categories(&mut categories, catalog, &mut ids, cap)?;
            read_groups(&mut list, catalog, &mut ids, cap)?;
        }
        _ => unreachable!("the low two bits select the list mode"),
    }
    // Historical addresses can resolve to the same item after a move. Keep set semantics.
    let mut seen = HashSet::new();
    ids.retain(|id| seen.insert(*id));
    Ok(ids)
}

enum Category<'a> {
    Visible(&'a Node),
    Hidden,
}

fn read_path<'a>(reader: &mut Reader<'_>, root: &'a Node) -> Result<Category<'a>> {
    let mut byte = reader.take(1)?[0];
    if byte == PATH_ROOT {
        return Ok(Category::Visible(root));
    }
    if byte == PATH_HIDDEN {
        return Ok(Category::Hidden);
    }
    let mut node = root;
    loop {
        let ordinal = match byte & 0x7f {
            PATH_ROOT => return Err(invalid()),
            PATH_WIDE => usize::from(PATH_WIDE)
                .checked_add(reader.uint()?)
                .ok_or_else(invalid)?,
            value => usize::from(value),
        };
        node = node
            .children
            .get(ordinal)
            .ok_or_else(|| format!("分享码包含未知的分类路径编号 {ordinal}，请升级客户端"))?;
        if byte & PATH_MORE == 0 {
            return Ok(Category::Visible(node));
        }
        byte = reader.take(1)?[0];
    }
}

fn read_categories<'a>(
    reader: &mut Reader<'_>,
    catalog: &'a Catalog,
    ids: &mut Vec<&'a str>,
    cap: usize,
) -> Result<()> {
    if reader.0.is_empty() {
        return Err(invalid());
    }
    while !reader.0.is_empty() {
        let Category::Visible(node) = read_path(reader, &catalog.tree)? else {
            return Err(invalid());
        };
        let before = ids.len();
        append_category(node, catalog, ids, cap)?;
        if ids.len() == before {
            return Err("分享码中的整选分类目前没有可用物品".into());
        }
    }
    Ok(())
}

fn append_category<'a>(
    node: &Node,
    catalog: &'a Catalog,
    ids: &mut Vec<&'a str>,
    cap: usize,
) -> Result<()> {
    if let Some(id) = node.group {
        let group = catalog.group(id)?;
        if group.active_slots.len() > cap - ids.len() {
            return Err(invalid());
        }
        for &slot in &group.active_slots {
            ids.push(group.id_at(slot)?);
        }
    }
    for child in &node.children {
        append_category(child, catalog, ids, cap)?;
    }
    Ok(())
}

fn read_groups<'a>(
    list: &mut Reader<'_>,
    catalog: &'a Catalog,
    ids: &mut Vec<&'a str>,
    cap: usize,
) -> Result<()> {
    let mut previous = None;
    while !list.0.is_empty() {
        if ids.len() == cap {
            return Err(invalid());
        }
        let group = match read_path(list, &catalog.tree)? {
            Category::Visible(node) => catalog.group(node.group.ok_or_else(invalid)?)?,
            Category::Hidden => catalog.hidden_group()?,
        };
        if previous.is_some_and(|previous| group.id <= previous) {
            return Err(invalid());
        }
        previous = Some(group.id);
        let tag = list.uint()?;
        let mut block = Reader(list.take(tag >> 2)?);
        let remaining = cap - ids.len();
        read_group(&mut block, tag & 3, group, ids, remaining)?;
        block.finish()?;
    }
    Ok(())
}

fn read_group<'a>(
    reader: &mut Reader<'_>,
    mode: usize,
    group: &'a Group,
    ids: &mut Vec<&'a str>,
    mut remaining: usize,
) -> Result<()> {
    match mode {
        ALL | EXCEPT => {
            let upper = reader.uint()?;
            group.check_upper(upper)?;
            let mut start = 0;
            let removed = if mode == EXCEPT { reader.uint()? } else { 0 };
            let count = upper.checked_sub(removed).ok_or_else(invalid)?;
            check_count(count, remaining)?;
            for _ in 0..removed {
                let slot = reader.offset(start)?;
                if slot >= upper {
                    return Err(invalid());
                }
                append_ids(group, ids, start..slot)?;
                start = slot + 1;
            }
            append_ids(group, ids, start..upper)?;
        }
        RANGES => {
            let ranges = reader.uint()?;
            check_count(ranges, remaining)?;
            let mut end = 0;
            for _ in 0..ranges {
                let start = reader.offset(end)?;
                let count = reader.uint()?;
                check_count(count, remaining)?;
                remaining -= count;
                end = start.checked_add(count).ok_or_else(invalid)?;
                append_ids(group, ids, start..end)?;
            }
        }
        SPARSE => {
            let count = reader.uint()?;
            check_count(count, remaining)?;
            let mut start = 0;
            for _ in 0..count {
                let slot = reader.offset(start)?;
                ids.push(group.id_at(slot)?);
                start = slot + 1;
            }
        }
        _ => unreachable!("the low two bits select the group mode"),
    }
    Ok(())
}

fn append_ids<'a>(group: &'a Group, ids: &mut Vec<&'a str>, range: Range<usize>) -> Result<()> {
    group.check_upper(range.end)?;
    for slot in range {
        ids.push(group.id_at(slot)?);
    }
    Ok(())
}

fn check_count(count: usize, cap: usize) -> Result<()> {
    if count == 0 || count > cap {
        return Err(invalid());
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::super::{pack_with, unpack_with};
    use super::*;
    use crate::share_code::Share;
    use serde_json::{json, Value};

    fn groups(slots: &[Vec<Option<String>>]) -> Catalog {
        let mut groups = slots
            .iter()
            .cloned()
            .enumerate()
            .map(|(id, slots)| Group {
                id,
                slots,
                path: Some(vec![id]),
                active_slots: Vec::new(),
            })
            .collect::<Vec<_>>();
        let mut current = HashMap::new();
        for group in &groups {
            for (slot, id) in group.slots.iter().enumerate() {
                if let Some(id) = id {
                    current.insert(id.clone(), (group.id, slot));
                }
            }
        }
        for &(group, slot) in current.values() {
            groups[group].active_slots.push(slot);
        }
        for group in &mut groups {
            group.active_slots.sort_unstable();
        }
        let children = groups
            .iter()
            .map(|group| Node {
                group: Some(group.id),
                children: vec![],
            })
            .collect();
        Catalog {
            groups,
            current,
            tree: Node {
                group: None,
                children,
            },
        }
    }

    fn nest_under_first(catalog: &mut Catalog) {
        let children = std::mem::take(&mut catalog.tree.children);
        catalog.tree.children.push(Node {
            group: None,
            children,
        });
        for group in &mut catalog.groups {
            group.path = Some(vec![0, group.id]);
        }
    }

    fn items(start: usize, end: usize) -> Vec<Option<String>> {
        (start..end)
            .map(|slot| Some(format!("test-{slot}")))
            .collect()
    }

    fn encode_catalog_list(slots: Vec<Address>, catalog: &Catalog) -> Vec<u8> {
        let mut out = Vec::new();
        write_list(&mut out, slots, &mut HashMap::new(), 0, catalog).unwrap();
        out
    }

    fn encode_list(slots: Vec<Address>) -> Vec<u8> {
        // Build an explicit slot list for the address stability tests.
        let mut payload = Vec::new();
        for group in slots.chunk_by(|a, b| a.0 == b.0) {
            write_slot_block(&mut payload, Some(&[group[0].0]), group);
        }
        let mut out = Vec::new();
        put_uint(&mut out, (payload.len() << 2) | LIST_GROUPS);
        out.extend(payload);
        out
    }

    #[test]
    fn body_wire_vector() {
        const BYTES: &[u8] = &[4, 1, b'N', 0, 0, 6, 0x7f];
        let catalog = groups(&[items(0, 3)]);
        let share = Share {
            name: "N".into(),
            profile: json!({"rules":[],"skippedItemIds":["test-0","test-1","test-2"]}),
        };
        assert_eq!(pack_with(&share, &catalog).unwrap(), BYTES);
        assert_eq!(unpack_with(BYTES, &catalog).unwrap(), share);
    }

    #[test]
    fn group_modes_choose_the_shortest_and_round_trip() {
        let catalog = groups(&[items(0, 512)]);
        for (mode, slots) in [
            (ALL, (0..128).collect::<Vec<_>>()),
            (EXCEPT, (0..128).filter(|&slot| slot != 49).collect()),
            (RANGES, (126..160).chain(300..360).collect()),
            (SPARSE, vec![2, 17, 44, 255, 511]),
        ] {
            assert_eq!(encode_group(&slots).0, mode);
            let bytes = encode_list(slots.iter().map(|&slot| (0, slot)).collect());
            let mut reader = Reader(&bytes);
            let ids = read_list(&mut reader, &catalog, &[], 512).unwrap();
            reader.finish().unwrap();
            assert_eq!(
                ids,
                slots
                    .iter()
                    .map(|i| format!("test-{i}"))
                    .collect::<Vec<_>>()
            );
        }
    }

    #[test]
    fn adding_a_slot_or_group_never_changes_an_old_selection() {
        for original_count in [127, 128, 255, 4096] {
            let before = groups(&[items(0, original_count)]);
            let after = groups(&[items(0, original_count + 1), items(6000, 6001)]);
            let selection = encode_list((0..original_count).map(|slot| (0, slot)).collect());
            let old = read_list(&mut Reader(&selection), &before, &[], 5000).unwrap();
            let new = read_list(&mut Reader(&selection), &after, &[], 5000).unwrap();
            assert_eq!(new, old);
            let expanded = encode_list((0..=original_count).map(|slot| (0, slot)).collect());
            assert_eq!(
                encode_group(&(0..=original_count).collect::<Vec<_>>()).0,
                ALL
            );
            assert_eq!(
                read_list(&mut Reader(&expanded), &after, &[], 5000)
                    .unwrap()
                    .len(),
                original_count + 1
            );
        }
        let before = groups(&vec![vec![]; 128]);
        let mut enlarged = before
            .groups
            .iter()
            .map(|group| group.slots.clone())
            .collect::<Vec<_>>();
        enlarged[127] = items(0, 1);
        let before = groups(&enlarged);
        enlarged.push(items(1, 2));
        let after = groups(&enlarged);
        let selection = encode_list(vec![(127, 0)]);
        assert_eq!(
            read_list(&mut Reader(&selection), &before, &[], 1).unwrap(),
            ["test-0"]
        );
        assert_eq!(
            read_list(&mut Reader(&selection), &after, &[], 1).unwrap(),
            ["test-0"]
        );
    }

    #[test]
    fn moves_keep_old_addresses_and_retired_items_fail_if_selected() {
        let full = encode_list(vec![(0, 0), (0, 1), (0, 2)]);
        let omitted = encode_list(vec![(0, 0), (0, 2)]);
        let moved = groups(&[items(0, 3), items(1, 2)]);
        assert_eq!(moved.current["test-1"], (1, 0));
        assert_eq!(
            read_list(&mut Reader(&full), &moved, &[], 3).unwrap(),
            ["test-0", "test-1", "test-2"]
        );
        let retired = groups(&[vec![Some("test-0".into()), None, Some("test-2".into())]]);
        let error = read_list(&mut Reader(&full), &retired, &[], 3).unwrap_err();
        assert!(error.contains("0:1") && error.contains("已退役"), "{error}");
        assert_eq!(
            read_list(&mut Reader(&omitted), &retired, &[], 3).unwrap(),
            ["test-0", "test-2"]
        );
    }

    #[test]
    fn share_metadata_and_repeated_lists_round_trip() {
        let catalog = groups(&[items(0, 3), items(3, 4)]);
        let make_rule = |id: &str, items: Value| {
            json!({
                "id": id, "name": "测试", "enabled": true, "hidden": false, "effectPresetId": "base-13",
                "target": {"itemIds":items,"range":{"min":{"amount":12.5,"currency":"chaos"}}},
                "effects": {"beam":"Blue Temp", "icon":"0 Red Star", "font":{"textColor":"255 2 3 0","fontSize":41},
                            "sound":{"type":"custom","fileName":"test.ogg"}}
            })
        };
        let mut share = Share {
            name: "自定义方案".into(),
            profile: json!({"schemaVersion":3,"baseFilterHint":"custom.filter",
                "rules":[make_rule("stack-id", json!(["test-3","test-0","test-0"])),
                         make_rule("rule-0f3a1c2d-3e4f-4a5b-8c6d-0e1f2a3b4c5d", json!(["test-0","test-3"]))],
                "skippedItemIds":[]}),
        };
        share.profile["rules"][0]["baselineEffectItemId"] = json!("test-0");
        let data = pack_with(&share, &catalog).unwrap();
        let mut lists = Reader(&data);
        lists.segment().unwrap();
        assert_eq!(lists.uint().unwrap(), 0);
        let tag = lists.uint().unwrap();
        assert_eq!(tag & 3, LIST_MIXED);
        lists.take(tag >> 2).unwrap();
        assert_eq!(lists.uint().unwrap(), (1 << 2) | LIST_REFERENCE);
        lists.finish().unwrap();
        for rule in share.profile["rules"].as_array_mut().unwrap() {
            rule["target"]["itemIds"] = json!(["test-3", "test-0"]);
            rule.as_object_mut().unwrap().remove("id");
        }
        let bound = share.profile["rules"][0].as_object_mut().unwrap();
        bound.remove("effects");
        bound.remove("effectPresetId");
        assert_eq!(unpack_with(&data, &catalog).unwrap(), share);
    }

    #[test]
    fn thirteen_two_level_categories_take_twenty_six_payload_bytes() {
        let mut catalog = groups(&(0..14).map(|i| items(i, i + 1)).collect::<Vec<_>>());
        nest_under_first(&mut catalog);
        let bytes = encode_catalog_list((0..13).map(|id| (id, 0)).collect(), &catalog);
        assert_eq!(usize::from(bytes[0]), (26 << 2) | LIST_CATEGORIES);
        assert_eq!(
            &bytes[1..],
            (0..13).flat_map(|id| [0x80, id]).collect::<Vec<_>>()
        );
        assert_eq!(
            read_list(&mut Reader(&bytes), &catalog, &[], 13)
                .unwrap()
                .len(),
            13
        );
    }

    #[test]
    fn whole_category_grows_and_explicit_slots_stay_fixed() {
        let before = groups(&[items(0, 2), items(3, 4)]);
        let after = groups(&[items(0, 3), items(3, 4), items(4, 5)]);
        let whole = encode_catalog_list(vec![(0, 0), (0, 1)], &before);
        assert_eq!(whole, [6, 0]);
        assert_eq!(
            read_list(&mut Reader(&whole), &before, &[], 3).unwrap(),
            ["test-0", "test-1"]
        );
        assert_eq!(
            read_list(&mut Reader(&whole), &after, &[], 3).unwrap(),
            ["test-0", "test-1", "test-2"]
        );
        let slots = encode_list(vec![(0, 0), (0, 1)]);
        assert_eq!(
            read_list(&mut Reader(&slots), &after, &[], 3).unwrap(),
            ["test-0", "test-1"]
        );
        assert!(read_list(&mut Reader(&whole), &after, &[], 2).is_err());
        let retired = groups(&[vec![None, None], items(3, 4)]);
        assert!(read_list(&mut Reader(&whole), &retired, &[], 3)
            .unwrap_err()
            .contains("没有可用物品"));
    }

    #[test]
    fn category_list_can_mix_whole_paths_sparse_slots_and_hidden_ids() {
        let mut catalog = groups(&[items(0, 2), items(2, 5), items(5, 6)]);
        catalog.tree.children.pop();
        catalog.groups[2].path = None;
        let bytes = encode_catalog_list(vec![(0, 0), (0, 1), (1, 2), (2, 0)], &catalog);
        assert_eq!(usize::from(bytes[0]) & 3, LIST_MIXED);
        assert_eq!(&bytes[1..3], &[1, 0]);
        let picked = read_list(&mut Reader(&bytes), &catalog, &[], 4).unwrap();
        assert_eq!(picked, ["test-0", "test-1", "test-4", "test-5"]);
    }

    #[test]
    fn rejects_unknown_addresses_bad_lengths_references_and_expansion() {
        let catalog = groups(&[items(0, 12)]);
        let full = encode_list((0..12).map(|slot| (0, slot)).collect());
        assert!(read_list(&mut Reader(&full), &catalog, &[], 11).is_err());
        assert!(read_list(&mut Reader(&[1]), &catalog, &[vec!["id"; 12]], 11).is_err());
        assert!(read_list(&mut Reader(&[5]), &catalog, &[vec![]], 12).is_err());
        for end in 0..full.len() {
            assert!(read_list(&mut Reader(&full[..end]), &catalog, &[], 12).is_err());
        }
        for malformed in [
            &[0x80, 0][..],
            &[0xff, 0xff, 0xff, 0xff, 0x10],
            &[16, 0, 8, 1, 0],
            &[12, 0, 4, 0],
            &[3],
        ] {
            assert!(read_list(&mut Reader(malformed), &catalog, &[], 12).is_err());
        }
        let unknown_slot = encode_list(vec![(0, 12)]);
        assert!(read_list(&mut Reader(&unknown_slot), &catalog, &[], 12)
            .unwrap_err()
            .contains("0:12"));
        let unknown_group = encode_list(vec![(1, 0)]);
        assert!(read_list(&mut Reader(&unknown_group), &catalog, &[], 12)
            .unwrap_err()
            .contains("分类路径编号 1"));
        let mut share = Share {
            name: "test".into(),
            profile: json!({"rules":[],"skippedItemIds":[]}),
        };
        let mut body = pack_with(&share, &catalog).unwrap();
        body.push(0);
        assert!(unpack_with(&body, &catalog).is_err());
        share.profile["skippedItemIds"] = json!(["test-99"]);
        assert!(pack_with(&share, &catalog).unwrap_err().contains("test-99"));
    }
}
