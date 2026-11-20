# poe2-filter Windows client

Native Win32 tray updater for saved poe2-filter subscription links.

## Local Windows build

```powershell
cargo test --target x86_64-pc-windows-msvc
cargo build --release --target x86_64-pc-windows-msvc
.\target\x86_64-pc-windows-msvc\release\poe2-filter-client.exe --diagnostics
```

The client locates `%USERPROFILE%\Documents\My Games\Path of Exile 2` through the Windows Known Folder API. Add a read-only link copied from the website, then choose the directory and click **添加方案**.
