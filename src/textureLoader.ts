// Loads the game's own block textures.
//
// Rust reads the `.dds` texture from the player's install, decodes it, shrinks it
// (see `load_texture_png` in src-tauri/src/se1.rs) and sends back a PNG, which the
// browser turns into a picture for three.js. Each texture is loaded once and
// shared by every block that uses it.

import { invoke } from "@tauri-apps/api/core";
import * as THREE from "three";
import { isDesktopApp } from "./catalog";
import { createLimiter } from "./limiter";

/** Textures are decoded no wider than this (the game's are 2048 or 4096; blocks on screen are small). */
const TEXTURE_SIZE = 512;
/** How many textures may be loading at once. */
const MAX_AT_ONCE = 3;
/** Angle-dependent sharpness: how many samples the graphics card may use for slanted surfaces. */
const ANISOTROPY = 4;

const limit = createLimiter(MAX_AT_ONCE);
const cache = new Map<string, Promise<THREE.Texture | null>>();

/** Where texture data comes from when the app is not running as the desktop app (tests and test pages only). */
type TextureSource = (path: string, maxSize: number) => Promise<ArrayBuffer>;
let developmentSource: TextureSource | null = null;

/** FOR DEVELOPMENT AND TESTS ONLY, like `setDevelopmentModelSource`: supplies PNG bytes without Rust. */
export function setDevelopmentTextureSource(source: TextureSource | null): void {
  developmentSource = source;
  cache.clear();
}

async function fetchTexture(path: string): Promise<THREE.Texture | null> {
  try {
    const bytes = await limit(() =>
      developmentSource
        ? developmentSource(path, TEXTURE_SIZE)
        : invoke<ArrayBuffer>("load_block_texture", { texturePath: path, maxSize: TEXTURE_SIZE }),
    );
    const image = await createImageBitmap(new Blob([bytes], { type: "image/png" }));
    const texture = new THREE.Texture(image);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.wrapS = THREE.RepeatWrapping; // some models tile their texture
    texture.wrapT = THREE.RepeatWrapping;
    texture.anisotropy = ANISOTROPY;
    texture.needsUpdate = true;
    return texture;
  } catch (error) {
    // A texture that cannot be read leaves its blocks in plain colour.
    console.warn(`texture failed (${path}):`, error);
    return null;
  }
}

/**
 * Loads a texture (once; later calls reuse the result). Gives null when there
 * is nothing to load, when running outside the desktop app, or on failure.
 */
export function loadTexture(path: string): Promise<THREE.Texture | null> {
  if (!path || (!isDesktopApp() && !developmentSource)) return Promise.resolve(null);
  const key = path.toLowerCase();
  let result = cache.get(key);
  if (!result) {
    result = fetchTexture(path);
    cache.set(key, result);
  }
  return result;
}
