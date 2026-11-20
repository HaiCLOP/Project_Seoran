//! Keeps the shield's filter lists fresh. Runs on a worker thread: loads the
//! cached compiled engine first (fast start), then refreshes lists older than
//! a day, recompiles and hands the new engine to the UI thread.

use std::{
    fs,
    path::PathBuf,
    time::{Duration, SystemTime},
};

const MAX_AGE: Duration = Duration::from_secs(24 * 3600);
const ENGINE_FILE: &str = "engine.bin";
const ENGINE_SOURCES: &str = "engine.sources";

pub struct Compiled {
    pub bytes: Vec<u8>,
    pub sources: Vec<String>,
    pub from_cache: bool,
}

fn age(path: &PathBuf) -> Option<Duration> {
    fs::metadata(path).ok()?.modified().ok().and_then(|m| SystemTime::now().duration_since(m).ok())
}

fn fetch(url: &str) -> Option<String> {
    use ureq::tls::{RootCerts, TlsConfig, TlsProvider};
    // Windows' own TLS stack and certificate store: no bundled crypto.
    let tls = TlsConfig::builder()
        .provider(TlsProvider::NativeTls)
        .root_certs(RootCerts::PlatformVerifier)
        .build();
    let agent: ureq::Agent = ureq::Agent::config_builder()
        .tls_config(tls)
        .timeout_global(Some(Duration::from_secs(45)))
        .user_agent("Seoran-Browser/0.1 (filter-list updater)")
        .build()
        .into();
    let mut resp = agent.get(url).call().ok()?;
    resp.body_mut().with_config().limit(16 * 1024 * 1024).read_to_string().ok()
}

fn bundle_tag() -> String {
    use std::hash::{Hash, Hasher};
    let mut h = std::collections::hash_map::DefaultHasher::new();
    shield::BUNDLED_LISTS.hash(&mut h);
    env!("CARGO_PKG_VERSION").hash(&mut h);
    format!("#bundle:{:016x}", h.finish())
}

/// Spawn the updater. `send` is called at most twice: once with the cached
/// engine (if any) and once after a refresh that changed something.
pub fn spawn(dir: PathBuf, force: bool, send: impl Fn(Compiled) + Send + 'static) {
    std::thread::Builder::new()
        .name("filter-lists".into())
        .spawn(move || {
            let lists_dir = dir.join("filters");
            let _ = fs::create_dir_all(&lists_dir);
            let engine_path = lists_dir.join(ENGINE_FILE);

            // The cache is only valid for the bundled lists it was built with.
            let tag = bundle_tag();
            let cached_sources = fs::read_to_string(lists_dir.join(ENGINE_SOURCES)).unwrap_or_default();
            let mut lines = cached_sources.lines();
            let cache_valid = lines.next() == Some(tag.as_str());
            if !force && cache_valid
                && let Ok(bytes) = fs::read(&engine_path) {
                    let sources = lines.map(String::from).collect();
                    send(Compiled { bytes, sources, from_cache: true });
                }

            let mut changed = force || !cache_valid || !engine_path.exists();
            let mut texts: Vec<(String, String)> = Vec::new();
            for (name, url) in shield::REMOTE_LISTS {
                let path = lists_dir.join(format!("{name}.txt"));
                let stale = force || age(&path).is_none_or(|a| a > MAX_AGE);
                if stale
                    && let Some(text) = fetch(url) {
                        let _ = fs::write(&path, &text);
                        texts.push((name.to_string(), text));
                        changed = true;
                        continue;
                    }
                if let Ok(text) = fs::read_to_string(&path) {
                    texts.push((name.to_string(), text));
                }
            }
            if !changed {
                return;
            }

            let mut sources: Vec<String> = vec!["builtin".into(), "youtube".into()];
            sources.extend(texts.iter().map(|(n, _)| n.clone()));
            let lists = shield::BUNDLED_LISTS
                .iter()
                .copied()
                .chain(texts.iter().map(|(_, t)| t.as_str()));
            let bytes = shield::compile_lists(lists);
            let _ = fs::write(&engine_path, &bytes);
            let _ = fs::write(lists_dir.join(ENGINE_SOURCES), format!("{tag}\n{}", sources.join("\n")));
            send(Compiled { bytes, sources, from_cache: false });
        })
        .expect("spawn filter thread");
}
