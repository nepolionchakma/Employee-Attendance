export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return
  if (process.env.NEXT_PHASE === 'phase-production-build') return

  const { backfillCurrentTab } = await import('./lib/googleSheets')

  const run = () => backfillCurrentTab().catch((e) => console.error('Auto-absent job failed:', e.message))
  run()
  const timer = setInterval(run, 60 * 60 * 1000)
  if (typeof timer.unref === 'function') timer.unref()
}