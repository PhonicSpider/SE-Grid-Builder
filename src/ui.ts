// The side panel. It changes the shared `EditorState` and the `Ship`; the
// viewport redraws in response.
//
// Top to bottom: game and grid size, tools, paint, blocks, export. The view
// controls (fade sliders) live in the bar across the top of the 3D view.

import { BlockGrid } from "./blockGrid";
import { loadGameIcon } from "./blockIcons";
import type { BlockInfo, Se1Catalog } from "./catalog";
import { hexToPaint, paintToHex } from "./color";
import { DEFAULT_PALETTE } from "./defaultPalette";
import type { EditMode, EditorState } from "./editorState";
import { exportSe1Blueprint } from "./exporter";
import { applyImport, describeImport, readBlueprintText } from "./importer";
import { createIcon } from "./icons";
import { rotatePitch, rotateRoll, rotateYaw } from "./orientation";
import { setUpSidebarResizer } from "./sidebar";
import type { GridSize, Ship } from "./ship";
import { VIEW_GROUPS } from "./viewGroups";
import type { Viewport } from "./viewport";

/** Drop-down value for blocks the game lists in none of its categories (debug blocks, a few floors). */
const NOT_IN_GAME_MENU = "__none__";

/** Finds an element by id and fails loudly if the page is missing it. */
function requireElement<ElementType extends HTMLElement>(id: string): ElementType {
  const element = document.getElementById(id);
  if (!element) throw new Error(`missing element #${id} in index.html`);
  return element as ElementType;
}

/** Where the game lists a block inside one category (0 = first); blocks not in it sort last. */
function positionInCategory(block: BlockInfo, categoryKey: string): number {
  const index = block.categories.indexOf(categoryKey);
  return index === -1 ? Number.MAX_SAFE_INTEGER : block.category_positions[index];
}

export function setUpInterface(catalog: Se1Catalog, ship: Ship, state: EditorState, viewport: Viewport): void {
  const searchBox = requireElement<HTMLInputElement>("search");
  const categorySelect = requireElement<HTMLSelectElement>("category-select");
  const includeVariants = requireElement<HTMLInputElement>("include-variants");
  const catalogStatus = requireElement<HTMLElement>("catalog-status");
  const selectionInfo = requireElement<HTMLElement>("selection-info");
  const orientationInfo = requireElement<HTMLElement>("orientation-info");
  const colorPicker = requireElement<HTMLInputElement>("color-picker");
  const shipName = requireElement<HTMLInputElement>("ship-name");
  const exportStatus = requireElement<HTMLElement>("export-status");
  const overwriteButton = requireElement<HTMLButtonElement>("overwrite-button");
  const blockCount = requireElement<HTMLElement>("block-count");
  const gridSizeHint = requireElement<HTMLElement>("grid-size-hint");
  const repaintColorBox = requireElement<HTMLInputElement>("repaint-color");
  const repaintSkinBox = requireElement<HTMLInputElement>("repaint-skin");
  const skinGrid = requireElement<HTMLElement>("skin-grid");
  const actionMessage = requireElement<HTMLElement>("action-message");

  // ---- Page set-up --------------------------------------------------------

  // Put the SVG pictures into every button that names one (data-icon="build").
  for (const button of document.querySelectorAll<HTMLElement>("[data-icon]")) {
    const picture = createIcon(button.dataset.icon ?? "");
    if (picture) button.replaceChildren(picture);
  }
  setUpSidebarResizer(requireElement("panel"), requireElement("panel-resizer"));

  const blockGrid = new BlockGrid(requireElement("block-grid"), (block) => selectBlock(block));

  // ---- View bar (top of the 3D view): fade groups of blocks ---------------

  // One slider per fadable group. 100% is solid, 0% hides the group.
  const fadeRows = requireElement<HTMLElement>("fade-rows");
  for (const { group, label } of VIEW_GROUPS) {
    const row = document.createElement("label");
    row.className = "fade-row";
    const name = document.createElement("span");
    name.textContent = label;
    const slider = document.createElement("input");
    slider.type = "range";
    slider.min = "0";
    slider.max = "100";
    slider.step = "5";
    slider.value = "100";
    slider.setAttribute("aria-label", `${label} opacity`);
    const value = document.createElement("span");
    value.className = "fade-value";
    value.textContent = "100%";
    slider.addEventListener("input", () => {
      value.textContent = `${slider.value}%`;
      viewport.setGroupOpacity(group, Number(slider.value) / 100);
    });
    // Double-click the slider to put it back to solid.
    slider.addEventListener("dblclick", () => {
      slider.value = "100";
      slider.dispatchEvent(new Event("input"));
    });
    row.append(name, slider, value);
    fadeRows.append(row);
  }
  requireElement<HTMLInputElement>("click-through").addEventListener("change", (event) => {
    const checked = (event.target as HTMLInputElement).checked;
    for (const { group } of VIEW_GROUPS) viewport.setClickThrough(group, checked);
  });

  // ---- Block list ---------------------------------------------------------

  /** Blocks that fit the current grid size and the "include variants" box. */
  function blocksForGrid(): BlockInfo[] {
    return catalog.blocks.filter(
      (block) => block.cube_size === ship.gridSize && (includeVariants.checked || block.shown_in_game_menu),
    );
  }

  /** The blocks to show, filtered by category and search, in the game's own order. */
  function visibleBlocks(): BlockInfo[] {
    const searchText = searchBox.value.trim().toLowerCase();
    const chosenCategory = categorySelect.value;

    const matching = blocksForGrid().filter((block) => {
      if (chosenCategory === NOT_IN_GAME_MENU) {
        if (block.categories.length > 0) return false;
      } else if (chosenCategory && !block.categories.includes(chosenCategory)) {
        return false;
      }
      if (!searchText) return true;
      return (
        block.display_name.toLowerCase().includes(searchText) ||
        block.subtype_id.toLowerCase().includes(searchText)
      );
    });

    // Inside one category the game lists blocks in a set order; match it.
    // ("All categories" keeps the alphabetical order from the catalog.)
    if (chosenCategory && chosenCategory !== NOT_IN_GAME_MENU) {
      matching.sort((left, right) => positionInCategory(left, chosenCategory) - positionInCategory(right, chosenCategory));
    }
    return matching;
  }

  /**
   * Fills the category drop-down with the game's own categories, in the game's
   * order, each with the number of blocks it holds for the current grid size.
   * Categories with no blocks for this grid size are left out.
   */
  function rebuildCategories(): void {
    const previous = categorySelect.value;

    const countByCategory = new Map<string, number>();
    let uncategorizedCount = 0;
    for (const block of blocksForGrid()) {
      if (block.categories.length === 0) uncategorizedCount++;
      for (const key of block.categories) countByCategory.set(key, (countByCategory.get(key) ?? 0) + 1);
    }

    const functionGroup = document.createElement("optgroup");
    functionGroup.label = "Categories";
    const dlcGroup = document.createElement("optgroup");
    dlcGroup.label = "DLC packs";

    for (const category of catalog.categories) {
      const count = countByCategory.get(category.key) ?? 0;
      if (count === 0) continue;
      const group = category.kind === "dlc" ? dlcGroup : functionGroup;
      group.append(new Option(`${category.display_name} (${count})`, category.key));
    }

    categorySelect.replaceChildren(new Option("All categories", ""));
    if (functionGroup.children.length > 0) categorySelect.append(functionGroup);
    if (dlcGroup.children.length > 0) categorySelect.append(dlcGroup);
    if (uncategorizedCount > 0) {
      categorySelect.append(new Option(`Not in the game's menu (${uncategorizedCount})`, NOT_IN_GAME_MENU));
    }

    // Keep the player's choice if it still exists for this grid size.
    const stillAvailable = [...categorySelect.options].some((option) => option.value === previous);
    categorySelect.value = stillAvailable ? previous : "";
  }

  function rebuildBlockList(): void {
    const blocks = visibleBlocks();
    blockGrid.show(blocks, state.selectedBlock);
    catalogStatus.textContent = `${blocks.length} blocks · ${catalog.install_path}`;
  }

  function selectBlock(block: BlockInfo): void {
    state.selectedBlock = block;
    setMode("build");
    blockGrid.markSelected(block);
    updateSelectionText();
    viewport.refresh();
  }

  function updateSelectionText(): void {
    const block = state.selectedBlock;
    selectionInfo.textContent = block
      ? `Selected: ${block.display_name || block.subtype_id} (${block.size.join("×")} cells)`
      : "No block selected. Pick one from the list below.";
    orientationInfo.textContent = `Front: ${state.orientation.forward} · Top: ${state.orientation.up}`;
  }

  // ---- Tools --------------------------------------------------------------

  function setMode(mode: EditMode): void {
    state.mode = mode;
    for (const button of document.querySelectorAll<HTMLButtonElement>("#mode-row button")) {
      button.classList.toggle("active", button.dataset.mode === mode);
    }
    viewport.refresh();
  }

  function rotate(change: typeof rotateYaw): void {
    state.orientation = change(state.orientation);
    updateSelectionText();
    viewport.refresh();
  }

  function setGridSize(size: GridSize): void {
    if (!ship.setGridSize(size)) {
      gridSizeHint.textContent = "Clear the ship before switching between Large and Small grid.";
      return;
    }
    gridSizeHint.textContent = "";
    showGridSize(size);
  }

  /** The grid size the buttons and block list currently show (an import or undo can change the ship's). */
  let shownGridSize: GridSize = ship.gridSize;

  /** Makes the buttons, categories and block list match a grid size the ship already has. */
  function showGridSize(size: GridSize): void {
    shownGridSize = size;
    for (const button of document.querySelectorAll<HTMLButtonElement>("#grid-size-row button")) {
      button.classList.toggle("active", button.dataset.gridSize === size);
    }
    // A selected block of the other grid size no longer applies.
    if (state.selectedBlock && state.selectedBlock.cube_size !== size) state.selectedBlock = null;
    rebuildCategories();
    rebuildBlockList();
    updateSelectionText();
    viewport.refresh();
  }

  // ---- Paint --------------------------------------------------------------

  const swatchContainer = requireElement<HTMLElement>("swatches");
  const swatches: Array<{ hex: string; button: HTMLButtonElement }> = [];

  /** Rings the swatch that matches the current paint (none if a custom color is in use). */
  function markSelectedSwatch(): void {
    const currentHex = paintToHex(state.paint);
    for (const swatch of swatches) swatch.button.classList.toggle("selected", swatch.hex === currentHex);
  }

  function choosePaint(hex: string): void {
    state.paint = hexToPaint(hex);
    colorPicker.value = hex;
    markSelectedSwatch();
  }

  // The game's own 14 default paint colors.
  DEFAULT_PALETTE.forEach((paint, index) => {
    const hex = paintToHex(paint);
    const button = document.createElement("button");
    button.type = "button";
    button.style.background = hex;
    button.dataset.tooltip = `Default color ${index + 1} (${hex})`;
    button.setAttribute("aria-label", `Default color ${index + 1}`);
    button.addEventListener("click", () => choosePaint(hex));
    swatchContainer.append(button);
    swatches.push({ hex, button });
  });
  colorPicker.addEventListener("input", () => choosePaint(colorPicker.value));
  colorPicker.value = paintToHex(state.paint);
  markSelectedSwatch();

  // The game's two "use ... to repaint" boxes decide what the paint tool changes.
  repaintColorBox.addEventListener("change", () => (state.repaintColor = repaintColorBox.checked));
  repaintSkinBox.addEventListener("change", () => (state.repaintSkin = repaintSkinBox.checked));

  // ---- Skins --------------------------------------------------------------

  const skinButtons: Array<{ skin: string | null; button: HTMLButtonElement }> = [];

  function markSelectedSkin(): void {
    for (const entry of skinButtons) {
      entry.button.classList.toggle("selected", entry.skin === state.skin);
      entry.button.setAttribute("aria-pressed", String(entry.skin === state.skin));
    }
  }

  function addSkinButton(skin: string | null, tooltip: string, needsDlc: boolean): HTMLButtonElement {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "skin" + (needsDlc ? " needs-dlc" : "");
    button.dataset.tooltip = tooltip;
    button.setAttribute("aria-label", tooltip.split("\n")[0]);
    button.addEventListener("click", () => {
      state.skin = skin;
      markSelectedSkin();
    });
    skinGrid.append(button);
    skinButtons.push({ skin, button });
    return button;
  }

  // The first entry is the red X: "no skin".
  const noSkinPicture = createIcon("skinNone");
  const noSkinButton = addSkinButton(null, "No skin", false);
  if (noSkinPicture) noSkinButton.append(noSkinPicture);

  for (const skin of catalog.skins) {
    const needsDlc = skin.dlc.length > 0;
    const tooltip = needsDlc ? `${skin.display_name}\nNeeds DLC: ${skin.dlc.join(", ")}` : skin.display_name;
    const button = addSkinButton(skin.subtype_id, tooltip, needsDlc);

    // Skin icons are few, so they all load at once (the loader limits how many run together).
    void loadGameIcon(skin.icon).then((address) => {
      if (!address) {
        button.textContent = skin.display_name; // no picture available: show the name instead
        return;
      }
      const picture = document.createElement("img");
      picture.alt = "";
      picture.draggable = false;
      picture.src = address;
      button.append(picture);
    });
  }
  markSelectedSkin();

  // ---- Export -------------------------------------------------------------

  // The blueprint is saved as a ship (can move) or a station/base (static).
  let saveAsStation = false;
  const exportKindButtons = document.querySelectorAll<HTMLButtonElement>("#export-kind-row button");

  function showExportKind(station: boolean): void {
    saveAsStation = station;
    for (const button of exportKindButtons) {
      const active = (button.dataset.kind === "station") === station;
      button.classList.toggle("active", active);
      button.setAttribute("aria-pressed", String(active));
    }
  }
  for (const button of exportKindButtons) {
    button.addEventListener("click", () => showExportKind(button.dataset.kind === "station"));
  }
  showExportKind(false);

  async function exportShip(overwrite: boolean): Promise<void> {
    exportStatus.classList.remove("error");
    overwriteButton.hidden = true;

    if (ship.count === 0) {
      exportStatus.textContent = "Place some blocks first.";
      exportStatus.classList.add("error");
      return;
    }
    const name = shipName.value.trim();
    if (!name) {
      exportStatus.textContent = "Give the ship a name first.";
      exportStatus.classList.add("error");
      return;
    }

    const result = await exportSe1Blueprint(ship, name, overwrite, saveAsStation);
    exportStatus.textContent = result.message;
    exportStatus.classList.toggle("error", !result.ok);
    // Offer a replace button only for the "name already used" case; the player
    // must press it on purpose so an existing ship is never overwritten by accident.
    overwriteButton.hidden = !result.nameAlreadyTaken;
  }

  // ---- Import -------------------------------------------------------------

  const importFileBox = requireElement<HTMLInputElement>("import-file");
  requireElement("import-button").addEventListener("click", () => importFileBox.click());
  importFileBox.addEventListener("change", async () => {
    const file = importFileBox.files?.[0];
    importFileBox.value = ""; // so picking the same file again still fires
    if (!file) return;

    exportStatus.classList.remove("error");
    overwriteButton.hidden = true;
    exportStatus.textContent = `Reading ${file.name}…`;
    try {
      const blueprint = await readBlueprintText(await file.text());
      const summary = applyImport(ship, blueprint, catalog.blocks);
      if (summary.notInGame > 0) console.warn("Blueprint blocks not in your game's block list:", summary.unknownNames);
      exportStatus.textContent = describeImport(summary);
      exportStatus.classList.toggle("error", summary.placed === 0);
      if (summary.placed > 0) {
        if (summary.name) shipName.value = summary.name;
        showExportKind(blueprint.is_station); // a station blueprint imports as a station
        viewport.frameShip();
      }
    } catch (error) {
      exportStatus.textContent = String(error instanceof Error ? error.message : error);
      exportStatus.classList.add("error");
    }
  });

  requireElement("export-button").addEventListener("click", () => void exportShip(false));
  overwriteButton.addEventListener("click", () => void exportShip(true));
  requireElement("undo-button").addEventListener("click", () => ship.undo());
  requireElement("clear-button").addEventListener("click", () => ship.clear());

  // ---- Wiring -------------------------------------------------------------

  searchBox.addEventListener("input", rebuildBlockList);
  categorySelect.addEventListener("change", rebuildBlockList);
  includeVariants.addEventListener("change", () => {
    rebuildCategories(); // the counts depend on this box
    rebuildBlockList();
  });

  for (const button of document.querySelectorAll<HTMLButtonElement>("#mode-row button")) {
    button.addEventListener("click", () => setMode(button.dataset.mode as EditMode));
  }
  for (const button of document.querySelectorAll<HTMLButtonElement>("#grid-size-row button")) {
    button.addEventListener("click", () => setGridSize(button.dataset.gridSize as GridSize));
  }
  requireElement("rotate-yaw").addEventListener("click", () => rotate(rotateYaw));
  requireElement("rotate-pitch").addEventListener("click", () => rotate(rotatePitch));
  requireElement("rotate-roll").addEventListener("click", () => rotate(rotateRoll));

  // Keyboard shortcuts, ignored while typing in a text box.
  window.addEventListener("keydown", (event) => {
    const target = event.target as HTMLElement;
    if (target.tagName === "INPUT" || target.tagName === "SELECT") return;

    const key = event.key.toLowerCase();
    if ((event.ctrlKey || event.metaKey) && key === "z") {
      event.preventDefault();
      ship.undo();
    } else if (key === "1") setMode("build");
    else if (key === "2") setMode("remove");
    else if (key === "3") setMode("paint");
    else if (key === "q") rotate(rotateYaw);
    else if (key === "w") rotate(rotatePitch);
    else if (key === "e") rotate(rotateRoll);
    else if (key === "escape") {
      // Escape first cancels a drag in progress; only otherwise does it deselect.
      if (viewport.cancelAreaDrag()) return;
      state.selectedBlock = null;
      blockGrid.markSelected(null);
      updateSelectionText();
      viewport.refresh();
    }
  });

  // Short messages such as "Placed 12 blocks" fade after a few seconds.
  let messageTimer: number | undefined;
  viewport.onMessage = (text) => {
    actionMessage.textContent = text;
    window.clearTimeout(messageTimer);
    messageTimer = window.setTimeout(() => (actionMessage.textContent = ""), 3500);
  };

  // Keep the counter and 3D view in step with the ship.
  ship.onChange = () => {
    blockCount.textContent = `${ship.count} block${ship.count === 1 ? "" : "s"}`;
    if (ship.gridSize !== shownGridSize) showGridSize(ship.gridSize); // after an import, or undoing one
    viewport.refresh();
  };

  rebuildCategories();
  rebuildBlockList();
  updateSelectionText();
}
