//! Shield: the browser's ad and tracker blocker.
//!
//! A thin layer over Brave's `adblock` engine. It owns the filter engine, the
//! per-site allow list and the counters the UI shows. The engine type is not
//! `Send`, so filter lists are compiled on a worker thread with
//! [`compile_lists`] and handed to the UI thread as serialized bytes, which
//! [`Shield::load_compiled`] restores quickly.

use std::collections::HashSet;

use adblock::{Engine, FilterSet, lists::ParseOptions, request::Request, resources::Resource};
use base64::{Engine as _, prelude::BASE64_STANDARD};

/// A small built-in list so blocking works on first launch, before the full
/// EasyList download finishes.
pub const BUILTIN_LIST: &str = include_str!("../lists/builtin.txt");

/// Our own YouTube rules (scriptlets + cosmetic + network).
pub const YOUTUBE_LIST: &str = include_str!("../lists/youtube.txt");

/// Lists that are always compiled in, before any remote list.
pub const BUNDLED_LISTS: &[&str] = &[BUILTIN_LIST, YOUTUBE_LIST];

/// Lists fetched in the background and cached on disk.
pub const REMOTE_LISTS: &[(&str, &str)] = &[
    ("easylist", "https://easylist.to/easylist/easylist.txt"),
    ("easyprivacy", "https://easylist.to/easylist/easyprivacy.txt"),
    ("ublock-filters", "https://ublockorigin.github.io/uAssets/filters/filters.txt"),
    ("ublock-quick-fixes", "https://ublockorigin.github.io/uAssets/filters/quick-fixes.txt"),
];

/// Scriptlets `+js(...)` rules can call: (file name, aliases, source).
const SCRIPTLETS: &[(&str, &[&str], &str)] = &[
    (
        "set-constant.js",
        &["set-constant", "set", "set.js"],
        include_str!("../scriptlets/set-constant.js"),
    ),
    ("json-prune.js", &["json-prune"], include_str!("../scriptlets/json-prune.js")),
    (
        "json-prune-fetch-response.js",
        &["json-prune-fetch-response"],
        include_str!("../scriptlets/json-prune-fetch-response.js"),
    ),
    (
        "json-prune-xhr-response.js",
        &["json-prune-xhr-response"],
        include_str!("../scriptlets/json-prune-xhr-response.js"),
    ),
    ("seoran-yt-skip.js", &["seoran-yt-skip"], include_str!("../scriptlets/seoran-yt-skip.js")),
];

fn scriptlet_resources() -> Vec<Resource> {
    SCRIPTLETS
        .iter()
        .map(|(name, aliases, src)| {
            serde_json::from_value(serde_json::json!({
                "name": name,
                "aliases": aliases,
                "kind": { "mime": "application/javascript" },
                "content": BASE64_STANDARD.encode(src),
            }))
            .expect("scriptlet resource")
        })
        .collect()
}

/// What kind of resource a request loads. Mirrors the browser engine's
/// resource contexts, mapped to the names filter lists use.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ResourceKind {
    Document,
    Subdocument,
    Stylesheet,
    Image,
    Media,
    Font,
    Script,
    Xhr,
    WebSocket,
    Ping,
    Other,
}

impl ResourceKind {
    pub fn as_filter_type(self) -> &'static str {
        match self {
            ResourceKind::Document => "document",
            ResourceKind::Subdocument => "subdocument",
            ResourceKind::Stylesheet => "stylesheet",
            ResourceKind::Image => "image",
            ResourceKind::Media => "media",
            ResourceKind::Font => "font",
            ResourceKind::Script => "script",
            ResourceKind::Xhr => "xmlhttprequest",
            ResourceKind::WebSocket => "websocket",
            ResourceKind::Ping => "ping",
            ResourceKind::Other => "other",
        }
    }
}

/// Compile one or more filter lists into serialized engine bytes.
/// Safe to call on any thread; the result is `Send`.
pub fn compile_lists<'a>(lists: impl IntoIterator<Item = &'a str>) -> Vec<u8> {
    build_engine(lists).serialize()
}

fn build_engine<'a>(lists: impl IntoIterator<Item = &'a str>) -> Engine {
    let mut set = FilterSet::new(false);
    for list in lists {
        set.add_filter_list(list.to_owned(), ParseOptions::default());
    }
    let mut engine = Engine::new_with_filter_set(set);
    engine.use_resources(scriptlet_resources());
    engine
}

/// Returns the registrable-ish host of a URL (lowercase, no `www.`).
pub fn site_of(url: &str) -> Option<String> {
    let rest = url.split_once("://")?.1;
    let host = rest
        .split(['/', '?', '#'])
        .next()?
        .rsplit('@')
        .next()?
        .split(':')
        .next()?
        .to_ascii_lowercase();
    if host.is_empty() {
        return None;
    }
    Some(host.trim_start_matches("www.").to_owned())
}

pub struct Shield {
    engine: Engine,
    enabled: bool,
    allowed_sites: HashSet<String>,
    rule_sources: Vec<String>,
    blocked_total: u64,
}

impl Default for Shield {
    fn default() -> Self {
        Self::new()
    }
}

impl Shield {
    /// A shield using only the built-in list.
    pub fn new() -> Self {
        Self {
            engine: build_engine(BUNDLED_LISTS.iter().copied()),
            enabled: true,
            allowed_sites: HashSet::new(),
            rule_sources: vec!["builtin".into(), "youtube".into()],
            blocked_total: 0,
        }
    }

    /// Swap in an engine compiled with [`compile_lists`]. Keeps the current
    /// engine if the bytes are invalid.
    pub fn load_compiled(&mut self, bytes: &[u8], sources: Vec<String>) -> bool {
        let mut engine = Engine::default();
        if engine.deserialize(bytes).is_ok() {
            engine.use_resources(scriptlet_resources());
            self.engine = engine;
            self.rule_sources = sources;
            true
        } else {
            false
        }
    }

    pub fn sources(&self) -> &[String] {
        &self.rule_sources
    }

    pub fn enabled(&self) -> bool {
        self.enabled
    }

    pub fn set_enabled(&mut self, on: bool) {
        self.enabled = on;
    }

    pub fn blocked_total(&self) -> u64 {
        self.blocked_total
    }

    pub fn set_blocked_total(&mut self, n: u64) {
        self.blocked_total = n;
    }

    pub fn allowed_sites(&self) -> impl Iterator<Item = &String> {
        self.allowed_sites.iter()
    }

    /// Whether blocking is active on the page at `page_url`.
    pub fn active_on(&self, page_url: &str) -> bool {
        self.enabled
            && site_of(page_url).is_none_or(|site| !self.allowed_sites.contains(&site))
    }

    /// Turn blocking off (`allow = true`) or back on for one site.
    pub fn set_site_allowed(&mut self, site: &str, allow: bool) {
        let site = site.trim_start_matches("www.").to_ascii_lowercase();
        if allow {
            self.allowed_sites.insert(site);
        } else {
            self.allowed_sites.remove(&site);
        }
    }

    /// Decide whether to block a request made by the page at `page_url`.
    /// Top-level navigations are never blocked.
    pub fn should_block(&mut self, url: &str, page_url: &str, kind: ResourceKind) -> bool {
        if kind == ResourceKind::Document || !self.active_on(page_url) {
            return false;
        }
        if !(url.starts_with("http://") || url.starts_with("https://") || url.starts_with("ws")) {
            return false;
        }
        let Ok(req) = Request::new(url, page_url, kind.as_filter_type(), "GET") else {
            return false;
        };
        let block = self.engine.check_network_request(&req).should_block();
        if block {
            self.blocked_total += 1;
        }
        block
    }

    /// Selectors of ad slots to hide on the page (cosmetic filtering).
    pub fn cosmetic_selectors(&self, page_url: &str) -> Vec<String> {
        if !self.active_on(page_url) {
            return Vec::new();
        }
        let res = self.engine.url_cosmetic_resources(page_url);
        let mut selectors: Vec<String> = res.hide_selectors.into_iter().collect();
        selectors.sort_unstable();
        selectors
    }

    /// The same as CSS text, one rule per selector.
    pub fn cosmetic_css(&self, page_url: &str) -> Option<String> {
        let selectors = self.cosmetic_selectors(page_url);
        if selectors.is_empty() {
            return None;
        }
        Some(selectors.iter().map(|s| format!("{s}{{display:none!important}}\n")).collect())
    }

    /// Script to run in the page before any of its own scripts: scriptlets
    /// (e.g. stripping YouTube's ad data) plus the cosmetic CSS. Guarded so it
    /// only acts in a frame whose host matches the page it was built for.
    pub fn document_start_script(&self, page_url: &str) -> Option<String> {
        if !self.active_on(page_url) {
            return None;
        }
        let host = page_url.split_once("://")?.1.split(['/', '?', '#', ':']).next()?;
        let res = self.engine.url_cosmetic_resources(page_url);
        let selectors = self.cosmetic_selectors(page_url);
        if res.injected_script.is_empty() && selectors.is_empty() {
            return None;
        }
        let host_js = serde_json::to_string(host).ok()?;
        let sel_js = serde_json::to_string(&selectors).ok()?;
        // Each selector gets its own rule: one the browser can't parse (e.g.
        // a uBO-only pseudo-class) must not disable the others.
        Some(format!(
            "(function(){{if(location.hostname!=={host_js})return;\n\
             try{{\n{script}\n}}catch(e){{}}\n\
             const sels={sel_js};if(sels.length){{const add=()=>{{const s=document.createElement('style');\
             (document.head||document.documentElement).appendChild(s);const sh=s.sheet;\
             for(const x of sels){{try{{sh.insertRule(x+'{{display:none!important}}',sh.cssRules.length);}}catch(e){{}}}}}};\
             if(document.documentElement)add();else document.addEventListener('readystatechange',add,{{once:true}});}}\n}})();",
            script = res.injected_script,
        ))
    }

    /// Which scriptlets run on the page, with how many rules call each.
    pub fn scriptlet_calls(&self, page_url: &str) -> Vec<(&'static str, usize)> {
        if !self.active_on(page_url) {
            return Vec::new();
        }
        let script = self.engine.url_cosmetic_resources(page_url).injected_script;
        SCRIPTLETS
            .iter()
            .filter_map(|(file, _, src)| {
                let func = src.strip_prefix("function ")?.split('(').next()?.trim();
                // The definition is one occurrence; every other one is a call.
                let n = script.matches(&format!("{func}(")).count().saturating_sub(1);
                (n > 0).then(|| (file.trim_end_matches(".js"), n))
            })
            .collect()
    }

    /// Generic hide selectors for classes and ids found on the page.
    pub fn generic_hide_selectors(
        &self,
        page_url: &str,
        classes: &[String],
        ids: &[String],
    ) -> Vec<String> {
        if !self.active_on(page_url) {
            return Vec::new();
        }
        let res = self.engine.url_cosmetic_resources(page_url);
        if res.generichide {
            return Vec::new();
        }
        self.engine.hidden_class_id_selectors(classes, ids, &res.exceptions)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn blocks_known_ad_hosts() {
        let mut s = Shield::new();
        assert!(s.should_block(
            "https://securepubads.g.doubleclick.net/tag/js/gpt.js",
            "https://news.example.com/",
            ResourceKind::Script
        ));
        assert!(s.should_block(
            "https://www.google-analytics.com/analytics.js",
            "https://shop.example.com/",
            ResourceKind::Script
        ));
        assert_eq!(s.blocked_total(), 2);
    }

    #[test]
    fn allows_normal_requests_and_documents() {
        let mut s = Shield::new();
        assert!(!s.should_block(
            "https://cdn.example.com/app.js",
            "https://example.com/",
            ResourceKind::Script
        ));
        assert!(!s.should_block(
            "https://doubleclick.net/",
            "https://doubleclick.net/",
            ResourceKind::Document
        ));
    }

    #[test]
    fn per_site_allow_and_global_toggle() {
        let mut s = Shield::new();
        let ad = "https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js";
        s.set_site_allowed("www.Example.com", true);
        assert!(!s.should_block(ad, "https://example.com/a", ResourceKind::Script));
        assert!(s.should_block(ad, "https://other.com/", ResourceKind::Script));
        s.set_site_allowed("example.com", false);
        s.set_enabled(false);
        assert!(!s.should_block(ad, "https://other.com/", ResourceKind::Script));
    }

    #[test]
    fn compiled_round_trip() {
        let bytes = compile_lists(["||ads.example^"]);
        let mut s = Shield::new();
        assert!(s.load_compiled(&bytes, vec!["test".into()]));
        assert!(s.should_block("https://ads.example/x.js", "https://a.com/", ResourceKind::Script));
        assert!(!s.load_compiled(b"garbage", vec![]));
    }

    #[test]
    fn cosmetic_rules() {
        let s = Shield::new();
        let css = s.cosmetic_css("https://example.com/").unwrap_or_default();
        assert!(css.contains("display:none"), "{css}");
        let sel = s.generic_hide_selectors("https://example.com/", &["adsbygoogle".into()], &[]);
        assert!(!sel.is_empty());
    }

    #[test]
    fn youtube_scriptlets_injected() {
        let s = Shield::new();
        let js = s
            .document_start_script("https://www.youtube.com/watch?v=abc")
            .expect("youtube script");
        for needle in [
            "setConstant(",
            "jsonPrune(",
            "jsonPruneFetchResponse(",
            "jsonPruneXhrResponse(",
            "seoranYtSkip(",
            "ytInitialPlayerResponse.playerAds",
            "ytd-ad-slot-renderer",
            "#player-ads",
            "insertRule",
            "location.hostname!==\"www.youtube.com\"",
        ] {
            assert!(js.contains(needle), "missing {needle}");
        }
        // Other sites get no YouTube scriptlets.
        let other = s.document_start_script("https://example.com/").unwrap_or_default();
        assert!(!other.contains("seoranYtSkip("));
    }

    #[test]
    fn scriptlet_report() {
        let s = Shield::new();
        let calls = s.scriptlet_calls("https://www.youtube.com/watch?v=abc");
        let get = |n: &str| calls.iter().find(|c| c.0 == n).map(|c| c.1);
        assert_eq!(get("set-constant"), Some(4));
        assert_eq!(get("json-prune"), Some(1));
        assert_eq!(get("seoran-yt-skip"), Some(1));
        assert!(s.scriptlet_calls("https://example.com/").is_empty());
    }

    #[test]
    fn youtube_ad_endpoints_blocked() {
        let mut s = Shield::new();
        assert!(s.should_block(
            "https://www.youtube.com/pagead/viewthroughconversion/123",
            "https://www.youtube.com/watch?v=abc",
            ResourceKind::Image
        ));
        assert!(!s.should_block(
            "https://www.youtube.com/youtubei/v1/player?key=x",
            "https://www.youtube.com/watch?v=abc",
            ResourceKind::Xhr
        ));
    }

    #[test]
    fn site_parsing() {
        assert_eq!(site_of("https://www.Example.com:8080/x?y").as_deref(), Some("example.com"));
        assert_eq!(site_of("http://user@host.io/").as_deref(), Some("host.io"));
        assert_eq!(site_of("about:blank"), None);
    }
}
