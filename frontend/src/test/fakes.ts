/** Minimal EventSource double: tests push server events with `emit`. */
export class FakeEventSource {
  static instances: FakeEventSource[] = [];
  static get last() {
    return FakeEventSource.instances[FakeEventSource.instances.length - 1];
  }
  closed = false;
  onerror: (() => void) | null = null;
  private listeners = new Map<string, ((e: MessageEvent) => void)[]>();

  constructor(public url: string) {
    FakeEventSource.instances.push(this);
  }
  addEventListener(name: string, fn: (e: MessageEvent) => void) {
    this.listeners.set(name, [...(this.listeners.get(name) ?? []), fn]);
  }
  close() {
    this.closed = true;
  }
  emit(name: string, data: unknown) {
    this.emitRaw(name, JSON.stringify(data));
  }
  emitRaw(name: string, data: string) {
    const event = new MessageEvent(name, { data });
    this.listeners.get(name)?.forEach((fn) => fn(event));
  }
  /**
   * What a browser does when the connection drops: a plain `error` Event (no data) goes to every
   * "error" listener, then to `onerror`. Server-sent events named "error" are MessageEvents.
   */
  connectionError() {
    this.listeners.get('error')?.forEach((fn) => fn(new Event('error') as MessageEvent));
    this.onerror?.();
  }
  static reset() {
    FakeEventSource.instances = [];
  }
}
