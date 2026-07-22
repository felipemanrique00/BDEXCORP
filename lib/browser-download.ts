export type CsvValue = string | number | boolean | null | undefined

export function csvCell(value: CsvValue): string {
  let text = String(value ?? '')
  if (/^[\t\r ]*[=+\-@]/.test(text)) text = `'${text}`
  return `"${text.replace(/"/g, '""')}"`
}

export function buildCsv(rows: CsvValue[][], delimiter = ';'): string {
  return rows.map((row) => row.map(csvCell).join(delimiter)).join('\n')
}

export function downloadTextFile(
  filename: string,
  content: string,
  type = 'text/plain;charset=utf-8',
): void {
  const blob = new Blob([content], { type })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 1_000)
}

export async function imageUrlToDataUrl(url: string): Promise<string> {
  const response = await fetch(url, { cache: 'force-cache' })
  if (!response.ok) throw new Error(`Nao foi possivel carregar o ativo de marca (${response.status}).`)

  const blob = await response.blob()
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result || ''))
    reader.onerror = () => reject(reader.error || new Error('Falha ao converter o ativo de marca.'))
    reader.readAsDataURL(blob)
  })
}
