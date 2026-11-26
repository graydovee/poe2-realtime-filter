use crate::{
    engine::{self, Result},
    store::Server,
};
use rayon::prelude::*;
use reqwest::{blocking::Client, header, StatusCode};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    collections::HashMap,
    io::Read,
    path::{Path, PathBuf},
    sync::Mutex,
    time::Duration,
};

const INDEX: &str = "https://poe.ninja/poe2/api/data/index-state";
const EXCHANGE: &str = "https://poe.ninja/poe2/api/economy/exchange/current/overview";
const TENCENT_INDEX: &str = "https://poecurrency.top/api/season_list";
const TENCENT_SUMMARY: &str = "https://poecurrency.top/api/summary";
const MAX_RESPONSE: u64 = 8 * 1024 * 1024;

#[derive(Clone, Serialize, Deserialize)]
struct QuoteResponse {
    etag: Option<String>,
    modified: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    quote_time: Option<String>,
    body: Value,
}

impl QuoteResponse {
    fn quote_time(&self) -> Option<&str> {
        self.quote_time.as_deref().or(self.modified.as_deref())
    }
}

#[derive(Serialize, Deserialize)]
struct SnapshotCache {
    responses: HashMap<String, QuoteResponse>,
    snapshot: Value,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    quotes: Option<Value>,
}

#[derive(Deserialize)]
struct MarketUpdate {
    snapshot: Value,
    quotes: Value,
}

pub struct Market {
    root: PathBuf,
    server: Server,
    client: Client,
    network: Mutex<()>,
    workers: rayon::ThreadPool,
}

impl Market {
    pub fn new(root: PathBuf, server: Server) -> Result<Self> {
        let client = Client::builder()
            .user_agent(concat!("poe2-realtime-filter/", env!("CARGO_PKG_VERSION")))
            .timeout(Duration::from_secs(12))
            .redirect(reqwest::redirect::Policy::none())
            .build()
            .map_err(|e| e.to_string())?;
        let workers = rayon::ThreadPoolBuilder::new()
            .num_threads(3)
            .build()
            .map_err(|e| e.to_string())?;
        Ok(Self {
            root,
            server,
            client,
            network: Mutex::new(()),
            workers,
        })
    }

    fn request(
        &self,
        url: &str,
        query: &[(&str, &str)],
        previous: Option<&QuoteResponse>,
        track_quote_time: bool,
    ) -> Result<QuoteResponse> {
        let mut request = self
            .client
            .get(url)
            .query(query)
            .header(header::ACCEPT, "application/json");
        // A cached exchange response without a usable source time has its body requested again.
        if let Some(previous) =
            previous.filter(|old| !track_quote_time || old.quote_time().is_some())
        {
            if let Some(tag) = &previous.etag {
                request = request.header(header::IF_NONE_MATCH, tag);
            }
            if let Some(modified) = &previous.modified {
                request = request.header(header::IF_MODIFIED_SINCE, modified);
            }
        }
        let source = if self.server == Server::Tencent {
            "poecurrency.top"
        } else {
            "poe.ninja"
        };
        let response = request
            .send()
            .map_err(|e| format!("{source} 请求失败 ({e})"))?;
        if response.status() == StatusCode::NOT_MODIFIED {
            return previous
                .cloned()
                .ok_or_else(|| "没有可复用的行情缓存".into());
        }
        if response.status() != StatusCode::OK {
            return Err(format!("{source} HTTP {}", response.status()));
        }
        let get_header = |key| {
            response
                .headers()
                .get(key)
                .and_then(|v| v.to_str().ok())
                .map(str::to_owned)
        };
        let etag = get_header(header::ETAG);
        let modified = get_header(header::LAST_MODIFIED);
        let date = get_header(header::DATE);
        let mut bytes = Vec::new();
        response
            .take(MAX_RESPONSE + 1)
            .read_to_end(&mut bytes)
            .map_err(|e| e.to_string())?;
        if bytes.len() as u64 > MAX_RESPONSE {
            return Err("行情响应过大".into());
        }
        let body = serde_json::from_slice(&bytes).map_err(|e| format!("行情格式无效 ({e})"))?;
        let quote_time = if track_quote_time {
            // Keep the original source time when HTTP 200 carries the same representation.
            previous
                .filter(|old| old.body == body)
                .and_then(QuoteResponse::quote_time)
                .map(str::to_owned)
                .or_else(|| modified.clone())
                .or(date)
        } else {
            None
        };
        Ok(QuoteResponse {
            etag,
            modified,
            quote_time,
            body,
        })
    }

    fn snapshot_path(&self, league: &str) -> PathBuf {
        self.root
            .join(format!("{}.json", crate::store::digest(league.as_bytes())))
    }

    pub fn snapshot(&self, league: &str) -> Option<Value> {
        read_json::<SnapshotCache>(&self.snapshot_path(league)).map(|cache| cache.snapshot)
    }

    pub fn catalog(&self, refresh: bool) -> Result<Value> {
        let path = self.root.join("leagues.json");
        if refresh {
            let _network = self.network.lock().map_err(|e| e.to_string())?;
            let cached = read_json::<(QuoteResponse, Value)>(&path);
            let (endpoint, query, parser) = match self.server {
                Server::International => (INDEX, &[][..], "catalog"),
                Server::Tencent => (TENCENT_INDEX, &[("version", "poe2")][..], "tencentCatalog"),
            };
            let response = self.request(endpoint, query, cached.as_ref().map(|it| &it.0), false)?;
            let catalog = engine::call(parser, &response.body)?;
            write_json(&path, &(&response, &catalog))?;
            return Ok(catalog);
        }
        let cached = read_json::<(QuoteResponse, Value)>(&path).map(|it| it.1);
        if self.server == Server::Tencent {
            return Ok(cached.unwrap_or_else(|| json!({ "leagues": [], "defaultLeague": "", "capturedAt":"1970-01-01T00:00:00Z", "expiresAt":"1970-01-01T00:00:00Z" })));
        }
        Ok(cached.unwrap_or_else(|| json!({
            "leagues": [{"id":"Standard","label":"Standard","hardcore":false,"permanent":true}, {"id":"Hardcore","label":"Hardcore","hardcore":true,"permanent":true}],
            "defaultLeague": "Standard", "capturedAt":"1970-01-01T00:00:00Z", "expiresAt":"1970-01-01T00:00:00Z"
        })))
    }

    fn refresh_tencent(&self, league: &str, minutes: u32, catalog: &Value) -> Result<Value> {
        if !catalog["leagues"]
            .as_array()
            .is_some_and(|items| items.iter().any(|item| item["id"] == league))
        {
            return Err("国服赛季列表中找不到所选赛季".into());
        }
        let current = catalog["defaultLeague"] == league;
        let mut query = vec![("version", "2")];
        if !current {
            query.push(("season", league));
        }
        let path = self.snapshot_path(league);
        let previous: Option<SnapshotCache> = read_json(&path);
        let previous_response = previous
            .as_ref()
            .and_then(|cache| cache.responses.get("summary"));
        let response = {
            let _network = self.network.lock().map_err(|e| e.to_string())?;
            self.request(TENCENT_SUMMARY, &query, previous_response, false)?
        };
        if current && self.catalog(true)?["defaultLeague"] != league {
            return Err("国服当前赛季已变化，请重新选择赛季".into());
        }
        let update: MarketUpdate = engine::call(
            "tencentSnapshot",
            json!({
                "league": league,
                "body": response.body,
                "previousBody": previous_response.map(|old| &old.body),
                "previousQuotes": previous.as_ref().and_then(|cache| cache.quotes.as_ref()),
                "lifetime": u64::from(minutes) * 120_000,
            }),
        )?;
        let cache = SnapshotCache {
            responses: HashMap::from([("summary".into(), response)]),
            snapshot: update.snapshot,
            quotes: Some(update.quotes),
        };
        write_json(&path, &cache)?;
        Ok(cache.snapshot)
    }

    pub fn refresh(&self, league: &str, minutes: u32, catalog: &Result<Value>) -> Result<Value> {
        if self.server == Server::Tencent {
            return self.refresh_tencent(league, minutes, catalog.as_ref().map_err(Clone::clone)?);
        }
        let _network = self.network.lock().map_err(|e| e.to_string())?;
        let path = self.snapshot_path(league);
        let previous: Option<SnapshotCache> = read_json(&path);
        let types: Vec<String> = engine::call("types", Value::Null)?;
        let responses = self.workers.install(|| {
            types
                .par_iter()
                .map(|kind| {
                    let old = previous
                        .as_ref()
                        .and_then(|cache| cache.responses.get(kind));
                    self.request(EXCHANGE, &[("league", league), ("type", kind)], old, true)
                        .map(|response| (kind.clone(), response))
                        .map_err(|e| format!("{kind} {e}"))
                })
                .collect::<Result<HashMap<_, _>>>()
        })?;
        let payloads = exchange_payloads(&responses);
        let previous_quotes = previous.as_ref().and_then(|cache| cache.quotes.as_ref());
        let legacy_payloads = previous
            .as_ref()
            .filter(|_| previous_quotes.is_none())
            .map(|cache| exchange_payloads(&cache.responses));
        let update: MarketUpdate = engine::call(
            "snapshot",
            json!({
                "league": league,
                "payloads": payloads,
                "previous": legacy_payloads,
                "previousQuotes": previous_quotes,
                "lifetime": u64::from(minutes) * 120_000,
            }),
        )?;
        let cache = SnapshotCache {
            responses,
            snapshot: update.snapshot,
            quotes: Some(update.quotes),
        };
        write_json(&path, &cache)?;
        Ok(cache.snapshot)
    }
}

fn exchange_payloads(responses: &HashMap<String, QuoteResponse>) -> HashMap<&str, Value> {
    responses
        .iter()
        .map(|(kind, response)| {
            (
                kind.as_str(),
                json!({ "body": response.body, "quoteTime": response.quote_time() }),
            )
        })
        .collect()
}

pub fn read_json<T: serde::de::DeserializeOwned>(path: &Path) -> Option<T> {
    serde_json::from_slice(&std::fs::read(path).ok()?).ok()
}

pub fn write_json(path: &Path, value: &impl Serialize) -> Result<()> {
    crate::store::write_file(
        path,
        &serde_json::to_vec(value).map_err(|e| e.to_string())?,
        true,
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{
        io::{BufRead, BufReader, Write},
        net::TcpListener,
    };

    #[test]
    fn conditional_requests_keep_the_original_quote_time() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let url = format!("http://{}", listener.local_addr().unwrap());
        let server = std::thread::spawn(move || {
            for (stage, reply) in [
                "200 OK\r\nContent-Length: 2\r\nETag: \"test\"\r\nLast-Modified: Fri, 21 Nov 2025 01:00:00 GMT\r\nDate: Fri, 21 Nov 2025 02:00:00 GMT\r\nConnection: close\r\n\r\n{}",
                "200 OK\r\nContent-Length: 2\r\nETag: \"test\"\r\nDate: Fri, 21 Nov 2025 03:00:00 GMT\r\nConnection: close\r\n\r\n{}",
                "304 Not Modified\r\nDate: Fri, 21 Nov 2025 04:00:00 GMT\r\nConnection: close\r\n\r\n",
                "200 OK\r\nContent-Length: 2\r\nDate: Fri, 21 Nov 2025 05:00:00 GMT\r\nConnection: close\r\n\r\n[]",
            ].into_iter().enumerate() {
                let (mut stream, _) = listener.accept().unwrap();
                let has_tag = BufReader::new(&stream)
                    .lines()
                    .map_while(std::result::Result::ok)
                    .take_while(|line| !line.is_empty())
                    .any(|line| line.to_lowercase() == "if-none-match: \"test\"");
                assert_eq!(has_tag, stage != 0);
                write!(stream, "HTTP/1.1 {reply}").unwrap();
            }
        });
        let dir = tempfile::tempdir().unwrap();
        let market = Market::new(dir.path().to_path_buf(), Server::International).unwrap();
        let mut response = market.request(&url, &[], None, true).unwrap();
        for _ in 0..2 {
            assert_eq!(response.quote_time(), Some("Fri, 21 Nov 2025 01:00:00 GMT"));
            let reused = market.request(&url, &[], Some(&response), true).unwrap();
            assert_eq!(response.etag, reused.etag);
            assert_eq!(response.body, reused.body);
            assert_eq!(response.quote_time(), reused.quote_time());
            response = reused;
        }
        let changed = market.request(&url, &[], Some(&response), true).unwrap();
        assert_eq!(changed.quote_time(), Some("Fri, 21 Nov 2025 05:00:00 GMT"));
        assert_ne!(
            market.snapshot_path("Standard"),
            market.snapshot_path("HC Forbidden Rites")
        );
        server.join().unwrap();
    }

    #[test]
    fn international_quotes_merge_per_item_and_preserve_newer_rates() {
        let types: Vec<String> = engine::call("types", Value::Null).unwrap();
        let make_payload = |kind: &str, time: &str, rate: u32, lines: Value| {
            json!({
                "quoteTime": time,
                "body": {
                    "core": { "primary": "divine", "rates": { "exalted": rate, "chaos": 25 } },
                    "items": if kind == "Currency" { json!([
                        {"id":"d", "name":"Divine Orb"}, {"id":"c", "name":"Chaos Orb"},
                        {"id":"e", "name":"Exalted Orb"}, {"id":"a", "name":"Orb of Annulment"},
                        {"id":"q", "name":"Orb of Alchemy"}
                    ]) } else { json!([]) },
                    "lines": lines,
                },
            })
        };
        let merge = |time, rate, lines: Value, previous: Option<Value>| {
            let payloads: HashMap<_, _> = types
                .iter()
                .map(|kind| {
                    let lines = if kind == "Currency" {
                        lines.clone()
                    } else {
                        json!([])
                    };
                    (kind, make_payload(kind, time, rate, lines))
                })
                .collect();
            engine::call::<MarketUpdate>(
                "snapshot",
                json!({
                    "league": "Standard", "payloads": payloads, "lifetime": 7200000,
                    "previousQuotes": previous,
                }),
            )
            .unwrap()
        };
        let first = merge(
            "Fri, 21 Nov 2025 02:00:00 GMT",
            1000,
            json!([
                {"id":"a", "primaryValue":0.2}, {"id":"q", "primaryValue":0.25},
            ]),
            None,
        );
        let older = merge(
            "Fri, 21 Nov 2025 01:00:00 GMT",
            500,
            json!([
                {"id":"a", "primaryValue":0.9},
            ]),
            Some(first.quotes),
        );
        assert_eq!(older.snapshot["prices"]["orb-of-annulment"]["amount"], 0.2);
        assert_eq!(older.snapshot["rates"]["divineToExalted"], 1000);
        assert_eq!(older.snapshot["capturedAt"], "2025-11-21T02:00:00.000Z");
        let newer = merge(
            "Fri, 21 Nov 2025 03:00:00 GMT",
            1200,
            json!([
                {"id":"a", "maxVolumeCurrency":"exalted", "maxVolumeRate":0.1},
            ]),
            Some(older.quotes),
        );
        assert_eq!(newer.snapshot["prices"]["orb-of-annulment"]["amount"], 10);
        assert_eq!(newer.snapshot["prices"]["orb-of-alchemy"]["amount"], 0.25);
        assert_eq!(
            newer.snapshot["prices"]["orb-of-alchemy"]["capturedAt"],
            "2025-11-21T02:00:00.000Z"
        );
        assert_eq!(newer.snapshot["rates"]["divineToExalted"], 1200);
        assert_eq!(newer.snapshot["capturedAt"], "2025-11-21T03:00:00.000Z");
    }
}
