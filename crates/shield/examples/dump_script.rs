//! Prints the document-start script the shield injects for a URL.
//! Usage: cargo run -p shield --example dump_script -- https://www.youtube.com/watch?v=x
fn main() {
    let url = std::env::args().nth(1).unwrap_or_else(|| "https://www.youtube.com/watch?v=x".into());
    let shield = shield::Shield::new();
    print!("{}", shield.document_start_script(&url).unwrap_or_default());
}
