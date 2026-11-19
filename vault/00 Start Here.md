# SE Grid Builder: Start Here

A desktop app for building a Space Engineers ship block by block in 3D, painting it, and exporting a blueprint the game can load.

**Status (as of 2026-11-17):** Space Engineers 1 works end to end in code: block menu, 3D editing, paint, undo, export. A test ship **loaded correctly in the real game** (2026-11-18); paint, rotation and conveyor behaviour were all checked against the game's own saves (paint was corrected as a result). **Blocks now draw with the game's real 3D models** (including slopes, corners and other armor shapes, and turrets with barrels). Space Engineers 2 export is not started. See [[Roadmap and Open Questions]].

## Read in this order
1. [[Project Overview]]: what it is, what it is not, and why these tools.
2. [[Architecture]]: the map of every file and how data flows.
3. [[Rust Concepts]]: the Rust you need, compared with C# and Lua.
4. [[Walkthrough - se1.rs]] then [[Walkthrough - blueprint.rs]]: the Rust code, line by line.
5. [[Walkthrough - TypeScript]]: the editor code.
6. [[SE1 Blueprint Format]], [[SE1 Game Files]], [[Colors and Paint]], [[Orientation and Grid Math]]: how the game's data works.
7. [[SE2 Notes]], [[Workshop and Licensing]]: the open questions.
8. [[MWM Model Format]] and [[Walkthrough - mwm.rs]]: how the game's 3D models are read.
9. [[Armor Shapes and Sub-parts]]: how slopes, corners and turrets are drawn (new).
10. [[Audit 2026-11-18]]: **read this first when you wake up**: what was reviewed, what changed in your code, what to check.
11. [[Commands]] and [[Coding Conventions]]: day-to-day reference.
12. [[Learning Exercises]]: things for you to write yourself.
13. [[Decision Log]]: why choices were made.

## Where things live
| What | Path |
|---|---|
| Project | `H:\SE Modding\SE-Grid-Builder` |
| This vault | `H:\SE Modding\SE-Grid-Builder\vault` (open this folder in Obsidian) |
| Game (SE1) | `H:\SteamLibrary\steamapps\common\SpaceEngineers` |
| Game (SE2) and its Mod SDK | `H:\SteamLibrary\steamapps\common\SpaceEngineers2` and `...\Space Engineers 2 - Mod SDK` |
| Your blueprints | `%APPDATA%\SpaceEngineers\Blueprints\local` |
