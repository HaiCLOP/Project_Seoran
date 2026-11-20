#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
//! Seoran: a fast, private browser. Rust shell, Chromium engine (WebView2 for
//! now, CEF later), built-in ad and tracker blocking.

mod engine;
mod filters;
mod nav;
mod pages;
mod store;

use std::{
    cell::RefCell,
    collections::VecDeque,
    rc::Rc,
    time::{Duration, Instant},
};

use serde_json::{Value, json};
use shield::Shield;
use tao::{
    dpi::{LogicalPosition, LogicalSize},
    event::{Event, StartCause, WindowEvent},
    event_loop::{ControlFlow, EventLoopBuilder, EventLoopProxy, EventLoopWindowTarget},
    window::{Icon, ResizeDirection, Window, WindowBuilder},
};
use wry::{Rect, WebContext, WebView, WebViewBuilder, http::Request};

use crate::{
    engine::{ContentSpec, TabHooks},
    store::{SessionTab, Store},
};

/// Height of the tab strip + toolbar, in logical pixels.
const TOP: f64 = 88.0;
const MAINTENANCE_EVERY: Duration = Duration::from_secs(30);
const FLUSH_EVERY: Duration = Duration::from_millis(80);

pub enum UserEvent {
    Chrome(String),
    Content { tab: u32, origin: String, body: String },
    Title(u32, String),
    Load { tab: u32, started: bool, url: String },
    OpenTab { url: String, background: bool },
    Blocked(u32),
    NavStarting { tab: u32, url: String },
    Url { tab: u32, url: String },
    History(u32),
    Favicon { tab: u32, url: String },
    Filters(filters::Compiled),
}

struct Tab {
    id: u32,
    webview: Option<WebView>,
    hooks: TabHooks,
    url: String,
    title: String,
    favicon: String,
    loading: bool,
    can_back: bool,
    can_forward: bool,
    last_active: Instant,
    key_times: VecDeque<Instant>,
}

impl Tab {
    fn new(id: u32, url: &str, title: &str) -> Self {
        Self {
            id,
            webview: None,
            hooks: TabHooks::default(),
            url: url.to_owned(),
            title: title.to_owned(),
            favicon: String::new(),
            loading: false,
            can_back: false,
            can_forward: false,
            last_active: Instant::now(),
            key_times: VecDeque::new(),
        }
    }

    fn display_title(&self) -> String {
        if nav::internal_page(&self.url) == Some("newtab") {
            return "New tab".into();
        }
        if !self.title.trim().is_empty() {
            return self.title.clone();
        }
        shield::site_of(&self.url).unwrap_or_else(|| self.url.clone())
    }

    /// Pages may send key messages directly; cap them so a page can't spam
    /// "open tab" and the like.
    fn allow_key(&mut self) -> bool {
        let now = Instant::now();
        while self.key_times.front().is_some_and(|t| now.duration_since(*t) > Duration::from_secs(1)) {
            self.key_times.pop_front();
        }
        if self.key_times.len() >= 8 {
            return false;
        }
        self.key_times.push_back(now);
        true
    }
}

struct Browser {
    window: Window,
    chrome: WebView,
    ctx: WebContext,
    proxy: EventLoopProxy<UserEvent>,
    shield: Rc<RefCell<Shield>>,
    store: Store,
    tabs: Vec<Tab>,
    active: usize,
    next_id: u32,
    closed: Vec<SessionTab>,
    /// Extra areas (menus, popovers, toasts) the UI view currently shows
    /// over the page, in logical pixels: x, y, w, h, corner radius.
    panels: Vec<[f64; 5]>,
    dirty: bool,
    last_flush: Instant,
    chrome_ready: bool,
    last_maintenance: Instant,
}

/// Window background for the current theme, so nothing ever flashes a
/// different colour while a view paints.
fn theme_bg(theme: &str, window: &Window) -> (u8, u8, u8, u8) {
    let dark = match theme {
        "dark" => true,
        "light" => false,
        _ => window.theme() == tao::window::Theme::Dark,
    };
    if dark { (20, 19, 23, 255) } else { (243, 240, 234, 255) }
}

fn app_icon() -> Option<Icon> {
    // 32x32 rounded seoran-orange square with a white diamond, drawn in code.
    let size = 32u32;
    let mut rgba = Vec::with_capacity((size * size * 4) as usize);
    for y in 0..size {
        for x in 0..size {
            let (fx, fy) = (x as f32 - 15.5, y as f32 - 15.5);
            let corner = (fx.abs() - 9.5).max(0.0).hypot((fy.abs() - 9.5).max(0.0));
            let inside = corner <= 6.5;
            let diamond = fx.abs() + fy.abs() <= 8.5;
            let px = match (inside, diamond) {
                (true, true) => [255, 255, 255, 255],
                (true, false) => [232, 85, 45, 255],
                _ => [0, 0, 0, 0],
            };
            rgba.extend_from_slice(&px);
        }
    }
    Icon::from_rgba(rgba, size, size).ok()
}

impl Browser {
    fn new(target: &EventLoopWindowTarget<UserEvent>, proxy: EventLoopProxy<UserEvent>) -> Self {
        let base = dirs::data_local_dir().unwrap_or_else(std::env::temp_dir);
        let profile = base.join("Seoran");
        // The browser used to be called Kite: carry an old profile over once.
        let old = base.join(concat!("K", "ite"));
        if !profile.exists() && old.exists() {
            let _ = std::fs::rename(&old, &profile);
        }
        let store = Store::open(profile.clone());

        let window = WindowBuilder::new()
            .with_title("Seoran")
            .with_decorations(false)
            .with_inner_size(LogicalSize::new(1280.0, 820.0))
            .with_min_inner_size(LogicalSize::new(520.0, 360.0))
            .with_window_icon(app_icon())
            .with_visible(false)
            .build(target)
            .expect("create window");
        {
            use tao::platform::windows::WindowExtWindows;
            window.set_undecorated_shadow(true);
        }
        let bg = theme_bg(&store.settings.theme, &window);
        window.set_background_color(Some(bg));

        let mut ctx = WebContext::new(Some(profile.join("WebView")));

        // The UI view always covers the whole window; a window region clips
        // it to the toolbar plus whatever menu is open (see `apply_region`).
        let p_chrome = proxy.clone();
        let size = window.inner_size().to_logical::<f64>(window.scale_factor());
        let chrome = WebViewBuilder::new_with_web_context(&mut ctx)
            .with_url(nav::internal_url("chrome"))
            .with_bounds(Rect {
                position: LogicalPosition::new(0.0, 0.0).into(),
                size: LogicalSize::new(size.width, size.height).into(),
            })
            .with_background_color(bg)
            .with_devtools(cfg!(debug_assertions))
            .with_hotkeys_zoom(false)
            .with_custom_protocol("seoran".into(), |_id, req| engine::serve_internal(req))
            .with_ipc_handler(move |req: Request<String>| {
                // Only our own UI page may drive the browser.
                if nav::internal_page(&req.uri().to_string()) == Some("chrome") {
                    let _ = p_chrome.send_event(UserEvent::Chrome(req.into_body()));
                }
            })
            .with_navigation_handler(|url| nav::internal_page(&url) == Some("chrome"))
            .build_as_child(&window)
            .expect("create browser UI");
        engine::lock_down_ui(&chrome);

        let mut shield = Shield::new();
        shield.set_enabled(store.settings.shields_enabled);
        shield.set_blocked_total(store.settings.blocked_total);
        for site in &store.settings.allowed_sites {
            shield.set_site_allowed(site, true);
        }

        let mut browser = Self {
            window,
            chrome,
            ctx,
            proxy: proxy.clone(),
            shield: Rc::new(RefCell::new(shield)),
            store,
            tabs: Vec::new(),
            active: 0,
            next_id: 1,
            closed: Vec::new(),
            panels: Vec::new(),
            dirty: true,
            last_flush: Instant::now(),
            chrome_ready: false,
            last_maintenance: Instant::now(),
        };

        // Restore the last session lazily: only the active tab loads now.
        let arg_url = std::env::args().nth(1);
        let session = browser.store.load_session();
        if browser.store.settings.restore_session && !session.tabs.is_empty() {
            for t in &session.tabs {
                let id = browser.alloc_id();
                browser.tabs.push(Tab::new(id, &t.url, &t.title));
            }
            browser.active = session.active.min(browser.tabs.len() - 1);
        }
        if let Some(url) = arg_url {
            let url = nav::resolve_input(&url, &browser.store.settings);
            browser.open_tab(&url, true);
        } else if browser.tabs.is_empty() {
            browser.open_tab(nav::NEW_TAB_URL, true);
        } else {
            browser.activate(browser.active);
        }

        browser.apply_region();
        // Show the window only once its views exist: no blank first frame.
        browser.window.set_visible(true);

        let p_filters = proxy;
        filters::spawn(profile, false, move |c| {
            let _ = p_filters.send_event(UserEvent::Filters(c));
        });
        browser
    }

    fn bg(&self) -> (u8, u8, u8, u8) {
        theme_bg(&self.store.settings.theme, &self.window)
    }

    fn apply_theme(&self) {
        let bg = self.bg();
        self.window.set_background_color(Some(bg));
        let _ = self.chrome.set_background_color(bg);
        for wv in self.tabs.iter().filter_map(|t| t.webview.as_ref()) {
            let _ = wv.set_background_color(bg);
        }
    }

    /// Clip the UI view to the toolbar plus open panels.
    fn apply_region(&self) {
        let scale = self.window.scale_factor();
        let s = self.logical_size();
        let px = |v: f64| (v * scale).round() as i32;
        let mut rects = vec![engine::RegionRect { x: 0, y: 0, w: px(s.width), h: px(TOP), r: 0 }];
        rects.extend(self.panels.iter().map(|p| engine::RegionRect {
            x: px(p[0]),
            y: px(p[1]),
            w: px(p[2]),
            h: px(p[3]),
            r: px(p[4]),
        }));
        engine::set_region(&self.chrome, &rects);
    }

    fn alloc_id(&mut self) -> u32 {
        let id = self.next_id;
        self.next_id += 1;
        id
    }

    fn logical_size(&self) -> LogicalSize<f64> {
        self.window.inner_size().to_logical(self.window.scale_factor())
    }

    fn content_bounds(&self) -> Rect {
        let s = self.logical_size();
        Rect {
            position: LogicalPosition::new(0.0, TOP).into(),
            size: LogicalSize::new(s.width, (s.height - TOP).max(1.0)).into(),
        }
    }

    fn chrome_bounds(&self) -> Rect {
        let s = self.logical_size();
        Rect {
            position: LogicalPosition::new(0.0, 0.0).into(),
            size: LogicalSize::new(s.width, s.height).into(),
        }
    }

    fn layout(&self) {
        let _ = self.chrome.set_bounds(self.chrome_bounds());
        self.apply_region();
        if let Some(wv) = self.tabs.get(self.active).and_then(|t| t.webview.as_ref()) {
            let _ = wv.set_bounds(self.content_bounds());
        }
    }

    fn index_of(&self, id: u32) -> Option<usize> {
        self.tabs.iter().position(|t| t.id == id)
    }

    fn ensure_webview(&mut self, i: usize, visible: bool) {
        if self.tabs[i].webview.is_some() {
            return;
        }
        let bounds = self.content_bounds();
        let tab = &self.tabs[i];
        let spec = ContentSpec { tab: tab.id, url: &tab.url.clone(), bounds, visible };
        let bg = self.bg();
        match engine::create_content(&self.window, &mut self.ctx, spec, bg, &self.proxy, &self.shield, &tab.hooks.clone()) {
            Ok(wv) => {
                self.tabs[i].webview = Some(wv);
                self.tabs[i].loading = true;
                // New views stack on top; keep the UI above the page.
                engine::raise(&self.chrome);
            }
            Err(e) => eprintln!("[seoran] could not create tab: {e}"),
        }
    }

    fn open_tab(&mut self, url: &str, activate: bool) {
        let id = self.alloc_id();
        let insert_at = if self.tabs.is_empty() { 0 } else { self.active + 1 };
        self.tabs.insert(insert_at.min(self.tabs.len()), Tab::new(id, url, ""));
        if activate {
            self.activate(insert_at);
            if nav::internal_page(url) == Some("newtab") {
                self.chrome_call("focusOmnibox", json!({}));
            }
        } else {
            // Background tabs (links opened in a new tab) start loading now.
            self.ensure_webview(insert_at, false);
            if insert_at <= self.active && self.tabs.len() > 1 {
                self.active += 1;
            }
        }
        self.dirty = true;
    }

    fn activate(&mut self, i: usize) {
        if i >= self.tabs.len() {
            return;
        }
        let prev = self.active;
        self.active = i;
        self.ensure_webview(i, true);
        let bounds = self.content_bounds();
        let tab = &mut self.tabs[i];
        tab.last_active = Instant::now();
        // Show the new page before hiding the old one, so there is never a
        // frame with no page at all.
        if let Some(wv) = &tab.webview {
            let _ = wv.set_bounds(bounds);
            let _ = wv.set_visible(true);
            let _ = wv.focus();
        }
        if prev != i
            && let Some(old) = self.tabs.get_mut(prev)
        {
            old.last_active = Instant::now();
            if let Some(wv) = &old.webview {
                let _ = wv.set_visible(false);
            }
        }
        self.refresh_nav(i);
        self.update_window_title();
        self.dirty = true;
    }

    fn close_tab(&mut self, id: u32) {
        let Some(i) = self.index_of(id) else { return };
        let tab = self.tabs.remove(i);
        if nav::internal_page(&tab.url).is_none_or(|p| p != "newtab") {
            self.closed.push(SessionTab { url: tab.url.clone(), title: tab.title.clone() });
            if self.closed.len() > 25 {
                self.closed.remove(0);
            }
            self.chrome_call(
                "toast",
                json!({ "text": format!("Closed “{}”", tab.display_title()), "action": "reopen", "actionLabel": "Undo" }),
            );
        }
        drop(tab);
        if self.tabs.is_empty() {
            self.active = 0;
            self.open_tab(nav::NEW_TAB_URL, true);
            return;
        }
        let next = if i < self.active || (i == self.active && i == self.tabs.len()) {
            self.active.saturating_sub(1)
        } else {
            self.active.min(self.tabs.len() - 1)
        };
        // The previous active tab is gone; nothing to hide.
        self.active = next;
        self.activate(next);
    }

    fn reopen_closed(&mut self) {
        if let Some(t) = self.closed.pop() {
            self.open_tab(&t.url, true);
        }
    }

    fn move_tab(&mut self, id: u32, to: usize) {
        let Some(from) = self.index_of(id) else { return };
        let to = to.min(self.tabs.len() - 1);
        if from == to {
            return;
        }
        let active_id = self.tabs[self.active].id;
        let tab = self.tabs.remove(from);
        self.tabs.insert(to, tab);
        self.active = self.index_of(active_id).unwrap_or(0);
        self.dirty = true;
    }

    fn navigate(&mut self, input: &str) {
        let url = nav::resolve_input(input, &self.store.settings);
        let i = self.active;
        if self.tabs.is_empty() {
            self.open_tab(&url, true);
            return;
        }
        self.tabs[i].url = url.clone();
        match &self.tabs[i].webview {
            Some(wv) => {
                let _ = wv.load_url(&url);
                let _ = wv.focus();
            }
            None => self.ensure_webview(i, true),
        }
        self.tabs[i].loading = true;
        self.dirty = true;
    }

    fn refresh_nav(&mut self, i: usize) {
        if let Some(tab) = self.tabs.get_mut(i)
            && let Some(wv) = &tab.webview {
                let s = engine::nav_state(wv);
                tab.can_back = s.can_back;
                tab.can_forward = s.can_forward;
            }
    }

    fn update_window_title(&self) {
        if let Some(t) = self.tabs.get(self.active) {
            self.window.set_title(&format!("{} — Seoran", t.display_title()));
        }
    }

    fn active_tab(&self) -> Option<&Tab> {
        self.tabs.get(self.active)
    }

    // ---- talking to the UI -------------------------------------------------

    fn chrome_call(&self, func: &str, arg: Value) {
        let js = format!("window.seoran && seoran.{func}({arg})");
        let _ = self.chrome.evaluate_script(&js);
    }

    fn page_reply(&self, tab: u32, msg: Value) {
        if let Some(wv) = self.index_of(tab).and_then(|i| self.tabs[i].webview.as_ref()) {
            let _ = wv.evaluate_script(&format!("window.__seoranReceive && __seoranReceive({msg})"));
        }
    }

    fn state_json(&self) -> Value {
        let shield = self.shield.borrow();
        let active = self.active_tab();
        let url = active.map(|t| t.url.as_str()).unwrap_or("");
        let site = shield::site_of(url).filter(|_| !nav::is_internal(url));
        json!({
            "tabs": self.tabs.iter().map(|t| json!({
                "id": t.id,
                "title": t.display_title(),
                "url": nav::display_url(&t.url),
                "loading": t.loading,
                "blocked": t.hooks.blocked.get(),
                "favicon": t.favicon,
                "internal": nav::is_internal(&t.url),
                "sleeping": t.webview.is_none(),
            })).collect::<Vec<_>>(),
            "active": active.map(|t| t.id),
            "url": nav::display_url(url),
            "secure": url.starts_with("https://"),
            "internal": nav::is_internal(url),
            "canBack": active.is_some_and(|t| t.can_back),
            "canForward": active.is_some_and(|t| t.can_forward),
            "loading": active.is_some_and(|t| t.loading),
            "bookmarked": self.store.is_bookmarked(url),
            "maximized": self.window.is_maximized(),
            "theme": self.store.settings.theme,
            "closedCount": self.closed.len(),
            "shield": {
                "enabled": shield.enabled(),
                "site": site,
                "siteActive": site.is_some() && shield.active_on(url),
                "blocked": active.map(|t| t.hooks.blocked.get()).unwrap_or(0),
                "total": shield.blocked_total(),
                "lists": shield.sources(),
            },
        })
    }

    /// Push state to the UI, at most every 80 ms: a page blocking dozens of
    /// requests a second must not make the toolbar re-render dozens of times.
    fn flush(&mut self) -> Option<Duration> {
        if !self.dirty || !self.chrome_ready {
            return None;
        }
        let since = self.last_flush.elapsed();
        if since < FLUSH_EVERY {
            return Some(FLUSH_EVERY - since);
        }
        self.dirty = false;
        self.last_flush = Instant::now();
        self.chrome_call("state", self.state_json());
        None
    }

    // ---- messages ----------------------------------------------------------

    fn suggestions(&self, q: &str) -> Value {
        let q = q.trim();
        let mut items = Vec::new();
        if q.is_empty() {
            return json!([]);
        }
        let target = nav::resolve_input(q, &self.store.settings);
        let is_search = target.starts_with(&self.store.settings.search_url(""));
        items.push(json!({
            "kind": if is_search { "search" } else { "url" },
            "title": q,
            "url": target,
            "sub": if is_search {
                let engine = store::SEARCH_ENGINES.iter().find(|e| e.0 == self.store.settings.search_engine).map(|e| e.1).unwrap_or("the web");
                format!("Search {engine}")
            } else { "Open address".into() },
        }));
        let ql = q.to_lowercase();
        for t in &self.tabs {
            if t.id != self.active_tab().map(|a| a.id).unwrap_or(0)
                && (t.title.to_lowercase().contains(&ql) || t.url.to_lowercase().contains(&ql))
            {
                items.push(json!({ "kind": "tab", "title": t.display_title(), "url": nav::display_url(&t.url), "tabId": t.id, "sub": "Switch to tab" }));
            }
            if items.len() > 3 {
                break;
            }
        }
        for (url, title, bookmarked) in self.store.search(q, 7) {
            if items.iter().any(|i| i["url"] == url) {
                continue;
            }
            items.push(json!({
                "kind": if bookmarked { "bookmark" } else { "history" },
                "title": if title.is_empty() { url } else { title },
                "url": url,
                "sub": url,
            }));
        }
        items.truncate(8);
        Value::Array(items)
    }

    fn handle_action(&mut self, action: &str) {
        match action {
            "newTab" => self.open_tab(nav::NEW_TAB_URL, true),
            "closeTab" => {
                if let Some(id) = self.active_tab().map(|t| t.id) {
                    self.close_tab(id);
                }
            }
            "reopen" => self.reopen_closed(),
            "nextTab" if !self.tabs.is_empty() => self.activate((self.active + 1) % self.tabs.len()),
            "prevTab" if !self.tabs.is_empty() => {
                self.activate((self.active + self.tabs.len() - 1) % self.tabs.len())
            }
            "focusOmnibox" => {
                let _ = self.chrome.focus();
                self.chrome_call("focusOmnibox", json!({}));
            }
            "palette" => {
                let _ = self.chrome.focus();
                self.chrome_call("openPalette", json!({}));
            }
            "bookmark" => self.toggle_bookmark(),
            "reload" => {
                if let Some(wv) = self.active_tab().and_then(|t| t.webview.as_ref()) {
                    let _ = wv.reload();
                }
            }
            "settings" => self.open_tab(&nav::internal_url("settings"), true),
            "devtools" => {
                if let Some(wv) = self.active_tab().and_then(|t| t.webview.as_ref()) {
                    engine::open_devtools(wv);
                }
            }
            a if a.starts_with("tab:") => {
                if let Ok(n) = a[4..].parse::<usize>() {
                    let i = if n == 9 { self.tabs.len().saturating_sub(1) } else { n.saturating_sub(1) };
                    self.activate(i);
                }
            }
            _ => {}
        }
    }

    fn toggle_bookmark(&mut self) {
        let Some(t) = self.active_tab() else { return };
        if nav::is_internal(&t.url) {
            return;
        }
        let (url, title) = (t.url.clone(), t.display_title());
        self.store.toggle_bookmark(&url, &title);
        self.dirty = true;
    }

    /// The UI reports which panels it shows over the page.
    fn set_panels(&mut self, v: &Value) {
        let panels: Vec<[f64; 5]> = v
            .as_array()
            .map(|a| {
                a.iter()
                    .filter_map(|r| {
                        let n = |i: usize| r.get(i).and_then(Value::as_f64);
                        Some([n(0)?, n(1)?, n(2)?.clamp(0.0, 8000.0), n(3)?.clamp(0.0, 8000.0), n(4).unwrap_or(0.0)])
                    })
                    .take(8)
                    .collect()
            })
            .unwrap_or_default();
        if panels != self.panels {
            self.panels = panels;
            self.apply_region();
        }
    }

    fn focus_content(&self) {
        if let Some(wv) = self.active_tab().and_then(|t| t.webview.as_ref()) {
            let _ = wv.focus();
        }
    }

    fn handle_chrome(&mut self, body: &str, target: &EventLoopWindowTarget<UserEvent>, flow: &mut ControlFlow) {
        let Ok(msg) = serde_json::from_str::<Value>(body) else { return };
        let id = msg["id"].as_u64().map(|v| v as u32);
        match msg["t"].as_str().unwrap_or("") {
            "ready" => {
                self.chrome_ready = true;
                self.dirty = true;
            }
            "action" => self.handle_action(msg["a"].as_str().unwrap_or("")),
            "openTab" => {
                let url = nav::resolve_input(msg["url"].as_str().unwrap_or(""), &self.store.settings);
                self.open_tab(&url, !msg["background"].as_bool().unwrap_or(false));
            }
            "closeTab" => {
                if let Some(id) = id {
                    self.close_tab(id);
                }
            }
            "activate" => {
                if let Some(i) = id.and_then(|id| self.index_of(id)) {
                    self.activate(i);
                }
            }
            "moveTab" => {
                if let (Some(id), Some(to)) = (id, msg["to"].as_u64()) {
                    self.move_tab(id, to as usize);
                }
            }
            "navigate" => self.navigate(msg["input"].as_str().unwrap_or("")),
            "back" | "forward" | "stop" => {
                if let Some(wv) = self.active_tab().and_then(|t| t.webview.as_ref()) {
                    match msg["t"].as_str() {
                        Some("back") => engine::go_back(wv),
                        Some("forward") => engine::go_forward(wv),
                        _ => engine::stop(wv),
                    }
                }
            }
            "shieldSite" => {
                let on = msg["on"].as_bool().unwrap_or(true);
                if let Some(site) = self.active_tab().and_then(|t| shield::site_of(&t.url)) {
                    self.shield.borrow_mut().set_site_allowed(&site, !on);
                    let s = &mut self.store.settings.allowed_sites;
                    s.retain(|x| x != &site);
                    if !on {
                        s.push(site.clone());
                    }
                    self.store.save_settings();
                    self.handle_action("reload");
                }
                self.dirty = true;
            }
            "shieldGlobal" => {
                let on = msg["on"].as_bool().unwrap_or(true);
                self.shield.borrow_mut().set_enabled(on);
                self.store.settings.shields_enabled = on;
                self.store.save_settings();
                self.dirty = true;
            }
            "suggest" => {
                let items = self.suggestions(msg["q"].as_str().unwrap_or(""));
                self.chrome_call("suggestions", json!({ "seq": msg["seq"], "items": items }));
            }
            "history" => {
                let q = msg["q"].as_str().unwrap_or("");
                let items: Vec<Value> = self
                    .store
                    .search(if q.is_empty() { "." } else { q }, 12)
                    .into_iter()
                    .map(|(u, t, b)| json!({ "url": u, "title": t, "bookmark": b }))
                    .collect();
                self.chrome_call("historyResults", json!({ "seq": msg["seq"], "items": items }));
            }
            "panels" => self.set_panels(&msg["rects"]),
            "focusContent" => self.focus_content(),
            "theme" => {
                if let Some(t) = msg["value"].as_str().filter(|t| ["system", "light", "dark"].contains(t)) {
                    self.store.settings.theme = t.into();
                    self.store.save_settings();
                    self.apply_theme();
                    self.dirty = true;
                }
            }
            "win" => match msg["a"].as_str().unwrap_or("") {
                "min" => self.window.set_minimized(true),
                "max" => {
                    self.window.set_maximized(!self.window.is_maximized());
                    self.dirty = true;
                }
                "close" => {
                    self.shutdown();
                    *flow = ControlFlow::Exit;
                }
                "drag" => {
                    let _ = self.window.drag_window();
                }
                "resizeTop" => {
                    let _ = self.window.drag_resize_window(ResizeDirection::North);
                }
                _ => {}
            },
            "updateFilters" => self.update_filters(),
            _ => {}
        }
        let _ = target;
    }

    fn update_filters(&mut self) {
        let p = self.proxy.clone();
        filters::spawn(self.store.dir().to_path_buf(), true, move |c| {
            let _ = p.send_event(UserEvent::Filters(c));
        });
    }

    fn handle_content(&mut self, tab: u32, origin: &str, body: &str) {
        let Ok(msg) = serde_json::from_str::<Value>(body) else { return };
        let Some(i) = self.index_of(tab) else { return };
        if msg["t"] == "key" {
            if self.tabs[i].allow_key() {
                let a = msg["a"].as_str().unwrap_or("").to_owned();
                self.handle_action(&a);
            }
            return;
        }
        // Everything else is only for our own internal pages.
        let Some(page) = nav::internal_page(origin) else { return };
        if !nav::is_internal(&self.tabs[i].url) {
            return;
        }
        match msg["t"].as_str().unwrap_or("") {
            "hello" => {
                let data = self.page_data(page);
                self.page_reply(tab, json!({ "t": "data", "data": data }));
            }
            "navigate" => {
                let input = msg["input"].as_str().unwrap_or("").to_owned();
                if self.tabs[self.active].id == tab {
                    self.navigate(&input);
                }
            }
            "setting" if page == "settings" => {
                let v = &msg["value"];
                let s = &mut self.store.settings;
                match msg["key"].as_str().unwrap_or("") {
                    "search_engine" => {
                        if let Some(e) = v.as_str().filter(|e| store::SEARCH_ENGINES.iter().any(|x| x.0 == *e)) {
                            s.search_engine = e.into();
                        }
                    }
                    "theme" => {
                        if let Some(t) = v.as_str().filter(|t| ["system", "light", "dark"].contains(t)) {
                            s.theme = t.into();
                            self.apply_theme();
                        }
                    }
                    "restore_session" => s.restore_session = v.as_bool().unwrap_or(true),
                    "sleep_tabs_after_min" => s.sleep_tabs_after_min = v.as_u64().unwrap_or(20).min(240),
                    "shields_enabled" => {
                        s.shields_enabled = v.as_bool().unwrap_or(true);
                        self.shield.borrow_mut().set_enabled(s.shields_enabled);
                    }
                    _ => {}
                }
                self.store.save_settings();
                self.dirty = true;
                let data = self.page_data(page);
                self.page_reply(tab, json!({ "t": "data", "data": data }));
            }
            "allowSite" if page == "settings" => {
                if let Some(site) = msg["site"].as_str() {
                    let allow = msg["allow"].as_bool().unwrap_or(false);
                    self.shield.borrow_mut().set_site_allowed(site, allow);
                    self.store.settings.allowed_sites.retain(|x| x != site);
                    if allow {
                        self.store.settings.allowed_sites.push(site.into());
                    }
                    self.store.save_settings();
                    let data = self.page_data(page);
                    self.page_reply(tab, json!({ "t": "data", "data": data }));
                }
            }
            "clearHistory" if page == "settings" => {
                self.store.clear_history();
                self.chrome_call("toast", json!({ "text": "History cleared" }));
                let data = self.page_data(page);
                self.page_reply(tab, json!({ "t": "data", "data": data }));
            }
            "updateFilters" if page == "settings" => self.update_filters(),
            "forgetSite" if page == "newtab" => {
                if let Some(site) = msg["site"].as_str() {
                    self.store.history.retain(|u, _| shield::site_of(u).as_deref() != Some(site));
                    self.store.save_history();
                    let data = self.page_data(page);
                    self.page_reply(tab, json!({ "t": "data", "data": data }));
                }
            }
            _ => {}
        }
    }

    fn page_data(&self, page: &str) -> Value {
        let shield = self.shield.borrow();
        let s = &self.store.settings;
        let engine_name = store::SEARCH_ENGINES.iter().find(|e| e.0 == s.search_engine).map(|e| e.1).unwrap_or("");
        match page {
            "newtab" => json!({
                "theme": s.theme,
                "engine": engine_name,
                "blockedTotal": shield.blocked_total(),
                "shieldOn": shield.enabled(),
                "topSites": self.store.top_sites(8).iter().map(|h| json!({
                    "url": h.url,
                    "title": h.title,
                    "site": shield::site_of(&h.url),
                })).collect::<Vec<_>>(),
            }),
            "settings" => json!({
                "theme": s.theme,
                "settings": s,
                "engines": store::SEARCH_ENGINES.iter().map(|e| json!({ "id": e.0, "name": e.1 })).collect::<Vec<_>>(),
                "lists": shield.sources(),
                "allowed": s.allowed_sites,
                "blockedTotal": shield.blocked_total(),
                "historyCount": self.store.history.len(),
                "bookmarkCount": self.store.bookmarks.len(),
                "profile": self.store.dir().display().to_string(),
                "version": env!("CARGO_PKG_VERSION"),
            }),
            _ => json!({ "theme": s.theme }),
        }
    }

    fn handle(&mut self, ev: UserEvent, target: &EventLoopWindowTarget<UserEvent>, flow: &mut ControlFlow) {
        match ev {
            UserEvent::Chrome(body) => self.handle_chrome(&body, target, flow),
            UserEvent::Content { tab, origin, body } => self.handle_content(tab, &origin, &body),
            UserEvent::Title(tab, title) => {
                if let Some(i) = self.index_of(tab) {
                    let url = self.tabs[i].url.clone();
                    self.store.set_title(&url, &title);
                    self.tabs[i].title = title;
                    if i == self.active {
                        self.update_window_title();
                    }
                    self.dirty = true;
                }
            }
            UserEvent::Load { tab, started, url } => {
                if let Some(i) = self.index_of(tab) {
                    let t = &mut self.tabs[i];
                    t.loading = started;
                    if !url.is_empty() {
                        t.url = url;
                    }
                    if !started {
                        let (u, ti) = (t.url.clone(), t.title.clone());
                        self.store.record_visit(&u, &ti);
                    }
                    self.refresh_nav(i);
                    self.dirty = true;
                }
            }
            UserEvent::NavStarting { tab, url } => {
                if let Some(i) = self.index_of(tab) {
                    self.tabs[i].loading = true;
                    if !nav::is_internal(&url) {
                        self.tabs[i].favicon.clear();
                    }
                    self.dirty = true;
                }
            }
            UserEvent::Url { tab, url } => {
                if let Some(i) = self.index_of(tab) {
                    let spa = !self.tabs[i].loading && self.tabs[i].url != url;
                    self.tabs[i].url = url.clone();
                    if spa {
                        let title = self.tabs[i].title.clone();
                        self.store.record_visit(&url, &title);
                    }
                    self.refresh_nav(i);
                    self.dirty = true;
                }
            }
            UserEvent::History(tab) => {
                if let Some(i) = self.index_of(tab) {
                    self.refresh_nav(i);
                    self.dirty = true;
                }
            }
            UserEvent::Favicon { tab, url } => {
                if let Some(i) = self.index_of(tab) {
                    self.tabs[i].favicon = url;
                    self.dirty = true;
                }
            }
            UserEvent::Blocked(_) => self.dirty = true,
            UserEvent::OpenTab { url, background } => self.open_tab(&url, !background),
            UserEvent::Filters(c) => {
                // Lists update silently in the background; settings shows them.
                self.shield.borrow_mut().load_compiled(&c.bytes, c.sources);
                self.dirty = true;
            }
        }
    }

    /// Periodic housekeeping: persist data, put idle tabs to sleep.
    fn maintenance(&mut self) {
        self.last_maintenance = Instant::now();
        if self.store.history_dirty {
            self.store.save_history();
        }
        self.save_session();
        let limit = Duration::from_secs(self.store.settings.sleep_tabs_after_min.max(1) * 60);
        let mut slept = false;
        for (i, tab) in self.tabs.iter_mut().enumerate() {
            if i == self.active || tab.webview.is_none() || tab.last_active.elapsed() < limit {
                continue;
            }
            if self.store.settings.sleep_tabs_after_min == 0 {
                continue;
            }
            if tab.webview.as_ref().is_some_and(engine::playing_audio) {
                continue;
            }
            tab.webview = None;
            tab.loading = false;
            slept = true;
        }
        if slept {
            self.dirty = true;
        }
    }

    fn save_session(&self) {
        let session = store::Session {
            tabs: self.tabs.iter().map(|t| SessionTab { url: t.url.clone(), title: t.title.clone() }).collect(),
            active: self.active,
        };
        self.store.save_session(&session);
    }

    fn shutdown(&mut self) {
        self.store.settings.blocked_total = self.shield.borrow().blocked_total();
        self.store.save_settings();
        self.store.save_history();
        self.save_session();
    }
}

fn main() {
    let event_loop = EventLoopBuilder::<UserEvent>::with_user_event().build();
    let proxy = event_loop.create_proxy();
    let mut browser: Option<Browser> = Some(Browser::new(&event_loop, proxy));

    event_loop.run(move |event, target, flow| {
        let Some(b) = browser.as_mut() else { return };
        *flow = ControlFlow::WaitUntil(Instant::now() + Duration::from_secs(5));
        match event {
            Event::NewEvents(StartCause::ResumeTimeReached { .. }) => {
                if b.last_maintenance.elapsed() >= MAINTENANCE_EVERY {
                    b.maintenance();
                }
            }
            Event::UserEvent(ev) => b.handle(ev, target, flow),
            Event::WindowEvent { event, .. } => match event {
                WindowEvent::Resized(_) | WindowEvent::ScaleFactorChanged { .. } => {
                    b.layout();
                    b.dirty = true;
                }
                WindowEvent::CloseRequested => {
                    b.shutdown();
                    *flow = ControlFlow::Exit;
                }
                _ => {}
            },
            Event::MainEventsCleared => {
                if let Some(wait) = b.flush() {
                    *flow = ControlFlow::WaitUntil(Instant::now() + wait);
                }
            }
            _ => {}
        }
        if *flow == ControlFlow::Exit {
            // Drop webviews before the window goes away.
            browser = None;
        }
    });
}
