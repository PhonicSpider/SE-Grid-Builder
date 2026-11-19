# Rust Concepts (for a C# and Lua programmer)

Every concept below is used somewhere in this project. The "Seen in" lines tell you where.

## Rust is not a scripting language
Lua is interpreted and runs inside a host. C# compiles to bytecode that a runtime runs. **Rust compiles straight to a native program**, with no runtime and no garbage collector. In exchange, the compiler is strict and checks things C# leaves to run time.

## Syntax cheat sheet
| Idea | C# | Lua | Rust |
|---|---|---|---|
| Variable | `var x = 5;` | `local x = 5` | `let x = 5;` |
| Changeable variable | (default) | (default) | `let mut x = 5;` (**locked unless `mut`**) |
| Function | `int Add(int a, int b)` | `function add(a,b)` | `fn add(a: i32, b: i32) -> i32` |
| Return | `return a+b;` | `return a+b` | last line **without a semicolon**: `a + b` |
| Nothing/maybe | `null` | `nil` | `Option<T>` = `Some(x)` or `None`. **No null.** |
| Failure | exceptions | `error()` | `Result<T, E>` = `Ok(x)` or `Err(e)`. **No exceptions.** |
| Lambda | `x => x + 1` | `function(x) ... end` | `\|x\| x + 1` (a "closure") |
| List | `List<T>` | table | `Vec<T>` |
| Dictionary | `Dictionary<K,V>` | table | `HashMap<K, V>` |
| Class | `class` | table | `struct` + `impl` |
| Interface | `interface` | n/a | `trait` |
| Print | `Console.WriteLine` | `print` | `println!("{}", x)` |
| Public | `public` | n/a | `pub` |
| Using | `using X;` | `require` | `use x::y;` |

## 1. The semicolon rule
```rust
fn add(a: i32, b: i32) -> i32 {
    a + b        // no semicolon: this is the return value
}
```
With a semicolon (`a + b;`) the value is thrown away and the function returns `()` ("nothing"), which gives the exact error you hit: *expected `Option<PathBuf>`, found `()`*.
**Seen in:** `find_install` ends with `None` (no semicolon).

## 2. Option: "might be missing"
```rust
fn find_install() -> Option<PathBuf>   // either Some(path) or None
```
You cannot use an `Option` as if it were the value; you must handle both cases (`match`, `if let`, `.expect(..)`, `?`). The compiler enforces it, which removes a whole class of null-reference bugs.
**Seen in:** `find_install`, `raw.size.map(...)`, `Option<String>` fields for XML elements that may be missing.

## 3. Result and the `?` operator
```rust
let entries = fs::read_dir(&directory).map_err(|error| format!("cannot read: {error}"))?;
```
- `fs::read_dir` returns `Result`: it can fail.
- `.map_err(...)` rewrites the error into our own message.
- `?` means: **if it failed, return that error from this whole function right now; otherwise give me the value.** It replaces try/catch.
- `?` only works inside a function that itself returns `Result` (or `Option`). That was the compile error when the loop code was pasted into `find_install`.
**Seen in:** `list_block_files`, `load_catalog`, `build_blueprint_xml`, `write_blueprint`.

## 4. Ownership and borrowing (the big idea)
Every value has exactly one owner. Passing a value to a function **moves** it; the old variable can no longer be used. To let a function look without taking it, **borrow** with `&`.
```rust
pub fn list_block_files(install: &Path)   // borrows: caller keeps its path
files.push(path);                          // MOVES path into the list; path is unusable afterwards
```
- `&T` = read-only borrow. `&mut T` = exclusive changeable borrow.
- C# gives every object reference semantics and a garbage collector. Rust gets the same safety with no collector by tracking owners at compile time.
- When the compiler complains about "moved value" or "borrowed", the fix is usually `&`, `.clone()`, or restructuring so one owner remains.
**Seen in:** almost every function signature (`&Path`, `&PlacedBlock`, `&BlueprintRequest`).

## 5. `String` versus `&str`; `PathBuf` versus `&Path`
Same pattern twice: an **owned, growable** type (`String`, `PathBuf`) and a **borrowed view** (`&str`, `&Path`). Functions that only read take the borrowed form.

## 6. Structs, derive and serde
```rust
#[derive(Debug, Deserialize)]
struct RawBlock {
    #[serde(rename = "DisplayName", default)]
    display_name: Option<String>,
}
```
- `#[derive(...)]` asks the compiler to generate code (printing, parsing, copying).
- **serde** generates the code that turns XML or JSON into the struct. `rename` maps `DisplayName` (XML) to `display_name` (Rust style).
- Fields not listed are ignored, so we read only what we need from huge game files.
**Seen in:** all of `se1.rs`, and `PlacedBlock` / `BlueprintRequest` in `blueprint.rs`.

## 7. Closures
`|error| format!(...)` is Rust's lambda: arguments between bars, then the body. Same idea as `error => ...` in C#.

## 8. Iterators
```rust
blocks.iter().find(|block| block.subtype_id == "LargeBlockArmorBlock")
```
Chains like `.iter().filter().map().collect()` are Rust's LINQ. They are lazy and compile to loops as fast as hand-written ones.

## 9. `match` and `if let` / `let ... else`
```rust
let Ok(text) = fs::read_to_string(&path) else { return HashMap::new(); };
```
Read as: "if this is `Ok`, name the inside `text` and continue; otherwise run the else block (which must leave)".

## 10. Modules and visibility
`mod se1;` in `lib.rs` pulls in `se1.rs`. Everything is private unless marked `pub`. Call across files with `se1::load_catalog(...)`.

## 11. Tests live next to the code
```rust
#[cfg(test)]
mod tests { use super::*; #[test] fn name() { assert!(...) } }
```
Run with `cargo test`. `#[cfg(test)]` means this code is only compiled when testing.

## 12. `#[tauri::command]`
A normal function tagged so TypeScript can call it by name. Arguments and return values travel as JSON, so they must be `Deserialize` / `Serialize`.

## Reading compiler errors
Rust errors are long but good. Read the **first** error (later ones are often knock-on effects), look for your own file name and line, and read the `help:` lines. Many errors print the exact fix. The long `stack backtrace` in a failed test is noise; look for the line naming your file.

## Where to learn more
- The Rust Book: chapters 1 to 6 cover everything above.
- Rust by Example: shorter, code first.

## More ideas used in the model reader and the audit

### 13. Lifetimes (`'a`)
```rust
struct ByteReader<'a> { bytes: &'a [u8], position: usize }
```
A struct that holds a **borrow** must say how long the borrow lasts. `'a` is just a name for "as long as the bytes it points at". The compiler uses it to guarantee the reader can never outlive the data it reads. You rarely write lifetimes, only when a struct or function returns a borrow.
**Seen in:** `ByteReader` in `mwm.rs`.

### 14. Moving instead of copying
`Ok(Self { bytes, tag_offsets })` **moves** the `bytes` vector into the result. The earlier version wrote `bytes.clone()`, which copied the whole file. In Rust, cloning is a visible, deliberate choice, so unnecessary copies stand out in review.

### 15. `OnceLock`: compute once, share everywhere
```rust
static INSTALL: OnceLock<PathBuf> = OnceLock::new();
```
A value that is filled in the first time it is needed and read freely afterwards, safe across threads. Replaces a global variable that you would otherwise have to lock.
**Seen in:** `install()` in `lib.rs`.

### 16. `async` and `spawn_blocking`
Tauri's plain commands run on the window's own thread, so a slow command freezes the window. An `async` command runs elsewhere; slow, non-async work (reading files, decoding) is handed to `spawn_blocking`, which runs it on a helper thread. The `run_in_background` helper in `lib.rs` wraps that and turns two layers of error (the thread failing, the work failing) into one.

### 17. `let` chains
```rust
if let Some(icon) = &block.icon
    && let Ok(png) = se1::load_icon_png(&install, icon)
{ ... }
```
Several "if this pattern matches" tests in one `if`, without nesting. Added to Rust in 2025 (edition 2024).

### 18. `#[cfg(test)]` on a single function
Marks a function as existing only when testing, so a helper used only by tests does not cause "unused function" warnings in the real program.

### 19. Const tables and slices of slices
```rust
const SIDE_ROTATIONS: &[(&str, &[u8])] = &[("Slope", &[0, 6, 6, 1, 4]), ...];
```
A fixed table baked into the program: a slice of (name, slice) pairs. `.iter().find(|(name, _)| *name == topology)` looks one up. **Seen in:** `armor.rs`.

### 20. `as_chunks::<3>()`
Cuts a slice into fixed groups of three (`&[[f32; 3]]`) so each group is an array, not a loose slice; replaces `chunks_exact(3)` plus indexing. **Seen in:** `armor.rs`, `mwm.rs`.

### 21. Struct update syntax
```rust
MeshPart { first_index: part.first_index + base, ..part }
```
Make a new value that copies every other field from `part` (moving them). **Seen in:** `append_placed`.
