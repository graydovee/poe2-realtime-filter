//! Format 2, revisions 1 and 2. A length-prefixed metadata record, then the skip list and one
//! item list per rule. Revision 2 writes the scheme description after the name. Keep these
//! layouts readable when later versions are added.

mod items;
mod metadata;
mod wire;

use super::{BodyCodec, BodyVersion};
use crate::{
    engine::Result,
    share_code::{Share, MAX_JSON},
};
use items::{catalog, read_list, write_list, Catalog};
use serde_json::{Map, Value};
use std::collections::HashMap;
use wire::{invalid, put_uint, Reader};

/// Version of the item catalog that share codes are written against.
pub(super) fn catalog_version() -> Result<u32> {
    Ok(catalog()?.version)
}

/// Rejects a code that was written against another item catalog.
pub(super) fn check_catalog_version(written: Option<u32>) -> Result<()> {
    catalog()?.check_version(written)
}

pub(super) const CODEC: BodyCodec = BodyCodec {
    version: BodyVersion {
        format: 2,
        revision: 1,
    },
    pack,
    unpack,
};
pub(super) const DESCRIBED_CODEC: BodyCodec = BodyCodec {
    version: BodyVersion {
        format: 2,
        revision: 2,
    },
    pack: pack_described,
    unpack: unpack_described,
};
const MAX_RULES: usize = 100;
const MAX_SELECTED: usize = 2000;
const MAX_SKIPPED: usize = 5000;

fn pack(share: &Share) -> Result<Vec<u8>> {
    pack_with(share, catalog()?, false)
}

fn unpack(bytes: &[u8]) -> Result<Share> {
    unpack_with(bytes, catalog()?, false)
}

fn pack_described(share: &Share) -> Result<Vec<u8>> {
    pack_with(share, catalog()?, true)
}

fn unpack_described(bytes: &[u8]) -> Result<Share> {
    unpack_with(bytes, catalog()?, true)
}

fn pack_with(share: &Share, catalog: &Catalog, described: bool) -> Result<Vec<u8>> {
    let mut metadata = share.clone();
    for rule in rules_mut(&mut metadata.profile)? {
        let fields = rule.as_object_mut().ok_or_else(invalid)?;
        fields.remove("id");
        fields.remove("followBaseline");
        if fields.contains_key("baselineEffectItemId") {
            fields.remove("effects");
            fields.remove("effectPresetId");
        } else if let Some(effects) = fields.get_mut("effects").and_then(Value::as_object_mut) {
            // A stored profile can carry null for empty font and sound settings.
            for key in ["font", "sound"] {
                if effects.get(key).is_some_and(Value::is_null) {
                    effects.remove(key);
                }
            }
        }
    }
    let mut lists = Vec::new();
    let mut prior = HashMap::new();
    visit_lists(&mut metadata.profile, |object, key, cap, index| {
        let items = object.remove(key).ok_or_else(invalid)?;
        let items = items
            .as_array()
            .filter(|items| items.len() <= cap)
            .ok_or_else(invalid)?;
        let mut slots = Vec::with_capacity(items.len());
        for item in items {
            let id = item.as_str().ok_or_else(invalid)?;
            slots.push(catalog.address(id)?);
        }
        slots.sort_unstable();
        slots.dedup();
        write_list(&mut lists, slots, &mut prior, index, catalog)?;
        Ok(())
    })?;
    let metadata = metadata::pack(metadata, MAX_RULES, described)?;
    if metadata.len() + lists.len() > MAX_JSON {
        return Err(invalid());
    }
    let mut out = Vec::new();
    put_uint(&mut out, metadata.len());
    out.extend(metadata);
    out.extend(lists);
    if out.len() > MAX_JSON {
        return Err(invalid());
    }
    Ok(out)
}

fn unpack_with(bytes: &[u8], catalog: &Catalog, described: bool) -> Result<Share> {
    if bytes.len() > MAX_JSON {
        return Err(invalid());
    }
    let mut reader = Reader(bytes);
    let mut share = metadata::unpack(reader.segment()?, MAX_RULES, described)?;
    for rule in rules_mut(&mut share.profile)? {
        let fields = rule.as_object().ok_or_else(invalid)?;
        if fields.contains_key("baselineEffectItemId")
            && (fields.contains_key("effects") || fields.contains_key("effectPresetId"))
        {
            return Err(invalid());
        }
    }
    let mut prior = Vec::new();
    let mut remaining = MAX_JSON;
    visit_lists(&mut share.profile, |object, key, cap, _| {
        if object.contains_key(key) {
            return Err(invalid());
        }
        let ids = read_list(&mut reader, catalog, &prior, cap)?;
        // Bound allocations even if every rule references the same small wire block.
        // The frame also checks the full serialized size, including metadata and escaping.
        let text_bytes = ids.iter().map(|id| id.len() + 2).sum::<usize>();
        remaining = remaining.checked_sub(text_bytes).ok_or_else(invalid)?;
        let items = ids
            .iter()
            .map(|id| Value::String((*id).to_owned()))
            .collect();
        object.insert(key.into(), Value::Array(items));
        prior.push(ids);
        Ok(())
    })?;
    reader.finish()?;
    Ok(share)
}

fn rules_mut(profile: &mut Value) -> Result<&mut Vec<Value>> {
    profile
        .get_mut("rules")
        .and_then(Value::as_array_mut)
        .filter(|rules| rules.len() <= MAX_RULES)
        .ok_or_else(invalid)
}

fn visit_lists(
    profile: &mut Value,
    mut visit: impl FnMut(&mut Map<String, Value>, &str, usize, usize) -> Result<()>,
) -> Result<()> {
    visit(
        profile.as_object_mut().ok_or_else(invalid)?,
        "skippedItemIds",
        MAX_SKIPPED,
        0,
    )?;
    for (index, rule) in rules_mut(profile)?.iter_mut().enumerate() {
        let target = rule
            .get_mut("target")
            .and_then(Value::as_object_mut)
            .ok_or_else(invalid)?;
        visit(target, "itemIds", MAX_SELECTED, index + 1)?;
    }
    Ok(())
}

#[cfg(test)]
pub(super) fn section_sizes(bytes: &[u8]) -> Result<(usize, usize)> {
    let mut reader = Reader(bytes);
    let metadata = reader.segment()?.len();
    Ok((metadata, reader.0.len()))
}
