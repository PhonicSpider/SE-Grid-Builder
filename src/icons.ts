// Small SVG pictures for the toolbar buttons. They use `currentColor`, so they
// take the text color of the button they sit in (white, or the accent color
// when the button is selected).
//
// These are our own simple drawings, not the game's artwork.

const STROKE = 'fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"';

function svg(inside: string): string {
  // The xmlns line is required: DOMParser reads this as XML, and without the
  // namespace the browser would not recognize it as a picture.
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" focusable="false">${inside}</svg>`;
}

/**
 * Builds the picture for a named icon as a real SVG element, or null if the
 * name is unknown. Parsing with DOMParser (instead of assigning to innerHTML)
 * means the text is only ever read as SVG, never as page HTML.
 */
export function createIcon(name: string): Element | null {
  const source = ICONS[name];
  if (!source) return null;
  return new DOMParser().parseFromString(source, "image/svg+xml").documentElement;
}

const ICONS: Record<string, string> = {
  // Large grid ship: a solid square.
  gridLarge: svg('<rect x="3" y="3" width="18" height="18" rx="2.5" fill="currentColor"/>'),

  // Small grid ship: a hollow square with a small solid square in its corner.
  gridSmall: svg(
    '<rect x="3.5" y="3.5" width="17" height="17" rx="2.5" fill="none" stroke="currentColor" stroke-width="2"/>' +
      '<rect x="3.5" y="12" width="8.5" height="8.5" rx="1.5" fill="currentColor"/>',
  ),

  // No skin: the red X the game uses for "remove the skin".
  skinNone: svg('<g fill="none" stroke="#e5484d" stroke-width="3" stroke-linecap="round"><path d="M5 5l14 14M19 5L5 19"/></g>'),

  // Build: a hammer.
  build: svg(
    `<g ${STROKE}><path d="M13.5 4.5l6 6-2.5 2.5-6-6z"/><path d="M11.5 8.5L4 16a1.6 1.6 0 0 0 2.3 2.3L13.8 10.8"/></g>`,
  ),

  // Remove: a trash can.
  remove: svg(
    `<g ${STROKE}><path d="M4 7h16"/><path d="M9.5 7V4.5h5V7"/><path d="M6 7l1 13h10l1-13"/><path d="M10 11v6M14 11v6"/></g>`,
  ),

  // Paint: a paint bucket pouring a drop.
  paint: svg(
    `<g ${STROKE}><path d="M6 11l6-6 7 7-6 6a2 2 0 0 1-2.8 0L6 13.8a2 2 0 0 1 0-2.8z"/><path d="M5.5 11.5h12"/>` +
      '<path d="M20 15.5c1.3 1.7 1.8 2.7 1.8 3.6a1.8 1.8 0 0 1-3.6 0c0-.9.5-1.9 1.8-3.6z"/></g>',
  ),

  // Turn: left and right arrows (spin around the vertical axis).
  turn: svg(`<g ${STROKE}><path d="M3 12h18"/><path d="M7 8l-4 4 4 4"/><path d="M17 8l4 4-4 4"/></g>`),

  // Tip: up and down arrows (tilt forward and back).
  tip: svg(`<g ${STROKE}><path d="M12 3v18"/><path d="M7.5 7.5L12 3l4.5 4.5"/><path d="M7.5 16.5L12 21l4.5-4.5"/></g>`),

  // Import: an arrow dropping into a tray (load a blueprint file).
  import: svg(`<g ${STROKE}><path d="M12 3v11"/><path d="M7.5 9.5L12 14l4.5-4.5"/><path d="M4 15v4.5h16V15"/></g>`),

  // Roll: two curved arrows (roll sideways).
  roll: svg(
    `<g ${STROKE}><path d="M3.5 12a8.5 8.5 0 0 1 14.5-6"/><path d="M20.5 3v5h-5"/>` +
      '<path d="M20.5 12A8.5 8.5 0 0 1 6 18"/><path d="M3.5 21v-5h5"/></g>',
  ),
};
