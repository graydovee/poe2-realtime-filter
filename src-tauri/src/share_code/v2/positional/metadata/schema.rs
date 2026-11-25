//! Positional metadata for POE2F2. Every field uses a presence bit, including fields
//! required by application validation. Field indices are mask bit positions, and choice
//! indices are wire values. The order follows `lib/types.ts` and is fixed for this
//! body revision. Keep the descriptors stable even if the TypeScript declarations change.

use super::{field, Field, Kind};

pub(super) const PROFILE: &[Field] = &[
    field("server", Kind::Choice(&["international", "tencent"])),
    field("baseFilterHint", Kind::Text),
    field("schemaVersion", Kind::UInt),
    field("league", Kind::Text),
    field("originalLeague", Kind::Text),
    field("strictness", Kind::UInt),
    field(
        "style",
        Kind::Choice(&[
            "default",
            "aura",
            "cobalt",
            "darkmode",
            "mythic",
            "vaal",
            "zen",
            "customsounds",
        ]),
    ),
    field("locale", Kind::Choice(&["cn", "tw", "us"])),
];

pub(super) const RULE: &[Field] = &[
    field("name", Kind::Text),
    field("enabled", Kind::Bool),
    field("hidden", Kind::Bool),
    field("baselineEffectItemId", Kind::Text),
    field("effectPresetId", Kind::Text),
    field("target", Kind::Object(TARGET)),
    field("effects", Kind::Object(EFFECTS)),
];

const TARGET: &[Field] = &[
    field("itemEnabled", Kind::Bool),
    field("range", Kind::Object(PRICE_RANGE)),
    field("priceEnabled", Kind::Bool),
    field("dropConditions", Kind::Object(DROP_CONDITIONS)),
];

const PRICE_RANGE: &[Field] = &[
    field("min", Kind::Object(PRICE_POINT)),
    field("max", Kind::Object(PRICE_POINT)),
];

const PRICE_POINT: &[Field] = &[
    field("amount", Kind::Number),
    field(
        "currency",
        Kind::Choice(&["exalted", "divine", "chaos", "annulment"]),
    ),
];

const DROP_CONDITIONS: &[Field] = &[
    field("stackSize", Kind::Object(DROP_NUMBER)),
    field("itemLevel", Kind::Object(DROP_NUMBER)),
    field("sockets", Kind::Object(DROP_NUMBER)),
    field("unidentifiedTier", Kind::Object(DROP_NUMBER)),
    field("rarity", Kind::Object(DROP_RARITY)),
];

const DROP_NUMBER: &[Field] = &[
    field("enabled", Kind::Bool),
    field(
        "bounds",
        Kind::Array {
            item: &Kind::Object(DROP_BOUND),
            max: 2,
        },
    ),
];

const DROP_BOUND: &[Field] = &[
    field("op", Kind::Choice(&[">=", ">", "=", "<", "<="])),
    field("value", Kind::UInt),
];

const DROP_RARITY: &[Field] = &[
    field("enabled", Kind::Bool),
    field(
        "value",
        Kind::Choice(&["Normal", "Magic", "Rare", "Unique"]),
    ),
];

const EFFECTS: &[Field] = &[
    field("beam", Kind::Text),
    field("icon", Kind::Text),
    field("font", Kind::Object(FONT)),
    field("sound", Kind::Sound),
];

const FONT: &[Field] = &[
    field("fontSize", Kind::UInt),
    field("textColor", Kind::Text),
    field("borderColor", Kind::Text),
    field("backgroundColor", Kind::Text),
];

// Indices are sound tags. The tag carries `type` separately from the variant fields.
pub(super) const SOUND_TYPES: &[&str] = &["builtin", "neversink", "baseline", "custom"];

pub(super) const BUILTIN_SOUND: &[Field] = &[
    field("id", Kind::UInt),
    field("volume", Kind::Number),
    field("positional", Kind::Bool),
];

pub(super) const BASELINE_SOUND: &[Field] = &[
    field("fileName", Kind::Text),
    field("volume", Kind::Number),
    field("optional", Kind::Bool),
    // The fallback carries the builtin payload with an implicit `type`.
    field("fallback", Kind::BuiltinSound),
];

pub(super) const FILE_SOUND: &[Field] = &[field("fileName", Kind::Text)];
