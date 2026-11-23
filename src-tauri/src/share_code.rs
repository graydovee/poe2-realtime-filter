mod poe2;

use crate::engine::Result;
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use brotli::{
    enc::BrotliEncoderParams, BrotliCompress, BrotliDecompressStream, BrotliResult, BrotliState,
    HeapAlloc,
};
use serde::{Deserialize, Serialize};
use serde_json::Value;

const VERSION: &str = "POE2F1";
const MAX_JSON: usize = 1024 * 1024;
const MAX_PAYLOAD: usize = MAX_JSON + 4096;
const MAX_HEADER: usize = 128;

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Share {
    pub name: String,
    pub profile: Value,
}

#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Header {
    alg: String,
    p: u32,
}

#[derive(Clone, Copy)]
enum Codec {
    BrotliJson,
    Poe2,
    ServerBrotliJson,
    ServerPoe2,
    DropConditionsJson,
}

impl Codec {
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

pub fn encode(share: &Share) -> Result<String> {
    let json = serde_json::to_vec(share).map_err(|e| e.to_string())?;
    if json.len() > MAX_JSON {
        return Err("方案过大，无法生成分享码".into());
    }
    let server = share.profile.get("server").map(server_byte).transpose()?;
    if share.profile["schemaVersion"].as_u64() == Some(3) {
        return encode_payload(Codec::DropConditionsJson, &json);
    }
    let generic = encode_payload(
        if server.is_some() {
            Codec::ServerBrotliJson
        } else {
            Codec::BrotliJson
        },
        &json,
    )?;
    let (codec, packed) = match server {
        Some(server) => {
            let mut core = share.clone();
            core.profile
                .as_object_mut()
                .ok_or("无效方案内容")?
                .remove("server");
            let bytes = poe2::pack(&core).map(|packed| {
                let mut bytes = vec![server];
                bytes.extend(packed);
                bytes
            });
            (Codec::ServerPoe2, bytes)
        }
        None => (Codec::Poe2, poe2::pack(share)),
    };
    let Some(packed) = packed.filter(|bytes| bytes.len() <= MAX_JSON) else {
        return Ok(generic);
    };
    let specialized = encode_payload(codec, &packed)?;
    Ok(if specialized.len() <= generic.len() {
        specialized
    } else {
        generic
    })
}

fn encode_payload(codec: Codec, bytes: &[u8]) -> Result<String> {
    let mut payload = crc32fast::hash(bytes).to_le_bytes().to_vec();
    let params = BrotliEncoderParams {
        quality: 11,
        lgwin: 20,
        size_hint: bytes.len(),
        ..Default::default()
    };
    BrotliCompress(&mut &bytes[..], &mut payload, &params)
        .map_err(|e| format!("无法压缩分享码: {e}"))?;
    if payload.len() > MAX_PAYLOAD {
        return Err("分享码过大".into());
    }
    let header = serde_json::to_vec(&codec.header()).map_err(|e| e.to_string())?;
    Ok(format!(
        "{VERSION}.{}.{}",
        URL_SAFE_NO_PAD.encode(header),
        URL_SAFE_NO_PAD.encode(payload)
    ))
}

pub fn decode(code: &str) -> Result<Share> {
    let mut parts = code.trim().split('.');
    if parts.next() != Some(VERSION) {
        return Err("不支持的分享码版本".into());
    }
    let first = parts.next().ok_or("分享码格式无效")?;
    match parts.next() {
        None => parse_json(&decode_base64(first, MAX_JSON)?),
        Some(payload) if parts.next().is_none() => {
            let head = decode_base64(first, MAX_HEADER)?;
            let header = serde_json::from_slice::<Header>(&head).map_err(|_| "分享码协议头无效")?;
            if header.p == 0 || header.alg.is_empty() {
                return Err("分享码协议头无效".into());
            }
            let codec = Codec::from_header(header)?;
            let bytes = inflate(&decode_base64(payload, MAX_PAYLOAD)?)?;
            match codec {
                Codec::BrotliJson => parse_json(&bytes),
                Codec::DropConditionsJson => {
                    let share = parse_json(&bytes)?;
                    if share.profile["schemaVersion"].as_u64() != Some(3) {
                        return Err("分享码方案格式无效".into());
                    }
                    if let Some(server) = share.profile.get("server") {
                        server_byte(server)?;
                    }
                    Ok(share)
                }
                Codec::ServerBrotliJson => {
                    let share = parse_json(&bytes)?;
                    server_byte(&share.profile["server"])?;
                    Ok(share)
                }
                Codec::ServerPoe2 => {
                    let (&server, packed) = bytes.split_first().ok_or("分享码缺少游戏服务器")?;
                    let server = match server {
                        0 => "international",
                        1 => "tencent",
                        _ => return Err("分享码的游戏服务器无效".into()),
                    };
                    let mut share = poe2::unpack(packed).ok_or("PoE2 分享码结构无效或过大")?;
                    share.profile["server"] = Value::String(server.into());
                    if serde_json::to_vec(&share).map_err(|e| e.to_string())?.len() > MAX_JSON {
                        return Err("分享码解压后过大".into());
                    }
                    Ok(share)
                }
                Codec::Poe2 => {
                    poe2::unpack(&bytes).ok_or_else(|| "PoE2 分享码结构无效或过大".into())
                }
            }
        }
        _ => Err("分享码格式无效".into()),
    }
}

fn server_byte(value: &Value) -> Result<u8> {
    match value.as_str() {
        Some("international") => Ok(0),
        Some("tencent") => Ok(1),
        _ => Err("分享码的游戏服务器无效".into()),
    }
}

fn parse_json(bytes: &[u8]) -> Result<Share> {
    serde_json::from_slice(bytes).map_err(|_| "分享码内容无效".into())
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

fn inflate(payload: &[u8]) -> Result<Vec<u8>> {
    let (checksum, stream) = payload
        .split_first_chunk::<4>()
        .ok_or("分享码压缩数据不完整")?;
    let expected = u32::from_le_bytes(*checksum);
    let mut state = BrotliState::new_strict(
        HeapAlloc::default(),
        HeapAlloc::default(),
        HeapAlloc::default(),
    );
    let mut output = vec![0; MAX_JSON + 1];
    let (mut input_left, mut input_offset) = (stream.len(), 0);
    let (mut output_left, mut output_offset) = (output.len(), 0);
    let mut total_out = 0;
    let status = BrotliDecompressStream(
        &mut input_left,
        &mut input_offset,
        stream,
        &mut output_left,
        &mut output_offset,
        &mut output,
        &mut total_out,
        &mut state,
    );
    if output_offset > MAX_JSON || matches!(status, BrotliResult::NeedsMoreOutput) {
        return Err("分享码解压后过大".into());
    }
    if !matches!(status, BrotliResult::ResultSuccess) || input_offset != stream.len() {
        return Err("分享码压缩数据损坏".into());
    }
    output.truncate(output_offset);
    if crc32fast::hash(&output) != expected {
        return Err("分享码校验失败".into());
    }
    Ok(output)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    const POE2_PREFIX: &str = "POE2F1.eyJhbGciOiJwb2UyIiwicCI6MX0.";
    const BROTLI_PREFIX: &str = "POE2F1.eyJhbGciOiJiciIsInAiOjF9.";
    const LEGACY: &str = "POE2F1.eyJuYW1lIjoi5omT5a6dIiwicHJvZmlsZSI6eyJzY2hlbWFWZXJzaW9uIjoyLCJsZWFndWUiOiJTdGFuZGFyZCIsInJ1bGVzIjpbXSwic2tpcHBlZEl0ZW1JZHMiOlsiYWxiaW5vLXJob2EtZmVhdGhlciJdfX0";
    // Produced independently with Node zlib, including CRC32 framing.
    const BROTLI_VECTOR: &str = "POE2F1.eyJhbGciOiJiciIsInAiOjF9.8d8ILRt2AGAchXGzE562KCuun6YtDsEGHBAH2WATDzpE3lK__kVpH7IJb_9GgJmmdVi6-urkwOkgv35BC0vCADTwkJUo2IMqwGJgsBpuPkIrfOIA3kYKlAD3QShIFnKJYNwTrs-pLr6QOtaW27dJCytSJPsB";
    const POE2_VECTOR: &str = "POE2F1.eyJhbGciOiJwb2UyIiwicCI6MX0.tG4EFQsXgCoAAABbIuaJk-WunSIsWzM4NywyLCJTdGFuZGFyZCIsW10sWzAsMSwwLDFdXV0kAw";

    #[test]
    fn drop_conditions_share_uses_brotli_profile_three() {
        let share = Share {
            name: "通货数量档".into(),
            profile: json!({"schemaVersion": 3, "server": "international", "rules": [{
                "target": {"itemIds": ["exalted-orb"], "dropConditions": {
                    "stackSize": {"enabled": true, "bounds": [{"op": ">=", "value": 5}]},
                    "itemLevel": {"enabled": false, "bounds": [{"op": "<", "value": 80}]}
                }}
            }]}),
        };
        let encoded = encode(&share).unwrap();
        assert!(encoded.starts_with("POE2F1.eyJhbGciOiJiciIsInAiOjN9."));
        assert_eq!(decode(&encoded).unwrap(), share);
    }

    #[test]
    fn share_protocol_vectors() {
        let expected = Share {
            name: "打宝".into(),
            profile: json!({"schemaVersion":2,"league":"Standard","rules":[],"skippedItemIds":["albino-rhoa-feather"]}),
        };
        for code in [LEGACY, BROTLI_VECTOR, POE2_VECTOR] {
            assert_eq!(decode(code).unwrap(), expected);
        }
        let encoded = encode(&expected).unwrap();
        assert!(encoded.starts_with(POE2_PREFIX));
        assert_eq!(encoded.split('.').count(), 3);
        assert_eq!(decode(&format!("  {encoded}\n")).unwrap(), expected);
    }

    #[test]
    fn share_server_and_raw_league_round_trip_in_both_codecs() {
        let mut share = decode(LEGACY).unwrap();
        assert!(share.profile.get("server").is_none());
        share.profile["server"] = json!("tencent");
        share.profile["league"] = json!("RunesofAldur");
        let compact = encode(&share).unwrap();
        assert!(compact.starts_with("POE2F1.eyJhbGciOiJwb2UyIiwicCI6Mn0."));
        assert_eq!(decode(&compact).unwrap(), share);
        share.profile["newField"] = json!(true);
        let generic = encode(&share).unwrap();
        assert!(generic.starts_with("POE2F1.eyJhbGciOiJiciIsInAiOjJ9."));
        assert_eq!(decode(&generic).unwrap(), share);
        assert!(decode(&encode_payload(Codec::ServerPoe2, &[2]).unwrap()).is_err());
    }

    #[test]
    fn uses_brotli_json_if_the_profile_cannot_be_packed() {
        let mut share = decode(LEGACY).unwrap();
        share.profile["skippedItemIds"] = json!(["possible-future-item"]);
        let encoded = encode(&share).unwrap();
        assert!(encoded.starts_with(BROTLI_PREFIX));
        assert_eq!(decode(&encoded).unwrap(), share);
        share.profile["skippedItemIds"] = json!(["albino-rhoa-feather"]);
        share.profile["futureField"] = json!({"future": true});
        let encoded = encode(&share).unwrap();
        assert!(encoded.starts_with(BROTLI_PREFIX));
        assert_eq!(decode(&encoded).unwrap(), share);
    }

    #[test]
    fn rejects_malformed_or_unsupported_headers() {
        let payload = BROTLI_VECTOR.rsplit_once('.').unwrap().1;
        let code_with_header =
            |header: &str| format!("{VERSION}.{}.{payload}", URL_SAFE_NO_PAD.encode(header));
        for header in [
            r#"{"alg":"br"}"#,
            r#"{"p":1}"#,
            r#"{"alg":"br","p":0}"#,
            r#"{"alg":"br","p":-1}"#,
            r#"{"alg":"br","p":"1"}"#,
            r#"{"alg":"br","p":1,"p":1}"#,
            r#"{"alg":"br","alg":"br","p":1}"#,
            r#"{"alg":"br","p":1,"extra":true}"#,
        ] {
            assert_eq!(
                decode(&code_with_header(header)).unwrap_err(),
                "分享码协议头无效"
            );
        }
        for header in [r#"{"alg":"zip","p":1}"#, r#"{"alg":"poe2","p":3}"#] {
            assert!(decode(&code_with_header(header))
                .unwrap_err()
                .contains("升级客户端"));
        }
        let full_header = format!(r#"{{"alg":"br","p":1}}{}"#, " ".repeat(MAX_HEADER - 18));
        assert_eq!(full_header.len(), MAX_HEADER);
        assert!(decode(&code_with_header(&full_header)).is_ok());
        assert_eq!(
            decode(&code_with_header(&(full_header + " "))).unwrap_err(),
            "分享码过大"
        );
        for code in [
            "POE2F1",
            "POE2F1.$$$",
            "POE2F1.*.A",
            "POE2F1.A.A.A",
            "POE2F2.A",
        ] {
            assert!(decode(code).is_err(), "{code}");
        }
    }

    #[test]
    fn rejects_bad_checksums_truncation_and_trailing_data() {
        let payload = URL_SAFE_NO_PAD
            .decode(BROTLI_VECTOR.strip_prefix(BROTLI_PREFIX).unwrap())
            .unwrap();
        let mut broken = payload.clone();
        broken[0] ^= 1;
        assert_eq!(inflate(&broken).unwrap_err(), "分享码校验失败");
        assert!(inflate(&payload[..payload.len() - 1]).is_err());
        let mut trailing = payload;
        trailing.push(0);
        assert!(inflate(&trailing).is_err());
        assert!(decode(&format!("{BROTLI_PREFIX}*=")).is_err());
    }

    #[test]
    fn limits_encoded_and_inflated_bytes() {
        assert_eq!(
            decode_base64(&URL_SAFE_NO_PAD.encode(vec![0; MAX_PAYLOAD]), MAX_PAYLOAD)
                .unwrap()
                .len(),
            MAX_PAYLOAD
        );
        assert!(decode_base64(&"A".repeat(MAX_PAYLOAD * 2), MAX_PAYLOAD).is_err());
        let maximum = encode_payload(Codec::BrotliJson, &vec![b'a'; MAX_JSON]).unwrap();
        let compressed =
            decode_base64(maximum.strip_prefix(BROTLI_PREFIX).unwrap(), MAX_PAYLOAD).unwrap();
        assert_eq!(inflate(&compressed).unwrap().len(), MAX_JSON);
        let oversized = encode_payload(Codec::BrotliJson, &vec![b'a'; MAX_JSON + 1]).unwrap();
        assert_eq!(decode(&oversized).unwrap_err(), "分享码解压后过大");
    }
}
