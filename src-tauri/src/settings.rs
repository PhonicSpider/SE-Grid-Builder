//! The app's saved settings: a small JSON file in `%APPDATA%\SE Grid Builder`.
//!
//! For now it holds one thing: the Space Engineers 1 folder the player chose
//! by hand, for when the automatic search cannot find the game.

use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};

/// What is written to `settings.json`. `#[serde(default)]` lets older files
/// that lack a field still load, so adding settings later never breaks them.
#[derive(Debug, Default, Serialize, Deserialize, PartialEq)]
#[serde(default)]
pub struct Settings {
    /// The game folder the player picked (the one that contains `Content`).
    pub install_path: Option<String>,
}

/// Where the settings file lives, or None when `APPDATA` is not set.
fn default_settings_file() -> Option<PathBuf> {
    let app_data = std::env::var_os("APPDATA")?;
    Some(PathBuf::from(app_data).join("SE Grid Builder").join("settings.json"))
}

/// Reads settings from `file`. A missing or damaged file gives the defaults:
/// a broken settings file must never stop the app from starting.
pub fn load_from(file: &Path) -> Settings {
    fs::read_to_string(file)
        .ok()
        .and_then(|text| serde_json::from_str(&text).ok())
        .unwrap_or_default()
}

/// Writes settings to `file`, creating its folder if needed.
pub fn save_to(file: &Path, settings: &Settings) -> Result<(), String> {
    if let Some(folder) = file.parent() {
        fs::create_dir_all(folder).map_err(|error| format!("cannot create {}: {error}", folder.display()))?;
    }
    let text = serde_json::to_string_pretty(settings).map_err(|error| error.to_string())?;
    fs::write(file, text).map_err(|error| format!("cannot write {}: {error}", file.display()))
}

/// The game folder saved earlier, if any (it may no longer exist; callers check).
pub fn saved_install() -> Option<PathBuf> {
    let settings = load_from(&default_settings_file()?);
    settings.install_path.map(PathBuf::from)
}

/// Remembers the game folder for the next start.
pub fn save_install(install: &Path) -> Result<(), String> {
    let file = default_settings_file().ok_or("APPDATA is not set")?;
    // Load first so any settings added later are kept, not overwritten.
    let mut settings = load_from(&file);
    settings.install_path = Some(install.display().to_string());
    save_to(&file, &settings)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_file(name: &str) -> PathBuf {
        std::env::temp_dir().join(format!("se-grid-builder-settings-test-{name}")).join("settings.json")
    }

    #[test]
    fn saved_settings_come_back() {
        let file = temp_file("roundtrip");
        let settings = Settings { install_path: Some("H:/Games/SpaceEngineers".to_string()) };
        save_to(&file, &settings).expect("save failed");
        assert_eq!(load_from(&file), settings);
        let _ = fs::remove_dir_all(file.parent().unwrap());
    }

    #[test]
    fn a_missing_or_broken_file_gives_defaults() {
        assert_eq!(load_from(&temp_file("missing")), Settings::default());

        let file = temp_file("broken");
        fs::create_dir_all(file.parent().unwrap()).unwrap();
        fs::write(&file, "{ this is not json").unwrap();
        assert_eq!(load_from(&file), Settings::default());
        let _ = fs::remove_dir_all(file.parent().unwrap());
    }
}
