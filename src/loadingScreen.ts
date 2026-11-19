// The loading screen: a shell-style log of what the app is doing at start-up,
// with a "Found 812 / 1240 blocks" counter just above a progress bar.
//
// It only draws; the work itself lives in `catalog.ts` (reading the game's
// block files) and `preload.ts` (icons, skins, shapes and textures).

/** The text of a counter line, e.g. "Found 812 / 1,240 blocks...". */
export function countText(verb: string, found: number, total: number, noun: string): string {
  return `${verb} ${found.toLocaleString("en-US")} / ${total.toLocaleString("en-US")} ${noun}...`;
}

/**
 * Where the overall bar should be when one stage is `done` of `total` finished.
 * A stage owns the slice of the bar from `from` to `to` (each 0 to 1). An
 * empty stage counts as finished, so the bar never divides by zero.
 */
export function stageFraction(from: number, to: number, done: number, total: number): number {
  const finished = total <= 0 ? 1 : Math.min(1, Math.max(0, done / total));
  return from + (to - from) * finished;
}

/** How many log lines to keep; older ones scroll away for good. */
const MAX_LOG_LINES = 300;

export class LoadingScreen {
  private readonly log: HTMLElement;
  private readonly counter: HTMLElement;
  private readonly bar: HTMLElement;

  constructor(private readonly root: HTMLElement) {
    this.log = root.querySelector<HTMLElement>("#loading-log")!;
    this.counter = root.querySelector<HTMLElement>("#loading-count")!;
    this.bar = root.querySelector<HTMLElement>("#loading-bar-fill")!;
  }

  /** Adds one line to the log (and keeps the newest line in view). */
  say(text: string): void {
    const line = document.createElement("div");
    line.textContent = `> ${text}`;
    this.log.append(line);
    while (this.log.childElementCount > MAX_LOG_LINES) this.log.firstElementChild?.remove();
    this.log.scrollTop = this.log.scrollHeight;
  }

  /** Sets the counter line above the bar and moves the bar (0 to 1). */
  progress(text: string, fraction: number): void {
    this.counter.textContent = text;
    this.bar.style.width = `${Math.round(Math.min(1, Math.max(0, fraction)) * 100)}%`;
  }

  /** Fills the bar, then fades the whole screen away. */
  async finish(): Promise<void> {
    this.progress("Ready", 1);
    await new Promise((resolve) => setTimeout(resolve, 250)); // let the full bar be seen
    this.root.classList.add("done");
    // Remove it once the fade has played, so it cannot catch clicks.
    await new Promise((resolve) => setTimeout(resolve, 400));
    this.root.hidden = true;
  }

  /** Shows a button under the bar (used to let the player pick the game folder). */
  offerButton(label: string, onClick: () => void): void {
    const button = this.root.querySelector<HTMLButtonElement>("#loading-action")!;
    button.textContent = label;
    button.hidden = false;
    button.onclick = onClick;
  }

  /** Puts the screen back to its starting state, for trying again. */
  reset(): void {
    this.root.classList.remove("failed", "done");
    this.root.hidden = false;
    this.root.querySelector<HTMLButtonElement>("#loading-action")!.hidden = true;
    this.log.replaceChildren();
    this.progress("Starting...", 0);
  }

  /** Keeps the screen up and shows why the app could not start. */
  fail(message: string): void {
    this.root.classList.add("failed");
    this.say(message);
    this.counter.textContent = "Could not start";
  }
}
