fn main() {
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("windows") {
        println!("cargo:rerun-if-changed=app-icon.rc");
        println!("cargo:rerun-if-changed=../app/favicon.ico");
        embed_resource::compile("app-icon.rc", embed_resource::NONE)
            .manifest_required()
            .expect("embed the Windows application icon");
    }
}
