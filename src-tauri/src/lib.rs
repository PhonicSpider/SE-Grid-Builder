//! Tauri entry point. Each `#[tauri::command]` function below can be called from
//! TypeScript with `invoke("function_name", { ...arguments })`.
//!
//! The slow commands are `async` and do their work with `spawn_blocking`, which
//! runs it on a helper thread. A plain command runs on the window's own thread,
//! and file reading or decoding there would freeze the window while it works.

mod armor;
mod blueprint;
mod blueprint_import;
mod mwm;
mod se1;
mod settings;

use std::path::PathBuf;
use std::sync::OnceLock;

/// The player's Space Engineers 1 folder. It is looked for once and then
/// remembered: icons and models ask for it hundreds of times, and searching
/// the disk each time would be wasted work. (A failed search is NOT
/// remembered, so installing the game while the app is open still works.)
fn install() -> Result<PathBuf, String> {
    static INSTALL: OnceLock<PathBuf> = OnceLock::new();
    if let Some(path) = INSTALL.get() {
        return Ok(path.clone());
    }
    let found = se1::find_install().ok_or("Space Engineers 1 install not found")?;
    Ok(INSTALL.get_or_init(|| found).clone())
}

/// Runs slow work on a helper thread and flattens the two layers of error
/// (the thread failing, and the work itself failing) into one `String`.
async fn run_in_background<Output, Work>(work: Work) -> Result<Output, String>
where
    Output: Send + 'static,
    Work: FnOnce() -> Result<Output, String> + Send + 'static,
{
    tauri::async_runtime::spawn_blocking(work)
        .await
        .map_err(|error| format!("background task failed: {error}"))?
}

/// Finds the player's Space Engineers 1 install and returns every block in it.
/// Errors become a rejected promise in TypeScript.
///
/// `on_progress` is a Tauri `Channel`: a one-way pipe from Rust to a function
/// the front-end supplied. Every `send` arrives there as a message, which is
/// how the loading screen gets its live text while this command is still busy.
#[tauri::command]
async fn load_se1_catalog(on_progress: tauri::ipc::Channel<se1::LoadProgress>) -> Result<se1::Se1Catalog, String> {
    run_in_background(move || {
        let say = |progress: se1::LoadProgress| {
            // A failed send only means the window closed; nothing to do about it.
            let _ = on_progress.send(progress);
        };
        say(se1::LoadProgress::Message { text: "Looking for your Space Engineers 1 install...".to_string() });
        let install = install()?;
        say(se1::LoadProgress::Message { text: format!("Found the game at {}", install.display()) });
        se1::load_catalog_with_progress(&install, &mut |progress| say(progress))
    })
    .await
}

/// Opens a folder picker so the player can point at their Space Engineers 1
/// folder when the automatic search fails. A good choice is saved to the
/// settings file, so the next start finds the game on its own.
/// Returns the game folder, or None if the player closed the dialog.
#[tauri::command]
async fn choose_install_folder() -> Result<Option<String>, String> {
    run_in_background(|| {
        let Some(chosen) = rfd::FileDialog::new()
            .set_title("Choose your Space Engineers folder")
            .pick_folder()
        else {
            return Ok(None); // cancelled
        };
        let game = se1::game_folder_from_choice(&chosen).ok_or_else(|| {
            format!(
                "{} does not look like Space Engineers 1 (it has no Content/Data/CubeBlocks inside). \
                 Pick the folder named SpaceEngineers.",
                chosen.display()
            )
        })?;
        settings::save_install(&game)?;
        Ok(Some(game.display().to_string()))
    })
    .await
}

/// Returns one block icon as PNG bytes, decoded from the game's own `.dds` file.
/// The path comes from the front-end, and `se1::load_icon_png` refuses anything
/// outside the game's Content folder.
#[tauri::command]
async fn load_block_icon(icon_path: String) -> Result<tauri::ipc::Response, String> {
    let png = run_in_background(move || se1::load_icon_png(&install()?, &icon_path)).await?;
    // `Response` sends the bytes as raw binary instead of a slow JSON number list.
    Ok(tauri::ipc::Response::new(png))
}

/// Returns a block's 3D model: its triangles, read from the game's own `.mwm`
/// file. `detail` 0 is the most detailed version; higher numbers are simpler.
/// The bytes use the layout described on `mwm::ModelMesh::encode_for_viewer`.
#[tauri::command]
async fn load_block_model(model_path: String, detail: usize) -> Result<tauri::ipc::Response, String> {
    let bytes = run_in_background(move || {
        mwm::load_model_with_subparts(&install()?, &model_path, detail).map(|mesh| mesh.encode_for_viewer())
    })
    .await?;
    Ok(tauri::ipc::Response::new(bytes))
}

/// Returns a block texture as PNG bytes, decoded from the game's own `.dds` file
/// and shrunk to at most `max_size` pixels wide. `se1::load_texture_png` refuses
/// any path outside the game's Content folder.
#[tauri::command]
async fn load_block_texture(texture_path: String, max_size: u32) -> Result<tauri::ipc::Response, String> {
    // The size comes from the front-end, so keep it in a sane range.
    let max_size = max_size.clamp(16, 2048);
    let png = run_in_background(move || se1::load_texture_png(&install()?, &texture_path, max_size)).await?;
    Ok(tauri::ipc::Response::new(png))
}

/// Builds an armor-style block (slope, corner, half block...) from its side
/// plates and returns it in the same byte layout as `load_block_model`.
/// See `armor.rs` for how the plates are turned into place.
#[tauri::command]
async fn load_armor_model(
    subtype: String,
    topology: String,
    side_models: Vec<String>,
    detail: usize,
) -> Result<tauri::ipc::Response, String> {
    let bytes = run_in_background(move || {
        armor::assemble(&install()?, &subtype, &topology, &side_models, detail).map(|mesh| mesh.encode_for_viewer())
    })
    .await?;
    Ok(tauri::ipc::Response::new(bytes))
}

/// Saves the ship as a blueprint in the game's local blueprint folder and
/// returns the path of the file it wrote.
#[tauri::command]
fn export_se1_blueprint(request: blueprint::BlueprintRequest) -> Result<String, String> {
    let root = blueprint::local_blueprint_folder()?;
    let file = blueprint::write_blueprint(&root, &request)?;
    Ok(file.display().to_string())
}

/// Reads the text of a blueprint (`bp.sbc`) the player picked and returns its
/// main grid's blocks. Parsing a big file takes a moment, so it runs off the window thread.
#[tauri::command]
async fn import_se1_blueprint(xml: String) -> Result<blueprint_import::ImportedBlueprint, String> {
    run_in_background(move || blueprint_import::parse_blueprint(&xml)).await
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        // The updater checks GitHub for a newer release; the process plugin
        // lets the app restart itself once an update is installed.
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .invoke_handler(tauri::generate_handler![
            load_se1_catalog,
            load_block_icon,
            load_block_model,
            load_armor_model,
            load_block_texture,
            export_se1_blueprint,
            import_se1_blueprint,
            choose_install_folder
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
