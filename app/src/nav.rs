//! Turning what people type into URLs, and URLs back into what we show.

use crate::store::Settings;

/// Internal pages are served by the `seoran` custom protocol. WebView2 exposes
/// it as `http://seoran.<page>/`; people see `seoran://<page>`.
pub const INTERNAL_PREFIX: &str = "http://seoran.";
pub const NEW_TAB_URL: &str = "http://seoran.newtab/";

pub fn is_internal(url: &str) -> bool {
    url.starts_with(INTERNAL_PREFIX)
}

pub fn internal_url(page: &str) -> String {
    format!("{INTERNAL_PREFIX}{page}/")
}

/// The internal page name, e.g. `settings` for `http://seoran.settings/`.
pub fn internal_page(url: &str) -> Option<&str> {
    let rest = url.strip_prefix(INTERNAL_PREFIX)?;
    Some(rest.split(['/', '?', '#']).next().unwrap_or(""))
}

/// What the address bar shows for a URL. The new-tab page shows nothing.
pub fn display_url(url: &str) -> String {
    if let Some(page) = internal_page(url) {
        return if page == "newtab" { String::new() } else { format!("seoran://{page}") };
    }
    url.to_owned()
}

fn looks_like_host(s: &str) -> bool {
    let host = s.split(['/', '?', '#']).next().unwrap_or("");
    let host_no_port = host.rsplit_once(':').map_or(host, |(h, p)| {
        if p.chars().all(|c| c.is_ascii_digit()) { h } else { host }
    });
    if host_no_port == "localhost" {
        return true;
    }
    if host_no_port.parse::<std::net::Ipv4Addr>().is_ok() {
        return true;
    }
    let labels: Vec<&str> = host_no_port.split('.').collect();
    labels.len() >= 2
        && labels.iter().all(|l| {
            !l.is_empty() && l.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || !c.is_ascii())
        })
        && labels.last().is_some_and(|tld| tld.len() >= 2 && tld.chars().all(|c| c.is_alphabetic()))
}

/// Resolve address-bar input to a URL: a URL as typed, a bare host, an
/// internal `seoran://` page, or a search.
pub fn resolve_input(input: &str, settings: &Settings) -> String {
    let text = input.trim();
    if text.is_empty() {
        return NEW_TAB_URL.into();
    }
    if let Some(page) = text.strip_prefix("seoran://") {
        let page = page.trim_end_matches('/');
        return internal_url(if page.is_empty() { "newtab" } else { page });
    }
    let lower = text.to_ascii_lowercase();
    if !text.contains(char::is_whitespace) {
        if lower.starts_with("http://") || lower.starts_with("https://") || lower.starts_with("file://") {
            return text.to_owned();
        }
        if lower.starts_with("about:") || lower.starts_with("edge:") {
            return text.to_owned();
        }
        if looks_like_host(text) {
            let scheme = if lower.starts_with("localhost") || lower.starts_with("127.") { "http" } else { "https" };
            return format!("{scheme}://{text}");
        }
    }
    settings.search_url(text)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn resolves_input() {
        let s = Settings::default();
        assert_eq!(resolve_input("example.com", &s), "https://example.com");
        assert_eq!(resolve_input("example.com/a?b=1", &s), "https://example.com/a?b=1");
        assert_eq!(resolve_input("localhost:3000", &s), "http://localhost:3000");
        assert_eq!(resolve_input("https://x.org", &s), "https://x.org");
        assert_eq!(resolve_input("seoran://settings", &s), "http://seoran.settings/");
        assert_eq!(resolve_input("rust lang", &s), "https://duckduckgo.com/?q=rust+lang");
        assert_eq!(resolve_input("hello", &s), "https://duckduckgo.com/?q=hello");
        assert_eq!(resolve_input("v1.2", &s), "https://duckduckgo.com/?q=v1.2");
    }

    #[test]
    fn displays_urls() {
        assert_eq!(display_url("http://seoran.newtab/"), "");
        assert_eq!(display_url("http://seoran.settings/"), "seoran://settings");
        assert_eq!(display_url("https://a.com/"), "https://a.com/");
        assert_eq!(internal_page("http://seoran.settings/#x"), Some("settings"));
    }
}
