import { readdirSync, readFileSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

const RAW_TEMPORAL_INPUT = /type\s*=\s*["'](?:date|datetime-local)["']/g

describe('temporal input inventory', () => {
  it('routes every application date field through the browser-safe primitive', () => {
    const root = process.cwd()
    const offenders = ['app', 'components']
      .flatMap((directory) => tsxFiles(resolve(root, directory)))
      .flatMap((path) => {
        const source = readFileSync(path, 'utf8')
        const matches = [...source.matchAll(RAW_TEMPORAL_INPUT)]
        return matches.map((match) => `${relative(root, path)}:${lineAt(source, match.index || 0)}`)
      })

    expect(offenders).toEqual([])
  })
})

function tsxFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) return tsxFiles(path)
    return entry.isFile() && entry.name.endsWith('.tsx') ? [path] : []
  })
}

function lineAt(source: string, index: number): number {
  return source.slice(0, index).split('\n').length
}
