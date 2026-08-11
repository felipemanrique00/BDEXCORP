import { mkdtemp, readFile, rm, stat, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { describe, expect, it } from 'vitest'

type PrepareAssetsModule = {
  copyAssetIfChanged: (sourcePath: string, targetPath: string) => Promise<boolean>
}

describe('prepare-assets', () => {
  it('keeps the generated asset timestamp stable when its content did not change', async () => {
    const modulePath = path.resolve(process.cwd(), 'scripts', 'prepare-assets.mjs')
    const { copyAssetIfChanged } = (await import(pathToFileURL(modulePath).href)) as PrepareAssetsModule
    const root = await mkdtemp(path.join(tmpdir(), 'bbt-prepare-assets-'))
    const source = path.join(root, 'source.mjs')
    const target = path.join(root, 'public', 'vendor', 'target.mjs')

    try {
      await writeFile(source, 'worker-v1')
      expect(await copyAssetIfChanged(source, target)).toBe(true)

      const sentinel = new Date('2001-02-03T04:05:06.000Z')
      await utimes(target, sentinel, sentinel)
      expect(await copyAssetIfChanged(source, target)).toBe(false)
      expect((await stat(target)).mtimeMs).toBe(sentinel.getTime())

      // Mesmo tamanho, conteudo diferente: ainda precisa atualizar.
      await writeFile(source, 'worker-v2')
      expect(await copyAssetIfChanged(source, target)).toBe(true)
      expect(await readFile(target, 'utf8')).toBe('worker-v2')
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})
