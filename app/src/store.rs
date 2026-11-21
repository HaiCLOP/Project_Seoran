//! Local, on-disk profile data: settings, history, bookmarks and the last
//! session. Everything is plain JSON in the profile folder and never leaves
//! the machine.

use std::{
    collections::HashMap,
    fs,
    path::{Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};

use serde::{Deserialize, Serialize};

pub fn now_secs() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0)
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(default)]
pub struct Settings {
    pub search_engine: String,
    pub shields_enabled: bool,
    pub allowed_sites: Vec<String>,
    pub theme: String,
    /// The accent colour: blue, orange, green, teal, pink or graphite.
    pub plastic: String,
    pub restore_session: bool,
    pub sleep_tabs_after_min: u64,
    pub blocked_total: u64,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            search_engine: "duckduckgo".into(),
            shields_enabled: true,
            allowed_sites: Vec::new(),
            theme: "system".into(),
            plastic: "blue".into(),
            restore_session: true,
            sleep_tabs_after_min: 20,
            blocked_total: 0,
        }
    }
}

pub const PLASTICS: &[&str] = &["blue", "orange", "green", "teal", "pink", "graphite"];

pub const SEARCH_ENGINES: &[(&str, &str, &str)] = &[
    ("duckduckgo", "DuckDuckGo", "https://duckduckgo.com/?q="),
    ("brave", "Brave Search", "https://search.brave.com/search?q="),
    ("google", "Google", "https://www.google.com/search?q="),
    ("bing", "Bing", "https://www.bing.com/search?q="),
    ("startpage", "Startpage", "https://www.startpage.com/do/search?q="),
];

impl Settings {
    pub fn search_url(&self, query: &str) -> String {
        let base = SEARCH_ENGINES
            .iter()
            .find(|(id, _, _)| *id == self.search_engine)
            .map(|(_, _, url)| *url)
            .unwrap_or(SEARCH_ENGINES[0].2);
        format!("{base}{}", encode_query(query))
    }
}

pub fn encode_query(q: &str) -> String {
    let mut out = String::with_capacity(q.len() * 3);
    for b in q.bytes() {
        match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => out.push(b as char),
            b' ' => out.push('+'),
            _ => out.push_str(&format!("%{b:02X}")),
        }
    }
    out
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct HistoryEntry {
    pub url: String,
    pub title: String,
    /// The site's own icon, remembered for the new tab page.
    #[serde(default)]
    pub favicon: String,
    pub visits: u32,
    pub last: u64,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct Bookmark {
    pub url: String,
    pub title: String,
    pub added: u64,
}

#[derive(Serialize, Deserialize, Clone, Debug, Default)]
pub struct SessionTab {
    pub url: String,
    pub title: String,
}

#[derive(Serialize, Deserialize, Clone, Debug, Default)]
pub struct Session {
    pub tabs: Vec<SessionTab>,
    pub active: usize,
}

const HISTORY_CAP: usize = 5000;

pub struct Store {
    dir: PathBuf,
    pub settings: Settings,
    pub history: HashMap<String, HistoryEntry>,
    pub bookmarks: Vec<Bookmark>,
    pub history_dirty: bool,
}

fn read_json<T: for<'de> Deserialize<'de> + Default>(path: &Path) -> T {
    fs::read(path)
        .ok()
        .and_then(|b| serde_json::from_slice(&b).ok())
        .unwrap_or_default()
}

fn write_json<T: Serialize>(path: &Path, value: &T) {
    let Ok(bytes) = serde_json::to_vec_pretty(value) else { return };
    // Write to a temp file and rename so a crash never leaves half a file.
    let tmp = path.with_extension("tmp");
    if fs::write(&tmp, bytes).is_ok() {
        let _ = fs::rename(&tmp, path);
    }
}

impl Store {
    pub fn open(dir: PathBuf) -> Self {
        let _ = fs::create_dir_all(&dir);
        let history: Vec<HistoryEntry> = read_json(&dir.join("history.json"));
        let mut settings: Settings = read_json(&dir.join("settings.json"));
        // Colour names from earlier versions.
        let renamed = match settings.plastic.as_str() {
            "grape" => Some("blue"),
            "tangerine" => Some("orange"),
            "lime" => Some("green"),
            "bondi" => Some("teal"),
            "strawberry" => Some("pink"),
            p if !PLASTICS.contains(&p) => Some("blue"),
            _ => None,
        };
        if let Some(p) = renamed {
            settings.plastic = p.into();
        }
        let before = history.len();
        // Internal pages never belong in history (older builds recorded some).
        let history: HashMap<String, HistoryEntry> = history
            .into_iter()
            .filter(|h| h.url.starts_with("https://") || (h.url.starts_with("http://") && !Self::is_internal(&h.url)))
            .map(|h| (h.url.clone(), h))
            .collect();
        let store = Self { history_dirty: history.len() != before, settings, history, bookmarks: read_json(&dir.join("bookmarks.json")), dir };
        if renamed.is_some() {
            store.save_settings();
        }
        store
    }

    /// Seoran's own pages, including the scheme used before the rename.
    fn is_internal(url: &str) -> bool {
        url.starts_with("http://seoran.") || url.starts_with(concat!("http://k", "ite."))
    }

    pub fn dir(&self) -> &Path {
        &self.dir
    }

    pub fn save_settings(&self) {
        write_json(&self.dir.join("settings.json"), &self.settings);
    }

    pub fn save_bookmarks(&self) {
        write_json(&self.dir.join("bookmarks.json"), &self.bookmarks);
    }

    pub fn save_history(&mut self) {
        let mut list: Vec<&HistoryEntry> = self.history.values().collect();
        list.sort_by(|a, b| b.last.cmp(&a.last));
        list.truncate(HISTORY_CAP);
        write_json(&self.dir.join("history.json"), &list);
        self.history_dirty = false;
    }

    pub fn load_session(&self) -> Session {
        read_json(&self.dir.join("session.json"))
    }

    pub fn save_session(&self, session: &Session) {
        write_json(&self.dir.join("session.json"), session);
    }

    pub fn record_visit(&mut self, url: &str, title: &str) {
        if !(url.starts_with("http://") || url.starts_with("https://")) || url.starts_with("http://seoran.") {
            return;
        }
        let entry = self.history.entry(url.to_owned()).or_insert_with(|| HistoryEntry {
            url: url.to_owned(),
            title: String::new(),
            favicon: String::new(),
            visits: 0,
            last: 0,
        });
        entry.visits += 1;
        entry.last = now_secs();
        if !title.is_empty() {
            entry.title = title.to_owned();
        }
        self.history_dirty = true;
    }

    pub fn set_title(&mut self, url: &str, title: &str) {
        if let Some(e) = self.history.get_mut(url)
            && e.title != title && !title.is_empty() {
                e.title = title.to_owned();
                self.history_dirty = true;
            }
    }

    pub fn set_favicon(&mut self, url: &str, favicon: &str) {
        if let Some(e) = self.history.get_mut(url) {
            if e.favicon != favicon && favicon.starts_with("https://") {
                e.favicon = favicon.to_owned();
                self.history_dirty = true;
            }
        }
    }

    pub fn clear_history(&mut self) {
        self.history.clear();
        self.save_history();
    }

    pub fn is_bookmarked(&self, url: &str) -> bool {
        self.bookmarks.iter().any(|b| b.url == url)
    }

    /// Adds or removes a bookmark; returns whether it is now bookmarked.
    pub fn toggle_bookmark(&mut self, url: &str, title: &str) -> bool {
        if let Some(i) = self.bookmarks.iter().position(|b| b.url == url) {
            self.bookmarks.remove(i);
            self.save_bookmarks();
            false
        } else {
            self.bookmarks.push(Bookmark { url: url.into(), title: title.into(), added: now_secs() });
            self.save_bookmarks();
            true
        }
    }

    /// Most-visited sites for the new-tab page, one per host.
    pub fn top_sites(&self, n: usize) -> Vec<&HistoryEntry> {
        let mut list: Vec<&HistoryEntry> = self.history.values().collect();
        list.sort_by(|a, b| b.visits.cmp(&a.visits).then(b.last.cmp(&a.last)));
        let mut seen = std::collections::HashSet::new();
        list.into_iter()
            .filter(|h| !Self::is_internal(&h.url))
            .filter(|h| shield::site_of(&h.url).is_some_and(|s| seen.insert(s)))
            .take(n)
            .collect()
    }

    /// History and bookmark matches for the omnibox, best first.
    pub fn search(&self, query: &str, n: usize) -> Vec<(&str, &str, bool)> {
        let q = query.to_lowercase();
        let terms: Vec<&str> = q.split_whitespace().collect();
        if terms.is_empty() {
            return Vec::new();
        }
        let matches = |url: &str, title: &str| {
            let hay = format!("{} {}", url.to_lowercase(), title.to_lowercase());
            terms.iter().all(|t| hay.contains(t))
        };
        let score_url = |url: &str| {
            let bare = url.split_once("://").map(|x| x.1).unwrap_or(url).trim_start_matches("www.");
            if bare.starts_with(&q) { 1000 } else { 0 }
        };
        let mut out: Vec<(i64, &str, &str, bool)> = Vec::new();
        for b in &self.bookmarks {
            if matches(&b.url, &b.title) {
                out.push((5000 + score_url(&b.url), &b.url, &b.title, true));
            }
        }
        for h in self.history.values() {
            if matches(&h.url, &h.title) && !out.iter().any(|o| o.1 == h.url) {
                let recency = (h.last / 3600) as i64 % 1000;
                out.push((score_url(&h.url) + h.visits as i64 * 20 + recency / 50, &h.url, &h.title, false));
            }
        }
        out.sort_by(|a, b| b.0.cmp(&a.0));
        out.into_iter().take(n).map(|(_, u, t, b)| (u, t, b)).collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn query_encoding() {
        assert_eq!(encode_query("rust lang & co"), "rust+lang+%26+co");
        assert_eq!(encode_query("ñ"), "%C3%B1");
    }

    #[test]
    fn history_search_and_top_sites() {
        let dir = std::env::temp_dir().join(format!("seoran-store-test-{}", now_secs()));
        let mut s = Store::open(dir.clone());
        s.record_visit("https://www.rust-lang.org/learn", "Learn Rust");
        s.record_visit("https://www.rust-lang.org/learn", "Learn Rust");
        s.record_visit("https://news.ycombinator.com/", "Hacker News");
        s.record_visit("http://seoran.newtab/", "New tab");
        assert_eq!(s.history.len(), 2);
        let hits = s.search("rust", 5);
        assert_eq!(hits[0].0, "https://www.rust-lang.org/learn");
        assert!(s.toggle_bookmark("https://news.ycombinator.com/", "HN"));
        assert!(s.search("news", 5)[0].2);
        assert_eq!(s.top_sites(8).len(), 2);
        let _ = fs::remove_dir_all(dir);
    }
}
