//! POE2F2 container and body-version registry.

mod frame;
mod positional;
#[cfg(test)]
mod tests;

use super::{
    check_json_size, compression::Encoder, decode_base64, validate_server, DecodedShare, Share,
    ShareDecoder, ShareEncoder, INFLATED_TOO_LARGE, MAX_JSON, MAX_PAYLOAD, SHARE_TOO_LARGE,
};
use crate::engine::Result;

const PREFIX: &str = "POE2F2";
const UNSUPPORTED_HEADER: &str = "不支持的分享码格式、正文版本或压缩算法，请升级客户端";
const ENCODERS: &[Encoder] = &[Encoder::Raw, Encoder::brotli(11, 16)];

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct BodyVersion {
    format: u32,
    revision: u32,
}

struct BodyCodec {
    version: BodyVersion,
    pack: fn(&Share) -> Result<Vec<u8>>,
    unpack: fn(&[u8]) -> Result<Share>,
}

// Read every released layout. Select the export layout separately.
const BODY_CODECS: &[&BodyCodec] = &[&positional::CODEC];
const EXPORT_BODY: &BodyCodec = &positional::CODEC;

pub(super) struct Codec;

impl ShareDecoder for Codec {
    fn prefix(&self) -> &'static str {
        PREFIX
    }

    fn decode(&self, payload: Option<&str>) -> Result<DecodedShare> {
        // A bare POE2F2 prefix was an unsupported version before the container split.
        let bytes = decode_base64(payload.ok_or(super::UNSUPPORTED_VERSION)?, MAX_PAYLOAD)?;
        let frame = frame::Frame::read(&bytes)?;
        let body = body_codec(frame.version)?;
        let share = (body.unpack)(&frame.inflate()?)?;
        check_json_size(&share, INFLATED_TOO_LARGE)?;
        Ok(DecodedShare {
            share,
            needs_rule_ids: true,
        })
    }
}

impl ShareEncoder for Codec {
    fn encode(&self, share: &Share) -> Result<String> {
        let bytes = pack_body(share)?;
        encode_shortest(&bytes, EXPORT_BODY.version)
    }
}

fn body_codec(version: BodyVersion) -> Result<&'static BodyCodec> {
    BODY_CODECS
        .iter()
        .copied()
        .find(|codec| codec.version == version)
        .ok_or_else(|| UNSUPPORTED_HEADER.into())
}

fn pack_body(share: &Share) -> Result<Vec<u8>> {
    check_json_size(share, SHARE_TOO_LARGE)?;
    if let Some(server) = share.profile.get("server") {
        validate_server(server)?;
    }
    let bytes = (EXPORT_BODY.pack)(share)?;
    if bytes.len() > MAX_JSON {
        return Err(SHARE_TOO_LARGE.into());
    }
    Ok(bytes)
}

fn encode_shortest(bytes: &[u8], version: BodyVersion) -> Result<String> {
    let checksum = crc32fast::hash(bytes);
    let mut best: Option<String> = None;
    for &encoder in ENCODERS {
        let code = frame::encode(bytes, version, checksum, encoder)?;
        if best
            .as_ref()
            .is_none_or(|current| code.len() < current.len())
        {
            best = Some(code);
        }
    }
    best.ok_or_else(|| "无法压缩分享码".into())
}

#[cfg(test)]
pub(crate) use tests::{measure_body_sections, measure_compression_candidates};
