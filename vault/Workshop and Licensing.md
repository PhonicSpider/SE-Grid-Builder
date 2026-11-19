# Workshop and Licensing

## Steam Workshop
- The Workshop hosts content the **game loads**: mods, blueprints, scripts, worlds. A standalone program is **not** a Workshop item.
- **SE2:** Keen's Mod SDK and Mod HUB publish to the Workshop, but the SDK has **no scripting yet**, so a builder tool cannot be an SE2 mod today. One community report claims Keen moved to mod.io instead; the official announcements say Workshop. Confirm in the Mod HUB. ([announcement](https://support.keenswh.com/spaceengineers2/pc/announcement/space-engineers-2-alpha-vs-1-5-modding))
- **SE1:** mods can contain C# scripts, but a mod cannot open its own 3D builder window. It can add in-game controls. ([upload guide](https://spaceengineers.wiki.gg/wiki/Modding/Tutorials/Creating_And_Uploading_Mods))

## Realistic ways to publish
| Option | Notes |
|---|---|
| The app on GitHub, itch.io or Nexus | Simple. Not the Workshop. |
| The app as its own Steam store item | A separate process with its own fees and rules. |
| **Ships made with the app** as Workshop blueprints | Fits the Workshop. The app creates the blueprint; the player publishes it from the game's blueprint screen. |

## Using the game's assets
- The app **does not bundle** any game files. It reads block definitions (and later models) from the player's own install at run time. That avoids redistributing Keen's assets.
- Keen's actual policy on third-party tools using game assets was **not found** in a web search. Read the EULA and ask Keen support **before any public release**, especially before adding real models or icons.
- Anyone using the app needs to own the game.

## Open questions to answer before releasing
- May a tool read game models from the install and display them? (Probably the safest reading, but unconfirmed.)
- May screenshots or exported previews contain game models?
- Is there a naming or trademark rule for tools ("SE" in the name)?
