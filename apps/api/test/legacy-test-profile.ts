export function useLegacyTestProfile(): void {
  let previous: string | undefined;
  beforeEach(() => {
    previous = process.env.TOWNBASE_RUNTIME_PROFILE;
    process.env.TOWNBASE_RUNTIME_PROFILE = "legacy_development";
  });
  afterEach(() => {
    if (previous == null) delete process.env.TOWNBASE_RUNTIME_PROFILE;
    else process.env.TOWNBASE_RUNTIME_PROFILE = previous;
  });
}
