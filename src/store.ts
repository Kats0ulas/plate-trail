/** A tiny typed store: one state object, shallow updates, subscribers notified after each change. */
export class Store<S extends object> {
  private state: S;
  private readonly listeners = new Set<(state: S, prev: S) => void>();

  constructor(initial: S) {
    this.state = initial;
  }

  get(): S {
    return this.state;
  }

  set(patch: Partial<S>): void {
    const prev = this.state;
    let changed = false;
    for (const k in patch) {
      if (!Object.is(prev[k], patch[k])) {
        changed = true;
        break;
      }
    }
    if (!changed) return;
    this.state = { ...prev, ...patch };
    for (const fn of this.listeners) fn(this.state, prev);
  }

  subscribe(fn: (state: S, prev: S) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** Call `fn` whenever any of the given keys changes (and once immediately if `now`). */
  on<K extends keyof S>(
    keys: readonly K[],
    fn: (state: S, prev: S) => void,
    now = false,
  ): () => void {
    if (now) fn(this.state, this.state);
    return this.subscribe((s, p) => {
      if (keys.some((k) => !Object.is(s[k], p[k]))) fn(s, p);
    });
  }
}
