// The first-launch tutorial: dims the screen, lights up one part of the app at a
// time and explains it in a small text box. Shown once, then replayable with the
// "?" button in the view bar.

/** One stop on the tour. */
interface TutorialStep {
  /** CSS selector of the part of the app to light up. */
  target: string;
  title: string;
  text: string;
}

const STEPS: TutorialStep[] = [
  {
    target: "#game-section",
    title: "Game and grid size",
    text: "Pick the game (only Space Engineers 1 for now) and whether you are building a large grid or small grid ship.",
  },
  {
    target: "#tools-section",
    title: "Tools",
    text: "Build, remove and paint modes, the import button for opening a .sbc blueprint, and the turn, tip and roll buttons that rotate the block you are placing.",
  },
  {
    target: "#paint-section",
    title: "Paint and skins",
    text: "Choose a color and an armor skin, then use the Paint tool to apply them. The checkboxes decide whether color, skin or both are applied.",
  },
  {
    target: "#blocks-section",
    title: "Blocks",
    text: "Every block from your game install. Search, filter by menu category, and click one to start placing it.",
  },
  {
    target: "#export-section",
    title: "Export",
    text: "Name your build, choose ship or station, and export it as a blueprint straight into the game's blueprint folder. Undo and Clear live here too.",
  },
  {
    target: "#viewport",
    title: "The 3D view",
    text: "Your build lives here. A ghost of the selected block follows your cursor, green where it fits and red where it does not.",
  },
  {
    target: "#view-bar",
    title: "View controls",
    text: "Fade groups of blocks, like armor, so you can see the working parts inside a hull. Click through faded blocks lets you place things behind them.",
  },
  {
    target: "#keybinds",
    title: "Controls",
    text: "The mouse and keyboard shortcuts: drag to orbit and pan, Shift and Ctrl drags to fill floors and walls, and number keys to switch tools.",
  },
];

/** Where the tutorial remembers that it has been seen. */
const SEEN_KEY = "se-grid-builder.tutorial-seen";

/** Space kept between a lit-up part and the text box, and between the box and the window edge. */
const GAP = 16;

interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

/**
 * Where to put the text box so it sits next to the lit-up part without covering it.
 * Tries the right side, then below, then the left, and otherwise centers the box
 * in the window (used for big parts like the whole 3D view).
 */
export function placeCard(
  target: Box,
  card: { width: number; height: number },
  windowSize: { width: number; height: number },
): { left: number; top: number } {
  const clampLeft = (left: number) => Math.max(GAP, Math.min(left, windowSize.width - card.width - GAP));
  const clampTop = (top: number) => Math.max(GAP, Math.min(top, windowSize.height - card.height - GAP));
  const targetRight = target.left + target.width;
  const targetBottom = target.top + target.height;

  // A part that fills most of the window (the 3D view) has no room beside it,
  // so the box floats in the middle of it instead.
  if (target.width * target.height > 0.5 * windowSize.width * windowSize.height) {
    return {
      left: clampLeft(target.left + (target.width - card.width) / 2),
      top: clampTop(target.top + (target.height - card.height) / 2),
    };
  }
  if (targetRight + GAP + card.width + GAP <= windowSize.width) {
    return { left: targetRight + GAP, top: clampTop(target.top) };
  }
  if (targetBottom + GAP + card.height + GAP <= windowSize.height) {
    return { left: clampLeft(target.left), top: targetBottom + GAP };
  }
  if (target.left - GAP - card.width >= GAP) {
    return { left: target.left - GAP - card.width, top: clampTop(target.top) };
  }
  return {
    left: clampLeft((windowSize.width - card.width) / 2),
    top: clampTop((windowSize.height - card.height) / 2),
  };
}

/** True once the player has finished or skipped the tour. */
function hasSeenTutorial(): boolean {
  try {
    return localStorage.getItem(SEEN_KEY) === "yes";
  } catch {
    return false; // storage blocked: just show it
  }
}

function markTutorialSeen(): void {
  try {
    localStorage.setItem(SEEN_KEY, "yes");
  } catch {
    // Not remembering is harmless; the tour will show again next time.
  }
}

/** Starts the tour the first time, and wires the "?" button to replay it. */
export function setUpTutorial(): void {
  document.getElementById("help-button")?.addEventListener("click", () => runTutorial());
  if (!hasSeenTutorial()) runTutorial();
}

let running = false;

function runTutorial(): void {
  if (running) return;
  running = true;

  // The spotlight is a see-through box whose huge shadow dims everything else.
  const spotlight = document.createElement("div");
  spotlight.id = "tutorial-spotlight";
  const card = document.createElement("div");
  card.id = "tutorial-card";
  card.setAttribute("role", "dialog");
  card.setAttribute("aria-live", "polite");
  const title = document.createElement("h2");
  const text = document.createElement("p");
  const footer = document.createElement("div");
  footer.className = "tutorial-footer";
  const count = document.createElement("span");
  const skipButton = button("Skip", "tutorial-skip");
  const backButton = button("Back", "");
  const nextButton = button("Next", "tutorial-next");
  footer.append(count, skipButton, backButton, nextButton);
  card.append(title, text, footer);
  document.body.append(spotlight, card);

  let index = 0;

  const show = () => {
    const step = STEPS[index];
    const element = document.querySelector<HTMLElement>(step.target);
    element?.scrollIntoView({ block: "nearest" });
    const rect = element?.getBoundingClientRect() ?? new DOMRect(0, 0, 0, 0);

    spotlight.style.left = `${rect.left - 4}px`;
    spotlight.style.top = `${rect.top - 4}px`;
    spotlight.style.width = `${rect.width + 8}px`;
    spotlight.style.height = `${rect.height + 8}px`;

    title.textContent = step.title;
    text.textContent = step.text;
    count.textContent = `${index + 1} / ${STEPS.length}`;
    backButton.hidden = index === 0;
    nextButton.textContent = index === STEPS.length - 1 ? "Done" : "Next";

    const place = placeCard(
      { left: rect.left, top: rect.top, width: rect.width, height: rect.height },
      { width: card.offsetWidth, height: card.offsetHeight },
      { width: window.innerWidth, height: window.innerHeight },
    );
    card.style.left = `${place.left}px`;
    card.style.top = `${place.top}px`;
  };

  const close = () => {
    markTutorialSeen();
    window.removeEventListener("keydown", onKey, true);
    window.removeEventListener("resize", show);
    spotlight.remove();
    card.remove();
    running = false;
  };
  const next = () => {
    if (index === STEPS.length - 1) {
      close();
    } else {
      index++;
      show();
    }
  };
  const back = () => {
    if (index > 0) {
      index--;
      show();
    }
  };
  // Captured first so the tour's keys do not also trigger the editor's shortcuts.
  const onKey = (event: KeyboardEvent) => {
    if (event.key === "Escape") close();
    else if (event.key === "ArrowRight" || event.key === "Enter") next();
    else if (event.key === "ArrowLeft") back();
    else return;
    event.preventDefault();
    event.stopPropagation();
  };

  nextButton.onclick = next;
  backButton.onclick = back;
  skipButton.onclick = close;
  window.addEventListener("keydown", onKey, true);
  window.addEventListener("resize", show);
  show();
  nextButton.focus();
}

function button(label: string, className: string): HTMLButtonElement {
  const element = document.createElement("button");
  element.type = "button";
  element.textContent = label;
  element.className = className;
  return element;
}
