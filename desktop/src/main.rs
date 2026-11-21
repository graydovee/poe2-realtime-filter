#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
#[cfg(not(windows))]
compile_error!("This client supports Windows amd64 only");
mod app;
mod brand;
mod platform;
mod sync;
mod theme;
mod tray;
mod widgets;
fn main(){
 let args:Vec<String>=std::env::args().collect();
 if args.iter().any(|a|a=="--diagnostics"){
  let info=serde_json::json!({"architecture":std::env::consts::ARCH,"filterDirectory":platform::documents().ok().map(|p|p.to_string_lossy().to_string()),"stateDirectory":sync::state_root(),"version":env!("CARGO_PKG_VERSION")});
  if let Some(i)=args.iter().position(|a|a=="--output"){if let Some(file)=args.get(i+1){let _=std::fs::write(file,info.to_string());return;}}
  println!("{info}");return;
 }
 if let Some(i)=args.iter().position(|a|a=="--once"){
  let result=(||->sync::Result<serde_json::Value>{let link=args.get(i+1).ok_or("missing subscription link")?;let dir=args.iter().position(|a|a=="--directory").and_then(|i|args.get(i+1)).map(std::path::PathBuf::from).unwrap_or(platform::documents()?);let root=args.iter().position(|a|a=="--state-dir").and_then(|i|args.get(i+1)).map(std::path::PathBuf::from).unwrap_or(sync::state_root());let mut settings=sync::read_settings(&root)?;let parsed=sync::parse_link(link,dir)?;let index=settings.entries.iter().position(|e|e.id==parsed.id&&e.origin==parsed.origin);let mut entry=index.map(|n|settings.entries[n].clone()).unwrap_or(parsed);let changed=sync::update(&root,&mut entry)?;let data=serde_json::json!({"changed":changed,"id":entry.id,"name":entry.name,"league":entry.league,"revision":entry.current,"directory":entry.directory});if let Some(n)=index{settings.entries[n]=entry;}else{settings.entries.push(entry);}sync::save_settings(&root,&settings)?;Ok(data)})();
  let (code,data)=match result{Ok(v)=>(0,v),Err(e)=>(1,serde_json::json!({"error":e}))};
  if let Some(i)=args.iter().position(|a|a=="--output"){if let Some(file)=args.get(i+1){let _=std::fs::write(file,data.to_string());}}else{println!("{data}");}std::process::exit(code);
 }
 let _=app::run(args.iter().any(|a|a=="--tray"));
}
