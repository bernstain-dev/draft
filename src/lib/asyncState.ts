/** Every request owns a generation and abort signal; older results cannot commit. */
export class RequestGeneration {
  private generation = 0;
  private controller: AbortController | null = null;
  next() {
    this.controller?.abort();
    const controller = new AbortController();
    this.controller = controller;
    const generation = ++this.generation;
    return { signal: controller.signal, isCurrent: () => generation === this.generation && !controller.signal.aborted };
  }
  cancel() { this.generation++; this.controller?.abort(); this.controller = null; }
}

export interface IdentityState<U, P, T> {
  user: U | null; profile: P | null; patient: T | null; loading: boolean; error: string | null;
}
/** Used by both real providers and the async race tests; publishes identity atomically. */
export class IdentityCoordinator<U extends { id: string }, P, T> {
  state: IdentityState<U, P, T> = { user: null, profile: null, patient: null, loading: true, error: null };
  private gate = new RequestGeneration();
  private pending: Promise<string | null> | null = null;
  private active = true;
  private resolveIdentity: (user: U, signal: AbortSignal) => Promise<{ profile: P; patient: T | null }>;
  private publish: (state: IdentityState<U, P, T>) => void;
  private timeoutMs: number;
  constructor(resolveIdentity: (user: U, signal: AbortSignal) => Promise<{ profile: P; patient: T | null }>,
    publish: (state: IdentityState<U, P, T>) => void, timeoutMs = 30000) {
    this.resolveIdentity = resolveIdentity; this.publish = publish;
    this.timeoutMs = timeoutMs;
  }
  private commit(state: IdentityState<U, P, T>) { if (this.active) { this.state = state; this.publish(state); } }
  accept(user: U | null, force = false): Promise<string | null> {
    if (!force && user && this.state.user?.id === user.id && this.state.loading && this.pending) return this.pending;
    const ticket = this.gate.next();
    this.commit({ user, profile: null, patient: null, loading: !!user, error: null });
    if (!user) { this.pending = null; return Promise.resolve(null); }
    // Supabase auth callbacks must return synchronously before querying APIs.
    this.pending = new Promise((resolve) => setTimeout(resolve, 0)).then(async () => {
      if (!ticket.isCurrent() || !this.active) return 'Your session changed. Please try again.';
      const controller = new AbortController();
      let rejectCancelled: (error: Error) => void = () => {};
      const cancelled = new Promise<never>((_resolve, reject) => { rejectCancelled = reject; });
      const abort = () => { controller.abort(); rejectCancelled(new Error('Your session changed. Please try again.')); };
      ticket.signal.addEventListener('abort', abort, { once: true });
      let timer: ReturnType<typeof setTimeout>;
      try {
        const deadline = new Promise<never>((_resolve, reject) => { timer = setTimeout(() => { controller.abort(); reject(new Error('Account loading timed out. Please retry.')); }, this.timeoutMs); });
        const identity = await Promise.race([this.resolveIdentity(user, controller.signal), deadline, cancelled]);
        if (!ticket.isCurrent() || !this.active) return 'Your session changed. Please try again.';
        this.commit({ user, ...identity, loading: false, error: null });
        return null;
      } catch (err) {
        if (!ticket.isCurrent() || !this.active) return 'Your session changed. Please try again.';
        const message = (err instanceof Error && err.message) || 'Unable to resolve your account. Please try again.';
        this.commit({ user, profile: null, patient: null, loading: false, error: message });
        return message;
      } finally {
        clearTimeout(timer!); ticket.signal.removeEventListener('abort', abort);
      }
    });
    return this.pending;
  }
  fail(message: string) { this.gate.cancel(); this.pending = null; this.commit({ user: null, profile: null, patient: null, loading: false, error: message }); }
  dispose() { this.active = false; this.gate.cancel(); }
}
