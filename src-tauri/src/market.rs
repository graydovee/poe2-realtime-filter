use crate::engine::{self, Result};
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
const MAX_RESPONSE: u64 = 8 * 1024 * 1024;

#[derive(Clone, Serialize, Deserialize)]
struct QuoteResponse {
    etag: Option<String>,
    modified: Option<String>,
    body: Value,
}

#[derive(Serialize, Deserialize)]
struct SnapshotCache {
    responses: HashMap<String, QuoteResponse>,
    snapshot: Value,
}

pub struct Market {
    root: PathBuf,
    client: Client,
    network: Mutex<()>,
    workers: rayon::ThreadPool,
}

impl Market {
    pub fn new(root: PathBuf) -> Result<Self> {
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
    ) -> Result<QuoteResponse> {
        let mut request = self
            .client
            .get(url)
            .query(query)
            .header(header::ACCEPT, "application/json");
        if let Some(previous) = previous {
            if let Some(tag) = &previous.etag {
                request = request.header(header::IF_NONE_MATCH, tag);
            }
            if let Some(modified) = &previous.modified {
                request = request.header(header::IF_MODIFIED_SINCE, modified);
            }
        }
        let response = request
            .send()
            .map_err(|e| format!("poe.ninja 请求失败 ({e})"))?;
        if response.status() == StatusCode::NOT_MODIFIED {
            return previous
                .cloned()
                .ok_or_else(|| "没有可复用的行情缓存".into());
        }
        if response.status() != StatusCode::OK {
            return Err(format!("poe.ninja HTTP {}", response.status()));
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
        let mut bytes = Vec::new();
        response
            .take(MAX_RESPONSE + 1)
            .read_to_end(&mut bytes)
            .map_err(|e| e.to_string())?;
        if bytes.len() as u64 > MAX_RESPONSE {
            return Err("行情响应过大".into());
        }
        let body = serde_json::from_slice(&bytes).map_err(|e| format!("行情格式无效 ({e})"))?;
        Ok(QuoteResponse {
            etag,
            modified,
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
            let response = self.request(INDEX, &[], cached.as_ref().map(|it| &it.0))?;
            let catalog = engine::call("catalog", &response.body)?;
            write_json(&path, &(&response, &catalog))?;
            return Ok(catalog);
        }
        Ok(read_json::<(QuoteResponse, Value)>(&path).map(|it| it.1).unwrap_or_else(|| json!({
            "leagues": [{"id":"Standard","label":"Standard","hardcore":false,"permanent":true}, {"id":"Hardcore","label":"Hardcore","hardcore":true,"permanent":true}],
            "defaultLeague": "Standard", "capturedAt":"1970-01-01T00:00:00Z", "expiresAt":"1970-01-01T00:00:00Z"
        })))
    }

    pub fn refresh(&self, league: &str, minutes: u32) -> Result<Value> {
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
                    self.request(EXCHANGE, &[("league", league), ("type", kind)], old)
                        .map(|response| (kind.clone(), response))
                        .map_err(|e| format!("{kind} {e}"))
                })
                .collect::<Result<HashMap<_, _>>>()
        })?;
        let payloads: HashMap<_, _> = responses
            .iter()
            .map(|(kind, response)| (kind, &response.body))
            .collect();
        let snapshot = engine::call(
            "snapshot",
            json!({ "league": league, "payloads": payloads, "lifetime": u64::from(minutes) * 120_000 }),
        )?;
        let cache = SnapshotCache {
            responses,
            snapshot,
        };
        write_json(&path, &cache)?;
        Ok(cache.snapshot)
    }
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
    fn conditional_requests_reuse_validated_response() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let url = format!("http://{}", listener.local_addr().unwrap());
        let server = std::thread::spawn(move || {
            for first in [true, false] {
                let (mut stream, _) = listener.accept().unwrap();
                let headers: Vec<_> = BufReader::new(&stream)
                    .lines()
                    .map_while(std::result::Result::ok)
                    .take_while(|line| !line.is_empty())
                    .collect();
                if first {
                    assert!(!headers
                        .iter()
                        .any(|line| line.to_lowercase().starts_with("if-none-match:")));
                    stream.write_all(b"HTTP/1.1 200 OK\r\nContent-Length: 2\r\nETag: \"test\"\r\nConnection: close\r\n\r\n{}").unwrap();
                } else {
                    assert!(headers
                        .iter()
                        .any(|line| line.to_lowercase() == "if-none-match: \"test\""));
                    stream
                        .write_all(b"HTTP/1.1 304 Not Modified\r\nConnection: close\r\n\r\n")
                        .unwrap();
                }
            }
        });
        let dir = tempfile::tempdir().unwrap();
        let market = Market::new(dir.path().to_path_buf()).unwrap();
        let response = market.request(&url, &[], None).unwrap();
        let reused = market.request(&url, &[], Some(&response)).unwrap();
        assert_eq!(response.etag, reused.etag);
        assert_eq!(response.body, reused.body);
        assert_ne!(
            market.snapshot_path("Standard"),
            market.snapshot_path("HC Forbidden Rites")
        );
        server.join().unwrap();
    }
}
