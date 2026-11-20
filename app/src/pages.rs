//! Built-in pages served over the `seoran://` protocol. Files are compiled
//! into the binary, so the browser UI works offline and can't be tampered
//! with on disk.

pub const CSP: &str = "default-src 'self'; script-src 'self' 'unsafe-inline'; \
    style-src 'self' 'unsafe-inline'; img-src * data:; font-src 'self' data:; \
    connect-src 'none'; frame-src 'none'; object-src 'none'";

const HTML: &str = "text/html; charset=utf-8";
const CSS: &str = "text/css; charset=utf-8";
const JS: &str = "text/javascript; charset=utf-8";
const SVG: &str = "image/svg+xml";

pub fn asset(page: &str, path: &str) -> Option<(&'static str, &'static [u8])> {
    if path == "/fonts/unbounded.woff2" {
        // Unbounded, SIL Open Font License 1.1 (ui/fonts/Unbounded-OFL.txt).
        return Some(("font/woff2", include_bytes!("../ui/fonts/Unbounded.woff2")));
    }
    let found: (&str, &str) = match (page, path) {
        (_, "/seoran.css") => (CSS, include_str!("../ui/seoran.css")),
        (_, "/icons.js") => (JS, include_str!("../ui/icons.js")),
        (_, "/odometer.js") => (JS, include_str!("../ui/odometer.js")),
        (_, "/logo.svg") => (SVG, include_str!("../ui/logo.svg")),
        ("chrome", "/") => (HTML, include_str!("../ui/chrome.html")),
        ("chrome", "/chrome.css") => (CSS, include_str!("../ui/chrome.css")),
        ("chrome", "/chrome.js") => (JS, include_str!("../ui/chrome.js")),
        ("newtab", "/") => (HTML, include_str!("../ui/newtab.html")),
        ("settings", "/") => (HTML, include_str!("../ui/settings.html")),
        ("devtools", "/") => (HTML, include_str!("../ui/devtools/devtools.html")),
        ("devtools", "/devtools.css") => (CSS, include_str!("../ui/devtools/devtools.css")),
        ("devtools", "/devtools.js") => (JS, include_str!("../ui/devtools/devtools.js")),
        _ => return None,
    };
    Some((found.0, found.1.as_bytes()))
}
