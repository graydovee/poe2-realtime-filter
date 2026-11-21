use std::{ffi::c_void,ptr};
use windows_sys::Win32::{Foundation::*,Networking::WinHttp::*,Security::Cryptography::*,System::{Com::CoTaskMemFree,Registry::*},UI::Shell::*,UI::WindowsAndMessaging::SW_SHOWNORMAL,Storage::FileSystem::*};
use base64::{Engine,engine::general_purpose::STANDARD};
use url::Url;
pub fn wide(s:&str)->Vec<u16>{s.encode_utf16().chain(Some(0)).collect()}
pub fn err(label:&str)->String{format!("{} (Windows {})",label,unsafe{GetLastError()})}
pub fn documents()->Result<std::path::PathBuf,String>{unsafe{
 let mut value=ptr::null_mut();if SHGetKnownFolderPath(&FOLDERID_Documents,0,ptr::null_mut(),&mut value)<0{return Err(err("无法定位文档目录"));}
 let mut n=0;while *value.add(n)!=0{n+=1;}
 let result=std::path::PathBuf::from(String::from_utf16_lossy(std::slice::from_raw_parts(value,n))).join("My Games").join("Path of Exile 2");CoTaskMemFree(value as *const c_void);Ok(result)
}}
pub fn protect(value:&str)->Result<String,String>{unsafe{
 let input=CRYPT_INTEGER_BLOB{cbData:value.len() as u32,pbData:value.as_ptr() as *mut u8};let mut output:CRYPT_INTEGER_BLOB=std::mem::zeroed();
 if CryptProtectData(&input,ptr::null(),ptr::null(),ptr::null_mut(),ptr::null(),CRYPTPROTECT_UI_FORBIDDEN,&mut output)==0{return Err(err("无法保护订阅密钥"));}
 let result=STANDARD.encode(std::slice::from_raw_parts(output.pbData,output.cbData as usize));LocalFree(output.pbData as *mut c_void);Ok(result)
}}
pub fn unprotect(value:&str)->Result<String,String>{unsafe{
 let mut bytes=STANDARD.decode(value).map_err(|_|"无效密钥".to_string())?;let input=CRYPT_INTEGER_BLOB{cbData:bytes.len() as u32,pbData:bytes.as_mut_ptr()};let mut output:CRYPT_INTEGER_BLOB=std::mem::zeroed();
 if CryptUnprotectData(&input,ptr::null_mut(),ptr::null(),ptr::null_mut(),ptr::null(),CRYPTPROTECT_UI_FORBIDDEN,&mut output)==0{return Err(err("无法解密订阅密钥"));}
 let result=String::from_utf8_lossy(std::slice::from_raw_parts(output.pbData,output.cbData as usize)).to_string();LocalFree(output.pbData as *mut c_void);Ok(result)
}}
struct Internet(*mut c_void);impl Drop for Internet{fn drop(&mut self){if !self.0.is_null(){unsafe{WinHttpCloseHandle(self.0);}}}}
pub struct Response{pub status:u32,pub bytes:Vec<u8>}
pub fn get(url:&str,key:&str,etag:Option<&str>,limit:usize)->Result<Response,String>{unsafe{
 let url=Url::parse(url).map_err(|_|"无效服务器地址".to_string())?;if url.scheme()!="https"{return Err("仅允许 HTTPS 同步地址".into());}
 let host=url.host_str().ok_or("无效服务器")?;
 let session=Internet(WinHttpOpen(wide("poe2-filter-client/0.2").as_ptr(),WINHTTP_ACCESS_TYPE_AUTOMATIC_PROXY,ptr::null(),ptr::null(),0));if session.0.is_null(){return Err(err("无法初始化网络"));}
 WinHttpSetTimeouts(session.0,10000,10000,15000,30000);
 let connection=Internet(WinHttpConnect(session.0,wide(host).as_ptr(),url.port_or_known_default().unwrap_or(443),0));if connection.0.is_null(){return Err(err("无法连接服务器"));}
 let route=format!("{}{}",url.path(),url.query().map(|q|format!("?{q}")).unwrap_or_default());
 let request=Internet(WinHttpOpenRequest(connection.0,wide("GET").as_ptr(),wide(&route).as_ptr(),ptr::null(),ptr::null(),ptr::null(),WINHTTP_FLAG_SECURE));if request.0.is_null(){return Err(err("无法创建请求"));}
 // A bearer token must never follow an HTTP redirect to a different destination.
 let policy:u32=WINHTTP_OPTION_REDIRECT_POLICY_NEVER;WinHttpSetOption(request.0,WINHTTP_OPTION_REDIRECT_POLICY,&policy as *const _ as *const c_void,4);
 let headers=wide(&format!("Authorization: Bearer {key}\r\n{}",etag.map(|e|format!("If-None-Match: {e}\r\n")).unwrap_or_default()));
 if WinHttpSendRequest(request.0,headers.as_ptr(),u32::MAX,ptr::null(),0,0,0)==0||WinHttpReceiveResponse(request.0,ptr::null_mut())==0{return Err(err("下载失败"));}
 let mut status=0u32;let mut size=4u32;if WinHttpQueryHeaders(request.0,WINHTTP_QUERY_STATUS_CODE|WINHTTP_QUERY_FLAG_NUMBER,ptr::null(),&mut status as *mut _ as *mut c_void,&mut size,ptr::null_mut())==0{return Err(err("读取状态失败"));}
 let mut bytes=Vec::new();loop{let mut buffer=[0u8;32768];let mut read=0;if WinHttpReadData(request.0,buffer.as_mut_ptr() as *mut c_void,buffer.len() as u32,&mut read)==0{return Err(err("下载中断"));}if read==0{break;}if bytes.len()+read as usize>limit{return Err("下载文件超过限制".into());}bytes.extend_from_slice(&buffer[..read as usize]);}
 Ok(Response{status,bytes})
}}
pub fn pick_directory()->Option<std::path::PathBuf>{unsafe{
 let mut info:BROWSEINFOW=std::mem::zeroed();let title=wide("选择 Path of Exile 2 本地过滤器目录");info.lpszTitle=title.as_ptr();info.ulFlags=BIF_RETURNONLYFSDIRS|BIF_NEWDIALOGSTYLE;
 let pid=SHBrowseForFolderW(&info);if pid.is_null(){return None;}
 let mut path=[0u16;32768];let ok=SHGetPathFromIDListW(pid,path.as_mut_ptr())!=0;CoTaskMemFree(pid as *const c_void);
 if !ok{return None;}let n=path.iter().position(|c|*c==0).unwrap_or(0);Some(std::path::PathBuf::from(String::from_utf16_lossy(&path[..n])))
}}
pub fn open_directory(path:&std::path::Path){unsafe{
 let target=path.to_string_lossy().to_string();ShellExecuteW(ptr::null_mut(),wide("open").as_ptr(),wide(&target).as_ptr(),ptr::null(),ptr::null(),SW_SHOWNORMAL);
}}
pub fn replace(from: &std::path::Path, to: &std::path::Path) -> Result<(), String> {
    move_file(from, to, true)
}
pub fn move_file(from:&std::path::Path,to:&std::path::Path,replace:bool)->Result<(),String>{unsafe{
 use std::os::windows::ffi::OsStrExt;let a:Vec<u16>=from.as_os_str().encode_wide().chain(Some(0)).collect();let b:Vec<u16>=to.as_os_str().encode_wide().chain(Some(0)).collect();
 if MoveFileExW(a.as_ptr(),b.as_ptr(),(if replace { MOVEFILE_REPLACE_EXISTING } else { 0 }) | MOVEFILE_WRITE_THROUGH)==0{return Err(err("文件占用或无法替换"));}Ok(())
}}
pub fn autostart(enabled:bool)->Result<(),String>{unsafe{
 let mut key=ptr::null_mut();if RegCreateKeyExW(HKEY_CURRENT_USER,wide("Software\\Microsoft\\Windows\\CurrentVersion\\Run").as_ptr(),0,ptr::null(),0,KEY_SET_VALUE,ptr::null(),&mut key,ptr::null_mut())!=0{return Err("无法设置开机启动".into());}
 let result=if enabled{let exe=std::env::current_exe().map_err(|e|e.to_string())?;let text=wide(&format!("\"{}\" --tray",exe.display()));RegSetValueExW(key,wide("poe2-filter").as_ptr(),0,REG_SZ,text.as_ptr() as *const u8,(text.len()*2) as u32)}else{RegDeleteValueW(key,wide("poe2-filter").as_ptr())};RegCloseKey(key);if result!=0&&result!=2{return Err("无法设置开机启动".into());}Ok(())
}}
