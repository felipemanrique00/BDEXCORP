import { startAutomationWorker } from '@/lib/server/automation-worker'
import { startWintourSyncWorker } from '@/lib/server/wintour-sync-worker'

export function registerNodeInstrumentation(): void {
  startAutomationWorker()
  startWintourSyncWorker()
}
