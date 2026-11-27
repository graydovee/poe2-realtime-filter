use super::*;
use crate::share_code::decode;
use serde_json::json;

const BROTLI_PREFIX: &str = "POE2F1.eyJhbGciOiJiciIsInAiOjF9.";
const JSON_VECTOR: &str = "POE2F1.eyJuYW1lIjoi5omT5a6dIiwicHJvZmlsZSI6eyJzY2hlbWFWZXJzaW9uIjoyLCJsZWFndWUiOiJTdGFuZGFyZCIsInJ1bGVzIjpbXSwic2tpcHBlZEl0ZW1JZHMiOlsiYWxiaW5vLXJob2EtZmVhdGhlciJdfX0";
// Produced independently with Node zlib, including CRC32 framing.
const BROTLI_VECTOR: &str = "POE2F1.eyJhbGciOiJiciIsInAiOjF9.8d8ILRt2AGAchXGzE562KCuun6YtDsEGHBAH2WATDzpE3lK__kVpH7IJb_9GgJmmdVi6-urkwOkgv35BC0vCADTwkJUo2IMqwGJgsBpuPkIrfOIA3kYKlAD3QShIFnKJYNwTrs-pLr6QOtaW27dJCytSJPsB";
const POE2_VECTOR: &str = "POE2F1.eyJhbGciOiJwb2UyIiwicCI6MX0.tG4EFQsXgCoAAABbIuaJk-WunSIsWzM4NywyLCJTdGFuZGFyZCIsW10sWzAsMSwwLDFdXV0kAw";

const SERVER_BROTLI_VECTOR: &str = "POE2F1.eyJhbGciOiJiciIsInAiOjJ9.H7qOQBeHASCcBXZbcmi394SBaSetjKh25Av2bxrhTcRBnhRyedgZCrE2U_9OKWuWiMJOw2CnhIVY1josXX3XWyhFDGZ8s3m5B5tPMBGJ1qVMoXMrjmxQRQ6HZoHiCYG-4cZJdhvCdIHvQplYHhgRnw2ZwRTBXACgXnrcOhxYd5Ek2SwDGEn8G7PcCJP8T0tyvG7tLf8tvlQEGdQMDNJ-Su5OxtQ8y7yEz2isj36ItJ2okMTQSryLiisApP-UpVocnR0dAu5QHsOjSK0cr1vDq-XfV6TsmSq3a03fQj8";
const SERVER_POE2_VECTOR: &str = "POE2F1.eyJhbGciOiJwb2UyIiwicCI6Mn0.XczV-xejABAsC2w3HyjgzUZptjkKXmKhFyU3uCJPLbZl2Je3zYdyGwimcnnCNgUx5U8LgnTzsDM0y8bKm6ULZ2bideE2GdvbHD1ZzXo0ovhAqISsR4LRk20Pn2LimxIURcxwBgxmIW7toPltiV8QjbQWRvoMyn8Br3s45IxSf6GhVFFcOuSSW9H0MUD5L6SkV02ZRwhkyfs1AQ";
const DROP_CONDITIONS_VECTOR: &str = "POE2F1.eyJhbGciOiJiciIsInAiOjN9.ElCTgBcGAmAsDmwbSfkxUbrtQdCwHgS1tlSZzYhI-pDFHG4ILUIbhp7SStDH0WTp6Wsdlq6-RzfDQPl3gwbdN8akrYGGGOTr9g6FQXw3yr2OIJoQLEEHLvjpNeee1Zu_g4MpBAp8kBqShIAOsgATOlO14hTUE30fGwj6EmIF5ZVmWC_HKMHZpRrMR8t8udkwgMRg8Uq4f4WVnbgEuwqCcIbDmHJJgKQNM4LuGav5_HsQsuEjE8xsE3VyoW5MOyYAxx9-AbBiCEr-iEmhXffKrMLmDXEBancDsgAycS43kfu1BQYisG55Aa7R5GvznVykHxnNkNr84Q5m0rjOJK8souS_x7DKs4lfuWbn1uwuyMil1mqxGmMG5U31gRi9ULhOls2QZIH6";

fn plain() -> Share {
    Share {
        name: "打宝".into(),
        description: String::new(),
        profile: json!({"schemaVersion":2,"league":"Standard","rules":[],"skippedItemIds":["albino-rhoa-feather"]}),
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
            "skippedItemIds":["albino-rhoa-feather"]}),
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

#[test]
fn brotli_checks_crc_and_exact_stream_end() {
    let payload = URL_SAFE_NO_PAD
        .decode(BROTLI_VECTOR.strip_prefix(BROTLI_PREFIX).unwrap())
        .unwrap();
    let decode_brotli =
        |bytes: &[u8]| decode(&format!("{BROTLI_PREFIX}{}", URL_SAFE_NO_PAD.encode(bytes)));
    let mut changed_crc = payload.clone();
    changed_crc[0] ^= 1;
    assert_eq!(decode_brotli(&changed_crc).unwrap_err(), "分享码校验失败");
    for invalid in [
        payload[..payload.len() - 1].to_vec(),
        [&payload[..], &[0]].concat(),
    ] {
        assert_eq!(decode_brotli(&invalid).unwrap_err(), "分享码压缩数据损坏");
    }
    assert_eq!(
        decode(&format!("{BROTLI_PREFIX}*=")).unwrap_err(),
        "分享码不是有效的 Base64URL"
    );
}

#[test]
fn json_bodies_read_the_description_and_default_it_to_empty() {
    let mut share = plain();
    share.description = "开荒到终局".into();
    let json = URL_SAFE_NO_PAD.encode(serde_json::to_vec(&share).unwrap());
    assert_eq!(decode(&format!("POE2F1.{json}")).unwrap().share, share);
    assert_eq!(decode(JSON_VECTOR).unwrap().share.description, "");
}

#[test]
fn json_header_codecs_decode() {
    let server_share = with_server();
    let drop_share = with_drop_conditions();
    for (code, expected) in [
        (JSON_VECTOR, plain()),
        (BROTLI_VECTOR, plain()),
        (POE2_VECTOR, plain()),
        (SERVER_BROTLI_VECTOR, server_share.clone()),
        (SERVER_POE2_VECTOR, server_share),
        (DROP_CONDITIONS_VECTOR, drop_share.clone()),
    ] {
        assert_eq!(
            decode(code).unwrap().into_import().unwrap(),
            expected,
            "{code}"
        );
    }
    assert_eq!(
        decode(&format!("  {JSON_VECTOR}\n")).unwrap().share,
        plain()
    );

    // The same bodies, built here.
    let share = with_server();
    let json = serde_json::to_vec(&share).unwrap();
    assert_eq!(
        decode(&encode_payload(Body::ServerBrotliJson, &json).unwrap())
            .unwrap()
            .share,
        share
    );
    let mut core = share.clone();
    core.profile.as_object_mut().unwrap().remove("server");
    let mut packed = vec![1];
    packed.extend(poe2::pack(&core).unwrap());
    assert_eq!(
        decode(&encode_payload(Body::ServerPoe2, &packed).unwrap())
            .unwrap()
            .share,
        share
    );
    assert_eq!(
        decode(&encode_payload(Body::ServerPoe2, &[2]).unwrap()).unwrap_err(),
        "分享码的游戏服务器无效"
    );
    assert_eq!(
        decode(&encode_payload(Body::ServerPoe2, &[]).unwrap()).unwrap_err(),
        "分享码缺少游戏服务器"
    );
    let json = serde_json::to_vec(&drop_share).unwrap();
    assert_eq!(
        decode(&encode_payload(Body::DropConditionsJson, &json).unwrap())
            .unwrap()
            .share,
        drop_share
    );
    let json = serde_json::to_vec(&plain()).unwrap();
    assert_eq!(
        decode(&encode_payload(Body::BrotliJson, &json).unwrap())
            .unwrap()
            .share,
        plain()
    );
    assert_eq!(
        decode(&encode_payload(Body::Poe2, &poe2::pack(&plain()).unwrap()).unwrap())
            .unwrap()
            .share,
        plain()
    );
}

#[test]
fn rejects_malformed_or_unsupported_headers() {
    let payload = BROTLI_VECTOR.rsplit_once('.').unwrap().1;
    let code_with_header =
        |header: &str| format!("{PREFIX}.{}.{payload}", URL_SAFE_NO_PAD.encode(header));
    for header in [
        r#"{"alg":"br"}"#,
        r#"{"p":1}"#,
        r#"{"alg":"","p":1}"#,
        r#"{"alg":"br","p":0}"#,
        r#"{"alg":"br","p":-1}"#,
        r#"{"alg":"br","p":"1"}"#,
        r#"{"alg":"br","p":1,"p":1}"#,
        r#"{"alg":"br","alg":"br","p":1}"#,
        r#"{"alg":"br","p":1,"extra":true}"#,
    ] {
        assert_eq!(
            decode(&code_with_header(header)).unwrap_err(),
            INVALID_HEADER
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
    for (code, error) in [
        ("POE2F1", "分享码格式无效"),
        ("POE2F1.", "分享码内容无效"),
        ("POE2F1..", INVALID_HEADER),
        ("POE2F1.$$$", "分享码不是有效的 Base64URL"),
        ("POE2F1.*.A", "分享码不是有效的 Base64URL"),
        ("POE2F1.A.A.A", "分享码格式无效"),
    ] {
        assert_eq!(decode(code).unwrap_err(), error, "{code}");
    }
}

#[test]
fn limits_json_bytes() {
    let mut share = plain();
    share.name.clear();
    let overhead = serde_json::to_vec(&share).unwrap().len();
    share.name = "a".repeat(MAX_JSON - overhead - 'é'.len_utf8());
    share.name.push('é');
    let maximum = serde_json::to_vec(&share).unwrap();
    let raw_code = |bytes: &[u8]| format!("{PREFIX}.{}", URL_SAFE_NO_PAD.encode(bytes));
    let brotli_code = |bytes: &[u8]| encode_payload(Body::BrotliJson, bytes).unwrap();
    assert_eq!(maximum.len(), MAX_JSON);
    for code in [raw_code(&maximum), brotli_code(&maximum)] {
        assert_eq!(decode(&code).unwrap().share, share);
    }

    share.name.push('a');
    let oversized = serde_json::to_vec(&share).unwrap();
    assert_eq!(decode(&raw_code(&oversized)).unwrap_err(), "分享码过大");
    assert_eq!(
        decode(&brotli_code(&oversized)).unwrap_err(),
        INFLATED_TOO_LARGE
    );
}

#[test]
fn limits_server_poe2_expansion() {
    let mut core = plain();
    core.name.clear();
    let mut share = core.clone();
    share.profile["server"] = json!("tencent");
    let overhead = serde_json::to_vec(&share).unwrap().len();
    share.name = "a".repeat(MAX_JSON - overhead);
    core.name.clone_from(&share.name);
    let server_code = |core: &Share| {
        let mut packed = vec![1];
        packed.extend(poe2::pack(core).unwrap());
        encode_payload(Body::ServerPoe2, &packed).unwrap()
    };
    assert_eq!(decode(&server_code(&core)).unwrap().share, share);
    core.name.push('a');
    assert_eq!(decode(&server_code(&core)).unwrap_err(), INFLATED_TOO_LARGE);
}
