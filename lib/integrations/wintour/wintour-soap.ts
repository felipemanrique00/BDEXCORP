import { encodeWintourIso88591 } from '@/lib/integrations/wintour/wintour-xml'

export const WINTOUR_SOAP_ENDPOINTS = Object.freeze({
  creation: 'https://www.digirotas.com/HubInterfacesSoap/soap/IHubInterfaces',
  update: 'https://www.digirotas.com/HubInterfacesSoapUpd/soap/IHubInterfacesUpd',
})

export const WINTOUR_SOAP_ACTIONS = Object.freeze({
  createSales: 'urn:HubInterfacesIntf-IHubInterfaces#importaArquivo2',
  queryCreationProtocol: 'urn:HubInterfacesIntf-IHubInterfaces#consultaProtocoloDet',
  updateSales: 'urn:HubInterfacesUpdIntf-IHubInterfacesUpd#alteraVendas',
  queryUpdateProtocol: 'urn:HubInterfacesUpdIntf-IHubInterfacesUpd#consultaProtocolo',
})

export const WINTOUR_DEFAULT_TIMEOUT_MS = 15_000
export const WINTOUR_MAX_TIMEOUT_MS = 60_000
export const WINTOUR_MAX_XML_BYTES = 2 * 1024 * 1024
export const WINTOUR_MAX_SOAP_RESPONSE_BYTES = 1024 * 1024

const SOAP_ENVELOPE_NAMESPACE = 'http://schemas.xmlsoap.org/soap/envelope/'
const SOAP_ENCODING_NAMESPACE = 'http://schemas.xmlsoap.org/soap/encoding/'
const XSI_NAMESPACE = 'http://www.w3.org/2001/XMLSchema-instance'
const XSD_NAMESPACE = 'http://www.w3.org/2001/XMLSchema'

export type WintourSoapOperation =
  | 'create-sales'
  | 'query-creation-protocol'
  | 'update-sales'
  | 'query-update-protocol'

export interface WintourSoapSafeMetadata {
  operation: WintourSoapOperation
  endpoint: string
  soapAction: string
  payloadBytes: number
}

export interface WintourSoapRequest {
  operation: WintourSoapOperation
  endpoint: string
  soapAction: string
  method: 'POST'
  headers: Readonly<Record<string, string>>
  body: string
  mutation: boolean
  safeMetadata: Readonly<WintourSoapSafeMetadata>
  toJSON(): Readonly<WintourSoapSafeMetadata>
}

export interface WintourSoapBuildFileInput {
  pin: string
  xml: string
  free?: string
}

export interface WintourSoapBuildProtocolInput {
  pin: string
  protocol: string
}

export type WintourSoapFetch = (input: string | URL, init?: RequestInit) => Promise<Response>

export interface WintourSoapExecuteOptions {
  fetchImpl?: WintourSoapFetch
  timeoutMs?: number
  signal?: AbortSignal
  maxResponseBytes?: number
}

export interface WintourSoapExecutionResult {
  operation: WintourSoapOperation
  endpoint: string
  value: string
  protocol?: string
  protocolDetail?: WintourProtocolDetail
  httpStatus: number
  durationMs: number
}

export interface WintourSoapFault {
  faultCode: string
  faultString: string
  detail?: string
}

export const WINTOUR_CREATION_PROTOCOL_STATUSES = [
  'trProcessado', 'trEmFila', 'trProcessManual', 'trNaoEncontrado',
] as const

export const WINTOUR_UPDATE_PROTOCOL_STATUSES = [
  'trProcessado', 'trEmFila', 'trProcessManual',
] as const

export type WintourCreationProtocolStatus = typeof WINTOUR_CREATION_PROTOCOL_STATUSES[number]
export type WintourUpdateProtocolStatus = typeof WINTOUR_UPDATE_PROTOCOL_STATUSES[number]

export interface WintourPendingSalesStatus {
  salesWithError: number
  excludedSales: number
  deniedDateSales: number
}

export interface WintourCreationProtocolDetail {
  kind: 'creation'
  id: number
  protocol: string
  status: WintourCreationProtocolStatus
  description: string
  processedAt: string | null
  lastError: string
  pendingSalesCount: number
  launchedSalesCount: number
  launchedSaleNumbers: string
  pendingSales: WintourPendingSalesStatus
}

export interface WintourUpdateProtocolDetail {
  kind: 'update'
  protocol: string
  status: WintourUpdateProtocolStatus
  description: string
  processedAt: string | null
  lastError: string
}

export type WintourProtocolDetail = WintourCreationProtocolDetail | WintourUpdateProtocolDetail

export type WintourSoapParsedResponse =
  | { ok: true; value: string; protocolDetail?: WintourProtocolDetail }
  | { ok: false; fault: WintourSoapFault }

export type WintourSoapErrorCode =
  | 'WINTOUR_SOAP_INPUT_INVALID'
  | 'WINTOUR_SOAP_TIMEOUT'
  | 'WINTOUR_SOAP_ABORTED'
  | 'WINTOUR_SOAP_NETWORK_ERROR'
  | 'WINTOUR_SOAP_HTTP_ERROR'
  | 'WINTOUR_SOAP_FAULT'
  | 'WINTOUR_SOAP_RESPONSE_TOO_LARGE'
  | 'WINTOUR_SOAP_INVALID_RESPONSE'

export class WintourSoapError extends Error {
  readonly code: WintourSoapErrorCode
  readonly operation: WintourSoapOperation
  readonly retryable: boolean
  readonly ambiguous: boolean
  readonly httpStatus?: number
  readonly fault?: WintourSoapFault

  constructor(
    message: string,
    options: {
      code: WintourSoapErrorCode
      operation: WintourSoapOperation
      retryable?: boolean
      ambiguous?: boolean
      httpStatus?: number
      fault?: WintourSoapFault
    },
  ) {
    super(message)
    this.name = 'WintourSoapError'
    this.code = options.code
    this.operation = options.operation
    this.retryable = options.retryable ?? false
    this.ambiguous = options.ambiguous ?? false
    this.httpStatus = options.httpStatus
    this.fault = options.fault
  }

  toSafeObject(): Record<string, unknown> {
    return {
      name: this.name,
      code: this.code,
      operation: this.operation,
      retryable: this.retryable,
      ambiguous: this.ambiguous,
      httpStatus: this.httpStatus,
      faultCode: this.fault?.faultCode,
    }
  }
}

const OPERATION_SPECS: Record<WintourSoapOperation, {
  endpoint: string
  action: string
  methodName: string
  namespace: string
  mutation: boolean
}> = {
  'create-sales': {
    endpoint: WINTOUR_SOAP_ENDPOINTS.creation,
    action: WINTOUR_SOAP_ACTIONS.createSales,
    methodName: 'importaArquivo2',
    namespace: 'urn:HubInterfacesIntf-IHubInterfaces',
    mutation: true,
  },
  'query-creation-protocol': {
    endpoint: WINTOUR_SOAP_ENDPOINTS.creation,
    action: WINTOUR_SOAP_ACTIONS.queryCreationProtocol,
    methodName: 'consultaProtocoloDet',
    namespace: 'urn:HubInterfacesIntf-IHubInterfaces',
    mutation: false,
  },
  'update-sales': {
    endpoint: WINTOUR_SOAP_ENDPOINTS.update,
    action: WINTOUR_SOAP_ACTIONS.updateSales,
    methodName: 'alteraVendas',
    namespace: 'urn:HubInterfacesUpdIntf-IHubInterfacesUpd',
    mutation: true,
  },
  'query-update-protocol': {
    endpoint: WINTOUR_SOAP_ENDPOINTS.update,
    action: WINTOUR_SOAP_ACTIONS.queryUpdateProtocol,
    methodName: 'consultaProtocolo',
    namespace: 'urn:HubInterfacesUpdIntf-IHubInterfacesUpd',
    mutation: false,
  },
}

export function buildWintourCreateSalesSoapRequest(input: WintourSoapBuildFileInput): WintourSoapRequest {
  return buildFileRequest('create-sales', input)
}

export function buildWintourUpdateSalesSoapRequest(input: WintourSoapBuildFileInput): WintourSoapRequest {
  return buildFileRequest('update-sales', input)
}

export function buildWintourCreateProtocolQuerySoapRequest(input: WintourSoapBuildProtocolInput): WintourSoapRequest {
  return buildProtocolRequest('query-creation-protocol', input)
}

export function buildWintourUpdateProtocolQuerySoapRequest(input: WintourSoapBuildProtocolInput): WintourSoapRequest {
  return buildProtocolRequest('query-update-protocol', input)
}

export async function executeWintourSoapRequest(
  request: WintourSoapRequest,
  options: WintourSoapExecuteOptions = {},
): Promise<WintourSoapExecutionResult> {
  assertTrustedRequest(request)
  const timeoutMs = normalizeTimeout(options.timeoutMs, request.operation)
  const maxResponseBytes = normalizeResponseLimit(options.maxResponseBytes, request.operation)
  const fetchImpl = options.fetchImpl || fetch
  const controller = new AbortController()
  let timedOut = false
  const startedAt = Date.now()
  const externalAbort = () => controller.abort(options.signal?.reason)
  if (options.signal?.aborted) externalAbort()
  else options.signal?.addEventListener('abort', externalAbort, { once: true })
  const timeout = setTimeout(() => {
    timedOut = true
    controller.abort()
  }, timeoutMs)

  try {
    const response = await fetchImpl(request.endpoint, {
      method: request.method,
      headers: request.headers,
      body: request.body,
      signal: controller.signal,
      cache: 'no-store',
      redirect: 'error',
    })
    const declaredLength = response.headers.get('content-length')
    if (declaredLength && Number(declaredLength) > maxResponseBytes) {
      throw responseTooLarge(request.operation, response.status)
    }
    const raw = await readResponseTextLimited(response, maxResponseBytes, request.operation)

    let parsed: WintourSoapParsedResponse
    try {
      parsed = parseWintourSoapResponse(raw, request.operation)
    } catch (error) {
      if (error instanceof WintourSoapError) throw error
      throw invalidResponse(request, response.status)
    }

    if (!parsed.ok) {
      throw new WintourSoapError('O Wintour rejeitou a solicitacao SOAP.', {
        code: 'WINTOUR_SOAP_FAULT',
        operation: request.operation,
        httpStatus: response.status,
        fault: parsed.fault,
      })
    }
    if (!response.ok) {
      throw new WintourSoapError(`O Wintour retornou HTTP ${response.status}.`, {
        code: 'WINTOUR_SOAP_HTTP_ERROR',
        operation: request.operation,
        httpStatus: response.status,
        retryable: response.status === 429 || response.status >= 500,
        ambiguous: request.mutation && response.status >= 500,
      })
    }
    return {
      operation: request.operation,
      endpoint: request.endpoint,
      value: parsed.value,
      protocol: request.mutation ? parsed.value.trim() : parsed.protocolDetail?.protocol,
      protocolDetail: parsed.protocolDetail,
      httpStatus: response.status,
      durationMs: Date.now() - startedAt,
    }
  } catch (error) {
    if (error instanceof WintourSoapError) throw error
    if (timedOut) {
      throw new WintourSoapError('Tempo limite excedido ao chamar o Wintour; o resultado do envio e desconhecido.', {
        code: 'WINTOUR_SOAP_TIMEOUT',
        operation: request.operation,
        retryable: !request.mutation,
        ambiguous: request.mutation,
      })
    }
    if (controller.signal.aborted) {
      throw new WintourSoapError('Chamada ao Wintour cancelada; o resultado do envio e desconhecido.', {
        code: 'WINTOUR_SOAP_ABORTED',
        operation: request.operation,
        retryable: false,
        ambiguous: request.mutation,
      })
    }
    throw new WintourSoapError('Falha de rede ao chamar o Wintour; o resultado do envio e desconhecido.', {
      code: 'WINTOUR_SOAP_NETWORK_ERROR',
      operation: request.operation,
      retryable: !request.mutation,
      ambiguous: request.mutation,
    })
  } finally {
    clearTimeout(timeout)
    options.signal?.removeEventListener('abort', externalAbort)
  }
}

export function parseWintourSoapResponse(
  xml: string,
  operation: WintourSoapOperation,
): WintourSoapParsedResponse {
  if (typeof xml !== 'string' || xml.length === 0 || utf8ByteLength(xml) > WINTOUR_MAX_SOAP_RESPONSE_BYTES) {
    throw invalidResponseForOperation(operation)
  }
  let root: XmlNode
  try {
    root = parseLimitedXml(xml)
  } catch {
    throw invalidResponseForOperation(operation)
  }
  const nodes = flattenNodes(root)
  const idMap = buildMultiRefMap(nodes, operation)
  const faultNode = nodes.find((node) => node.localName === 'fault')
  if (faultNode) {
    return {
      ok: false,
      fault: {
        faultCode: resolvedTextFromFirst(nodes, 'faultcode', idMap, operation) || 'SOAP-FAULT',
        faultString: resolvedTextFromFirst(nodes, 'faultstring', idMap, operation) || 'Falha SOAP sem descricao.',
        detail: resolvedTextFromFirst(nodes, 'detail', idMap, operation) || undefined,
      },
    }
  }
  const spec = OPERATION_SPECS[operation]
  const responseNode = nodes.find((node) => node.localName === `${spec.methodName.toLowerCase()}response`)
  const searchNodes = responseNode ? flattenNodes(responseNode) : nodes
  const resultNode = searchNodes.find((node) => (
    node.localName === 'return'
    || node.localName === 'result'
    || node.localName === `${spec.methodName.toLowerCase()}return`
    || node.localName === `${spec.methodName.toLowerCase()}result`
  ))
  if (!resultNode) throw invalidResponseForOperation(operation)
  if (operation === 'query-creation-protocol') {
    const protocolDetail = parseCreationProtocolNode(resultNode, idMap, operation)
    return { ok: true, value: protocolDetail.protocol, protocolDetail }
  }
  if (operation === 'query-update-protocol') {
    const protocolDetail = parseUpdateProtocolNode(resultNode, idMap, operation)
    return { ok: true, value: protocolDetail.protocol, protocolDetail }
  }
  const value = resolveNodeValue(resultNode, idMap, operation, new Set(), 0).trim()
  if (!value || utf8ByteLength(value) > WINTOUR_MAX_SOAP_RESPONSE_BYTES) throw invalidResponseForOperation(operation)
  return { ok: true, value }
}

export function parseWintourCreationProtocolResponse(xml: string): WintourCreationProtocolDetail {
  const parsed = parseWintourSoapResponse(xml, 'query-creation-protocol')
  if (!parsed.ok) throw soapFaultError('query-creation-protocol', parsed.fault)
  if (parsed.protocolDetail?.kind !== 'creation') throw invalidResponseForOperation('query-creation-protocol')
  return parsed.protocolDetail
}

export function parseWintourUpdateProtocolResponse(xml: string): WintourUpdateProtocolDetail {
  const parsed = parseWintourSoapResponse(xml, 'query-update-protocol')
  if (!parsed.ok) throw soapFaultError('query-update-protocol', parsed.fault)
  if (parsed.protocolDetail?.kind !== 'update') throw invalidResponseForOperation('query-update-protocol')
  return parsed.protocolDetail
}

function parseCreationProtocolNode(
  resultNode: XmlNode,
  idMap: Map<string, XmlNode>,
  operation: 'query-creation-protocol',
): WintourCreationProtocolDetail {
  const node = resolveNodeReference(resultNode, idMap, operation, new Set(), 0)
  assertProtocolObjectFields(node, new Set([
    'ide', 'protocolo', 'codresultado', 'descricao', 'dthrprocessado', 'txtulterro',
    'qtdvendaspendentes', 'qtdvendaslancadas', 'nrvendaslancadas', 'sitvendaspendentes',
  ]), operation)
  const status = requiredProtocolText(node, 'codresultado', idMap, operation, 64)
  if (!(WINTOUR_CREATION_PROTOCOL_STATUSES as readonly string[]).includes(status)) {
    throw invalidResponseForOperation(operation)
  }
  const pendingNode = requiredProtocolChild(node, 'sitvendaspendentes', idMap, operation)
  assertProtocolObjectFields(pendingNode, new Set([
    'qtdvendaserro', 'qtdvendasexcluidas', 'qtdvendasdtnegada',
  ]), operation)
  return {
    kind: 'creation',
    id: requiredProtocolInteger(node, 'ide', idMap, operation),
    protocol: requiredProtocolText(node, 'protocolo', idMap, operation, 128),
    status: status as WintourCreationProtocolStatus,
    description: requiredProtocolText(node, 'descricao', idMap, operation, 4000, true),
    processedAt: requiredProtocolDateTime(node, 'dthrprocessado', idMap, operation),
    lastError: requiredProtocolText(node, 'txtulterro', idMap, operation, 16_000, true),
    pendingSalesCount: requiredProtocolInteger(node, 'qtdvendaspendentes', idMap, operation),
    launchedSalesCount: requiredProtocolInteger(node, 'qtdvendaslancadas', idMap, operation),
    launchedSaleNumbers: requiredProtocolText(node, 'nrvendaslancadas', idMap, operation, 16_000, true),
    pendingSales: {
      salesWithError: requiredProtocolInteger(pendingNode, 'qtdvendaserro', idMap, operation),
      excludedSales: requiredProtocolInteger(pendingNode, 'qtdvendasexcluidas', idMap, operation),
      deniedDateSales: requiredProtocolInteger(pendingNode, 'qtdvendasdtnegada', idMap, operation),
    },
  }
}

function parseUpdateProtocolNode(
  resultNode: XmlNode,
  idMap: Map<string, XmlNode>,
  operation: 'query-update-protocol',
): WintourUpdateProtocolDetail {
  const node = resolveNodeReference(resultNode, idMap, operation, new Set(), 0)
  assertProtocolObjectFields(node, new Set([
    'protocolo', 'codresultado', 'descricao', 'dthrprocessado', 'txtulterro',
  ]), operation)
  const status = requiredProtocolText(node, 'codresultado', idMap, operation, 64)
  if (!(WINTOUR_UPDATE_PROTOCOL_STATUSES as readonly string[]).includes(status)) {
    throw invalidResponseForOperation(operation)
  }
  return {
    kind: 'update',
    protocol: requiredProtocolText(node, 'protocolo', idMap, operation, 128),
    status: status as WintourUpdateProtocolStatus,
    description: requiredProtocolText(node, 'descricao', idMap, operation, 4000, true),
    processedAt: requiredProtocolDateTime(node, 'dthrprocessado', idMap, operation),
    lastError: requiredProtocolText(node, 'txtulterro', idMap, operation, 16_000, true),
  }
}

function assertProtocolObjectFields(
  node: XmlNode,
  allowed: Set<string>,
  operation: WintourSoapOperation,
): void {
  const names = node.children.map((child) => child.localName)
  if (names.length !== allowed.size || new Set(names).size !== names.length || names.some((name) => !allowed.has(name))) {
    throw invalidResponseForOperation(operation)
  }
}

function requiredProtocolChild(
  parent: XmlNode,
  name: string,
  idMap: Map<string, XmlNode>,
  operation: WintourSoapOperation,
): XmlNode {
  const child = parent.children.find((candidate) => candidate.localName === name)
  if (!child) throw invalidResponseForOperation(operation)
  const resolved = resolveNodeReference(child, idMap, operation, new Set(), 0)
  if (isNilNode(resolved)) throw invalidResponseForOperation(operation)
  return resolved
}

function requiredProtocolText(
  parent: XmlNode,
  name: string,
  idMap: Map<string, XmlNode>,
  operation: WintourSoapOperation,
  max: number,
  allowEmpty = false,
): string {
  const node = requiredProtocolChild(parent, name, idMap, operation)
  const value = recursiveText(node).trim()
  if ((!allowEmpty && !value) || value.length > max) throw invalidResponseForOperation(operation)
  return value
}

function requiredProtocolInteger(
  parent: XmlNode,
  name: string,
  idMap: Map<string, XmlNode>,
  operation: WintourSoapOperation,
): number {
  const value = requiredProtocolText(parent, name, idMap, operation, 16)
  if (!/^\d+$/.test(value)) throw invalidResponseForOperation(operation)
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed < 0 || parsed > 2_147_483_647) throw invalidResponseForOperation(operation)
  return parsed
}

function requiredProtocolDateTime(
  parent: XmlNode,
  name: string,
  idMap: Map<string, XmlNode>,
  operation: WintourSoapOperation,
): string | null {
  const child = parent.children.find((candidate) => candidate.localName === name)
  if (!child) throw invalidResponseForOperation(operation)
  const node = resolveNodeReference(child, idMap, operation, new Set(), 0)
  if (isNilNode(node)) return null
  const value = recursiveText(node).trim()
  if (!value) return null
  if (value.length > 64 || !/^\d{4}-\d{2}-\d{2}T/.test(value) || Number.isNaN(Date.parse(value))) {
    throw invalidResponseForOperation(operation)
  }
  return value
}

function isNilNode(node: XmlNode): boolean {
  const nil = attributeByLocalName(node, 'nil')
  return nil === 'true' || nil === '1'
}

function soapFaultError(operation: WintourSoapOperation, fault: WintourSoapFault): WintourSoapError {
  return new WintourSoapError('O Wintour rejeitou a consulta SOAP.', {
    code: 'WINTOUR_SOAP_FAULT', operation, fault,
  })
}

function buildFileRequest(operation: 'create-sales' | 'update-sales', input: WintourSoapBuildFileInput): WintourSoapRequest {
  assertPlainInput(input, operation)
  assertKnownInputKeys(input, new Set(['pin', 'xml', 'free']), operation)
  const pin = validatePin(input.pin, operation)
  if (typeof input.xml !== 'string' || input.xml.trim() === '') throw inputError(operation, 'XML obrigatorio.')
  const xmlBytes = encodeWintourIso88591(input.xml)
  if (xmlBytes.byteLength > WINTOUR_MAX_XML_BYTES) throw inputError(operation, 'XML excede o limite permitido.')
  const free = validateOptionalFree(input.free, operation)
  return buildRequest(operation, {
    aPin: pin,
    aArquivo: encodeBase64(xmlBytes),
    aLivre: free,
  }, xmlBytes.byteLength)
}

function buildProtocolRequest(
  operation: 'query-creation-protocol' | 'query-update-protocol',
  input: WintourSoapBuildProtocolInput,
): WintourSoapRequest {
  assertPlainInput(input, operation)
  assertKnownInputKeys(input, new Set(['pin', 'protocol']), operation)
  const pin = validatePin(input.pin, operation)
  if (typeof input.protocol !== 'string' || !/^[\x20-\x7E]{1,128}$/.test(input.protocol) || input.protocol.trim() === '') {
    throw inputError(operation, 'Protocolo invalido.')
  }
  return buildRequest(operation, { aPin: pin, aProtocolo: input.protocol.trim() }, 0)
}

function buildRequest(
  operation: WintourSoapOperation,
  params: Record<string, string>,
  payloadBytes: number,
): WintourSoapRequest {
  const spec = OPERATION_SPECS[operation]
  const parameterXml = Object.entries(params)
    .map(([name, value]) => `      <${name} xsi:type="xsd:string">${escapeSoapText(value)}</${name}>`)
    .join('\n')
  const body = [
    '<?xml version="1.0" encoding="utf-8"?>',
    `<soapenv:Envelope xmlns:soapenv="${SOAP_ENVELOPE_NAMESPACE}" xmlns:xsi="${XSI_NAMESPACE}" xmlns:xsd="${XSD_NAMESPACE}">`,
    '  <soapenv:Body>',
    `    <m:${spec.methodName} xmlns:m="${spec.namespace}" soapenv:encodingStyle="${SOAP_ENCODING_NAMESPACE}">`,
    parameterXml,
    `    </m:${spec.methodName}>`,
    '  </soapenv:Body>',
    '</soapenv:Envelope>',
  ].join('\n')
  const endpoint = new URL(spec.endpoint)
  if (endpoint.protocol !== 'https:' || endpoint.username || endpoint.password || endpoint.search || endpoint.hash) {
    throw inputError(operation, 'Endpoint Wintour inseguro.')
  }
  const safeMetadata = Object.freeze({
    operation,
    endpoint: spec.endpoint,
    soapAction: spec.action,
    payloadBytes,
  })
  return Object.freeze({
    operation,
    endpoint: spec.endpoint,
    soapAction: spec.action,
    method: 'POST' as const,
    headers: Object.freeze({
      Accept: 'text/xml',
      'Content-Type': 'text/xml; charset=utf-8',
      SOAPAction: `"${spec.action}"`,
    }),
    body,
    mutation: spec.mutation,
    safeMetadata,
    toJSON: () => safeMetadata,
  })
}

function assertTrustedRequest(request: WintourSoapRequest): void {
  const spec = OPERATION_SPECS[request.operation]
  if (
    request.endpoint !== spec.endpoint
    || request.soapAction !== spec.action
    || request.method !== 'POST'
    || request.headers.SOAPAction !== `"${spec.action}"`
    || request.mutation !== spec.mutation
  ) {
    throw inputError(request.operation, 'Request SOAP nao foi produzido por um builder confiavel.')
  }
}

function validatePin(pin: unknown, operation: WintourSoapOperation): string {
  if (typeof pin !== 'string' || !/^[\x21-\x7E]{1,128}$/.test(pin)) {
    throw inputError(operation, 'PIN Wintour invalido.')
  }
  return pin
}

function validateOptionalFree(value: unknown, operation: WintourSoapOperation): string {
  if (value == null) return ''
  if (typeof value !== 'string' || value.length > 500) throw inputError(operation, 'Campo livre Wintour invalido.')
  encodeWintourIso88591(value)
  return value
}

function normalizeTimeout(value: number | undefined, operation: WintourSoapOperation): number {
  const timeout = value ?? WINTOUR_DEFAULT_TIMEOUT_MS
  if (!Number.isInteger(timeout) || timeout < 1 || timeout > WINTOUR_MAX_TIMEOUT_MS) {
    throw inputError(operation, `Timeout deve estar entre 1 e ${WINTOUR_MAX_TIMEOUT_MS} ms.`)
  }
  return timeout
}

function normalizeResponseLimit(value: number | undefined, operation: WintourSoapOperation): number {
  const limit = value ?? WINTOUR_MAX_SOAP_RESPONSE_BYTES
  if (!Number.isInteger(limit) || limit < 1024 || limit > WINTOUR_MAX_SOAP_RESPONSE_BYTES) {
    throw inputError(operation, 'Limite de resposta SOAP invalido.')
  }
  return limit
}

function assertPlainInput(value: unknown, operation: WintourSoapOperation): asserts value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw inputError(operation, 'Entrada SOAP invalida.')
  const prototype = Object.getPrototypeOf(value)
  if (prototype !== Object.prototype && prototype !== null) throw inputError(operation, 'Entrada SOAP invalida.')
}

function assertKnownInputKeys(value: object, keys: Set<string>, operation: WintourSoapOperation): void {
  if (Object.keys(value).some((key) => !keys.has(key))) throw inputError(operation, 'Entrada SOAP contem campos desconhecidos.')
}

function inputError(operation: WintourSoapOperation, message: string): WintourSoapError {
  return new WintourSoapError(message, { code: 'WINTOUR_SOAP_INPUT_INVALID', operation })
}

function responseTooLarge(operation: WintourSoapOperation, httpStatus?: number): WintourSoapError {
  return new WintourSoapError('Resposta SOAP do Wintour excedeu o limite permitido.', {
    code: 'WINTOUR_SOAP_RESPONSE_TOO_LARGE', operation, httpStatus,
    ambiguous: OPERATION_SPECS[operation].mutation,
  })
}

async function readResponseTextLimited(
  response: Response,
  maxBytes: number,
  operation: WintourSoapOperation,
): Promise<string> {
  if (!response.body) return ''
  const reader = response.body.getReader()
  const charset = response.headers.get('content-type') || ''
  const encoding = /charset\s*=\s*["']?(?:iso-8859-1|latin1|windows-1252)/i.test(charset)
    ? 'iso-8859-1'
    : 'utf-8'
  const decoder = new TextDecoder(encoding, { fatal: true })
  const chunks: string[] = []
  let total = 0
  try {
    while (true) {
      const next = await reader.read()
      if (next.done) break
      total += next.value.byteLength
      if (total > maxBytes) {
        await reader.cancel().catch(() => undefined)
        throw responseTooLarge(operation, response.status)
      }
      chunks.push(decodeResponseChunk(decoder, next.value, true, operation, response.status))
    }
    chunks.push(decodeResponseChunk(decoder, undefined, false, operation, response.status))
    return chunks.join('')
  } finally {
    reader.releaseLock()
  }
}

function decodeResponseChunk(
  decoder: TextDecoder,
  value: Uint8Array | undefined,
  stream: boolean,
  operation: WintourSoapOperation,
  httpStatus: number,
): string {
  try {
    return value ? decoder.decode(value, { stream }) : decoder.decode()
  } catch {
    throw new WintourSoapError('Resposta SOAP do Wintour possui codificacao invalida.', {
      code: 'WINTOUR_SOAP_INVALID_RESPONSE', operation, httpStatus,
      ambiguous: OPERATION_SPECS[operation].mutation,
    })
  }
}

function invalidResponse(request: WintourSoapRequest, httpStatus?: number): WintourSoapError {
  return new WintourSoapError('Resposta SOAP do Wintour invalida ou inesperada.', {
    code: 'WINTOUR_SOAP_INVALID_RESPONSE', operation: request.operation, httpStatus,
    ambiguous: request.mutation,
  })
}

function invalidResponseForOperation(operation: WintourSoapOperation): WintourSoapError {
  return new WintourSoapError('Resposta SOAP do Wintour invalida ou inesperada.', {
    code: 'WINTOUR_SOAP_INVALID_RESPONSE', operation,
    ambiguous: OPERATION_SPECS[operation].mutation,
  })
}

function escapeSoapText(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
}

function encodeBase64(bytes: Uint8Array): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
  let output = ''
  for (let index = 0; index < bytes.length; index += 3) {
    const first = bytes[index]
    const second = index + 1 < bytes.length ? bytes[index + 1] : 0
    const third = index + 2 < bytes.length ? bytes[index + 2] : 0
    const combined = (first << 16) | (second << 8) | third
    output += alphabet[(combined >> 18) & 63]
    output += alphabet[(combined >> 12) & 63]
    output += index + 1 < bytes.length ? alphabet[(combined >> 6) & 63] : '='
    output += index + 2 < bytes.length ? alphabet[combined & 63] : '='
  }
  return output
}

interface XmlNode {
  name: string
  localName: string
  attributes: Record<string, string>
  children: XmlNode[]
  text: string[]
}

function parseLimitedXml(xml: string): XmlNode {
  if (/<!DOCTYPE|<!ENTITY/i.test(xml)) throw new Error('DTD proibido')
  const stack: XmlNode[] = []
  let root: XmlNode | undefined
  let index = xml.charCodeAt(0) === 0xfeff ? 1 : 0
  let nodeCount = 0
  while (index < xml.length) {
    const open = xml.indexOf('<', index)
    if (open < 0) {
      appendXmlText(stack, xml.slice(index), false)
      index = xml.length
      break
    }
    appendXmlText(stack, xml.slice(index, open), false)
    if (xml.startsWith('<!--', open)) {
      const end = xml.indexOf('-->', open + 4)
      if (end < 0) throw new Error('Comentario XML incompleto')
      index = end + 3
      continue
    }
    if (xml.startsWith('<![CDATA[', open)) {
      const end = xml.indexOf(']]>', open + 9)
      if (end < 0) throw new Error('CDATA incompleto')
      appendXmlText(stack, xml.slice(open + 9, end), true)
      index = end + 3
      continue
    }
    if (xml.startsWith('<?', open)) {
      const end = xml.indexOf('?>', open + 2)
      if (end < 0 || !/^<\?xml(?:\s|\?>)/i.test(xml.slice(open, end + 2))) throw new Error('Instrucao XML proibida')
      index = end + 2
      continue
    }
    if (xml.startsWith('</', open)) {
      const end = xml.indexOf('>', open + 2)
      if (end < 0) throw new Error('Fechamento XML incompleto')
      const closeName = xml.slice(open + 2, end).trim()
      if (!isXmlName(closeName) || !stack.length || stack[stack.length - 1].name !== closeName) throw new Error('XML malformado')
      stack.pop()
      index = end + 1
      continue
    }
    if (xml.startsWith('<!', open)) throw new Error('Declaracao XML proibida')
    const end = findTagEnd(xml, open + 1)
    const rawTag = xml.slice(open + 1, end)
    const selfClosing = /\/\s*$/.test(rawTag)
    const content = selfClosing ? rawTag.replace(/\/\s*$/, '') : rawTag
    const nameMatch = /^([A-Za-z_][A-Za-z0-9_.:-]*)/.exec(content)
    if (!nameMatch) throw new Error('Nome XML invalido')
    const name = nameMatch[1]
    const attributes = parseAttributes(content.slice(name.length))
    const node: XmlNode = {
      name,
      localName: localName(name),
      attributes,
      children: [],
      text: [],
    }
    nodeCount += 1
    if (nodeCount > 2048 || stack.length >= 32) throw new Error('XML complexo demais')
    if (stack.length) stack[stack.length - 1].children.push(node)
    else if (!root) root = node
    else throw new Error('Mais de uma raiz XML')
    if (!selfClosing) stack.push(node)
    index = end + 1
  }
  if (!root || stack.length) throw new Error('XML incompleto')
  return root
}

function findTagEnd(xml: string, start: number): number {
  let quote = ''
  for (let index = start; index < xml.length; index += 1) {
    const char = xml[index]
    if (quote) {
      if (char === quote) quote = ''
    } else if (char === '"' || char === "'") quote = char
    else if (char === '>') return index
  }
  throw new Error('Tag XML incompleta')
}

function parseAttributes(raw: string): Record<string, string> {
  const attributes: Record<string, string> = Object.create(null) as Record<string, string>
  let remaining = raw
  let count = 0
  while (remaining.trim()) {
    const match = /^\s+([A-Za-z_][A-Za-z0-9_.:-]*)\s*=\s*("([^"]*)"|'([^']*)')/.exec(remaining)
    if (!match) throw new Error('Atributo XML invalido')
    const name = match[1]
    if (Object.prototype.hasOwnProperty.call(attributes, name)) throw new Error('Atributo XML duplicado')
    attributes[name] = decodeXmlEntities(match[3] ?? match[4] ?? '')
    remaining = remaining.slice(match[0].length)
    count += 1
    if (count > 32) throw new Error('Atributos demais')
  }
  return attributes
}

function appendXmlText(stack: XmlNode[], raw: string, cdata: boolean): void {
  if (!raw) return
  if (!stack.length) {
    if (raw.trim()) throw new Error('Texto fora da raiz')
    return
  }
  stack[stack.length - 1].text.push(cdata ? raw : decodeXmlEntities(raw))
}

function decodeXmlEntities(value: string): string {
  const entityPattern = /&(#(?:x[0-9A-Fa-f]+|\d+)|amp|lt|gt|quot|apos);/g
  let decoded = ''
  let offset = 0
  for (const match of value.matchAll(entityPattern)) {
    const index = match.index
    const prefix = value.slice(offset, index)
    if (prefix.includes('&')) throw new Error('Entidade XML desconhecida')
    decoded += prefix
    const entity = match[1]
    const named = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }[entity]
    if (named != null) decoded += named
    else {
      const code = entity[1].toLowerCase() === 'x' ? Number.parseInt(entity.slice(2), 16) : Number.parseInt(entity.slice(1), 10)
      if (!Number.isInteger(code) || code < 0 || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)) throw new Error('Entidade XML invalida')
      decoded += String.fromCodePoint(code)
    }
    offset = index + match[0].length
  }
  const suffix = value.slice(offset)
  if (suffix.includes('&')) throw new Error('Entidade XML desconhecida')
  return decoded + suffix
}

function isXmlName(value: string): boolean {
  return /^[A-Za-z_][A-Za-z0-9_.:-]*$/.test(value)
}

function localName(value: string): string {
  return value.slice(value.lastIndexOf(':') + 1).toLowerCase()
}

function flattenNodes(root: XmlNode): XmlNode[] {
  const result: XmlNode[] = []
  const visit = (node: XmlNode) => {
    result.push(node)
    node.children.forEach(visit)
  }
  visit(root)
  return result
}

function resolvedTextFromFirst(
  nodes: XmlNode[],
  name: string,
  idMap: Map<string, XmlNode>,
  operation: WintourSoapOperation,
): string {
  const node = nodes.find((candidate) => candidate.localName === name)
  return node ? resolveNodeValue(node, idMap, operation, new Set(), 0).trim().slice(0, 4000) : ''
}

function recursiveText(node: XmlNode): string {
  return `${node.text.join('')}${node.children.map(recursiveText).join('')}`
}

function buildMultiRefMap(nodes: XmlNode[], operation: WintourSoapOperation): Map<string, XmlNode> {
  const result = new Map<string, XmlNode>()
  for (const node of nodes) {
    const id = attributeByLocalName(node, 'id')
    if (!id) continue
    if (!/^[A-Za-z0-9_.:-]{1,128}$/.test(id) || result.has(id)) throw invalidResponseForOperation(operation)
    result.set(id, node)
  }
  return result
}

function resolveNodeValue(
  node: XmlNode,
  idMap: Map<string, XmlNode>,
  operation: WintourSoapOperation,
  seen: Set<string>,
  depth: number,
): string {
  return recursiveText(resolveNodeReference(node, idMap, operation, seen, depth))
}

function resolveNodeReference(
  node: XmlNode,
  idMap: Map<string, XmlNode>,
  operation: WintourSoapOperation,
  seen: Set<string>,
  depth: number,
): XmlNode {
  if (depth > 8) throw invalidResponseForOperation(operation)
  const href = attributeByLocalName(node, 'href')
  if (!href) return node
  if (!/^#[A-Za-z0-9_.:-]{1,128}$/.test(href)) throw invalidResponseForOperation(operation)
  const id = href.slice(1)
  if (seen.has(id)) throw invalidResponseForOperation(operation)
  const target = idMap.get(id)
  if (!target) throw invalidResponseForOperation(operation)
  seen.add(id)
  return resolveNodeReference(target, idMap, operation, seen, depth + 1)
}

function attributeByLocalName(node: XmlNode, name: string): string | undefined {
  const entry = Object.entries(node.attributes).find(([key]) => localName(key) === name)
  return entry?.[1]
}

function utf8ByteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength
}
