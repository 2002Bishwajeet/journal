//! The main window's first-launch size and its remembered size and position (#1468).
//!
//! Desktop only. The sizing and clamping are pure functions on plain rectangles so they can be
//! unit-tested; `restore` and `track` are the thin Tauri glue. The state is one small JSON file in
//! the app data dir. `tauri-plugin-window-state` would also restore minimised and fullscreen
//! windows and add a dependency, so this is a few lines of our own instead.

use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::{PhysicalPosition, PhysicalSize, Runtime, WebviewWindow, WindowEvent};

/// A rectangle in physical pixels.
#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
pub struct Rect {
    pub x: i32,
    pub y: i32,
    pub w: u32,
    pub h: u32,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct State {
    /// The window when it is neither maximised, minimised nor fullscreen.
    pub rect: Option<Rect>,
    pub maximized: bool,
}

const MAX_W: f64 = 1600.0;
const MIN_W: f64 = 1024.0;
// Matches the window builder's min_inner_size height, which the OS enforces; 16:9 at this height.
const MIN_H: f64 = 600.0;

/// First-launch size in logical pixels for a work area of the given logical size: 16:9, 75% of
/// the width capped at 1600x900 and shrunk to fit the work area's height, but never below the window's 600 logical pixel minimum
/// height (so 1067x600 at the smallest), or the OS would resize it off 16:9.
pub fn default_size(work_w: f64, work_h: f64) -> (f64, f64) {
    let mut w = (work_w * 0.75).clamp(MIN_W, MAX_W);
    if w * 9.0 / 16.0 > work_h {
        w = work_h * 16.0 / 9.0;
    }
    w = w.max(MIN_H * 16.0 / 9.0);
    (w, w * 9.0 / 16.0)
}

fn overlap(a: &Rect, b: &Rect) -> i64 {
    let dx = (a.x as i64 + a.w as i64).min(b.x as i64 + b.w as i64) - (a.x as i64).max(b.x as i64);
    let dy = (a.y as i64 + a.h as i64).min(b.y as i64 + b.h as i64) - (a.y as i64).max(b.y as i64);
    if dx > 0 && dy > 0 {
        dx * dy
    } else {
        0
    }
}

/// Moves a saved rectangle onto the work area it overlaps most (the first one if it overlaps none,
/// e.g. an unplugged display), shrinking it to fit and centring it when it was off every screen.
pub fn fit_on_screen(saved: Rect, work_areas: &[Rect]) -> Rect {
    let Some(first) = work_areas.first() else {
        return saved;
    };
    let best = work_areas
        .iter()
        .max_by_key(|a| overlap(&saved, a))
        .filter(|a| overlap(&saved, a) > 0);
    let area = best.unwrap_or(first);
    let w = saved.w.min(area.w);
    let h = saved.h.min(area.h);
    let (x, y) = if best.is_some() {
        (saved.x, saved.y)
    } else {
        (
            area.x + (area.w - w) as i32 / 2,
            area.y + (area.h - h) as i32 / 2,
        )
    };
    Rect {
        x: x.clamp(area.x, area.x + (area.w - w) as i32),
        y: y.clamp(area.y, area.y + (area.h - h) as i32),
        w,
        h,
    }
}

impl State {
    pub fn load(path: &PathBuf) -> Self {
        std::fs::read(path)
            .ok()
            .and_then(|b| serde_json::from_slice(&b).ok())
            .unwrap_or_default()
    }

    fn save(&self, path: &PathBuf) {
        if let Ok(json) = serde_json::to_vec(self) {
            let _ = std::fs::write(path, json);
        }
    }
}

/// The work areas of every monitor in physical pixels, the primary one first.
fn work_areas<R: Runtime>(window: &WebviewWindow<R>) -> Vec<Rect> {
    let primary = window.primary_monitor().ok().flatten();
    let mut monitors = window.available_monitors().unwrap_or_default();
    if let Some(p) = &primary {
        monitors.sort_by_key(|m| m.position() != p.position());
    }
    monitors
        .iter()
        .map(|m| {
            let a = m.work_area();
            Rect {
                x: a.position.x,
                y: a.position.y,
                w: a.size.width,
                h: a.size.height,
            }
        })
        .collect()
}

/// The first-launch size in logical pixels for the primary monitor, if it is known.
pub fn first_launch_size<R: Runtime>(app: &tauri::AppHandle<R>) -> (f64, f64) {
    app.primary_monitor()
        .ok()
        .flatten()
        .map(|m| {
            let s = m.scale_factor();
            let a = m.work_area();
            default_size(a.size.width as f64 / s, a.size.height as f64 / s)
        })
        .unwrap_or((MIN_H * 16.0 / 9.0, MIN_H))
}

/// Puts a saved window back (on a visible monitor), then shows it. Without saved state the
/// window keeps its first-launch size and stays centred.
pub fn restore<R: Runtime>(window: &WebviewWindow<R>, state: &State) {
    if let Some(saved) = state.rect {
        let r = fit_on_screen(saved, &work_areas(window));
        let _ = window.set_size(PhysicalSize::new(r.w, r.h));
        let _ = window.set_position(PhysicalPosition::new(r.x, r.y));
    }
    if state.maximized {
        let _ = window.maximize();
    }
    let _ = window.show();
}

/// Saves the window's size and position on resize, move and close.
pub fn track<R: Runtime>(window: &WebviewWindow<R>, path: PathBuf, initial: State) {
    let state = Mutex::new(initial);
    let w = window.clone();
    window.on_window_event(move |event| {
        if !matches!(
            event,
            WindowEvent::Resized(_) | WindowEvent::Moved(_) | WindowEvent::CloseRequested { .. }
        ) {
            return;
        }
        if w.is_minimized().unwrap_or(false) || w.is_fullscreen().unwrap_or(false) {
            return;
        }
        let mut s = state.lock().unwrap();
        if w.is_maximized().unwrap_or(false) {
            s.maximized = true;
        } else if let (Ok(p), Ok(z)) = (w.outer_position(), w.inner_size()) {
            s.maximized = false;
            s.rect = Some(Rect {
                x: p.x,
                y: p.y,
                w: z.width,
                h: z.height,
            });
        }
        s.save(&path);
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    fn assert_16_9(w: f64, h: f64) {
        assert!((w * 9.0 - h * 16.0).abs() < 1e-6, "{w}x{h} is not 16:9");
    }

    fn check(work_w: f64, work_h: f64) -> (f64, f64) {
        let (w, h) = default_size(work_w, work_h);
        assert_16_9(w, h);
        assert!(w <= MAX_W && h <= 900.0);
        assert!(
            w <= work_w && h <= work_h,
            "{w}x{h} outside {work_w}x{work_h}"
        );
        (w, h)
    }

    #[test]
    fn a_1440x900_work_area_gets_75_percent_of_its_width() {
        assert_eq!(check(1440.0, 900.0), (1080.0, 607.5));
    }

    #[test]
    fn a_1920x1080_work_area_hits_the_cap() {
        assert_eq!(check(1920.0, 1080.0), (1440.0, 810.0));
        assert_eq!(check(2560.0, 1440.0), (1600.0, 900.0));
    }

    #[test]
    fn a_retina_3024x1964_screen_is_sized_in_logical_pixels() {
        // 3024x1964 physical at 2x is 1512x982 logical, less the menu bar and Dock.
        let (w, _) = check(1512.0, 900.0);
        assert_eq!(w, 1134.0);
    }

    #[test]
    fn a_1280x720_work_area_shrinks_to_fit_its_height() {
        let (w, h) = check(1280.0, 680.0);
        assert!(h <= 680.0 && w > 0.0);
        // The window's minimum height is 600, so 16:9 is widened to match rather than shortened.
        let (w, h) = check(1280.0, 720.0);
        assert_eq!(h, 600.0);
        assert!((w - 1066.6667).abs() < 1e-3);
    }

    const SCREEN: Rect = Rect {
        x: 0,
        y: 0,
        w: 1920,
        h: 1080,
    };
    const SIDE: Rect = Rect {
        x: 1920,
        y: 0,
        w: 1920,
        h: 1080,
    };

    #[test]
    fn a_visible_window_stays_where_it_was() {
        let saved = Rect {
            x: 100,
            y: 50,
            w: 1200,
            h: 675,
        };
        assert_eq!(fit_on_screen(saved, &[SCREEN]), saved);
    }

    #[test]
    fn a_window_saved_on_an_unplugged_display_comes_back_centred_on_screen() {
        let saved = Rect {
            x: 2500,
            y: 100,
            w: 1200,
            h: 675,
        };
        let r = fit_on_screen(saved, &[SCREEN]);
        assert_eq!(
            r,
            Rect {
                x: 360,
                y: 202,
                w: 1200,
                h: 675
            }
        );
    }

    #[test]
    fn a_window_hanging_off_the_edge_is_pulled_back_in() {
        let saved = Rect {
            x: 1500,
            y: 800,
            w: 1200,
            h: 675,
        };
        let r = fit_on_screen(saved, &[SCREEN]);
        assert_eq!(
            r,
            Rect {
                x: 720,
                y: 405,
                w: 1200,
                h: 675
            }
        );
    }

    #[test]
    fn a_window_larger_than_the_screen_shrinks_to_it() {
        let saved = Rect {
            x: 0,
            y: 0,
            w: 3000,
            h: 2000,
        };
        assert_eq!(fit_on_screen(saved, &[SCREEN]), SCREEN);
    }

    #[test]
    fn the_second_display_is_kept_while_it_is_plugged_in() {
        let saved = Rect {
            x: 2000,
            y: 100,
            w: 1200,
            h: 675,
        };
        assert_eq!(fit_on_screen(saved, &[SCREEN, SIDE]), saved);
    }
}
