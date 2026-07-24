export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const instrumentation = await import('./instrumentation-node')
    instrumentation.registerNodeInstrumentation()
  }
}
