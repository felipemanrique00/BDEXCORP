import { readdir, readFile } from 'node:fs/promises'
import { extname, join, relative } from 'node:path'
import { promisify } from 'node:util'
import { execFile } from 'node:child_process'

const root = process.cwd()
const execFileAsync = promisify(execFile)
const ignoredDirectories = new Set([
  '.git', '.next', 'node_modules', 'coverage', 'playwright-report', 'test-results',
  '.server-backups', '.server-runtime', '.bbt-storage',
])
const textExtensions = new Set([
  '.cjs', '.css', '.env', '.example', '.html', '.js', '.json', '.md', '.mjs',
  '.ps1', '.sh', '.sql', '.ts', '.tsx', '.txt', '.yml', '.yaml',
])
const highConfidencePatterns = [
  { name: 'private key', pattern: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/ },
  { name: 'AWS access key', pattern: /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/ },
  { name: 'GitHub token', pattern: /\b(?:ghp|gho|ghu|ghs|github_pat)_[A-Za-z0-9_]{20,}\b/ },
  { name: 'OpenAI key', pattern: /\bsk-[A-Za-z0-9_-]{24,}\b/ },
  { name: 'Slack token', pattern: /\bxox[baprs]-[A-Za-z0-9-]{20,}\b/ },
]

const findings = []
const trackedFiles = await readTrackedFiles(root)
for (const path of await walk(root)) {
  const relativePath = relative(root, path).replaceAll('\\', '/')
  if (isForbiddenEnvironmentFile(relativePath)) {
    if (trackedFiles === null || trackedFiles.has(relativePath)) {
      findings.push(`${relativePath}: arquivo de ambiente local nao deve ser versionado`)
    }
    continue
  }
  if (!textExtensions.has(extname(path).toLowerCase()) && !relativePath.endsWith('.env.example')) continue

  const content = await readFile(path, 'utf8').catch(() => '')
  for (const detector of highConfidencePatterns) {
    if (detector.pattern.test(content)) findings.push(`${relativePath}: possivel ${detector.name}`)
  }
}

if (findings.length) {
  console.error('A verificacao de segredos encontrou bloqueadores:')
  findings.forEach((finding) => console.error(`- ${finding}`))
  process.exit(1)
}
console.log('Verificacao de segredos concluida sem achados de alta confianca.')

async function walk(directory) {
  const files = []
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.isDirectory() && ignoredDirectories.has(entry.name)) continue
    const path = join(directory, entry.name)
    if (entry.isDirectory()) files.push(...await walk(path))
    else if (entry.isFile()) files.push(path)
  }
  return files
}

function isForbiddenEnvironmentFile(path) {
  const name = path.split('/').at(-1) || ''
  return name.startsWith('.env') && name !== '.env.example'
}

async function readTrackedFiles(directory) {
  try {
    const { stdout } = await execFileAsync('git', ['ls-files', '--cached'], {
      cwd: directory,
      windowsHide: true,
    })
    return new Set(stdout.split(/\r?\n/).map((path) => path.replaceAll('\\', '/')).filter(Boolean))
  } catch {
    return null
  }
}
