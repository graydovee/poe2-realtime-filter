//! Dispatch portable filter schemes by share-code prefix.

mod compression;
mod v1;
mod v2;

use crate::engine::Result;
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{
    collections::HashSet,
    io::{self, Write},
};
use uuid::Uuid;

// Byte limit for the uncompressed body and its expanded JSON representation.
const MAX_JSON: usize = 1024 * 1024;
const MAX_PAYLOAD: usize = MAX_JSON + 4096;
const MAX_HEADER: usize = 128;
const INVALID_HEADER: &str = "分享码协议头无效";
const UNSUPPORTED_VERSION: &str = "不支持的分享码版本";
const INFLATED_TOO_LARGE: &str = "分享码解压后过大";
const SHARE_TOO_LARGE: &str = "方案过大，无法生成分享码";

trait ShareDecoder {
    fn prefix(&self) -> &'static str;
    fn decode(&self, payload: Option<&str>) -> Result<DecodedShare>;
}

trait ShareEncoder: ShareDecoder {
    fn encode(&self, share: &Share) -> Result<String>;
}

const DECODERS: &[&dyn ShareDecoder] = &[&v1::Codec, &v2::Codec];
const EXPORT_CODEC: &dyn ShareEncoder = &v2::Codec;

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Share {
    pub name: String,
    #[serde(default)]
    pub description: String,
    pub profile: Value,
}

#[derive(Debug)]
pub struct DecodedShare {
    pub share: Share,
    needs_rule_ids: bool,
}

impl DecodedShare {
    /// Only confirmed imports allocate and persist rule IDs. Share inspection remains read-only.
    pub fn into_import(mut self) -> Result<Share> {
        if self.needs_rule_ids {
            let rules = self
                .share
                .profile
                .get_mut("rules")
                .and_then(Value::as_array_mut)
                .ok_or("分享码缺少规则列表")?;
            let mut used = HashSet::new();
            for rule in rules {
                let fields = rule.as_object_mut().ok_or("分享码中的规则无效")?;
                fields.insert("id".into(), Value::String(new_rule_id(&mut used)?));
            }
            check_json_size(&self.share, INFLATED_TOO_LARGE)?;
        }
        Ok(self.share)
    }
}

pub fn encode(share: &Share) -> Result<String> {
    EXPORT_CODEC.encode(share)
}

pub fn decode(code: &str) -> Result<DecodedShare> {
    let code = code.trim();
    let (prefix, payload) = match code.split_once('.') {
        Some((prefix, payload)) => (prefix, Some(payload)),
        None => (code, None),
    };
    let decoder = DECODERS
        .iter()
        .find(|decoder| decoder.prefix() == prefix)
        .ok_or(UNSUPPORTED_VERSION)?;
    decoder.decode(payload)
}

fn new_rule_id(used: &mut HashSet<String>) -> Result<String> {
    // Match the editor's unambiguous, uniformly sampled eight-character alphabet.
    const ALPHABET: &[u8] = b"0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
    for _ in 0..100 {
        let random = Uuid::new_v4();
        let id: String = random
            .as_bytes()
            .iter()
            .copied()
            .enumerate()
            .filter(|&(index, byte)| index != 6 && index != 8 && byte < 248)
            .take(8)
            .map(|(_, byte)| char::from(ALPHABET[usize::from(byte) % ALPHABET.len()]))
            .collect();
        if id.len() == 8 && used.insert(id.clone()) {
            return Ok(id);
        }
    }
    Err("无法生成不重复的规则 ID".into())
}

fn decode_base64(encoded: &str, max: usize) -> Result<Vec<u8>> {
    if encoded.len() > (max * 4).div_ceil(3) {
        return Err("分享码过大".into());
    }
    let decoded = URL_SAFE_NO_PAD
        .decode(encoded)
        .map_err(|_| "分享码不是有效的 Base64URL")?;
    if decoded.len() > max {
        return Err("分享码过大".into());
    }
    Ok(decoded)
}

fn check_json_size(share: &Share, error: &str) -> Result<()> {
    struct Budget(usize);

    impl Write for Budget {
        fn write(&mut self, bytes: &[u8]) -> io::Result<usize> {
            self.0 = self
                .0
                .checked_sub(bytes.len())
                .ok_or_else(|| io::Error::other("share JSON exceeds size limit"))?;
            Ok(bytes.len())
        }

        fn flush(&mut self) -> io::Result<()> {
            Ok(())
        }
    }

    serde_json::to_writer(Budget(MAX_JSON), share).map_err(|_| error.into())
}

fn validate_server(value: &Value) -> Result<()> {
    match value.as_str() {
        Some("international" | "tencent") => Ok(()),
        _ => Err("分享码的游戏服务器无效".into()),
    }
}

#[cfg(test)]
pub(crate) use v2::{measure_body_sections, measure_compression_candidates};
