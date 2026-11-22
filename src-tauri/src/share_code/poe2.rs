//! Wire layout for `{"alg":"poe2","p":1}`.
//! A little-endian u32 metadata length, JSON [name, packed profile], then list data
//! in rule order followed by skipped items. Packed objects start with a presence
//! mask followed by values in field order. Lists use [mode, count, reference, size].

use super::{Share, MAX_JSON};
use serde_json::{json, Map, Value};
use std::{collections::HashMap, sync::LazyLock};

// Index is the wire ID. Keep this snapshot independent of the live item catalog.
const ITEMS: &str = include_str!("poe2-p1-items.txt");
static ITEM_IDS: LazyLock<Vec<&'static str>> = LazyLock::new(|| ITEMS.lines().collect());
static ITEM_INDEX: LazyLock<HashMap<&'static str, usize>> = LazyLock::new(|| {
    ITEM_IDS
        .iter()
        .enumerate()
        .map(|(index, id)| (*id, index))
        .collect()
});

const MAX_RULES: usize = 100;
const MAX_SELECTED: usize = 2000;
const MAX_SKIPPED: usize = 5000;

#[derive(Clone, Copy)]
enum Layout {
    Profile,
    Rule,
    Target,
    Range,
    Price,
    Effects,
    Font,
    Sound,
}

impl Layout {
    // Field order and mask bits are part of the wire format.
    fn fields(self) -> &'static [&'static str] {
        match self {
            Self::Profile => &[
                "schemaVersion",
                "league",
                "originalLeague",
                "strictness",
                "style",
                "locale",
                "baseFilterHint",
                "rules",
                "skippedItemIds",
            ],
            Self::Rule => &[
                "id",
                "name",
                "enabled",
                "hidden",
                "autoRange",
                "followBaseline",
                "effectPresetId",
                "target",
                "effects",
            ],
            Self::Target => &["itemIds", "itemEnabled", "priceEnabled", "range"],
            Self::Range => &["min", "max"],
            Self::Price => &["amount", "currency", "referenceItemId"],
            Self::Effects => &["beam", "icon", "font", "sound"],
            Self::Font => &["fontSize", "textColor", "borderColor", "backgroundColor"],
            Self::Sound => &["type", "fileName", "id", "volume"],
        }
    }

    fn child(self, field: &str) -> Option<Self> {
        match (self, field) {
            (Self::Rule, "target") => Some(Self::Target),
            (Self::Rule, "effects") => Some(Self::Effects),
            (Self::Target, "range") => Some(Self::Range),
            (Self::Range, "min" | "max") => Some(Self::Price),
            (Self::Effects, "font") => Some(Self::Font),
            (Self::Effects, "sound") => Some(Self::Sound),
            _ => None,
        }
    }
}

fn transform_field(layout: Layout, field: &str, value: Value, pack: bool) -> Option<Value> {
    if matches!(layout, Layout::Profile) && field == "rules" {
        let Value::Array(rules) = value else {
            return None;
        };
        if rules.len() > MAX_RULES {
            return None;
        }
        return Some(Value::Array(
            rules
                .into_iter()
                .map(|rule| transform_object(Layout::Rule, rule, pack))
                .collect::<Option<_>>()?,
        ));
    }
    match layout.child(field) {
        Some(child) => transform_object(child, value, pack),
        None => Some(value),
    }
}

fn transform_object(layout: Layout, value: Value, pack: bool) -> Option<Value> {
    let fields = layout.fields();
    if pack {
        let Value::Object(mut object) = value else {
            return None;
        };
        let mut mask = 0u32;
        let mut values = vec![Value::Null];
        for (index, field) in fields.iter().enumerate() {
            if let Some(value) = object.remove(*field) {
                mask |= 1 << index;
                values.push(transform_field(layout, field, value, pack)?);
            }
        }
        // A newer field must survive sharing, so the caller falls back to JSON.
        if !object.is_empty() {
            return None;
        }
        values[0] = json!(mask);
        Some(Value::Array(values))
    } else {
        let Value::Array(values) = value else {
            return None;
        };
        let mut values = values.into_iter();
        let mask = values.next()?.as_u64()?;
        if mask >> fields.len() != 0 || mask.count_ones() as usize != values.len() {
            return None;
        }
        let mut object = Map::new();
        for (index, field) in fields.iter().enumerate() {
            if mask & (1 << index) != 0 {
                object.insert(
                    (*field).into(),
                    transform_field(layout, field, values.next()?, pack)?,
                );
            }
        }
        Some(Value::Object(object))
    }
}

fn list_slots(profile: &mut Value) -> Option<Vec<(&mut Value, usize)>> {
    let object = profile.as_object_mut()?;
    let mut slots = Vec::new();
    // Iterate the map to borrow both fields together. Put skipped items last on the wire.
    let mut skipped = None;
    let mut found_rules = false;
    for (key, value) in object {
        match key.as_str() {
            "rules" => {
                let rules = value.as_array_mut()?;
                if rules.len() > MAX_RULES {
                    return None;
                }
                found_rules = true;
                for rule in rules {
                    slots.push((rule.get_mut("target")?.get_mut("itemIds")?, MAX_SELECTED));
                }
            }
            "skippedItemIds" => skipped = Some(value),
            _ => {}
        }
    }
    if !found_rules {
        return None;
    }
    slots.push((skipped?, MAX_SKIPPED));
    Some(slots)
}

const DELTA: usize = 0;
const BITMAP: usize = 1;
const COPY: usize = 2;
const KEEP: usize = 3;
const DROP: usize = 4;
const SUBSET_BITMAP: usize = 5;

type Descriptor = [usize; 4];

pub(super) fn pack(share: &Share) -> Option<Vec<u8>> {
    let mut profile = share.profile.clone();
    let mut history = Vec::new();
    let mut data = Vec::new();
    for (slot, limit) in list_slots(&mut profile)? {
        let list = slot.as_array()?;
        if list.len() > limit {
            return None;
        }
        let list: Vec<usize> = list
            .iter()
            .map(|id| ITEM_INDEX.get(id.as_str()?).copied())
            .collect::<Option<_>>()?;
        let (mode, reference, bytes) = encode_list(&list, &history);
        *slot = json!([mode, list.len(), reference, bytes.len()]);
        history.push(list);
        data.extend(bytes);
    }
    let metadata = serde_json::to_vec(&(
        &share.name,
        transform_object(Layout::Profile, profile, true)?,
    ))
    .ok()?;
    let mut output = u32::try_from(metadata.len()).ok()?.to_le_bytes().to_vec();
    output.extend(metadata);
    output.extend(data);
    Some(output)
}

pub(super) fn unpack(bytes: &[u8]) -> Option<Share> {
    let (length, body) = bytes.split_first_chunk::<4>()?;
    let (metadata, mut data) = body.split_at_checked(u32::from_le_bytes(*length) as usize)?;
    let (name, profile): (String, Value) = serde_json::from_slice(metadata).ok()?;
    let mut share = Share {
        name,
        profile: transform_object(Layout::Profile, profile, false)?,
    };
    let mut descriptors = Vec::new();
    for (slot, limit) in list_slots(&mut share.profile)? {
        let descriptor: Descriptor =
            serde_json::from_value(std::mem::replace(slot, json!([]))).ok()?;
        if descriptor[1] > limit {
            return None;
        }
        descriptors.push(descriptor);
    }
    // Account for empty arrays and all other metadata before expanding the list references.
    let mut budget = MAX_JSON.checked_sub(serde_json::to_vec(&share).ok()?.len())?;
    let mut history = Vec::with_capacity(descriptors.len());
    for (descriptor, (slot, _)) in descriptors.into_iter().zip(list_slots(&mut share.profile)?) {
        let (list_bytes, rest) = data.split_at_checked(descriptor[3])?;
        data = rest;
        let list = decode_list(descriptor, list_bytes, &history)?;
        for (position, &index) in list.iter().enumerate() {
            // IDs consist only of lowercase ASCII letters, digits and hyphens.
            budget =
                budget.checked_sub(ITEM_IDS.get(index)?.len() + 2 + usize::from(position > 0))?;
        }
        *slot = Value::Array(
            list.iter()
                .map(|&index| Value::String(ITEM_IDS[index].into()))
                .collect(),
        );
        history.push(list);
    }
    data.is_empty().then_some(share)
}

fn encode_list(list: &[usize], history: &[Vec<usize>]) -> (usize, usize, Vec<u8>) {
    let mut best = (DELTA, 0, encode_deltas(list.iter().copied(), true));
    let mut consider = |mode, reference, bytes: Vec<u8>| {
        // Reference is a single JSON digit in the common case. Charge for longer ones.
        if bytes.len() + usize::from(reference >= 10) < best.2.len() + usize::from(best.1 >= 10) {
            best = (mode, reference, bytes);
        }
    };
    if list.windows(2).all(|pair| pair[0] < pair[1]) {
        consider(BITMAP, 0, bitmap(list, ITEM_IDS.len()));
    }
    if !list.is_empty() {
        for (reference, previous) in history.iter().enumerate() {
            if previous == list {
                consider(COPY, reference, Vec::new());
                break;
            }
            if let Some(positions) = subsequence_positions(list, previous) {
                let excluded =
                    (0..previous.len()).filter(|index| positions.binary_search(index).is_err());
                consider(
                    KEEP,
                    reference,
                    encode_deltas(positions.iter().copied(), false),
                );
                consider(DROP, reference, encode_deltas(excluded, false));
                consider(SUBSET_BITMAP, reference, bitmap(&positions, previous.len()));
            }
        }
    }
    best
}

fn subsequence_positions(list: &[usize], previous: &[usize]) -> Option<Vec<usize>> {
    if list.len() >= previous.len() {
        return None;
    }
    let mut previous = previous.iter().enumerate();
    list.iter()
        .map(|id| {
            previous
                .find(|(_, other)| *other == id)
                .map(|(index, _)| index)
        })
        .collect()
}

fn decode_list(descriptor: Descriptor, bytes: &[u8], history: &[Vec<usize>]) -> Option<Vec<usize>> {
    let [mode, count, reference, _] = descriptor;
    let list = match mode {
        DELTA if reference == 0 => decode_deltas(bytes, count, ITEM_IDS.len(), true)?,
        BITMAP if reference == 0 => bitmap_positions(bytes, ITEM_IDS.len())?,
        COPY if bytes.is_empty() => history.get(reference)?.clone(),
        KEEP | DROP | SUBSET_BITMAP => {
            let previous = history.get(reference)?;
            if count > previous.len() {
                return None;
            }
            match mode {
                KEEP => decode_deltas(bytes, count, previous.len(), false)?
                    .into_iter()
                    .map(|index| previous[index])
                    .collect(),
                SUBSET_BITMAP => bitmap_positions(bytes, previous.len())?
                    .into_iter()
                    .map(|index| previous[index])
                    .collect(),
                _ => {
                    let excluded =
                        decode_deltas(bytes, previous.len() - count, previous.len(), false)?;
                    previous
                        .iter()
                        .enumerate()
                        .filter_map(|(index, &id)| {
                            excluded.binary_search(&index).is_err().then_some(id)
                        })
                        .collect()
                }
            }
        }
        _ => return None,
    };
    (list.len() == count).then_some(list)
}

fn encode_deltas(values: impl Iterator<Item = usize>, signed: bool) -> Vec<u8> {
    let mut previous = 0;
    let mut bytes = Vec::new();
    for value in values {
        let delta = value as i32 - previous;
        previous = value as i32;
        let mut number = if signed {
            ((delta << 1) ^ (delta >> 31)) as u32
        } else {
            delta as u32
        };
        while number >= 128 {
            bytes.push((number as u8 & 127) | 128);
            number >>= 7;
        }
        bytes.push(number as u8);
    }
    bytes
}

fn read_varint(bytes: &mut &[u8]) -> Option<u32> {
    let mut value = 0;
    // Maximum delta is bounded by the p1 catalog and per-list item limits.
    for shift in [0, 7, 14] {
        let (&byte, rest) = bytes.split_first()?;
        *bytes = rest;
        value |= u32::from(byte & 127) << shift;
        if byte < 128 {
            return (shift == 0 || byte != 0).then_some(value);
        }
    }
    None
}

fn decode_deltas(mut bytes: &[u8], count: usize, limit: usize, signed: bool) -> Option<Vec<usize>> {
    let mut result = Vec::with_capacity(count);
    let mut previous = 0i32;
    for index in 0..count {
        let number = read_varint(&mut bytes)? as i32;
        let delta = if signed {
            (number >> 1) ^ -(number & 1)
        } else {
            number
        };
        let value = previous.checked_add(delta)?;
        if value < 0 || value as usize >= limit || (!signed && index > 0 && value <= previous) {
            return None;
        }
        result.push(value as usize);
        previous = value;
    }
    bytes.is_empty().then_some(result)
}

fn bitmap(indices: &[usize], count: usize) -> Vec<u8> {
    let mut bitmap = vec![0; count.div_ceil(8)];
    for &index in indices {
        bitmap[index / 8] |= 1 << (index % 8);
    }
    bitmap
}

fn bitmap_positions(bytes: &[u8], count: usize) -> Option<Vec<usize>> {
    if bytes.len() != count.div_ceil(8) {
        return None;
    }
    let remainder = count % 8;
    if remainder != 0 && bytes.last()? >> remainder != 0 {
        return None;
    }
    Some(
        (0..count)
            .filter(|index| bytes[index / 8] & (1 << (index % 8)) != 0)
            .collect(),
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use sha2::{Digest, Sha256};

    #[test]
    fn item_indices_are_frozen() {
        assert_eq!(ITEM_IDS.len(), 1417);
        assert_eq!(ITEM_IDS.len(), ITEM_INDEX.len());
        assert!(ITEM_IDS.iter().all(|id| !id.is_empty()
            && id
                .bytes()
                .all(|ch| { ch.is_ascii_lowercase() || ch.is_ascii_digit() || ch == b'-' })));
        assert_eq!(
            format!("{:x}", Sha256::digest(ITEM_IDS.join("\n"))),
            "cb80472911155e585246edd3fa73f0049a5f81589b7ce7b23544790469c82bbf"
        );
    }

    #[test]
    fn encodes_all_selection_modes_and_keeps_order_and_duplicates() {
        let dense = (0..1000).collect::<Vec<_>>();
        let alternating = dense.iter().step_by(2).copied().collect::<Vec<_>>();
        for (list, history, expected_mode) in [
            (vec![2, 0, 2, 1], vec![], DELTA),
            (dense.clone(), vec![], BITMAP),
            (vec![2, 0, 2, 1], vec![vec![2, 0, 2, 1]], COPY),
            (vec![900, 901], vec![(900..932).collect()], KEEP),
            (dense[1..].to_vec(), vec![dense.clone()], DROP),
            (alternating, vec![dense.clone()], SUBSET_BITMAP),
        ] {
            let (mode, reference, bytes) = encode_list(&list, &history);
            assert_eq!(mode, expected_mode);
            assert_eq!(
                decode_list([mode, list.len(), reference, bytes.len()], &bytes, &history).unwrap(),
                list
            );
        }
    }

    #[test]
    fn preserves_metadata_and_uses_shorter_codes_on_repeated_lists() {
        let selected = ITEM_IDS[0..525].iter().rev().copied().collect::<Vec<_>>();
        let mut rules = Vec::new();
        for i in 0..6 {
            rules.push(json!({
                "id": format!("rule-{i}"), "name": "崇高石", "enabled": true, "hidden": false,
                "autoRange": false, "followBaseline": false, "effectPresetId": "preset-a",
                "target": {"itemIds": selected, "itemEnabled": false, "priceEnabled": false,
                    "range": {"min": {"amount": 0.25, "currency": "exalted", "referenceItemId": "exalted-orb"}}},
                "effects": {"beam": "Red Temp", "icon": "1 Red Circle",
                    "font": {"fontSize": 31, "textColor": "15 23 42"},
                    "sound": {"type": "custom", "fileName": "custom.mp3"}}
            }));
        }
        let share = Share {
            name: "我的过滤器".into(),
            profile: json!({
                "schemaVersion": 2, "league": "Standard", "locale": "cn", "baseFilterHint": "基础.filter",
                "rules": rules, "skippedItemIds": ["exalted-orb", "albino-rhoa-feather", "exalted-orb"]
            }),
        };
        let packed = pack(&share).unwrap();
        assert_eq!(unpack(&packed).unwrap(), share);
        let specialized = super::super::encode(&share).unwrap();
        let json = serde_json::to_vec(&share).unwrap();
        let generic = super::super::encode_payload(super::super::Codec::BrotliJson, &json).unwrap();
        assert!(specialized.len() < generic.len() / 2);
        assert_eq!(super::super::decode(&specialized).unwrap(), share);
    }

    #[test]
    fn rejects_bad_references_and_trailing_bytes() {
        let history = vec![vec![1, 2, 3]];
        assert!(decode_list([COPY, 3, 1, 0], &[], &history).is_none());
        assert!(decode_list([KEEP, 1, 0, 1], &[3], &history).is_none());
        assert!(decode_list([DROP, 1, 0, 2], &[0, 0], &history).is_none());
        assert!(decode_list([SUBSET_BITMAP, 1, 0, 1], &[0b1000], &history).is_none());
        assert!(decode_list([DELTA, 1, 0, 2], &[0, 0], &history).is_none());
        assert!(decode_list([DELTA, 1, 0, 1], &[1], &history).is_none());
        assert!(decode_list([DELTA, 1, 0, 2], &[0x80, 0], &history).is_none());
        assert!(decode_list([DELTA, 1, 0, 3], &[0xff, 0xff, 0x7f], &history).is_none());
        let share = Share {
            name: "Test".into(),
            profile: json!({"rules":[],"skippedItemIds":[]}),
        };
        let mut packed = pack(&share).unwrap();
        packed.push(0);
        assert!(unpack(&packed).is_none());
    }

    #[test]
    fn bounds_expansion_even_for_a_small_reference_chain() {
        let id = ITEM_IDS.iter().max_by_key(|id| id.len()).unwrap();
        let selected = vec![*id; MAX_SELECTED];
        let mut share = Share {
            name: "Test".into(),
            profile: json!({"rules": [],"skippedItemIds":[]}),
        };
        let selected = json!({"target":{"itemIds": selected}});
        share.profile["rules"] = Value::Array(vec![selected; MAX_RULES]);
        assert!(serde_json::to_vec(&share).unwrap().len() > MAX_JSON);
        let packed = pack(&share).unwrap();
        assert!(packed.len() < MAX_JSON / 8);
        assert!(unpack(&packed).is_none());
    }
}
