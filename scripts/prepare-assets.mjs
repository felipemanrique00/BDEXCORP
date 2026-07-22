import { copyFile, mkdir, stat } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const source = path.join(projectRoot, 'node_modules', 'pdfjs-dist', 'build', 'pdf.worker.min.mjs')
const targetDirectory = path.join(projectRoot, 'public', 'vendor')
const target = path.join(targetDirectory, 'pdf.worker.min.mjs')

await stat(source).catch(() => {
  throw new Error('Worker do pdfjs-dist não encontrado. Execute npm ci antes de preparar os ativos.')
})
await mkdir(targetDirectory, { recursive: true })
await copyFile(source, target)
process.stdout.write('Ativos locais preparados.\n')
