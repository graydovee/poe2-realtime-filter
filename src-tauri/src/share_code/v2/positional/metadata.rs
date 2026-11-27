//! Positional scheme and rule fields. The format and revision in the frame select this
//! schema. A record is a presence mask followed by the present values in declaration order.

mod schema;

use super::wire::{invalid, put_u64, put_uint, Reader};
use crate::engine::Result;
use crate::share_code::Share;
use serde_json::{Map, Number, Value};

#[derive(Clone, Copy)]
enum Kind {
    Bool,
    UInt,
    Number,
    Text,
    Choice(&'static [&'static str]),
    Object(&'static [Field]),
    Array { item: &'static Kind, max: usize },
    Sound,
    BuiltinSound,
}

type Field = (&'static str, Kind);

const fn field(name: &'static str, kind: Kind) -> Field {
    (name, kind)
}

pub(super) fn pack(mut share: Share, max_rules: usize, described: bool) -> Result<Vec<u8>> {
    let profile = share.profile.as_object_mut().ok_or_else(invalid)?;
    let Some(Value::Array(rules)) = profile.remove("rules") else {
        return Err(invalid());
    };
    check_limit(rules.len(), max_rules)?;
    let mut out = Vec::new();
    write_text(&mut out, &share.name);
    if described {
        write_text(&mut out, &share.description);
    }
    write_object(&mut out, profile, schema::PROFILE, None)?;
    put_uint(&mut out, rules.len());
    for rule in &rules {
        write_object(
            &mut out,
            rule.as_object().ok_or_else(invalid)?,
            schema::RULE,
            None,
        )?;
    }
    Ok(out)
}

pub(super) fn unpack(bytes: &[u8], max_rules: usize, described: bool) -> Result<Share> {
    let mut input = Reader(bytes);
    let name = read_text(&mut input)?;
    let description = if described {
        read_text(&mut input)?
    } else {
        String::new()
    };
    let mut profile = read_object(&mut input, schema::PROFILE)?;
    let count = input.uint()?;
    check_limit(count, max_rules)?;
    let mut rules = Vec::with_capacity(count);
    for _ in 0..count {
        rules.push(Value::Object(read_object(&mut input, schema::RULE)?));
    }
    input.finish()?;
    profile.insert("rules".into(), Value::Array(rules));
    Ok(Share {
        name,
        description,
        profile: Value::Object(profile),
    })
}

fn write_object(
    out: &mut Vec<u8>,
    object: &Map<String, Value>,
    fields: &[Field],
    discriminator: Option<&str>,
) -> Result<()> {
    if let Some(key) = object.keys().find(|key| {
        Some(key.as_str()) != discriminator && !fields.iter().any(|(name, _)| *name == key.as_str())
    }) {
        return Err(format!("当前分享码格式不支持方案字段「{key}」"));
    }
    let mut mask = 0u8;
    for (index, (name, _)) in fields.iter().enumerate() {
        if object.contains_key(*name) {
            mask |= 1 << index;
        }
    }
    out.push(mask);
    for &(name, kind) in fields {
        if let Some(value) = object.get(name) {
            write_value(out, kind, value).map_err(|error| format!("{error}（字段 {name}）"))?;
        }
    }
    Ok(())
}

fn read_object(input: &mut Reader<'_>, fields: &[Field]) -> Result<Map<String, Value>> {
    let mask = usize::from(input.take(1)?[0]);
    if mask >> fields.len() != 0 {
        return Err(invalid());
    }
    let mut object = Map::new();
    for (index, &(name, kind)) in fields.iter().enumerate() {
        if mask & (1 << index) != 0 {
            object.insert(name.into(), read_value(input, kind)?);
        }
    }
    Ok(object)
}

fn write_value(out: &mut Vec<u8>, kind: Kind, value: &Value) -> Result<()> {
    match kind {
        Kind::Bool => out.push(u8::from(value.as_bool().ok_or_else(invalid)?)),
        Kind::UInt => {
            let number = value
                .as_u64()
                .and_then(|value| u32::try_from(value).ok())
                .ok_or_else(invalid)?;
            put_uint(out, number as usize);
        }
        Kind::Number => write_number(out, value)?,
        Kind::Text => write_text(out, value.as_str().ok_or_else(invalid)?),
        Kind::Choice(choices) => put_uint(out, choice(choices, value)?),
        Kind::Object(fields) => {
            write_object(out, value.as_object().ok_or_else(invalid)?, fields, None)?
        }
        Kind::Array { item, max } => {
            let array = value.as_array().ok_or_else(invalid)?;
            check_limit(array.len(), max)?;
            put_uint(out, array.len());
            for value in array {
                write_value(out, *item, value)?;
            }
        }
        Kind::Sound => write_sound(out, value, false)?,
        Kind::BuiltinSound => write_sound(out, value, true)?,
    }
    Ok(())
}

fn read_value(input: &mut Reader<'_>, kind: Kind) -> Result<Value> {
    match kind {
        Kind::Bool => match input.take(1)?[0] {
            0 => Ok(Value::Bool(false)),
            1 => Ok(Value::Bool(true)),
            _ => Err(invalid()),
        },
        Kind::UInt => Ok((input.uint()? as u32).into()),
        Kind::Number => read_number(input),
        Kind::Text => read_text(input).map(Value::String),
        Kind::Choice(choices) => Ok(Value::String(
            choices.get(input.uint()?).ok_or_else(invalid)?.to_string(),
        )),
        Kind::Object(fields) => read_object(input, fields).map(Value::Object),
        Kind::Array { item, max } => {
            let count = input.uint()?;
            check_limit(count, max)?;
            let mut array = Vec::with_capacity(count);
            for _ in 0..count {
                array.push(read_value(input, *item)?);
            }
            Ok(Value::Array(array))
        }
        Kind::Sound => {
            let tag = input.uint()?;
            read_sound(input, tag)
        }
        Kind::BuiltinSound => read_sound(input, 0),
    }
}

fn check_limit(count: usize, max: usize) -> Result<()> {
    if count > max {
        return Err(invalid());
    }
    Ok(())
}

fn write_text(out: &mut Vec<u8>, text: &str) {
    put_uint(out, text.len());
    out.extend_from_slice(text.as_bytes());
}

fn read_text(input: &mut Reader<'_>) -> Result<String> {
    std::str::from_utf8(input.segment()?)
        .map(str::to_owned)
        .map_err(|_| invalid())
}

fn choice(choices: &[&str], value: &Value) -> Result<usize> {
    let value = value.as_str().ok_or_else(invalid)?;
    choices
        .iter()
        .position(|&choice| choice == value)
        .ok_or_else(invalid)
}

// Most prices and volumes are small nonnegative integers. Zero introduces an f64;
// other varints carry the integer plus one. Floats retain their full precision.
fn write_number(out: &mut Vec<u8>, value: &Value) -> Result<()> {
    if let Some(integer) = value.as_u64() {
        put_u64(out, integer.checked_add(1).ok_or_else(invalid)?);
    } else {
        let number = value
            .as_f64()
            .filter(|value| *value >= 0.0)
            .ok_or_else(invalid)?;
        out.push(0);
        out.extend_from_slice(&number.to_le_bytes());
    }
    Ok(())
}

fn read_number(input: &mut Reader<'_>) -> Result<Value> {
    if let Some(integer) = input.uint64()?.checked_sub(1) {
        return Ok(integer.into());
    }
    let bytes = input.take(8)?.try_into().map_err(|_| invalid())?;
    let number = f64::from_le_bytes(bytes);
    if number < 0.0 {
        return Err(invalid());
    }
    Number::from_f64(number)
        .map(Value::Number)
        .ok_or_else(invalid)
}

fn sound_fields(tag: usize) -> Result<&'static [Field]> {
    match tag {
        0 => Ok(schema::BUILTIN_SOUND),
        1 | 3 => Ok(schema::FILE_SOUND),
        2 => Ok(schema::BASELINE_SOUND),
        _ => Err(invalid()),
    }
}

fn write_sound(out: &mut Vec<u8>, value: &Value, builtin_only: bool) -> Result<()> {
    let object = value.as_object().ok_or_else(invalid)?;
    let tag = choice(schema::SOUND_TYPES, object.get("type").ok_or_else(invalid)?)?;
    if builtin_only {
        if tag != 0 {
            return Err(invalid());
        }
    } else {
        put_uint(out, tag);
    }
    write_object(out, object, sound_fields(tag)?, Some("type"))
}

fn read_sound(input: &mut Reader<'_>, tag: usize) -> Result<Value> {
    let mut object = read_object(input, sound_fields(tag)?)?;
    object.insert(
        "type".into(),
        Value::String(schema::SOUND_TYPES[tag].into()),
    );
    Ok(Value::Object(object))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn positional_wire_vector() {
        let share = Share {
            name: "N".into(),
            description: String::new(),
            profile: json!({
                "server":"tencent", "schemaVersion":3, "league":"L", "rules":[{
                    "name":"R", "enabled":true, "hidden":false, "effects":{},
                    "target":{"itemEnabled":false, "range":{"min":{"amount":128,"currency":"annulment"}}}
                }]
            }),
        };
        let expected = [
            1, b'N', 0x0d, 1, 3, 1, b'L', 1, // name, profile, rule count
            0x67, 1, b'R', 1, 0, // rule mask, name and switches
            3, 0, 1, 3, 0x81, 1, 3, 0, // target, minimum price, empty effects
        ];
        assert_eq!(pack(share.clone(), 1, false).unwrap(), expected);
        assert_eq!(unpack(&expected, 1, false).unwrap(), share);
        for cut in 0..expected.len() {
            assert!(unpack(&expected[..cut], 1, false).is_err());
        }
        assert!(unpack(&expected, 0, false).is_err());
        assert!(unpack(&[&expected[..], &[0]].concat(), 1, false).is_err());
    }

    #[test]
    fn described_wire_vector_writes_the_description_after_the_name() {
        let share = Share {
            name: "N".into(),
            description: "描述".into(),
            profile: json!({"schemaVersion":3,"league":"L","rules":[]}),
        };
        let expected = [
            1, b'N', // name
            6, 0xe6, 0x8f, 0x8f, 0xe8, 0xbf, 0xb0, // description
            0x0c, 3, 1, b'L', 0, // profile and rule count
        ];
        assert_eq!(pack(share.clone(), 1, true).unwrap(), expected);
        assert_eq!(unpack(&expected, 1, true).unwrap(), share);
        for cut in 0..expected.len() {
            assert!(unpack(&expected[..cut], 1, true).is_err());
        }
        assert!(unpack(&[&expected[..], &[0]].concat(), 1, true).is_err());
        // Revision 1 reads another field where the description starts.
        assert!(unpack(&expected, 1, false).is_err());
        let mut bare = share.clone();
        bare.description = String::new();
        assert_eq!(
            pack(bare.clone(), 1, true).unwrap(),
            [1, b'N', 0, 0x0c, 3, 1, b'L', 0]
        );
        assert_eq!(
            unpack(&[1, b'N', 0, 0x0c, 3, 1, b'L', 0], 1, true).unwrap(),
            bare
        );
    }

    #[test]
    fn keeps_inactive_values_and_sound_variants() {
        let rules = [
            json!({"type":"builtin", "id":16, "volume":0, "positional":false}),
            json!({"type":"neversink", "fileName":"example.ogg"}),
            json!({"type":"baseline", "fileName":"ref/one.ogg;two.ogg", "volume":12.25,
                   "optional":true, "fallback":{"type":"builtin", "id":1, "volume":300, "positional":true}}),
            json!({"type":"custom", "fileName":"custom.ogg"}),
        ].map(|sound| json!({
            "name":"测试", "enabled":false, "hidden":true, "effectPresetId":"old-look",
            "target":{"priceEnabled":false, "range":{"min":{"amount":99.125,"currency":"divine"},
                      "max":{"amount":1_000_000_000_000u64,"currency":"exalted"}}, "dropConditions":{
                "stackSize":{"enabled":false,"bounds":[{"op":">=", "value":2},{"op":"<", "value":256}]},
                "itemLevel":{"enabled":false,"bounds":[]}, "sockets":{"enabled":true,"bounds":[{"op":"=", "value":0}]},
                "unidentifiedTier":{"enabled":false,"bounds":[{"op":">", "value":1}]},
                "rarity":{"enabled":false,"value":"Unique"}
            }},
            "effects":{"beam":"Blue Temp", "icon":"1 White Star", "font":{"fontSize":42,
                "textColor":"015 2 34", "borderColor":"255 255 255 0", "backgroundColor":"0 0 0"}, "sound":sound}
        }));
        let share = Share {
            name: "配置".into(),
            description: String::new(),
            profile: json!({"schemaVersion":3, "baseFilterHint":"reference.filter",
            "originalLeague":"Original", "league":"", "strictness":6, "style":"customsounds", "locale":"tw",
            "server":"tencent", "rules":rules}),
        };
        let data = pack(share.clone(), 100, false).unwrap();
        assert_eq!(unpack(&data, 100, false).unwrap(), share);
        let mut unsupported = share;
        unsupported.profile["rules"][0]["effects"]["newEffect"] = json!(true);
        assert!(pack(unsupported, 100, false)
            .unwrap_err()
            .contains("newEffect"));
    }
}
