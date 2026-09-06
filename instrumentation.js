export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return
  if (process.env.NEXT_PHASE === 'phase-production-build') return

  const { backfillCurrentTab } = await import('./lib/googleSheets')

  // Runs on the hour (minute 0) so past-day auto-absent marking happens at a
  // predictable time instead of drifting with server start.
  const run = () => backfillCurrentTab().catch((e) => console.error('Auto-absent job failed:', e.message))
  const scheduleTopOfHour = () => {
    const now = Date.now()
    const delay = 60 * 60 * 1000 - (now % (60 * 60 * 1000))
    setTimeout(() => {
      run()
      scheduleTopOfHour()
    }, delay)
  }
  run()
  scheduleTopOfHour()
}