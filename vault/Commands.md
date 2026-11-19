# Commands

Run these in a terminal. Where a command needs a folder, it is stated.

## Everyday
| Do this | Command | Folder |
|---|---|---|
| Run the desktop app (live reload) | `npm run tauri dev` | `SE-Grid-Builder` |
| Run only the web part in a browser (sample blocks, no export) | `npm run dev` | `SE-Grid-Builder` |
| Rust tests (your install is read) | `cargo test -- --nocapture` | `SE-Grid-Builder\src-tauri` |
| TypeScript tests | `npm test` | `SE-Grid-Builder` |
| Type-check TypeScript | `npx tsc --noEmit` | `SE-Grid-Builder` |
| Check Rust compiles (fast) | `cargo check` | `SE-Grid-Builder\src-tauri` |
| Build a release installer | `npm run tauri build` | `SE-Grid-Builder` |

## Notes
- First `cargo` build is slow (minutes); later ones take seconds.
- `cargo test -- --nocapture` shows `println!` output; without it, output is hidden for passing tests.
- Only one `npm run tauri dev` can run at a time (it uses port 1420).
- If a build says "Blocking waiting for file lock", another cargo run is still going.

## Developer tools (on demand, not part of the normal tests)
| Do this | Command (in `src-tauri`) |
|---|---|
| Export real models, icons and block data to a temporary `devfixtures/` folder, for browser test pages | `cargo test export_viewer_fixtures -- --ignored --nocapture` |
| Write a small test ship into your real blueprint folder | `cargo test write_sample_ship -- --ignored --nocapture` |
| Export assembled armor and sub-part blocks and their icons to `devfixtures/armor/` (list them in `devfixtures/armor/wanted.txt`, one per line: a subtype, or `TypeId\|SubtypeId`) | `cargo test export_armor_fixtures -- --ignored --nocapture` |
| Dump every side plate and construction model to `devfixtures/plates.json` (used to derive the armor table) | `cargo test dump_plates -- --ignored --nocapture` |
Extra blocks can be exported by listing `Type\|Subtype\|Large` lines in `devfixtures/wanted.txt` first. The folder is temporary; delete it afterwards.

## Where tests are
- Rust: inside each `.rs` file under `#[cfg(test)] mod tests`.
- TypeScript: `src/*.test.ts`.

## Last verified run (2026-11-18)
- `cargo test`: 50 passed, 0 failed, 5 ignored; takes about 45 s because several tests read the whole game (every model twice, every icon, and the blueprint test reads all your local blueprints). `cargo test --release` is faster. The ignored ones write into your real blueprint folder or print exploration data.
- `npm test`: 87 passed (Rust: 54 passed), 0 failed.
- `cargo clippy --all-targets`: no warnings.
- `run.bat` in the project root starts the desktop app (installs dependencies first if needed).
- `npx tsc --noEmit`: clean. `npx vite build`: succeeded. `npm run tauri dev`: compiled and launched without errors.
