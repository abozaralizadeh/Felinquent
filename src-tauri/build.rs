fn main() {
    // The app embeds the built web page (../dist). Cargo does not notice new or renamed files there,
    // so without this a rebuild can ship an old page. Watching the folder makes it re-embed.
    println!("cargo:rerun-if-changed=../dist");
    tauri_build::build()
}
