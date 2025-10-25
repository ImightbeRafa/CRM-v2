export async function register() {
  try {
    if (typeof (globalThis as any).self === 'undefined') {
      (globalThis as any).self = globalThis as any;
    }
  } catch {
    // no-op
  }
}
