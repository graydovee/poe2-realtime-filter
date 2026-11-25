//! Compression streams and their shared CRC32 envelope.

use super::{INFLATED_TOO_LARGE, MAX_JSON};
use crate::engine::Result;
use brotli::{
    enc::BrotliEncoderParams, BrotliCompress, BrotliDecompressStream, BrotliResult, BrotliState,
    HeapAlloc,
};
#[cfg(test)]
use flate2::{write::DeflateEncoder, Compression as DeflateLevel};
use flate2::{Decompress, FlushDecompress, Status};
#[cfg(test)]
use std::io::Write;

const INVALID_COMPRESSED_DATA: &str = "分享码压缩数据损坏";

#[derive(Clone, Copy)]
#[repr(u32)]
pub(super) enum Algorithm {
    Raw = 1,
    Brotli = 2,
    Deflate = 3,
}

impl Algorithm {
    pub(super) fn from_wire(value: u32) -> Option<Self> {
        match value {
            1 => Some(Self::Raw),
            2 => Some(Self::Brotli),
            3 => Some(Self::Deflate),
            _ => None,
        }
    }
}

/// Encoder parameters are local policy. The algorithm alone is written on the wire.
#[derive(Clone, Copy)]
pub(super) enum Encoder {
    Raw,
    Brotli {
        quality: i32,
        lgwin: i32,
    },
    #[cfg(test)]
    Deflate(u32),
}

impl Encoder {
    pub(super) const fn brotli(quality: i32, lgwin: i32) -> Self {
        Self::Brotli { quality, lgwin }
    }

    pub(super) fn algorithm(self) -> Algorithm {
        match self {
            Self::Raw => Algorithm::Raw,
            Self::Brotli { .. } => Algorithm::Brotli,
            #[cfg(test)]
            Self::Deflate(_) => Algorithm::Deflate,
        }
    }

    pub(super) fn write_payload(self, bytes: &[u8], out: &mut Vec<u8>) -> Result<()> {
        match self {
            Self::Raw => {
                out.extend_from_slice(bytes);
                Ok(())
            }
            Self::Brotli { quality, lgwin } => {
                let params = BrotliEncoderParams {
                    quality,
                    lgwin,
                    size_hint: bytes.len(),
                    ..Default::default()
                };
                let mut input = bytes;
                BrotliCompress(&mut input, out, &params).map(|_| ())
            }
            #[cfg(test)]
            Self::Deflate(level) => {
                let mut encoder = DeflateEncoder::new(out, DeflateLevel::new(level));
                encoder
                    .write_all(bytes)
                    .and_then(|_| encoder.finish().map(|_| ()))
            }
        }
        .map_err(|error| format!("无法压缩分享码: {error}"))
    }
}

pub(super) fn inflate(payload: &[u8], algorithm: Algorithm) -> Result<Vec<u8>> {
    let (checksum, stream) = payload
        .split_first_chunk::<4>()
        .ok_or("分享码压缩数据不完整")?;
    let output = match algorithm {
        Algorithm::Raw => {
            if stream.len() > MAX_JSON {
                return Err(INFLATED_TOO_LARGE.into());
            }
            stream.to_vec()
        }
        Algorithm::Brotli => inflate_brotli(stream)?,
        Algorithm::Deflate => inflate_deflate(stream)?,
    };
    if crc32fast::hash(&output) != u32::from_le_bytes(*checksum) {
        return Err("分享码校验失败".into());
    }
    Ok(output)
}

fn inflate_brotli(stream: &[u8]) -> Result<Vec<u8>> {
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
        return Err(INFLATED_TOO_LARGE.into());
    }
    if !matches!(status, BrotliResult::ResultSuccess) || input_offset != stream.len() {
        return Err(INVALID_COMPRESSED_DATA.into());
    }
    output.truncate(output_offset);
    Ok(output)
}

fn inflate_deflate(stream: &[u8]) -> Result<Vec<u8>> {
    // Raw RFC 1951 DEFLATE, with no zlib or gzip wrapper.
    let mut decoder = Decompress::new(false);
    let mut output = vec![0; MAX_JSON + 1];
    let status = decoder.decompress(stream, &mut output, FlushDecompress::Finish);
    let output_size = decoder.total_out() as usize;
    if output_size > MAX_JSON {
        return Err(INFLATED_TOO_LARGE.into());
    }
    if !matches!(status, Ok(Status::StreamEnd)) || decoder.total_in() != stream.len() as u64 {
        return Err(INVALID_COMPRESSED_DATA.into());
    }
    output.truncate(output_size);
    Ok(output)
}
