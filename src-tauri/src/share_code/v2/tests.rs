use super::*;
use crate::share_code::{decode, encode, INVALID_HEADER, MAX_HEADER, UNSUPPORTED_VERSION};
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use serde_json::json;

const INVALID_COMPRESSED_DATA: &str = "分享码压缩数据损坏";

// Independent frame vectors with body b"123456789" (CRC32 0xcbf43926).
// The compressed streams were produced with Node zlib.
const RAW_VECTOR: &str = "POE2F2.CAgCEAEYASABJjn0yzEyMzQ1Njc4OQ";
const PACKED_BROTLI_VECTOR: &str = "POE2F2.CAgCEAEYAiABJjn0ywsEgDEyMzQ1Njc4OQM";
const DEFLATE_VECTOR: &str = "POE2F2.CAgCEAEYAyABJjn0yzM0MjYxNTO3sAQA";
const RAW_HEADER: &[u8] = &[0x08, 2, 0x10, 1, 0x18, 1];
// The catalog version, written after the three required fields.
const CATALOG_FIELD: &[u8] = &[0x20, 1];
const VECTOR_BODY: &[u8] = b"123456789";
const BODY_VERSION: BodyVersion = BodyVersion {
    format: 2,
    revision: 1,
};

fn plain() -> Share {
    Share {
        name: "打宝".into(),
        description: String::new(),
        profile: json!({"schemaVersion":2,"league":"Standard","rules":[],"skippedItemIds":["scroll-of-wisdom"]}),
    }
}

fn with_server() -> Share {
    Share {
        name: "打宝".into(),
        description: String::new(),
        profile: json!({"schemaVersion":2,"league":"Standard","server":"tencent",
            "rules":[{"id":"default-exalted","name":"崇高石价格档","enabled":true,"hidden":false,
                "followBaseline":true,"effects":{},"target":{"itemIds":["exalted-orb","chaos-orb"],
                "range":{"max":{"amount":1,"currency":"chaos"},"min":{"amount":1,"currency":"exalted"}}}}],
            "skippedItemIds":["scroll-of-wisdom"]}),
    }
}

fn with_drop_conditions() -> Share {
    Share {
        name: "通货数量档".into(),
        description: String::new(),
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
        description: String::new(),
        profile: json!({"schemaVersion": 3, "server": "international", "league": "Standard",
            "originalLeague": "Original", "strictness": 2, "style": "default", "locale": "cn",
            "rules": [{"id":"local-test-id", "name":"Shared fixture, shared fixture, shared fixture",
                "enabled":true, "hidden":false,
                "target":{"itemIds":["exalted-orb"],"dropConditions":{"stackSize":{"enabled":true,"bounds":[{"op":">=","value":5}]}}},
                "effects":{"beam":"Blue Temp","sound":{"type":"builtin","id":2,"volume":150}}},
                {"id":"local-test-id-2","name":"Shared fixture, shared fixture, shared fixture","enabled":true,"hidden":false,
                 "target":{"itemIds":["exalted-orb"]},"baselineEffectItemId":"chaos-orb"}],
            "skippedItemIds":["scroll-of-wisdom"]}),
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
            1,
        )
    };
    assert_eq!(encode(Encoder::Raw).unwrap(), RAW_VECTOR);
    for (tag, candidate) in [(2, Encoder::brotli(6, 16)), (3, Encoder::Deflate(6))] {
        let code = encode(candidate).unwrap();
        let wire = URL_SAFE_NO_PAD
            .decode(code.split_once('.').unwrap().1)
            .unwrap();
        assert_eq!(
            &wire[..13],
            &[8, 8, 2, 16, 1, 24, tag, 32, 1, 0x26, 0x39, 0xf4, 0xcb]
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
            .map(|&candidate| frame::encode(body, BODY_VERSION, checksum, candidate, 1).unwrap())
            .min_by_key(String::len)
            .unwrap();
        let code = encode_shortest(body, BODY_VERSION, 1).unwrap();
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
            &[0x28, 0x05][..],
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
        &[0x20, 0x00],                         // catalog version zero
        &[0x20, 0x80, 0x80, 0x80, 0x80, 0x10], // catalog version wider than u32
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
        [8, 2, 16, 4, 24, 1], // Unknown revision of the positional body.
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
        // The checksum follows the length byte and the header.
        let checksum = 1 + wire[0] as usize;
        let mut changed_crc = wire.clone();
        changed_crc[checksum] ^= 1;
        assert_eq!(
            decode(&frame_code(&changed_crc)).unwrap_err(),
            "分享码校验失败"
        );
        // A truncated checksum is reported before it is compared.
        assert_eq!(
            decode(&frame_code(&wire[..checksum + 3])).unwrap_err(),
            "分享码压缩数据不完整"
        );
        for invalid in [
            wire[..wire.len() - 1].to_vec(),
            [&wire[..], &[0]].concat(),
            [&wire[..], &wire[checksum + 4..]].concat(),
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
            |body| frame::encode(body, BODY_VERSION, crc32fast::hash(body), candidate, 1).unwrap();
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

// Fixed vectors of complete share codes.
const RAW_SHARE: &str = "POE2F2.CAgCEAEYASABkPBTBBMG5omT5a6dDAIIU3RhbmRhcmQAFIYCCwEF";
const BROTLI_SHARE: &str = "POE2F2.CAgCEAEYAiABFIqnc6IbAJyRWqw1tsYsuHl3X1sTXMhj0thAgaYYUgGik9OD8ueH8znHsHkUQ-AhCyZEWXm1ycd8XvC8G-_9WNt0U_2wYDekgHmnAPUtKxHQSIMbhuz5pT0WppeF77AeymnLprVC8iimG5jpAg";
const DEFLATE_SHARE: &str = "POE2F2.CAgCEAEYAyABFIqnc5XMzQmDQBAG0Pl2WNjFqwVsAfnpIQ3kYBqYZDe6YDSMCqnAFlKWFQl2IHh8l7fgUjWiKYZ3_o2TplMYdr0Su2qULopGd9dc505aQ2TqgxHIgQEm6_2tnVJ4pM-X2PxxPTz5VyP9cO71SeVsCthy5gKwGw";

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
        assert_eq!(encode_shortest(&bytes, BODY_VERSION, 1).unwrap(), fixture);
    }
}

#[test]
fn export_layout_is_registered_for_import() {
    let code = encode(&plain()).unwrap();
    assert_eq!(decode(&code).unwrap().share, plain());
}

#[test]
fn packed_header_carries_the_catalog_version() {
    let read = |header: &[u8]| {
        let code = raw_frame(header, VECTOR_BODY);
        let wire = decode_base64(code.strip_prefix("POE2F2.").unwrap(), MAX_PAYLOAD)?;
        frame::Frame::read(&wire).map(|frame| frame.catalog)
    };
    // Codes from before the field existed carry the first catalog.
    assert_eq!(read(RAW_HEADER).unwrap(), None);
    assert_eq!(read(&[CATALOG_FIELD, RAW_HEADER].concat()).unwrap(), Some(1));
    // A repeated scalar keeps its last value. Another wire type is skipped.
    assert_eq!(
        read(&[&[0x20, 0x02][..], RAW_HEADER, CATALOG_FIELD].concat()).unwrap(),
        Some(1)
    );
    assert_eq!(
        read(&[RAW_HEADER, &[0x22, 0x01, 0x01][..]].concat()).unwrap(),
        None
    );

    // The exported code carries the current catalog version.
    let code = encode(&plain()).unwrap();
    let wire = decode_base64(code.strip_prefix("POE2F2.").unwrap(), MAX_PAYLOAD).unwrap();
    let frame = frame::Frame::read(&wire).unwrap();
    assert_eq!(frame.catalog, Some(positional::catalog_version().unwrap()));
    positional::check_catalog_version(frame.catalog).unwrap();

    // A code from another catalog is rejected before its body is read.
    let newer = [RAW_HEADER, &[0x20, 0x02][..]].concat();
    assert_eq!(
        decode(&raw_frame(&newer, VECTOR_BODY)).unwrap_err(),
        "分享码来自第 2 版物品目录，当前客户端使用第 1 版，请升级客户端"
    );
}


// Fixed vectors of complete revision 2 share codes. Schemes without edits of base filter rules
// are still written this way.
const DESCRIBED_VERSION: BodyVersion = BodyVersion {
    format: 2,
    revision: 2,
};
const EDITED_VERSION: BodyVersion = BodyVersion {
    format: 2,
    revision: 3,
};
const DESCRIBED_RAW_SHARE: &str = "POE2F2.CAgCEAIYASAB8LY_mzgG5omT5a6dJOW8gOiNkuWIsOe7iOWxgO-8jOiHquWKqOi3n-maj-eJqeS7twwCCFN0YW5kYXJkABSGAgsBBQ";
const DESCRIBED_BROTLI_SHARE: &str = "POE2F2.CAgCEAIYAiAB8LY_m-ADEDgG5omT5a6dJOW8gOiNkuWIsOe7iOWxgO-8jOiHquWKqOi3n-maj-eJqeS7twwCCFN0YW5kYXJkABSGAgsBBQM";
const DESCRIBED_DEFLATE_SHARE: &str = "POE2F2.CAgCEAIYAyAB8LY_mwE_AMD_OAbmiZPlrp0k5byA6I2S5Yiw57uI5bGA77yM6Ieq5Yqo6Lef6ZqP54mp5Lu3DAIIU3RhbmRhcmQAFIYCCwEF";
const DESCRIBED_FIXTURE_BROTLI_SHARE: &str = "POE2F2.CAgCEAIYAiABOjFxhYIhAI-RWqw1tsYRksxacPPuvrYmuJDHpLGBAg2MKkB0cnpQ_vxwjiPMMGwexVBUAIcctFBbKmeIoPiZr8Hzbrz3Y23TTZWRHyyYIwWUTgHq60oENNLghiGGh3ssTC8L32E9lNOWTWuF5FFMF2a6";

fn described(share: &Share, description: &str) -> Share {
    let mut share = share.clone();
    share.description = description.into();
    share
}

#[test]
fn described_revision_vectors_keep_wire_and_decoded_shares() {
    let plain = described(&plain(), "开荒到终局，自动跟随物价");
    let source = described(
        &code_fixture(),
        "Shared fixture, shared fixture, shared fixture",
    );
    let mut expected = source.clone();
    for rule in expected.profile["rules"].as_array_mut().unwrap() {
        rule.as_object_mut().unwrap().remove("id");
    }
    assert_eq!(decode(DESCRIBED_RAW_SHARE).unwrap().share, plain);
    assert_eq!(decode(DESCRIBED_BROTLI_SHARE).unwrap().share, plain);
    assert_eq!(decode(DESCRIBED_DEFLATE_SHARE).unwrap().share, plain);
    assert_eq!(
        decode(DESCRIBED_FIXTURE_BROTLI_SHARE).unwrap().share,
        expected
    );
    for (share, fixture) in [
        (&plain, DESCRIBED_RAW_SHARE),
        (&source, DESCRIBED_FIXTURE_BROTLI_SHARE),
    ] {
        let bytes = (positional::DESCRIBED_CODEC.pack)(share).unwrap();
        assert_eq!(
            encode_shortest(&bytes, DESCRIBED_VERSION, 1).unwrap(),
            fixture
        );
        assert_eq!(encode(share).unwrap(), fixture);
    }
}

fn edited() -> Share {
    let mut source = described(&plain(), "带修改");
    source.profile["overlays"] = json!([{
        "id": "local-edit", "baseName": "base.filter", "conditions": ["BaseType == \"Gold\"", "StackSize >= 5"],
        "conditionLines": ["BaseType == \"Gold\"", "AreaLevel >= 66"], "hidden": true, "enabled": true,
        "effects": {"beam": "None", "font": {"fontSize": 40}, "sound": {"type": "custom", "fileName": "mine.mp3"}}
    }]);
    source
}

// Fixed vector of a complete revision 3 share code.
const EDITED_BROTLI_SHARE: &str = "POE2F2.CAgCEAMYAiAB8GlDq-IRAITjwI4t3JyvDXHR1M0fqzUEos37PPBJYwl0iaRhHEppUyMSIHqyPeSq2STNZoJIlbSqNW5jY7kVn0MiKL8guxhuvLf0f09yhIrEeFABCHPFR3ylIbsCZVumae-QYJ2v3dhFnFk6q43yGJr6AR8QaqRelwF6GIotlnveEvdECqQ";

#[test]
fn edits_travel_as_revision_3_and_schemes_without_them_stay_on_revision_2() {
    let source = edited();
    let mut expected = source.clone();
    expected.profile["overlays"][0]
        .as_object_mut()
        .unwrap()
        .remove("id");
    expected.profile["editsEnabled"] = json!(true);
    let code = encode(&source).unwrap();
    assert_eq!(code, EDITED_BROTLI_SHARE);
    let wire = decode_base64(code.split_once('.').unwrap().1, MAX_PAYLOAD).unwrap();
    assert_eq!(frame::Frame::read(&wire).unwrap().version, EDITED_VERSION);
    let decoded = decode(&code).unwrap();
    assert_eq!(decoded.share, expected);
    let bytes = (positional::EDITED_CODEC.pack)(&source).unwrap();
    assert_eq!(packed_body(&code).unwrap(), (EDITED_VERSION, bytes.clone()));
    assert_eq!(
        code,
        encode_shortest(
            &bytes,
            EDITED_VERSION,
            positional::catalog_version().unwrap()
        )
        .unwrap()
    );
    // Edits are numbered on import, together with the rules.
    let imported = decoded.into_import().unwrap();
    let edits = imported.profile["overlays"].as_array().unwrap();
    assert_eq!(edits[0]["id"].as_str().unwrap().len(), 8);
    assert_eq!(
        edits[0]["conditions"],
        source.profile["overlays"][0]["conditions"]
    );
    // Revision 2 and 1 layouts stop after the rules and refuse the edit count.
    assert!((positional::DESCRIBED_CODEC.unpack)(&bytes).is_err());
    assert!((positional::CODEC.unpack)(&bytes).is_err());
    // A scheme without edits is still written the way clients before the edits read it.
    let bare = described(&plain(), "带修改");
    assert_eq!(
        packed_body(&encode(&bare).unwrap()).unwrap().0,
        DESCRIBED_VERSION
    );
    let mut cleared = source;
    cleared.profile["overlays"] = json!([]);
    assert_eq!(
        packed_body(&encode(&cleared).unwrap()).unwrap().0,
        DESCRIBED_VERSION
    );
    // A switched-off scheme carries the switch even without edits, so it needs revision 3.
    let mut switched_off = described(&plain(), "带修改");
    switched_off.profile["overlays"] = json!([]);
    switched_off.profile["editsEnabled"] = json!(false);
    assert_eq!(
        packed_body(&encode(&switched_off).unwrap()).unwrap().0,
        EDITED_VERSION
    );
    assert_eq!(
        decode(&encode(&switched_off).unwrap()).unwrap().share,
        switched_off
    );
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
    positional::section_sizes(&pack_body(share)?.1)
}

/// Full share-code length and per-candidate encoding time for the same packed body.
/// Packing and the shared CRC calculation happen once, outside the timed region.
#[cfg(test)]
pub(crate) fn measure_compression_candidates(
    share: &Share,
) -> Result<Vec<(&'static str, usize, std::time::Duration)>> {
    let (version, bytes) = pack_body(share)?;
    let checksum = crc32fast::hash(&bytes);
    BENCHMARK_CANDIDATES
        .iter()
        .map(|&(name, candidate)| {
            let start = std::time::Instant::now();
            let code = frame::encode(
                &bytes,
                version,
                checksum,
                candidate,
                positional::catalog_version()?,
            )?;
            Ok((name, code.len(), start.elapsed()))
        })
        .collect()
}
