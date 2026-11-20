use std::{ptr,sync::{Mutex,OnceLock},thread,time::{Duration,Instant},ffi::c_void};
use windows_sys::Win32::{Foundation::*,Graphics::Gdi::*,System::{LibraryLoader::GetModuleHandleW,Threading::CreateMutexW,Com::*},UI::{WindowsAndMessaging::*,Shell::*,Controls::*}};
use crate::{platform::{self,wide},sync::{self,Settings}};
const LIST:i32=100;const LINK:i32=101;const DIR:i32=102;const MINUTES:i32=103;const STATUS:i32=104;const STARTUP:i32=105;
const ADD:i32=201;const UPDATE:i32=202;const PAUSE:i32=203;const REMOVE:i32=204;const ROLLBACK:i32=205;const OPEN:i32=206;const BROWSE:i32=207;const SAVE:i32=208;
const TRAY:u32=WM_APP+1;const DONE:u32=WM_APP+2;
struct App{settings:Settings,busy:bool,root:std::path::PathBuf,last:Instant,failures:u32,next_attempt:Instant}
static APP:OnceLock<Mutex<App>>=OnceLock::new();
fn app()->&'static Mutex<App>{APP.get().unwrap()}
unsafe fn text(hwnd:HWND,id:i32)->String{let c=GetDlgItem(hwnd,id);let n=GetWindowTextLengthW(c);let mut b=vec![0u16;n as usize+1];GetWindowTextW(c,b.as_mut_ptr(),n+1);String::from_utf16_lossy(&b[..n as usize])}
unsafe fn set(hwnd:HWND,id:i32,s:&str){SetWindowTextW(GetDlgItem(hwnd,id),wide(s).as_ptr());}
unsafe fn selected(hwnd:HWND)->Option<usize>{let n=SendMessageW(GetDlgItem(hwnd,LIST),LB_GETCURSEL,0,0);if n<0{None}else{Some(n as usize)}}
unsafe fn note(hwnd:HWND,s:&str){set(hwnd,STATUS,s);}
unsafe fn save(hwnd:HWND){let a=app().lock().unwrap();if let Err(e)=sync::save_settings(&a.root,&a.settings){note(hwnd,&e);}}
unsafe fn refresh(hwnd:HWND){
 let old=selected(hwnd);let a=app().lock().unwrap();SendMessageW(GetDlgItem(hwnd,LIST),LB_RESETCONTENT,0,0);
 for e in &a.settings.entries{let row=format!("{} | {} | {} | {}",e.name,e.league,if e.revoked{"链接失效"}else if e.paused{"已暂停"}else{"同步中"},e.status);SendMessageW(GetDlgItem(hwnd,LIST),LB_ADDSTRING,0,wide(&row).as_ptr() as isize);}
 if let Some(n)=old{if n<a.settings.entries.len(){SendMessageW(GetDlgItem(hwnd,LIST),LB_SETCURSEL,n,0);}}
 
}
unsafe fn update(hwnd:HWND,force:bool){
 let (root,entries)={let mut a=app().lock().unwrap();if a.busy{return;}a.busy=true;(a.root.clone(),a.settings.entries.clone())};refresh(hwnd);note(hwnd,"正在检查更新…");let window=hwnd as usize;
 thread::spawn(move||{
 let mut changed=false;let mut failed=false;
 for mut e in entries{if e.paused||e.revoked{continue;}match sync::update(&root,&mut e){Ok(c)=>changed|=c,Err(message)=>{e.status=message;failed=true;}}
 let mut a=app().lock().unwrap();if let Some(target)=a.settings.entries.iter_mut().find(|target|target.id==e.id&&target.origin==e.origin){*target=e;}}
 {let mut a=app().lock().unwrap();a.busy=false;a.last=Instant::now();a.failures=if failed{(a.failures+1).min(6)}else{0};let wait=if failed{60*(1u64<<a.failures.min(5))}else{a.settings.interval_minutes as u64*60};a.next_attempt=Instant::now()+Duration::from_secs(wait);let _=sync::save_settings(&a.root,&a.settings);}
 unsafe{PostMessageW(window as HWND,DONE,if changed{1}else if failed{2}else{0},if force{1}else{0});}
 });
}
unsafe fn child(hwnd:HWND,class:&str,label:&str,style:u32,id:i32,x:i32,y:i32,w:i32,h:i32)->HWND{
 let c=CreateWindowExW(0,wide(class).as_ptr(),wide(label).as_ptr(),WS_CHILD|WS_VISIBLE|style,x,y,w,h,hwnd,id as usize as *mut c_void,GetModuleHandleW(ptr::null()),ptr::null());
 SendMessageW(c,WM_SETFONT,GetStockObject(DEFAULT_GUI_FONT) as usize,1);c
}
unsafe fn browse(hwnd:HWND){
 let mut info:BROWSEINFOW=std::mem::zeroed();info.hwndOwner=hwnd;let title=wide("选择 Path of Exile 2 本地过滤器目录");info.lpszTitle=title.as_ptr();info.ulFlags=BIF_RETURNONLYFSDIRS|BIF_NEWDIALOGSTYLE;
 let pid=SHBrowseForFolderW(&info);if !pid.is_null(){let mut path=[0u16;32768];if SHGetPathFromIDListW(pid,path.as_mut_ptr())!=0{let n=path.iter().position(|c|*c==0).unwrap_or(0);set(hwnd,DIR,&String::from_utf16_lossy(&path[..n]));}CoTaskMemFree(pid as *const c_void);}
}
unsafe extern "system" fn proc(hwnd:HWND,msg:u32,w:WPARAM,l:LPARAM)->LRESULT{
 match msg{
 WM_CREATE=>{
 child(hwnd,"STATIC","方案订阅链接",0,0,16,14,150,20);child(hwnd,"EDIT","",WS_BORDER|ES_AUTOHSCROLL as u32|WS_TABSTOP,LINK,16,36,735,26);child(hwnd,"BUTTON","添加方案",WS_TABSTOP,ADD,765,35,110,28);
 child(hwnd,"STATIC","过滤器目录",0,0,16,76,150,20);child(hwnd,"EDIT",&platform::documents().map(|p|p.to_string_lossy().to_string()).unwrap_or_default(),WS_BORDER|ES_AUTOHSCROLL as u32|WS_TABSTOP,DIR,16,98,610,26);child(hwnd,"BUTTON","浏览…",WS_TABSTOP,BROWSE,638,96,105,28);child(hwnd,"BUTTON","打开目录",WS_TABSTOP,OPEN,755,96,120,28);
 child(hwnd,"LISTBOX","",WS_BORDER|WS_VSCROLL|LBS_NOTIFY as u32|WS_TABSTOP,LIST,16,140,860,230);
 for(id,label,x)in[(UPDATE,"立即更新",16),(PAUSE,"暂停 / 恢复",146),(REMOVE,"移除条目",290),(ROLLBACK,"回滚上一版",420)]{child(hwnd,"BUTTON",label,WS_TABSTOP,id,x,384,120,30);}
 child(hwnd,"STATIC","检查间隔（分钟）",0,0,16,437,140,20);child(hwnd,"EDIT","30",WS_BORDER|ES_NUMBER as u32|WS_TABSTOP,MINUTES,160,432,70,26);child(hwnd,"BUTTON","开机启动",BS_AUTOCHECKBOX as u32|WS_TABSTOP,STARTUP,255,430,145,30);child(hwnd,"BUTTON","保存设置 / 目录",WS_TABSTOP,SAVE,420,430,155,30);
 child(hwnd,"EDIT","启动后自动检查更新；关闭窗口将留在托盘。",WS_BORDER|ES_MULTILINE as u32|ES_READONLY as u32,STATUS,16,480,860,70);
 let a=app().lock().unwrap();set(hwnd,MINUTES,&a.settings.interval_minutes.to_string());SendMessageW(GetDlgItem(hwnd,STARTUP),BM_SETCHECK,if a.settings.autostart{BST_CHECKED as usize}else{BST_UNCHECKED as usize},0);drop(a);
 let mut icon:NOTIFYICONDATAW=std::mem::zeroed();icon.cbSize=std::mem::size_of::<NOTIFYICONDATAW>() as u32;icon.hWnd=hwnd;icon.uID=1;icon.uFlags=NIF_MESSAGE|NIF_ICON|NIF_TIP;icon.uCallbackMessage=TRAY;icon.hIcon=LoadIconW(ptr::null_mut(),IDI_APPLICATION);let title=wide("poe2-filter 自动更新");icon.szTip[..title.len()].copy_from_slice(&title);Shell_NotifyIconW(NIM_ADD,&icon);
 SetTimer(hwnd,1,30000,None);refresh(hwnd);PostMessageW(hwnd,WM_COMMAND,UPDATE as usize,0);0
 },
 WM_COMMAND=>{let id=(w&0xffff) as i32;
 if id==LIST && ((w>>16)&0xffff) as u32==LBN_SELCHANGE{if let Some(n)=selected(hwnd){let a=app().lock().unwrap();if let Some(e)=a.settings.entries.get(n){set(hwnd,DIR,&e.directory.to_string_lossy());note(hwnd,&e.status);}}return 0;}
 match id{
 ADD=>{let link=text(hwnd,LINK);let directory=std::path::PathBuf::from(text(hwnd,DIR));if !directory.is_absolute(){note(hwnd,"请选择绝对目录");return 0;}match sync::parse_link(&link,directory){Ok(entry)=>{let mut a=app().lock().unwrap();if a.settings.entries.iter().any(|e|e.id==entry.id&&e.origin==entry.origin){note(hwnd,"该方案已存在；重置密钥后请先移除旧条目再添加");return 0;}a.settings.entries.push(entry);drop(a);save(hwnd);set(hwnd,LINK,"");refresh(hwnd);update(hwnd,true);},Err(e)=>note(hwnd,&e)}},
 UPDATE=>update(hwnd,true),
 PAUSE|REMOVE|ROLLBACK=>{if let Some(n)=selected(hwnd){if id==ROLLBACK{let(root,entry)={let mut a=app().lock().unwrap();if a.busy{return 0;}a.busy=true;(a.root.clone(),a.settings.entries[n].clone())};refresh(hwnd);let window=hwnd as usize;thread::spawn(move||{let mut entry=entry;if let Err(e)=sync::rollback(&root,&mut entry){entry.status=e;}let mut a=app().lock().unwrap();a.settings.entries[n]=entry;a.busy=false;let _=sync::save_settings(&a.root,&a.settings);drop(a);unsafe{PostMessageW(window as HWND,DONE,0,0);}});}else{let mut a=app().lock().unwrap();if a.busy{return 0;}if id==REMOVE{a.settings.entries.remove(n);}else{a.settings.entries[n].paused=!a.settings.entries[n].paused;}drop(a);save(hwnd);refresh(hwnd);}}},
 BROWSE=>browse(hwnd),
 OPEN=>{ShellExecuteW(hwnd,wide("open").as_ptr(),wide(&text(hwnd,DIR)).as_ptr(),ptr::null(),ptr::null(),SW_SHOWNORMAL);},
 SAVE=>{let minutes=text(hwnd,MINUTES).parse::<u32>().unwrap_or(0);if !(5..=1440).contains(&minutes){note(hwnd,"检查间隔必须在5–1440分钟之间");return 0;}let directory=std::path::PathBuf::from(text(hwnd,DIR));if !directory.is_absolute(){note(hwnd,"目录必须是绝对路径");return 0;}let startup=SendMessageW(GetDlgItem(hwnd,STARTUP),BM_GETCHECK,0,0)==BST_CHECKED as isize;if let Err(e)=platform::autostart(startup){note(hwnd,&e);return 0;}let mut a=app().lock().unwrap();if a.busy{note(hwnd,"请等待同步结束后再修改设置");return 0;}a.settings.interval_minutes=minutes;a.settings.autostart=startup;if let Some(n)=selected(hwnd){if a.settings.entries[n].directory!=directory{a.settings.entries[n].directory=directory;a.settings.entries[n].current=None;}}a.next_attempt=Instant::now()+Duration::from_secs(minutes as u64*60);drop(a);save(hwnd);refresh(hwnd);note(hwnd,"设置已保存");},
 900=>{ShowWindow(hwnd,SW_RESTORE);SetForegroundWindow(hwnd);},901=>update(hwnd,true),902=>{let mut a=app().lock().unwrap();let paused=a.settings.entries.iter().any(|e|!e.paused);for e in &mut a.settings.entries{e.paused=paused;}drop(a);save(hwnd);refresh(hwnd);},903=>{let a=app().lock().unwrap();if a.busy{note(hwnd,"正在下载，请完成后退出");ShowWindow(hwnd,SW_RESTORE);}else{drop(a);DestroyWindow(hwnd);}},_=>{}
 }0},
 WM_TIMER=>{let due={let a=app().lock().unwrap();!a.busy&&Instant::now()>=a.next_attempt};if due{update(hwnd,false);}0},
 DONE=>{refresh(hwnd);note(hwnd,match w{1=>"更新完成。首次请在游戏选择 poe2-filter-方案ID.filter；更新后重新加载。",2=>"部分更新失败，原有过滤器已保留。请选择条目查看详情。",_=>"检查完成。请选择条目查看状态。"});0},
 TRAY=>{if l as u32==WM_LBUTTONDBLCLK{ShowWindow(hwnd,SW_RESTORE);SetForegroundWindow(hwnd);}else if l as u32==WM_RBUTTONUP{let menu=CreatePopupMenu();for(id,label)in[(900,"打开窗口"),(901,"全部更新"),(902,"全部暂停 / 恢复"),(903,"退出")]{AppendMenuW(menu,MF_STRING,id,wide(label).as_ptr());}let mut p:POINT=std::mem::zeroed();GetCursorPos(&mut p);SetForegroundWindow(hwnd);TrackPopupMenu(menu,TPM_RIGHTBUTTON,p.x,p.y,0,hwnd,ptr::null());DestroyMenu(menu);}0},
 WM_CLOSE=>{ShowWindow(hwnd,SW_HIDE);0},
 WM_DESTROY=>{let mut icon:NOTIFYICONDATAW=std::mem::zeroed();icon.cbSize=std::mem::size_of::<NOTIFYICONDATAW>() as u32;icon.hWnd=hwnd;icon.uID=1;Shell_NotifyIconW(NIM_DELETE,&icon);PostQuitMessage(0);0},
 _=>DefWindowProcW(hwnd,msg,w,l)
 }
}
pub fn run(tray:bool){unsafe{
 let mutex=CreateMutexW(ptr::null(),0,wide("Local\\poe2-filter-client").as_ptr());if GetLastError()==ERROR_ALREADY_EXISTS{let old=FindWindowW(wide("Poe2FilterWindow").as_ptr(),ptr::null());if !old.is_null(){ShowWindow(old,SW_RESTORE);SetForegroundWindow(old);}return;}
 let root=sync::state_root();let settings=match sync::read_settings(&root){Ok(s)=>s,Err(e)=>{MessageBoxW(ptr::null_mut(),wide(&e).as_ptr(),wide("poe2-filter").as_ptr(),MB_OK|MB_ICONERROR);return;}};
 APP.set(Mutex::new(App{settings,busy:false,root,last:Instant::now(),failures:0,next_attempt:Instant::now()})).ok();
 CoInitializeEx(ptr::null(),COINIT_APARTMENTTHREADED as u32);
 let instance=GetModuleHandleW(ptr::null());let mut class:WNDCLASSW=std::mem::zeroed();class.lpfnWndProc=Some(proc);class.hInstance=instance;let name=wide("Poe2FilterWindow");class.lpszClassName=name.as_ptr();class.hCursor=LoadCursorW(ptr::null_mut(),IDC_ARROW);class.hbrBackground=(COLOR_BTNFACE+1) as HBRUSH;RegisterClassW(&class);
 let hwnd=CreateWindowExW(0,name.as_ptr(),wide("poe2-filter · 过滤器自动更新").as_ptr(),WS_OVERLAPPED|WS_CAPTION|WS_SYSMENU|WS_MINIMIZEBOX,CW_USEDEFAULT,CW_USEDEFAULT,915,605,ptr::null_mut(),ptr::null_mut(),instance,ptr::null());
 if !tray{ShowWindow(hwnd,SW_SHOW);}let mut msg:MSG=std::mem::zeroed();while GetMessageW(&mut msg,ptr::null_mut(),0,0)>0{if IsDialogMessageW(hwnd,&msg)==0{TranslateMessage(&msg);DispatchMessageW(&msg);}}CoUninitialize();CloseHandle(mutex);
}}
