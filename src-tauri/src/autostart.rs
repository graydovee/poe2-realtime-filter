//! Start the client when the user signs in. The entry lives in the per-user Run key, so it
//! needs no administrator rights. The switch shows the registry rather than a saved copy.

use crate::engine::Result;
use std::{ffi::OsStr, os::windows::ffi::OsStrExt};
use windows_sys::Win32::{
    Foundation::{ERROR_FILE_NOT_FOUND, ERROR_SUCCESS},
    System::Registry::{
        RegCloseKey, RegCreateKeyW, RegDeleteKeyValueW, RegGetValueW, RegSetValueExW,
        HKEY_CURRENT_USER, REG_SZ, RRF_RT_REG_SZ,
    },
};

/// Launch quietly into the tray instead of opening the window.
pub const TRAY_ARGUMENT: &str = "--tray";
const RUN_KEY: &str = "Software\\Microsoft\\Windows\\CurrentVersion\\Run";
// The same entry name the earlier tray client wrote, so turning it on replaces a stale path.
const ENTRY: &str = "poe2-filter";

fn wide(text: &str) -> Vec<u16> {
    OsStr::new(text).encode_wide().chain(Some(0)).collect()
}

fn checked(code: u32, action: &str) -> Result<()> {
    if code == ERROR_SUCCESS {
        return Ok(());
    }
    let reason = std::io::Error::from_raw_os_error(code as i32);
    Err(format!("{action}失败：{reason}"))
}

fn command() -> Result<String> {
    let exe = std::env::current_exe().map_err(|error| format!("无法确定客户端路径：{error}"))?;
    Ok(format!("\"{}\" {TRAY_ARGUMENT}", exe.display()))
}

fn read(run_key: &str, entry: &str) -> Result<Option<String>> {
    let (key, name) = (wide(run_key), wide(entry));
    let mut bytes = 0u32;
    let status = unsafe {
        RegGetValueW(
            HKEY_CURRENT_USER,
            key.as_ptr(),
            name.as_ptr(),
            RRF_RT_REG_SZ,
            std::ptr::null_mut(),
            std::ptr::null_mut(),
            &mut bytes,
        )
    };
    if status == ERROR_FILE_NOT_FOUND {
        return Ok(None);
    }
    checked(status, "读取启动项")?;
    // The size includes the terminating NUL.
    let mut buffer = vec![0u16; (bytes as usize / 2).max(1)];
    let status = unsafe {
        RegGetValueW(
            HKEY_CURRENT_USER,
            key.as_ptr(),
            name.as_ptr(),
            RRF_RT_REG_SZ,
            std::ptr::null_mut(),
            buffer.as_mut_ptr().cast(),
            &mut bytes,
        )
    };
    checked(status, "读取启动项")?;
    Ok(Some(
        String::from_utf16_lossy(&buffer[..bytes as usize / 2])
            .trim_end_matches('\0')
            .to_owned(),
    ))
}

fn is_current(run_key: &str, entry: &str, expected: &str) -> Result<bool> {
    Ok(read(run_key, entry)?.is_some_and(|value| value.eq_ignore_ascii_case(expected)))
}

fn write(run_key: &str, entry: &str, enabled: bool, command: &str) -> Result<()> {
    if !enabled {
        let status = unsafe {
            RegDeleteKeyValueW(
                HKEY_CURRENT_USER,
                wide(run_key).as_ptr(),
                wide(entry).as_ptr(),
            )
        };
        // Turning it off twice, or off for a user who never turned it on, is not an error.
        if status != ERROR_FILE_NOT_FOUND {
            checked(status, "移除启动项")?;
        }
        return Ok(());
    }
    let mut key = std::ptr::null_mut();
    checked(
        unsafe { RegCreateKeyW(HKEY_CURRENT_USER, wide(run_key).as_ptr(), &mut key) },
        "打开启动项",
    )?;
    let value = wide(command);
    let status = unsafe {
        RegSetValueExW(
            key,
            wide(entry).as_ptr(),
            0,
            REG_SZ,
            value.as_ptr().cast(),
            (value.len() * 2) as u32,
        )
    };
    unsafe { RegCloseKey(key) };
    checked(status, "写入启动项")?;
    Ok(())
}

/// Whether the Run entry points at this client. Another install location counts as off.
pub fn enabled() -> Result<bool> {
    is_current(RUN_KEY, ENTRY, &command()?)
}

pub fn set(enabled: bool) -> Result<()> {
    let command = command()?;
    write(RUN_KEY, ENTRY, enabled, &command)?;
    if enabled && !is_current(RUN_KEY, ENTRY, &command)? {
        return Err("启动项未能写入，请检查当前用户的启动项设置".into());
    }
    Ok(())
}

/// Whether this process was launched by the startup entry.
pub fn requested() -> bool {
    std::env::args_os()
        .skip(1)
        .any(|argument| argument == TRAY_ARGUMENT)
}

#[cfg(test)]
mod tests {
    use super::*;
    use windows_sys::Win32::System::Registry::RegDeleteTreeW;

    #[test]
    fn startup_command_quotes_the_client_and_adds_the_tray_argument() {
        let command = command().unwrap();
        assert!(
            command.starts_with('"') && command.ends_with(&format!("\" {TRAY_ARGUMENT}")),
            "{command}"
        );
        let exe = command
            .trim_start_matches('"')
            .replace(&format!("\" {TRAY_ARGUMENT}"), "");
        assert!(std::path::Path::new(&exe).is_file(), "{exe}");
    }

    #[test]
    fn run_entry_round_trips_under_a_throwaway_key() {
        // Never touch the real Run key from the tests.
        const TEST_ROOT: &str = "Software\\poe2-realtime-filter-tests";
        let run_key = format!("{TEST_ROOT}\\Run-{}", std::process::id());
        const ENTRY: &str = "poe2-filter";
        const COMMAND: &str = "\"C:\\Apps\\PoE2 Realtime Filter\\poe2-realtime-filter.exe\" --tray";
        let cleanup = || unsafe { RegDeleteTreeW(HKEY_CURRENT_USER, wide(TEST_ROOT).as_ptr()) };
        cleanup();
        assert!(!is_current(&run_key, ENTRY, COMMAND).unwrap());
        // Nothing to remove yet, and that is fine.
        write(&run_key, ENTRY, false, COMMAND).unwrap();

        write(&run_key, ENTRY, true, COMMAND).unwrap();
        assert_eq!(read(&run_key, ENTRY).unwrap().as_deref(), Some(COMMAND));
        assert!(is_current(&run_key, ENTRY, COMMAND).unwrap());
        // Windows paths are case-insensitive.
        assert!(is_current(&run_key, ENTRY, &COMMAND.to_uppercase()).unwrap());
        // An entry left by another install location does not count as on.
        assert!(!is_current(&run_key, ENTRY, "\"D:\\Old\\client.exe\" --tray").unwrap());
        // Turning it on again replaces the stale path.
        write(&run_key, ENTRY, true, "\"D:\\Old\\client.exe\" --tray").unwrap();
        assert!(!is_current(&run_key, ENTRY, COMMAND).unwrap());
        write(&run_key, ENTRY, true, COMMAND).unwrap();
        assert!(is_current(&run_key, ENTRY, COMMAND).unwrap());

        write(&run_key, ENTRY, false, COMMAND).unwrap();
        assert_eq!(read(&run_key, ENTRY).unwrap(), None);
        write(&run_key, ENTRY, false, COMMAND).unwrap();
        assert_eq!(cleanup(), ERROR_SUCCESS);
    }
}
