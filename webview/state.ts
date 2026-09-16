/** Shared local webview state. Each feature patches its own keys, preserving drafts. */
export function createViewState(api: {getState(): any; setState(value: any): void}) {
  let value = api.getState() || {};
  return {
    read: () => value,
    patch: (patch: Record<string, unknown>) => { value = {...value, ...patch}; api.setState(value); }
  };
}
export type ViewState = ReturnType<typeof createViewState>;
