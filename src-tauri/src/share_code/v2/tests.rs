use super::*;
use crate::share_code::{decode, encode, INVALID_HEADER, MAX_HEADER, UNSUPPORTED_VERSION};
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use serde_json::json;

const INVALID_COMPRESSED_DATA: &str = "分享码压缩数据损坏";

const DRAFT_VECTOR: &str = "POE2F2.BAgBEAFG79hlhwaADADmiZPlrp0wLAAgAUwD";

// Independent frame vectors with body b"123456789" (CRC32 0xcbf43926).
// The compressed streams were produced with Node zlib.
const RAW_VECTOR: &str = "POE2F2.BggCEAEYASY59MsxMjM0NTY3ODk";
const PACKED_BROTLI_VECTOR: &str = "POE2F2.BggCEAEYAiY59MsLBIAxMjM0NTY3ODkD";
const DEFLATE_VECTOR: &str = "POE2F2.BggCEAEYAyY59MszNDI2MTUzt7AEAA";
const RAW_HEADER: &[u8] = &[0x08, 2, 0x10, 1, 0x18, 1];
const VECTOR_BODY: &[u8] = b"123456789";
const BODY_VERSION: BodyVersion = BodyVersion {
    format: 2,
    revision: 1,
};

fn plain() -> Share {
    Share {
        name: "打宝".into(),
        profile: json!({"schemaVersion":2,"league":"Standard","rules":[],"skippedItemIds":["albino-rhoa-feather"]}),
    }
}

fn with_server() -> Share {
    Share {
        name: "打宝".into(),
        profile: json!({"schemaVersion":2,"league":"Standard","server":"tencent",
            "rules":[{"id":"default-exalted","name":"崇高石价格档","enabled":true,"hidden":false,
                "followBaseline":true,"effects":{},"target":{"itemIds":["exalted-orb","chaos-orb"],
                "range":{"max":{"amount":1,"currency":"chaos"},"min":{"amount":1,"currency":"exalted"}}}}],
            "skippedItemIds":["albino-rhoa-feather"]}),
    }
}

fn with_drop_conditions() -> Share {
    Share {
        name: "通货数量档".into(),
        profile: json!({"schemaVersion":3,"server":"international","league":"Standard",
            "rules":[{"effects":{"beam":"Blue Temp","font":{"fontSize":42,"textColor":"0 0 0 255"},
                "icon":"1 Blue Circle","sound":{"id":9,"type":"builtin","volume":300}},
                "enabled":true,"hidden":true,"id":"stack","name":"堆叠",
                "target":{"dropConditions":{"rarity":{"enabled":false,"value":"Rare"},
                    "stackSize":{"bounds":[{"op":">=","value":5}],"enabled":true}},
                    "itemIds":["exalted-orb","base:iron-greaves"]}}],
            "skippedItemIds":[]}),
    }
}

fn code_fixture() -> Share {
    Share {
        name: "Shared fixture, shared fixture, shared fixture".into(),
        profile: json!({"schemaVersion": 3, "server": "international", "league": "Standard",
            "originalLeague": "Original", "strictness": 2, "style": "default", "locale": "cn",
            "rules": [{"id":"local-test-id", "name":"Shared fixture, shared fixture, shared fixture",
                "enabled":true, "hidden":false,
                "target":{"itemIds":["exalted-orb"],"dropConditions":{"stackSize":{"enabled":true,"bounds":[{"op":">=","value":5}]}}},
                "effects":{"beam":"Blue Temp","sound":{"type":"builtin","id":2,"volume":150}}},
                {"id":"local-test-id-2","name":"Shared fixture, shared fixture, shared fixture","enabled":true,"hidden":false,
                 "target":{"itemIds":["exalted-orb"]},"baselineEffectItemId":"chaos-orb"}],
            "skippedItemIds":["albino-rhoa-feather"]}),
    }
}

fn raw_frame(header: &[u8], body: &[u8]) -> String {
    let mut frame = Vec::new();
    frame::put_varint(&mut frame, header.len() as u64);
    frame.extend_from_slice(header);
    frame.extend_from_slice(&crc32fast::hash(body).to_le_bytes());
    frame.extend_from_slice(body);
    frame_code(&frame)
}

fn frame_code(frame: &[u8]) -> String {
    format!("{PREFIX}.{}", URL_SAFE_NO_PAD.encode(frame))
}

#[test]
fn official_frame_wire_vectors() {
    for code in [RAW_VECTOR, PACKED_BROTLI_VECTOR, DEFLATE_VECTOR] {
        assert_eq!(
            packed_body(code).unwrap(),
            (BODY_VERSION, VECTOR_BODY.to_vec())
        );
    }
    let encode = |candidate| {
        frame::encode(
            VECTOR_BODY,
            BODY_VERSION,
            crc32fast::hash(VECTOR_BODY),
            candidate,
        )
    };
    assert_eq!(encode(Encoder::Raw).unwrap(), RAW_VECTOR);
    for (tag, candidate) in [(2, Encoder::brotli(6, 16)), (3, Encoder::Deflate(6))] {
        let code = encode(candidate).unwrap();
        let wire = URL_SAFE_NO_PAD
            .decode(code.split_once('.').unwrap().1)
            .unwrap();
        assert_eq!(
            &wire[..11],
            &[6, 8, 2, 16, 1, 24, tag, 0x26, 0x39, 0xf4, 0xcb]
        );
        assert_eq!(
            packed_body(&code).unwrap(),
            (BODY_VERSION, VECTOR_BODY.to_vec())
        );
    }
}

#[test]
fn production_picks_shortest_complete_code() {
    let compressible = b"a sample payload with repeated wording".repeat(40);
    for body in [b"x".as_slice(), compressible.as_slice()] {
        let checksum = crc32fast::hash(body);
        let expected = ENCODERS
            .iter()
            .map(|&candidate| frame::encode(body, BODY_VERSION, checksum, candidate).unwrap())
            .min_by_key(String::len)
            .unwrap();
        let code = encode_shortest(body, BODY_VERSION).unwrap();
        assert_eq!(code, expected);
        assert_eq!(packed_body(&code).unwrap(), (BODY_VERSION, body.to_vec()));
    }
}

#[test]
#[ignore = "measure encoding time and full share-code length"]
fn compression_on_ordinary_profiles() {
    for (label, share) in [
        ("plain", plain()),
        ("price rule", with_server()),
        ("custom effects and conditions", with_drop_conditions()),
    ] {
        println!("{label}");
        for (candidate, chars, elapsed) in measure_compression_candidates(&share).unwrap() {
            println!(
                "{candidate:>20}  {chars:>5} chars  {:>8.3} ms",
                elapsed.as_secs_f64() * 1000.0
            );
        }
    }
}

#[test]
fn packed_header_skips_unknown_optional_fields() {
    let headers = [
        // Unknown varint, length-delimited, fixed64 and fixed32 fields in any order.
        [
            &[0x20, 0x05][..],
            RAW_HEADER,
            &[0x2a, 3, b'a', b'b', b'c'],
            &[0x31, 0, 0, 0, 0, 0, 0, 0, 0],
            &[0x3d, 0, 0, 0, 0],
        ]
        .concat(),
        // A repeated scalar uses its last value.
        [&[0x18, 3, 0x08, 2, 0x10, 7][..], RAW_HEADER].concat(),
        // A known number with another wire type is also skipped.
        [&[0x1a, 1, 3][..], RAW_HEADER].concat(),
        // The largest valid protobuf field number can be skipped.
        [RAW_HEADER, &[0xf8, 0xff, 0xff, 0xff, 0x0f, 0]].concat(),
    ];
    for header in headers {
        assert_eq!(
            packed_body(&raw_frame(&header, VECTOR_BODY)).unwrap(),
            (BODY_VERSION, VECTOR_BODY.to_vec())
        );
    }
}

#[test]
fn packed_header_requires_all_three_fields() {
    for header in [
        &[][..],
        &[0x10, 1, 0x18, 1],
        &[0x08, 1, 0x18, 1],
        &[0x08, 1, 0x10, 1],
        &[0x08, 0, 0x10, 1, 0x18, 1],
        &[0x08, 1, 0x10, 0, 0x18, 1],
        &[0x08, 1, 0x10, 1, 0x18, 0],
        &[0x08, 1, 0x10, 1, 0x1a, 1, 1],
    ] {
        assert_eq!(
            decode(&raw_frame(header, VECTOR_BODY)).unwrap_err(),
            INVALID_HEADER,
            "{header:?}"
        );
    }
    assert_eq!(decode(DRAFT_VECTOR).unwrap_err(), INVALID_HEADER);
}

#[test]
fn packed_header_rejects_malformed_fields_and_lengths() {
    for suffix in [
        &[0x00][..],                           // field number zero
        &[0x80, 0x80, 0x80, 0x80, 0x10, 0],    // field number wider than 29 bits
        &[0x23],                               // group start
        &[0x24],                               // group end
        &[0x26],                               // invalid wire type
        &[0x20],                               // truncated optional varint
        &[0x21, 0, 0, 0],                      // truncated fixed64
        &[0x22, 5, b'a'],                      // truncated length-delimited field
        &[0x25, 0, 0, 0],                      // truncated fixed32
        &[0x18, 0x80],                         // truncated compression varint
        &[0x18, 0x80, 0x80, 0x80, 0x80, 0x10], // compression wider than u32
        &[
            0x20, 0x80, 0x80, 0x80, 0x80, 0x80, 0x80, 0x80, 0x80, 0x80, 0x02,
        ], // exceeds u64
    ] {
        let header = [RAW_HEADER, suffix].concat();
        assert_eq!(
            decode(&raw_frame(&header, VECTOR_BODY)).unwrap_err(),
            INVALID_HEADER,
            "{suffix:?}"
        );
    }
    for prefix in [
        &[][..],
        &[0x80],
        &[0x80; 10],
        &[7, 0x08, 1, 0x10, 1, 0x18, 1], // header length exceeds the frame
    ] {
        assert_eq!(
            decode(&frame_code(prefix)).unwrap_err(),
            INVALID_HEADER,
            "{prefix:?}"
        );
    }

    // An otherwise valid optional field can fill the header to exactly 128 bytes.
    let mut header = [RAW_HEADER, &[0x22, 120], &[0; 120]].concat();
    assert_eq!(header.len(), MAX_HEADER);
    assert_eq!(
        packed_body(&raw_frame(&header, VECTOR_BODY)).unwrap(),
        (BODY_VERSION, VECTOR_BODY.to_vec())
    );
    header[7] += 1;
    header.push(0);
    assert_eq!(
        decode(&raw_frame(&header, VECTOR_BODY)).unwrap_err(),
        INVALID_HEADER
    );
}

#[test]
fn packed_header_rejects_unsupported_format_revision_or_compression() {
    for header in [
        [8, 3, 16, 1, 24, 1], // Unknown format.
        [8, 1, 16, 3, 24, 1], // Unpublished JSON body.
        [8, 2, 16, 2, 24, 1], // Unknown revision of the positional body.
        [8, 2, 16, 1, 24, 4], // Unknown compression.
    ] {
        // Unsupported values are rejected before CRC and before consulting the body.
        let wire = [&[6][..], &header].concat();
        assert_eq!(decode(&frame_code(&wire)).unwrap_err(), UNSUPPORTED_HEADER);
    }
}

#[test]
fn packed_payload_checks_crc_and_exact_stream_end() {
    for (code, bad_stream) in [
        (RAW_VECTOR, "分享码校验失败"),
        (PACKED_BROTLI_VECTOR, INVALID_COMPRESSED_DATA),
        (DEFLATE_VECTOR, INVALID_COMPRESSED_DATA),
    ] {
        let wire = URL_SAFE_NO_PAD
            .decode(code.split_once('.').unwrap().1)
            .unwrap();
        let mut changed_crc = wire.clone();
        changed_crc[7] ^= 1;
        assert_eq!(
            decode(&frame_code(&changed_crc)).unwrap_err(),
            "分享码校验失败"
        );
        assert_eq!(
            decode(&frame_code(&wire[..10])).unwrap_err(),
            "分享码压缩数据不完整"
        );
        for invalid in [
            wire[..wire.len() - 1].to_vec(),
            [&wire[..], &[0]].concat(),
            [&wire[..], &wire[11..]].concat(),
        ] {
            assert_eq!(
                decode(&frame_code(&invalid)).unwrap_err(),
                bad_stream,
                "{code}"
            );
        }
    }
}

#[test]
fn limits_encoded_and_inflated_bytes() {
    assert_eq!(
        decode_base64(&URL_SAFE_NO_PAD.encode(vec![0; MAX_PAYLOAD]), MAX_PAYLOAD)
            .unwrap()
            .len(),
        MAX_PAYLOAD
    );
    let oversized_frame = frame_code(&vec![0; MAX_PAYLOAD + 1]);
    assert_eq!(decode(&oversized_frame).unwrap_err(), "分享码过大");

    let oversized = vec![b'a'; MAX_JSON + 1];
    let maximum = &oversized[..MAX_JSON];
    for candidate in [Encoder::Raw, Encoder::brotli(4, 16), Encoder::Deflate(6)] {
        let frame =
            |body| frame::encode(body, BODY_VERSION, crc32fast::hash(body), candidate).unwrap();
        assert_eq!(packed_body(&frame(maximum)).unwrap().1, maximum);
        assert_eq!(decode(&frame(&oversized)).unwrap_err(), INFLATED_TOO_LARGE);
    }
}

#[test]
fn packed_frame_requires_unpadded_base64url_and_supported_version() {
    for code in [
        format!("{RAW_VECTOR}="),
        format!("{RAW_VECTOR}.A"),
        "POE2F2.A A".into(),
        "POE2F2.+/".into(),
    ] {
        assert_eq!(decode(&code).unwrap_err(), "分享码不是有效的 Base64URL");
    }
    assert_eq!(decode("POE2F3.A").unwrap_err(), UNSUPPORTED_VERSION);
    assert_eq!(decode("POE2F.A").unwrap_err(), UNSUPPORTED_VERSION);
    assert_eq!(decode("POE2F2").unwrap_err(), UNSUPPORTED_VERSION);
    assert_eq!(
        decode("POE2F2.$$$").unwrap_err(),
        "分享码不是有效的 Base64URL"
    );
}

#[test]
fn limits_expanded_share_json_bytes() {
    let mut share = plain();
    share.name.clear();
    let overhead = serde_json::to_vec(&share).unwrap().len();
    share.name = "a".repeat(MAX_JSON - overhead - 2);
    share.name.push('é');
    check_json_size(&share, INFLATED_TOO_LARGE).unwrap();
    share.name.push('a');
    assert_eq!(
        check_json_size(&share, INFLATED_TOO_LARGE).unwrap_err(),
        INFLATED_TOO_LARGE
    );
    assert_eq!(encode(&share).unwrap_err(), SHARE_TOO_LARGE);
}

fn packed_body(code: &str) -> Result<(BodyVersion, Vec<u8>)> {
    let wire = decode_base64(code.strip_prefix("POE2F2.").unwrap(), MAX_PAYLOAD)?;
    let frame = frame::Frame::read(&wire)?;
    body_codec(frame.version)?;
    Ok((frame.version, frame.inflate()?))
}

// Captured from the format 2/revision 1 implementation before the protocol split.
const RAW_SHARE: &str = "POE2F2.BggCEAEYARN3c2gTBuaJk-WunQwCCFN0YW5kYXJkABCBAgQB";
const BROTLI_SHARE: &str = "POE2F2.BggCEAEYAjjSmleCGwCYkVqsNbbGLDh3_78swUKOpGid0BSHtABxygF784CiIMfw89MZDh6yYEKTlVcbfZTvC553470fa5tuyg8xhkM0oDcZ4L5mJRgkRALVNOHjTHsshF8qfJv1UE5bNq0VgocVSmKbDBU";
const DEFLATE_SHARE: &str = "POE2F2.BggCEAEYAzjSmleVzMsJhDAQANCZyQoJe9nDFpAC9tODDXjQBkYTNeCPUcGrVViWFQl2IHh8l7fjL61ZvLNlWKZZ_MeOlz5A6XTizrE4nUioQscNAVB1M0LQqBAVRMbEzext5tsBFG34vz2ZouZ-_PaSw2ulB75XeqKOTg";

#[test]
fn full_share_vectors_keep_wire_and_decoded_profiles() {
    let plain = plain();
    let source = code_fixture();
    let mut expected = source.clone();
    for rule in expected.profile["rules"].as_array_mut().unwrap() {
        rule.as_object_mut().unwrap().remove("id");
    }
    assert_eq!(decode(RAW_SHARE).unwrap().share, plain);
    assert_eq!(decode(BROTLI_SHARE).unwrap().share, expected);
    assert_eq!(decode(DEFLATE_SHARE).unwrap().share, expected);
    for (share, fixture) in [(&plain, RAW_SHARE), (&source, BROTLI_SHARE)] {
        let bytes = (positional::CODEC.pack)(share).unwrap();
        assert_eq!(encode_shortest(&bytes, BODY_VERSION).unwrap(), fixture);
    }
}

#[test]
fn export_layout_is_registered_for_import() {
    let code = encode(&plain()).unwrap();
    assert_eq!(decode(&code).unwrap().share, plain());
}

#[cfg(test)]
const BENCHMARK_CANDIDATES: &[(&str, Encoder)] = &[
    ("raw", Encoder::Raw),
    ("brotli q1 w12", Encoder::brotli(1, 12)),
    ("brotli q1 w20", Encoder::brotli(1, 20)),
    ("brotli q4 w12", Encoder::brotli(4, 12)),
    ("brotli q4 w16", Encoder::brotli(4, 16)),
    ("brotli q4 w20", Encoder::brotli(4, 20)),
    ("brotli q6 w12", Encoder::brotli(6, 12)),
    ("brotli q6 w16", Encoder::brotli(6, 16)),
    ("brotli q6 w20", Encoder::brotli(6, 20)),
    ("brotli q9 w12", Encoder::brotli(9, 12)),
    ("brotli q9 w16", Encoder::brotli(9, 16)),
    ("brotli q9 w20", Encoder::brotli(9, 20)),
    ("brotli q10 w12", Encoder::brotli(10, 12)),
    ("brotli q10 w20", Encoder::brotli(10, 20)),
    ("brotli q11 w10", Encoder::brotli(11, 10)),
    ("brotli q11 w12", Encoder::brotli(11, 12)),
    ("brotli q11 w16", Encoder::brotli(11, 16)),
    ("brotli q11 w20", Encoder::brotli(11, 20)),
    ("brotli q11 w22", Encoder::brotli(11, 22)),
    ("brotli q11 w24", Encoder::brotli(11, 24)),
    ("deflate level 1", Encoder::Deflate(1)),
    ("deflate level 3", Encoder::Deflate(3)),
    ("deflate level 6", Encoder::Deflate(6)),
    ("deflate level 9", Encoder::Deflate(9)),
];

#[cfg(test)]
pub(crate) fn measure_body_sections(share: &Share) -> Result<(usize, usize)> {
    positional::section_sizes(&pack_body(share)?)
}

/// Full share-code length and per-candidate encoding time for the same packed body.
/// Packing and the shared CRC calculation happen once, outside the timed region.
#[cfg(test)]
pub(crate) fn measure_compression_candidates(
    share: &Share,
) -> Result<Vec<(&'static str, usize, std::time::Duration)>> {
    let bytes = pack_body(share)?;
    let checksum = crc32fast::hash(&bytes);
    BENCHMARK_CANDIDATES
        .iter()
        .map(|&(name, candidate)| {
            let start = std::time::Instant::now();
            let code = frame::encode(&bytes, EXPORT_BODY.version, checksum, candidate)?;
            Ok((name, code.len(), start.elapsed()))
        })
        .collect()
}
