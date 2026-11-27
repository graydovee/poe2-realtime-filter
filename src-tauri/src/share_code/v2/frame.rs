//! Protobuf wire encoding for `share_header.proto` and the POE2F2 frame.

use super::{BodyVersion, PREFIX, UNSUPPORTED_HEADER};
use crate::{
    engine::Result,
    share_code::{
        compression::{self, Algorithm, Encoder},
        INVALID_HEADER, MAX_HEADER, MAX_PAYLOAD,
    },
};
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};

const FORMAT: u64 = 1;
const REVISION: u64 = 2;
const COMPRESSION: u64 = 3;
const CATALOG: u64 = 4;
const VARINT: u64 = 0;
const MAX_FIELD_NUMBER: u64 = (1 << 29) - 1;

pub(super) struct Frame<'a> {
    pub(super) version: BodyVersion,
    /// Version of the item catalog the code was written against. Absent means the first one.
    pub(super) catalog: Option<u32>,
    compression: u32,
    payload: &'a [u8],
}

impl<'a> Frame<'a> {
    pub(super) fn read(mut bytes: &'a [u8]) -> Result<Self> {
        let length = varint(&mut bytes).ok_or(INVALID_HEADER)?;
        if length > MAX_HEADER as u64 {
            return Err(INVALID_HEADER.into());
        }
        let (head, payload) = bytes
            .split_at_checked(length as usize)
            .ok_or(INVALID_HEADER)?;
        let (version, catalog, compression) = read_header(head).ok_or(INVALID_HEADER)?;
        Ok(Self {
            version,
            catalog,
            compression,
            payload,
        })
    }

    pub(super) fn inflate(&self) -> Result<Vec<u8>> {
        let algorithm = Algorithm::from_wire(self.compression).ok_or(UNSUPPORTED_HEADER)?;
        compression::inflate(self.payload, algorithm)
    }
}

pub(super) fn encode(
    bytes: &[u8],
    version: BodyVersion,
    checksum: u32,
    encoder: Encoder,
    catalog: u32,
) -> Result<String> {
    let header = write_header(version, encoder.algorithm(), catalog);
    let mut frame = Vec::with_capacity(header.len() + 16);
    put_varint(&mut frame, header.len() as u64);
    frame.extend_from_slice(&header);
    frame.extend_from_slice(&checksum.to_le_bytes());
    encoder.write_payload(bytes, &mut frame)?;
    if frame.len() > MAX_PAYLOAD {
        return Err("分享码过大".into());
    }
    Ok(format!("{PREFIX}.{}", URL_SAFE_NO_PAD.encode(frame)))
}

fn write_header(version: BodyVersion, algorithm: Algorithm, catalog: u32) -> Vec<u8> {
    let mut out = Vec::new();
    for (number, value) in [
        (FORMAT, version.format),
        (REVISION, version.revision),
        (COMPRESSION, algorithm as u32),
        (CATALOG, catalog),
    ] {
        put_varint(&mut out, number << 3 | VARINT);
        put_varint(&mut out, u64::from(value));
    }
    out
}

/// A repeated scalar keeps its last value. The first three fields must be present and nonzero.
/// The catalog version is optional, but nonzero when present.
fn read_header(mut bytes: &[u8]) -> Option<(BodyVersion, Option<u32>, u32)> {
    let (mut format, mut revision, mut compression) = (0, 0, 0);
    let mut catalog = None;
    while !bytes.is_empty() {
        let key = varint(&mut bytes)?;
        let number = key >> 3;
        if !(1..=MAX_FIELD_NUMBER).contains(&number) {
            return None;
        }
        let wire = key & 7;
        let field = match (number, wire) {
            (FORMAT, VARINT) => &mut format,
            (REVISION, VARINT) => &mut revision,
            (COMPRESSION, VARINT) => &mut compression,
            (CATALOG, VARINT) => {
                let version = u32::try_from(varint(&mut bytes)?).ok()?;
                if version == 0 {
                    return None;
                }
                catalog = Some(version);
                continue;
            }
            _ => {
                skip(&mut bytes, wire)?;
                continue;
            }
        };
        *field = u32::try_from(varint(&mut bytes)?).ok()?;
    }
    if format == 0 || revision == 0 || compression == 0 {
        return None;
    }
    Some((BodyVersion { format, revision }, catalog, compression))
}

/// Skip unknown fields of the supported proto3 wire types.
fn skip(bytes: &mut &[u8], wire: u64) -> Option<()> {
    let length = match wire {
        0 => return varint(bytes).map(|_| ()),
        1 => 8,
        2 => usize::try_from(varint(bytes)?).ok()?,
        5 => 4,
        _ => return None,
    };
    *bytes = bytes.get(length..)?;
    Some(())
}

/// Protobuf base-128 varint: ten bytes at most, and the last may only add one bit.
fn varint(bytes: &mut &[u8]) -> Option<u64> {
    let mut value = 0u64;
    for shift in (0..=63).step_by(7) {
        let (&byte, rest) = bytes.split_first()?;
        *bytes = rest;
        if shift == 63 && byte > 1 {
            return None;
        }
        value |= u64::from(byte & 127) << shift;
        if byte < 128 {
            return Some(value);
        }
    }
    None
}

pub(super) fn put_varint(out: &mut Vec<u8>, mut value: u64) {
    while value >= 128 {
        out.push(value as u8 & 127 | 128);
        value >>= 7;
    }
    out.push(value as u8);
}
