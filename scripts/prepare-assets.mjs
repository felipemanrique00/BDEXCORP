import { copyFile, mkdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const source = path.join(projectRoot, 'node_modules', 'pdfjs-dist', 'build', 'pdf.worker.min.mjs')
const target = path.join(projectRoot, 'public', 'vendor', 'pdf.worker.min.mjs')

export async function copyAssetIfChanged(sourcePath, targetPath) {
  const sourceContents = await readFile(sourcePath).catch(() => {
    throw new Error('Worker do pdfjs-dist nao encontrado. Execute npm ci antes de preparar os ativos.')
  })
  const targetContents = await readFile(targetPath).catch((error) => {
    if (error?.code === 'ENOENT') return null
    throw error
  })

  if (targetContents?.equals(sourceContents)) return false

  await mkdir(path.dirname(targetPath), { recursive: true })
  await copyFile(sourcePath, targetPath)
  return true
}

const isEntrypoint = process.argv[1]
  ? path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
  : false

if (isEntrypoint) {
  const changed = await copyAssetIfChanged(source, target)
  process.stdout.write(changed ? 'Ativos locais atualizados.\n' : 'Ativos locais ja atualizados.\n')
}
