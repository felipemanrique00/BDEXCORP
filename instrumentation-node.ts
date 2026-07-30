import { startAutomationWorker } from '@/lib/server/automation-worker'

export function registerNodeInstrumentation(): void {
  startAutomationWorker()
}
