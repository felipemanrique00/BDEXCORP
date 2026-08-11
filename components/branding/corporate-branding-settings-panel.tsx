'use client'

import {
  Check,
  ImagePlus,
  Loader2,
  Palette,
  RefreshCw,
  RotateCcw,
  Save,
  Upload,
} from 'lucide-react'
import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'

import {
  corporateBrandingConfigurationSchema,
  corporateBrandingScopeIdSchema,
  corporateBrandingScopeTypeSchema,
  emptyCorporateBrandingDeclared,
  type CorporateBrandingConfiguration,
  type CorporateBrandingDeclared,
  type CorporateBrandingScopeType,
  type CorporateBrandingSource,
} from '@/lib/corporate-branding'

interface CorporateBrandingSettingsPanelProps {
  scopeType: CorporateBrandingScopeType
  scopeId: string
  scopeName: string
  canManage: boolean
  compact?: boolean
}

type TextFieldKey = 'displayName' | 'logoAlt' | 'documentLegalName' | 'documentNumber'
type ColorFieldKey = 'primaryColor' | 'accentColor' | 'sidebarColor'

const TEXT_FIELDS: ReadonlyArray<{
  key: TextFieldKey
  label: string
  description: string
  maxLength: number
  placeholder: string
}> = [
  {
    key: 'displayName',
    label: 'Nome de exibição',
    description: 'Nome curto exibido no ambiente e nos cabeçalhos.',
    maxLength: 200,
    placeholder: 'Ex.: Grupo Exemplo',
  },
  {
    key: 'logoAlt',
    label: 'Descrição da logomarca',
    description: 'Texto alternativo usado por leitores de tela.',
    maxLength: 240,
    placeholder: 'Ex.: Logomarca do Grupo Exemplo',
  },
  {
    key: 'documentLegalName',
    label: 'Razão social nos documentos',
    description: 'Identificação legal do cliente em vouchers e relatórios.',
    maxLength: 240,
    placeholder: 'Ex.: Grupo Exemplo Participações S.A.',
  },
  {
    key: 'documentNumber',
    label: 'CNPJ ou documento',
    description: 'Aceita letras, números, ponto, barra e hífen.',
    maxLength: 64,
    placeholder: 'Ex.: 12.345.678/0001-90',
  },
]

const COLOR_FIELDS: ReadonlyArray<{
  key: ColorFieldKey
  label: string
  description: string
}> = [
  {
    key: 'primaryColor',
    label: 'Cor principal',
    description: 'Títulos, botões principais e destaques institucionais.',
  },
  {
    key: 'accentColor',
    label: 'Cor de destaque',
    description: 'Indicadores, abas ativas e elementos de apoio.',
  },
  {
    key: 'sidebarColor',
    label: 'Cor do menu lateral',
    description: 'Fundo da navegação principal do ambiente.',
  },
]

const ALLOWED_LOGO_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp'])
const MAX_LOGO_BYTES = 5 * 1024 * 1024
const HEX_COLOR = /^#[0-9A-Fa-f]{6}$/
const DOCUMENT_NUMBER = /^[A-Za-z0-9./-]+$/

export function CorporateBrandingSettingsPanel({
  scopeType,
  scopeId,
  scopeName,
  canManage,
  compact = false,
}: CorporateBrandingSettingsPanelProps) {
  const uploadInputId = useId()
  const uploadInputRef = useRef<HTMLInputElement>(null)
  const activeScopeRef = useRef(`${scopeType}:${scopeId}`)
  const [configuration, setConfiguration] = useState<CorporateBrandingConfiguration | null>(null)
  const [draft, setDraft] = useState<CorporateBrandingDeclared>(emptyCorporateBrandingDeclared())
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    const scopeKey = `${scopeType}:${scopeId}`
    activeScopeRef.current = scopeKey
    const controller = new AbortController()
    setConfiguration(null)
    setDraft(emptyCorporateBrandingDeclared())
    setLoading(true)
    setSaving(false)
    setUploading(false)
    setError('')

    void getBrandingConfiguration(scopeType, scopeId, controller.signal)
      .then((result) => {
        if (controller.signal.aborted || activeScopeRef.current !== scopeKey) return
        setConfiguration(result)
        setDraft(result.declared)
      })
      .catch((reason) => {
        if (controller.signal.aborted || activeScopeRef.current !== scopeKey) return
        setError(errorMessage(reason, 'Não foi possível carregar a identidade visual.'))
      })
      .finally(() => {
        if (!controller.signal.aborted && activeScopeRef.current === scopeKey) setLoading(false)
      })

    return () => controller.abort()
  }, [scopeId, scopeType])

  const dirty = useMemo(
    () => Boolean(configuration && !sameDeclared(draft, configuration.declared)),
    [configuration, draft],
  )
  const preview = useMemo(() => {
    if (!configuration) return null
    return {
      displayName: draft.displayName || configuration.effective.displayName,
      logoUrl: configuration.effective.logoUrl,
      logoAlt: draft.logoAlt || configuration.effective.logoAlt,
      primaryColor: normalizePreviewColor(draft.primaryColor, configuration.effective.primaryColor),
      accentColor: normalizePreviewColor(draft.accentColor, configuration.effective.accentColor),
      sidebarColor: normalizePreviewColor(draft.sidebarColor, configuration.effective.sidebarColor),
      documentLegalName: draft.documentLegalName || configuration.effective.documentLegalName,
      documentNumber: draft.documentNumber ?? configuration.effective.documentNumber,
    }
  }, [configuration, draft])

  async function save(nextDraft = draft) {
    if (!configuration || saving || uploading || !canManage) return
    const validationError = validateDeclared(nextDraft)
    if (validationError) {
      toast.error(validationError)
      return
    }
    const scopeKey = `${scopeType}:${scopeId}`
    setSaving(true)
    try {
      const next = await patchBrandingConfiguration(scopeType, scopeId, nextDraft, configuration.version)
      if (activeScopeRef.current !== scopeKey) return
      setConfiguration(next)
      setDraft(next.declared)
      toast.success('Identidade visual atualizada.')
      window.dispatchEvent(new CustomEvent('bbt-branding-configuration-updated', {
        detail: { scopeType, scopeId },
      }))
    } catch (reason) {
      if (activeScopeRef.current !== scopeKey) return
      toast.error(errorMessage(reason, 'Não foi possível salvar a identidade visual.'))
    } finally {
      if (activeScopeRef.current === scopeKey) setSaving(false)
    }
  }

  async function uploadLogo(file: File | null) {
    if (!file || !configuration || uploading || saving || !canManage) return
    if (!ALLOWED_LOGO_TYPES.has(file.type)) {
      toast.error('Selecione uma imagem PNG, JPEG ou WebP.')
      clearUploadInput()
      return
    }
    if (file.size > MAX_LOGO_BYTES) {
      toast.error('A logomarca deve ter no máximo 5 MB.')
      clearUploadInput()
      return
    }

    const scopeKey = `${scopeType}:${scopeId}`
    setUploading(true)
    try {
      const next = await uploadBrandingLogo(scopeType, scopeId, file, configuration.version)
      if (activeScopeRef.current !== scopeKey) return
      setConfiguration(next)
      setDraft((current) => ({ ...current, logoFileId: next.declared.logoFileId }))
      toast.success('Logomarca enviada e aplicada.')
      window.dispatchEvent(new CustomEvent('bbt-branding-configuration-updated', {
        detail: { scopeType, scopeId },
      }))
    } catch (reason) {
      if (activeScopeRef.current !== scopeKey) return
      toast.error(errorMessage(reason, 'Não foi possível enviar a logomarca.'))
    } finally {
      if (activeScopeRef.current === scopeKey) setUploading(false)
      clearUploadInput()
    }
  }

  function clearUploadInput() {
    if (uploadInputRef.current) uploadInputRef.current.value = ''
  }

  function restoreInheritance() {
    setDraft(emptyCorporateBrandingDeclared())
    toast.info('Herança selecionada. Clique em Salvar para confirmar.')
  }

  const inheritanceChain = scopeType === 'company'
    ? configuration?.effective.groupId
      ? 'Empresa → Grupo → Sistema'
      : 'Empresa → Sistema'
    : 'Grupo → Sistema'

  return (
    <section
      className={compact ? 'bbt-card p-5' : 'bbt-card p-6'}
      aria-labelledby={`corporate-branding-${scopeType}-${scopeId}`}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-cyan-100 text-cyan-700 dark:bg-cyan-900/30 dark:text-cyan-300">
            <Palette className="h-5 w-5" aria-hidden="true" />
          </span>
          <div>
            <p className="bbt-section-label">Identidade visual</p>
            <h2
              id={`corporate-branding-${scopeType}-${scopeId}`}
              className="mt-1 font-semibold text-bbt-primary dark:text-white"
            >
              {scopeName}
            </h2>
            <p className="mt-1 max-w-3xl text-xs leading-5 text-slate-500">
              Personalize o ambiente e a identificação do cliente nos documentos. A BBT continua identificada como agência emissora.
            </p>
          </div>
        </div>
        {!loading && configuration && (
          <span className="rounded-full border border-slate-200 px-2.5 py-1 text-[10px] font-semibold text-slate-500 dark:border-slate-700">
            {inheritanceChain}
          </span>
        )}
      </div>

      {loading && (
        <div className="mt-5 flex items-center justify-center gap-2 py-10 text-sm text-slate-500" role="status">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> Carregando identidade visual...
        </div>
      )}

      {!loading && error && (
        <div className="mt-5 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/20 dark:text-red-300" role="alert">
          <p>{error}</p>
          <button type="button" onClick={() => window.location.reload()} className="mt-3 inline-flex items-center gap-2 font-semibold underline">
            <RefreshCw className="h-4 w-4" aria-hidden="true" /> Tentar novamente
          </button>
        </div>
      )}

      {!loading && configuration && preview && (
        <>
          <div className={`mt-6 grid gap-5 ${compact ? '' : 'xl:grid-cols-[minmax(0,1fr)_360px]'}`}>
            <div className="space-y-5">
              <fieldset className="rounded-xl border border-bbt-gray-100 p-4 dark:border-slate-700">
                <legend className="px-1 text-sm font-semibold text-bbt-primary dark:text-white">Logomarca</legend>
                <div className="mt-1 flex flex-col gap-4 sm:flex-row sm:items-center">
                  <div className="flex h-24 w-full items-center justify-center rounded-xl border border-dashed border-slate-300 bg-white p-3 sm:w-56 dark:border-slate-600">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={configuration.effective.logoUrl} alt={preview.logoAlt} className="max-h-full max-w-full object-contain" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap gap-2">
                      <input
                        ref={uploadInputRef}
                        id={uploadInputId}
                        type="file"
                        accept="image/png,image/jpeg,image/webp"
                        className="sr-only"
                        disabled={!canManage || uploading || saving}
                        onChange={(event) => void uploadLogo(event.target.files?.[0] || null)}
                      />
                      <label
                        htmlFor={uploadInputId}
                        aria-disabled={!canManage || uploading || saving}
                        className={`bbt-button-ghost inline-flex cursor-pointer items-center gap-2 ${!canManage || uploading || saving ? 'pointer-events-none opacity-50' : ''}`}
                      >
                        {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                        {uploading ? 'Enviando...' : 'Enviar logomarca'}
                      </label>
                      <button
                        type="button"
                        disabled={!canManage || uploading || saving || draft.logoFileId === null}
                        onClick={() => setDraft((current) => ({ ...current, logoFileId: null }))}
                        className="bbt-button-ghost disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        <RotateCcw className="h-4 w-4" aria-hidden="true" /> Herdar logomarca
                      </button>
                    </div>
                    <p className="mt-2 text-xs leading-5 text-slate-500">PNG, JPEG ou WebP, com até 5 MB. O servidor valida e normaliza o arquivo.</p>
                    <p className="mt-1 text-[11px] text-slate-500">
                      Origem efetiva: <strong>{sourceLabel(configuration.effective.sources.logoUrl)}</strong>
                      {draft.logoFileId !== configuration.declared.logoFileId ? ' · alteração pendente' : ''}
                    </p>
                  </div>
                </div>
              </fieldset>

              <fieldset className="rounded-xl border border-bbt-gray-100 p-4 dark:border-slate-700">
                <legend className="px-1 text-sm font-semibold text-bbt-primary dark:text-white">Identificação</legend>
                <div className="mt-1 grid gap-4 md:grid-cols-2">
                  {TEXT_FIELDS.map((field) => (
                    <TextOverrideField
                      key={field.key}
                      definition={field}
                      value={draft[field.key]}
                      effectiveValue={configuration.effective[field.key] || ''}
                      effectiveSource={configuration.effective.sources[field.key]}
                      disabled={!canManage || saving || uploading}
                      onChange={(value) => setDraft((current) => ({ ...current, [field.key]: value }))}
                    />
                  ))}
                </div>
              </fieldset>

              <fieldset className="rounded-xl border border-bbt-gray-100 p-4 dark:border-slate-700">
                <legend className="px-1 text-sm font-semibold text-bbt-primary dark:text-white">Cores</legend>
                <div className="mt-1 grid gap-4 md:grid-cols-3">
                  {COLOR_FIELDS.map((field) => (
                    <ColorOverrideField
                      key={field.key}
                      definition={field}
                      value={draft[field.key]}
                      effectiveValue={configuration.effective[field.key]}
                      effectiveSource={configuration.effective.sources[field.key]}
                      disabled={!canManage || saving || uploading}
                      onChange={(value) => setDraft((current) => ({ ...current, [field.key]: value }))}
                    />
                  ))}
                </div>
              </fieldset>
            </div>

            <BrandingPreview preview={preview} source={configuration.effective.source} />
          </div>

          {canManage ? (
            <div className="mt-6 flex flex-wrap items-center justify-between gap-3 border-t border-bbt-gray-100 pt-5 dark:border-slate-700">
              <p className="text-xs text-slate-500" aria-live="polite">
                {dirty ? 'Há alterações aguardando salvamento.' : 'Configuração sincronizada.'}
              </p>
              <div className="flex flex-wrap justify-end gap-2">
                <button
                  type="button"
                  disabled={saving || uploading || isEmptyDeclared(draft)}
                  onClick={restoreInheritance}
                  className="bbt-button-ghost disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <RefreshCw className="h-4 w-4" aria-hidden="true" /> Restaurar herança
                </button>
                <button
                  type="button"
                  disabled={saving || uploading || !dirty}
                  onClick={() => {
                    if (!configuration) return
                    setDraft(configuration.declared)
                  }}
                  className="bbt-button-ghost disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <RotateCcw className="h-4 w-4" aria-hidden="true" /> Desfazer
                </button>
                <button
                  type="button"
                  disabled={saving || uploading || !dirty}
                  onClick={() => void save()}
                  className="bbt-button-primary disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                  {saving ? 'Salvando...' : 'Salvar identidade'}
                </button>
              </div>
            </div>
          ) : (
            <p className="mt-5 border-t border-bbt-gray-100 pt-4 text-xs text-slate-500 dark:border-slate-700">
              Configuração somente para consulta. É necessária a permissão de alterar configurações.
            </p>
          )}
        </>
      )}
    </section>
  )
}

function TextOverrideField({
  definition,
  value,
  effectiveValue,
  effectiveSource,
  disabled,
  onChange,
}: {
  definition: (typeof TEXT_FIELDS)[number]
  value: string | null
  effectiveValue: string
  effectiveSource: CorporateBrandingSource
  disabled: boolean
  onChange: (value: string | null) => void
}) {
  const customized = value !== null
  return (
    <div className="rounded-lg border border-slate-200 p-3 dark:border-slate-700">
      <div className="flex items-start justify-between gap-3">
        <div>
          <label htmlFor={`branding-${definition.key}`} className="text-sm font-semibold text-bbt-primary dark:text-white">
            {definition.label}
          </label>
          <p className="mt-1 text-xs leading-5 text-slate-500">{definition.description}</p>
        </div>
        <label className="inline-flex shrink-0 items-center gap-1.5 text-[11px] font-semibold text-slate-600 dark:text-slate-300">
          <input
            type="checkbox"
            checked={customized}
            disabled={disabled}
            onChange={(event) => onChange(event.target.checked ? effectiveValue : null)}
            className="h-4 w-4 rounded border-slate-300 text-bbt-primary focus:ring-bbt-accent"
          />
          Personalizar
        </label>
      </div>
      <input
        id={`branding-${definition.key}`}
        type="text"
        value={value || ''}
        maxLength={definition.maxLength}
        placeholder={customized ? definition.placeholder : effectiveValue || 'Sem valor herdado'}
        disabled={disabled || !customized}
        onChange={(event) => onChange(event.target.value)}
        className="bbt-input mt-3 disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-400 dark:disabled:bg-slate-900/40"
      />
      <p className="mt-2 text-[11px] text-slate-500">
        {customized ? 'Valor personalizado' : `Herdado de: ${sourceLabel(effectiveSource)}`}
      </p>
    </div>
  )
}

function ColorOverrideField({
  definition,
  value,
  effectiveValue,
  effectiveSource,
  disabled,
  onChange,
}: {
  definition: (typeof COLOR_FIELDS)[number]
  value: string | null
  effectiveValue: string
  effectiveSource: CorporateBrandingSource
  disabled: boolean
  onChange: (value: string | null) => void
}) {
  const customized = value !== null
  const pickerValue = HEX_COLOR.test(value || '') ? value! : effectiveValue
  return (
    <div className="rounded-lg border border-slate-200 p-3 dark:border-slate-700">
      <div className="flex items-start justify-between gap-2">
        <div>
          <label htmlFor={`branding-${definition.key}`} className="text-sm font-semibold text-bbt-primary dark:text-white">
            {definition.label}
          </label>
          <p className="mt-1 text-xs leading-5 text-slate-500">{definition.description}</p>
        </div>
        <label className="inline-flex shrink-0 items-center gap-1.5 text-[11px] font-semibold text-slate-600 dark:text-slate-300">
          <input
            type="checkbox"
            checked={customized}
            disabled={disabled}
            onChange={(event) => onChange(event.target.checked ? effectiveValue.toUpperCase() : null)}
            className="h-4 w-4 rounded border-slate-300 text-bbt-primary focus:ring-bbt-accent"
          />
          Personalizar
        </label>
      </div>
      <div className="mt-3 flex items-center gap-2">
        <input
          type="color"
          value={pickerValue}
          aria-label={`Selecionar ${definition.label.toLocaleLowerCase('pt-BR')}`}
          disabled={disabled || !customized}
          onChange={(event) => onChange(event.target.value.toUpperCase())}
          className="h-10 w-12 cursor-pointer rounded-lg border border-slate-300 bg-white p-1 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-600"
        />
        <input
          id={`branding-${definition.key}`}
          type="text"
          inputMode="text"
          value={value || ''}
          maxLength={7}
          placeholder={effectiveValue}
          disabled={disabled || !customized}
          onChange={(event) => onChange(event.target.value.toUpperCase())}
          className="bbt-input h-10 min-w-0 font-mono uppercase disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-400 dark:disabled:bg-slate-900/40"
        />
      </div>
      <p className="mt-2 text-[11px] text-slate-500">
        {customized ? 'Valor personalizado' : `Herdado de: ${sourceLabel(effectiveSource)}`}
      </p>
    </div>
  )
}

function BrandingPreview({
  preview,
  source,
}: {
  preview: {
    displayName: string
    logoUrl: string
    logoAlt: string
    primaryColor: string
    accentColor: string
    sidebarColor: string
    documentLegalName: string
    documentNumber: string | null
  }
  source: CorporateBrandingSource
}) {
  const sidebarText = readableTextColor(preview.sidebarColor)
  const primaryText = readableTextColor(preview.primaryColor)
  return (
    <aside className="self-start rounded-xl border border-bbt-gray-100 bg-slate-50 p-4 dark:border-slate-700 dark:bg-slate-900/40" aria-label="Prévia da identidade visual">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="bbt-section-label">Prévia efetiva</p>
          <p className="mt-1 text-xs text-slate-500">Origem principal: {sourceLabel(source)}</p>
        </div>
        <ImagePlus className="h-5 w-5 text-slate-400" aria-hidden="true" />
      </div>

      <div className="mt-4 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm dark:border-slate-700">
        <div className="flex items-center gap-3 px-4 py-3" style={{ backgroundColor: preview.sidebarColor, color: sidebarText }}>
          <span className="flex h-11 w-20 items-center justify-center rounded-lg bg-white p-1.5">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={preview.logoUrl} alt={preview.logoAlt} className="max-h-full max-w-full object-contain" />
          </span>
          <div className="min-w-0">
            <p className="truncate text-sm font-bold">{preview.displayName}</p>
            <p className="text-[10px] opacity-75">Ambiente corporativo</p>
          </div>
        </div>
        <div className="space-y-4 p-4">
          <div className="h-2 w-16 rounded-full" style={{ backgroundColor: preview.accentColor }} />
          <div>
            <p className="text-xs uppercase tracking-wide text-slate-500">Documento do cliente</p>
            <p className="mt-1 text-sm font-bold text-slate-900">{preview.documentLegalName}</p>
            <p className="text-xs text-slate-500">{preview.documentNumber || 'Documento não informado'}</p>
          </div>
          <button
            type="button"
            tabIndex={-1}
            className="pointer-events-none inline-flex items-center gap-2 rounded-lg px-3 py-2 text-xs font-semibold"
            style={{ backgroundColor: preview.primaryColor, color: primaryText }}
          >
            <Check className="h-3.5 w-3.5" aria-hidden="true" /> Ação principal
          </button>
          <p className="border-t border-slate-100 pt-3 text-[10px] leading-4 text-slate-500">
            Gestão e emissão por BBT Corporativo.
          </p>
        </div>
      </div>
    </aside>
  )
}

async function getBrandingConfiguration(
  scopeType: CorporateBrandingScopeType,
  scopeId: string,
  signal?: AbortSignal,
): Promise<CorporateBrandingConfiguration> {
  const response = await fetch(brandingEndpoint(scopeType, scopeId), {
    cache: 'no-store',
    headers: { Accept: 'application/json' },
    signal,
  })
  return readConfigurationResponse(response, 'Não foi possível carregar a identidade visual.')
}

async function patchBrandingConfiguration(
  scopeType: CorporateBrandingScopeType,
  scopeId: string,
  values: CorporateBrandingDeclared,
  expectedVersion: number | null,
): Promise<CorporateBrandingConfiguration> {
  const response = await fetch(brandingEndpoint(scopeType, scopeId), {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ values: normalizeDeclared(values), expectedVersion }),
  })
  return readConfigurationResponse(response, 'Não foi possível salvar a identidade visual.')
}

async function uploadBrandingLogo(
  scopeType: CorporateBrandingScopeType,
  scopeId: string,
  file: File,
  expectedVersion: number | null,
): Promise<CorporateBrandingConfiguration> {
  const form = new FormData()
  form.append('file', file)
  form.append('expectedVersion', expectedVersion === null ? 'null' : String(expectedVersion))
  const response = await fetch(`${brandingEndpoint(scopeType, scopeId)}/logo`, {
    method: 'POST',
    headers: { Accept: 'application/json' },
    body: form,
  })
  return readConfigurationResponse(response, 'Não foi possível enviar a logomarca.')
}

async function readConfigurationResponse(
  response: Response,
  fallbackMessage: string,
): Promise<CorporateBrandingConfiguration> {
  const payload = await response.json().catch(() => null) as {
    ok?: boolean
    configuration?: unknown
    error?: string
  } | null
  if (!response.ok || !payload?.ok || !payload.configuration) {
    throw new Error(payload?.error || fallbackMessage)
  }
  return corporateBrandingConfigurationSchema.parse(payload.configuration)
}

function brandingEndpoint(scopeType: CorporateBrandingScopeType, scopeId: string): string {
  const parsedType = corporateBrandingScopeTypeSchema.parse(scopeType)
  const parsedId = corporateBrandingScopeIdSchema.parse(scopeId)
  return `/api/brand-identity-settings/${parsedType}/${encodeURIComponent(parsedId)}`
}

function normalizeDeclared(values: CorporateBrandingDeclared): CorporateBrandingDeclared {
  const normalize = (value: string | null) => value === null ? null : value.trim()
  return {
    displayName: normalize(values.displayName),
    logoFileId: values.logoFileId,
    logoAlt: normalize(values.logoAlt),
    primaryColor: values.primaryColor?.toUpperCase() || null,
    accentColor: values.accentColor?.toUpperCase() || null,
    sidebarColor: values.sidebarColor?.toUpperCase() || null,
    documentLegalName: normalize(values.documentLegalName),
    documentNumber: normalize(values.documentNumber),
  }
}

function validateDeclared(values: CorporateBrandingDeclared): string | null {
  const namedValues: ReadonlyArray<[string, string | null]> = [
    ['Nome de exibição', values.displayName],
    ['Descrição da logomarca', values.logoAlt],
    ['Razão social', values.documentLegalName],
    ['Documento', values.documentNumber],
  ]
  for (const [label, value] of namedValues) {
    if (value !== null && !value.trim()) return `${label}: informe um valor ou selecione a herança.`
  }
  for (const field of COLOR_FIELDS) {
    const value = values[field.key]
    if (value !== null && !HEX_COLOR.test(value)) return `${field.label}: informe uma cor hexadecimal válida, como #20265A.`
  }
  if (values.documentNumber !== null && !DOCUMENT_NUMBER.test(values.documentNumber.trim())) {
    return 'CNPJ ou documento: use somente letras, números, ponto, barra e hífen.'
  }
  return null
}

function normalizePreviewColor(value: string | null, fallback: string): string {
  return value && HEX_COLOR.test(value) ? value : fallback
}

function sameDeclared(left: CorporateBrandingDeclared, right: CorporateBrandingDeclared): boolean {
  return JSON.stringify(normalizeDeclared(left)) === JSON.stringify(normalizeDeclared(right))
}

function isEmptyDeclared(value: CorporateBrandingDeclared): boolean {
  return Object.values(value).every((item) => item === null)
}

function sourceLabel(source: CorporateBrandingSource): string {
  if (source === 'company') return 'empresa'
  if (source === 'group') return 'grupo'
  return 'sistema'
}

function readableTextColor(hex: string): '#0F172A' | '#FFFFFF' {
  if (!HEX_COLOR.test(hex)) return '#FFFFFF'
  const red = Number.parseInt(hex.slice(1, 3), 16)
  const green = Number.parseInt(hex.slice(3, 5), 16)
  const blue = Number.parseInt(hex.slice(5, 7), 16)
  return (red * 299 + green * 587 + blue * 114) / 1000 > 150 ? '#0F172A' : '#FFFFFF'
}

function errorMessage(reason: unknown, fallback: string): string {
  return reason instanceof Error && reason.message ? reason.message : fallback
}
