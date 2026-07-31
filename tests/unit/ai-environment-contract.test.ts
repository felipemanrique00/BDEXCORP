import fs from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

describe('AI environment contract', () => {
  it('uses the documented transcription model variable throughout the gateway', () => {
    const gatewaySource = fs.readFileSync(
      path.join(process.cwd(), 'lib', 'server', 'ai-gateway-service.ts'),
      'utf8',
    )
    const providerSource = fs.readFileSync(
      path.join(process.cwd(), 'lib', 'server-ai.ts'),
      'utf8',
    )

    expect(gatewaySource).toContain('OPENAI_TRANSCRIBE_MODEL')
    expect(gatewaySource).not.toContain('OPENAI_TRANSCRIPTION_MODEL')
    expect(providerSource).toContain('process.env.OPENAI_TRANSCRIBE_MODEL')
  })
})
