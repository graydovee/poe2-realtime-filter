use serde::{Deserialize,Serialize};
use sha2::{Digest,Sha256};
use std::{fs,path::{Path,PathBuf}};
use crate::platform;
use url::Url;
pub type Result<T>=std::result::Result<T,String>;
#[derive(Clone,Serialize,Deserialize,Default)]
pub struct Entry{pub id:String,pub origin:String,pub protected_key:String,pub directory:PathBuf,#[serde(default)]pub name:String,#[serde(default)]pub league:String,#[serde(default)]pub paused:bool,#[serde(default)]pub revoked:bool,#[serde(default)]pub current:Option<String>,#[serde(default)]pub previous:Option<String>,#[serde(default)]pub status:String}
#[derive(Clone,Serialize,Deserialize)]
pub struct Settings{pub interval_minutes:u32,pub autostart:bool,pub entries:Vec<Entry>}
impl Default for Settings{fn default()->Self{Self{interval_minutes:30,autostart:false,entries:vec![]}}}
#[derive(Clone,Serialize,Deserialize)]
#[serde(rename_all="camelCase")]
pub struct Manifest{pub protocol_version:u32,pub profile_id:String,pub name:String,pub league:String,pub config_version:u64,pub revision:String,pub market_captured_at:String,pub generated_at:String,pub files:Vec<File>,#[serde(default)]pub stale:bool,#[serde(default)]pub error:Option<String>}
#[derive(Clone,Serialize,Deserialize)]
pub struct File{pub id:String,pub path:String,pub kind:String,pub size:u64,pub sha256:String}
pub fn hash(bytes:&[u8])->String{hex::encode(Sha256::digest(bytes))}
pub fn state_root()->PathBuf{std::env::var_os("LOCALAPPDATA").map(PathBuf::from).unwrap_or_else(std::env::temp_dir).join("poe2-filter")}
pub fn read_settings(root:&Path)->Result<Settings>{let file=root.join("settings.json");if !file.exists(){return Ok(Settings::default());}serde_json::from_slice(&fs::read(file).map_err(|e|e.to_string())?).map_err(|_|"配置文件损坏，请从备份恢复".into())}
pub fn save_settings(root:&Path,state:&Settings)->Result<()>{fs::create_dir_all(root).map_err(|e|e.to_string())?;let target=root.join("settings.json");let temporary=root.join("settings.tmp");fs::write(&temporary,serde_json::to_vec_pretty(state).map_err(|e|e.to_string())?).map_err(|e|e.to_string())?;platform::replace(&temporary,&target)}
pub fn parse_link(link:&str,directory:PathBuf)->Result<Entry>{let url=Url::parse(link.trim()).map_err(|_|"请输入网站复制的完整订阅链接".to_string())?;if url.scheme()!="https"||!url.username().is_empty()||url.password().is_some()||url.query().is_some(){return Err("订阅链接必须是 HTTPS 地址".into());}
 let segments:Vec<_>=url.path().trim_matches('/').split('/').collect();if segments.len()!=2||segments[0]!="sync"||!valid_id(segments[1]){return Err("不是有效订阅链接".into());}
 let key=url.fragment().and_then(|f|f.strip_prefix("key=")).ok_or("链接缺少密钥")?;if key.len()<32||key.len()>256||!key.chars().all(|c|c.is_ascii_alphanumeric()||c=='-'||c=='_'){return Err("无效订阅密钥".into());}
 Ok(Entry{id:segments[1].into(),origin:url.origin().ascii_serialization(),protected_key:platform::protect(key)?,directory,name:"等待同步".into(),..Entry::default()})
}
fn valid_id(s:&str)->bool{!s.is_empty()&&s.len()<=100&&s.chars().all(|c|c.is_ascii_alphanumeric()||c=='-')}
fn valid_revision(s:&str)->bool{s.len()==32&&s.chars().all(|c|c.is_ascii_hexdigit())}
pub fn validate(m:&Manifest,id:&str)->Result<()>{if m.protocol_version!=1||m.profile_id!=id||!valid_revision(&m.revision)||m.files.is_empty()||m.files.len()>100{return Err("订阅协议或版本不匹配".into());}
 let mut filter=0;let mut total=0u64;let mut paths=std::collections::HashSet::new();let mut ids=std::collections::HashSet::new();
 for f in &m.files{if !valid_id(&f.id)||!paths.insert(f.path.to_lowercase())||!ids.insert(f.id.clone())||f.sha256.len()!=64||!f.sha256.chars().all(|c|c.is_ascii_hexdigit()){return Err("文件清单无效".into());}
 if f.path.contains(['\\',':'])||f.path.starts_with('/')||f.path.split('/').any(|p|p.is_empty()||p=="."||p==".."||p.ends_with('.')||p.ends_with(' ')){return Err("拒绝越界路径".into());}
 if f.kind=="filter"{filter+=1;if f.path!=format!("poe2-filter-{id}.filter"){return Err("过滤器文件名不匹配".into());}}
 else if f.kind=="sound"{let prefix=format!("poe2-filter-assets/{id}/{}/",m.revision);if !f.path.starts_with(&prefix)||!['m','w','o'].iter().any(|_|[".mp3",".wav",".ogg"].iter().any(|e|f.path.to_lowercase().ends_with(e))){return Err("音效路径无效".into());}}
 else{return Err("不支持的文件类型".into());}total=total.checked_add(f.size).ok_or("文件过大")?;if f.size>8*1024*1024||total>40*1024*1024{return Err("下载包过大".into());}}
 if filter!=1{return Err("过滤器数量无效".into());}Ok(())
}
fn clean_parent(target:&Path)->Result<()>{use std::os::windows::fs::MetadataExt;let mut parent=target.parent();while let Some(p)=parent{if let Ok(m)=fs::symlink_metadata(p){if m.file_attributes()&0x400!=0{return Err("目标目录包含重解析点，请选择实际目录".into());}}parent=p.parent();}Ok(())}
fn checked_file(path:&Path,file:&File)->Result<Vec<u8>>{let bytes=fs::read(path).map_err(|e|e.to_string())?;if bytes.len() as u64!=file.size||hash(&bytes)!=file.sha256{return Err("文件完整性校验失败".into());}Ok(bytes)}
fn cache(root:&Path,id:&str,rev:&str)->PathBuf{root.join("cache").join(id).join(rev)}
fn install(root:&Path,entry:&Entry,manifest:&Manifest)->Result<()>{
 fs::create_dir_all(&entry.directory).map_err(|e|e.to_string())?;
 for f in manifest.files.iter().filter(|f|f.kind=="sound").chain(manifest.files.iter().filter(|f|f.kind=="filter")){
 let bytes=checked_file(&cache(root,&entry.id,&manifest.revision).join(&f.id),f)?;let target=entry.directory.join(&f.path);clean_parent(&target)?;if let Some(parent)=target.parent(){fs::create_dir_all(parent).map_err(|e|e.to_string())?;}
 if target.exists(){let meta=fs::symlink_metadata(&target).map_err(|e|e.to_string())?;use std::os::windows::fs::MetadataExt;if meta.file_attributes()&0x400!=0{return Err("目标文件是链接，停止更新".into());}}
 let temporary=target.with_extension("poe2-filter.tmp");fs::write(&temporary,bytes).map_err(|e|e.to_string())?;platform::replace(&temporary,&target)?;
 }Ok(())
}
pub fn update(root:&Path,entry:&mut Entry)->Result<bool>{
 let key=platform::unprotect(&entry.protected_key)?;let etag=entry.current.as_ref().map(|v|format!("\"{v}\""));let response=platform::get(&format!("{}/api/sync/{}/manifest",entry.origin,entry.id),&key,etag.as_deref(),1024*1024)?;
 if response.status==304{entry.status="已是最新版本".into();return Ok(false);}
 if [401,403,404,410].contains(&response.status){entry.revoked=true;entry.status="订阅已停用、删除或密钥失效；保留现有文件".into();return Err(entry.status.clone());}
 if response.status!=200{return Err(format!("服务器暂不可用：HTTP {}",response.status));}
 let manifest:Manifest=serde_json::from_slice(&response.bytes).map_err(|_|"无法读取订阅清单".to_string())?;validate(&manifest,&entry.id)?;
 if manifest.stale{return Err(format!("服务器保留旧版本：{}",manifest.error.unwrap_or_default()));}
 if entry.current.as_deref()==Some(&manifest.revision){entry.status="已是最新版本".into();return Ok(false);}
 let dir=cache(root,&entry.id,&manifest.revision);fs::create_dir_all(&dir).map_err(|e|e.to_string())?;
 for file in &manifest.files{let target=dir.join(&file.id);if target.exists()&&checked_file(&target,file).is_ok(){continue;}
 let response=platform::get(&format!("{}/api/sync/{}/revisions/{}/files/{}",entry.origin,entry.id,manifest.revision,file.id),&key,None,8*1024*1024)?;
 if response.status!=200||response.bytes.len() as u64!=file.size||hash(&response.bytes)!=file.sha256{return Err("下载中断或文件校验失败；保留现有过滤器".into());}fs::write(&target,response.bytes).map_err(|e|e.to_string())?;}
 fs::write(dir.join("manifest.json"),serde_json::to_vec(&manifest).map_err(|e|e.to_string())?).map_err(|e|e.to_string())?;
 install(root,entry,&manifest)?;entry.previous=entry.current.take();entry.current=Some(manifest.revision);entry.name=manifest.name;entry.league=manifest.league;entry.revoked=false;entry.status=format!("已更新 · {} · 请在游戏内重新加载",manifest.generated_at);Ok(true)
}
pub fn rollback(root:&Path,entry:&mut Entry)->Result<()>{let previous=entry.previous.clone().ok_or("没有可回滚版本")?;let m:Manifest=serde_json::from_slice(&fs::read(cache(root,&entry.id,&previous).join("manifest.json")).map_err(|e|e.to_string())?).map_err(|e|e.to_string())?;validate(&m,&entry.id)?;install(root,entry,&m)?;entry.previous=entry.current.take();entry.current=Some(previous);entry.paused=true;entry.status="已回滚并暂停同步；请在游戏内重新加载".into();Ok(())}
#[cfg(test)]mod tests{use super::*;
 #[test]fn links(){assert!(parse_link("http://example.com/sync/abc#key=aaa",PathBuf::new()).is_err());assert!(parse_link("https://example.com/sync/../../bad#key=aaa",PathBuf::new()).is_err());}
 #[test]fn paths(){let mut m=Manifest{protocol_version:1,profile_id:"abc".into(),name:"测试".into(),league:"Standard".into(),config_version:1,revision:"a".repeat(32),market_captured_at:"".into(),generated_at:"".into(),stale:false,error:None,files:vec![File{id:"filter".into(),path:"poe2-filter-abc.filter".into(),kind:"filter".into(),size:1,sha256:"a".repeat(64)}]};assert!(validate(&m,"abc").is_ok());m.files[0].path="../x.filter".into();assert!(validate(&m,"abc").is_err());}
 #[test]fn dpapi(){let value="secret-test-123456789";let encrypted=platform::protect(value).unwrap();assert_ne!(value,encrypted);assert_eq!(platform::unprotect(&encrypted).unwrap(),value);}
}
