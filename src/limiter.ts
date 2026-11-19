// A small helper that keeps only a few slow tasks running at once.
//
// Loading a model or an icon asks Rust to read and decode a file. Scrolling a
// long list could start hundreds of those together, so each loader wraps its
// work in a limiter: extra tasks wait their turn.

/** Returns a function that runs tasks, at most `maxAtOnce` at the same time. */
export function createLimiter(maxAtOnce: number): <Result>(task: () => Promise<Result>) => Promise<Result> {
  let running = 0;
  const waiting: Array<() => void> = [];

  return async function limited<Result>(task: () => Promise<Result>): Promise<Result> {
    if (running >= maxAtOnce) {
      // Wait until a finishing task hands over its place (see `finally`).
      await new Promise<void>((resolve) => waiting.push(resolve));
    } else {
      running++;
    }
    try {
      return await task();
    } finally {
      const next = waiting.shift();
      if (next) next(); // the waiting task takes over this place, so `running` stays the same
      else running--;
    }
  };
}
