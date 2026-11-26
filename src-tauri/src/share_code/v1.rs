//! Reader for POE2F1 frames with or without a JSON header.

mod poe2;

#[cfg(test)]
use super::compression::Encoder;
use super::{
    check_json_size,
    compression::{inflate, Algorithm},
    decode_base64, validate_server, DecodedShare, Share, ShareDecoder, INFLATED_TOO_LARGE,
    INVALID_HEADER, MAX_HEADER, MAX_JSON, MAX_PAYLOAD,
};
use crate::engine::Result;
#[cfg(test)]
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use serde::Deserialize;
use serde_json::Value;

const PREFIX: &str = "POE2F1";
const INVALID_FORMAT: &str = "分享码格式无效";

pub(super) struct Codec;

impl ShareDecoder for Codec {
    fn prefix(&self) -> &'static str {
        PREFIX
    }

    fn decode(&self, payload: Option<&str>) -> Result<DecodedShare> {
        let share = decode_payload(payload.ok_or(INVALID_FORMAT)?)?;
        Ok(DecodedShare {
            share,
            needs_rule_ids: false,
        })
    }
}

#[derive(Deserialize)]
#[cfg_attr(test, derive(serde::Serialize))]
#[serde(deny_unknown_fields)]
struct Header {
    alg: String,
    p: u32,
}

#[derive(Clone, Copy)]
enum Body {
    BrotliJson,
    Poe2,
    ServerBrotliJson,
    ServerPoe2,
    DropConditionsJson,
}

impl Body {
    fn from_header(header: Header) -> Result<Self> {
        match (header.alg.as_str(), header.p) {
            ("br", 1) => Ok(Self::BrotliJson),
            ("poe2", 1) => Ok(Self::Poe2),
            ("br", 3) => Ok(Self::DropConditionsJson),
            ("br", 2) => Ok(Self::ServerBrotliJson),
            ("poe2", 2) => Ok(Self::ServerPoe2),
            _ => Err("不支持的分享码算法或参数档位，请升级客户端".into()),
        }
    }

    #[cfg(test)]
    fn header(self) -> Header {
        let (alg, p) = match self {
            Self::DropConditionsJson => ("br", 3),
            Self::BrotliJson => ("br", 1),
            Self::Poe2 => ("poe2", 1),
            Self::ServerBrotliJson => ("br", 2),
            Self::ServerPoe2 => ("poe2", 2),
        };
        Header { alg: alg.into(), p }
    }
}

/// Build frames for the decoder tests.
#[cfg(test)]
fn encode_payload(body: Body, bytes: &[u8]) -> Result<String> {
    let mut payload = crc32fast::hash(bytes).to_le_bytes().to_vec();
    Encoder::brotli(11, 20).write_payload(bytes, &mut payload)?;
    if payload.len() > MAX_PAYLOAD {
        return Err("分享码过大".into());
    }
    let header = serde_json::to_vec(&body.header()).map_err(|e| e.to_string())?;
    Ok(format!(
        "{PREFIX}.{}.{}",
        URL_SAFE_NO_PAD.encode(header),
        URL_SAFE_NO_PAD.encode(payload)
    ))
}

fn decode_payload(payload: &str) -> Result<Share> {
    let (head, payload) = match payload.split_once('.') {
        None => return parse_json(&decode_base64(payload, MAX_JSON)?),
        Some((head, payload)) if !payload.contains('.') => (head, payload),
        Some(_) => return Err(INVALID_FORMAT.into()),
    };
    let head = decode_base64(head, MAX_HEADER)?;
    let header = serde_json::from_slice::<Header>(&head).map_err(|_| INVALID_HEADER)?;
    if header.p == 0 || header.alg.is_empty() {
        return Err(INVALID_HEADER.into());
    }
    let body = Body::from_header(header)?;
    let bytes = inflate(&decode_base64(payload, MAX_PAYLOAD)?, Algorithm::Brotli)?;
    match body {
        Body::BrotliJson => parse_json(&bytes),
        Body::DropConditionsJson => {
            let share = parse_json(&bytes)?;
            if share.profile["schemaVersion"].as_u64() != Some(3) {
                return Err("分享码方案格式无效".into());
            }
            if let Some(server) = share.profile.get("server") {
                validate_server(server)?;
            }
            Ok(share)
        }
        Body::ServerBrotliJson => {
            let share = parse_json(&bytes)?;
            validate_server(&share.profile["server"])?;
            Ok(share)
        }
        Body::ServerPoe2 => {
            let (&server, packed) = bytes.split_first().ok_or("分享码缺少游戏服务器")?;
            let server = match server {
                0 => "international",
                1 => "tencent",
                _ => return Err("分享码的游戏服务器无效".into()),
            };
            let mut share = poe2::unpack(packed).ok_or("PoE2 分享码结构无效或过大")?;
            share.profile["server"] = Value::String(server.into());
            check_json_size(&share, INFLATED_TOO_LARGE)?;
            Ok(share)
        }
        Body::Poe2 => poe2::unpack(&bytes).ok_or_else(|| "PoE2 分享码结构无效或过大".into()),
    }
}

fn parse_json(bytes: &[u8]) -> Result<Share> {
    serde_json::from_slice(bytes).map_err(|_| "分享码内容无效".into())
}

#[cfg(test)]
mod tests;
