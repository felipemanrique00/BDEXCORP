import { describe, expect, it, vi } from 'vitest'

import {
  buildWintourCreateProtocolQuerySoapRequest,
  buildWintourCreateSalesSoapRequest,
  buildWintourUpdateProtocolQuerySoapRequest,
  buildWintourUpdateSalesSoapRequest,
  executeWintourSoapRequest,
  parseWintourCreationProtocolResponse,
  parseWintourSoapResponse,
  parseWintourUpdateProtocolResponse,
  WINTOUR_SOAP_ACTIONS,
  WINTOUR_SOAP_ENDPOINTS,
  WintourSoapError,
} from '@/lib/integrations/wintour/wintour-soap'

const CREATION_XML = '<?xml version="1.0" encoding="iso-8859-1"?><bilhetes><nome_agencia>Coração</nome_agencia></bilhetes>'

function response(body: string, status = 200, headers?: Record<string, string>): Response {
  return new Response(body, { status, headers: { 'Content-Type': 'text/xml', ...headers } })
}

function successEnvelope(method: string, result: string): string {
  return `<?xml version="1.0"?>
    <SOAP-ENV:Envelope xmlns:SOAP-ENV="http://schemas.xmlsoap.org/soap/envelope/">
      <SOAP-ENV:Body>
        <m:${method}Response xmlns:m="urn:test">
          <return>${result}</return>
        </m:${method}Response>
      </SOAP-ENV:Body>
    </SOAP-ENV:Envelope>`
}

describe('Wintour outbound SOAP', () => {
  it('builds SOAP 1.1 RPC/encoded creation requests with official HTTPS endpoint/action and Latin-1 Base64', () => {
    const request = buildWintourCreateSalesSoapRequest({
      pin: 'PIN-SUPER-SECRETO',
      xml: CREATION_XML,
      free: 'apelido_mesa=BDEX',
    })

    expect(request.endpoint).toBe(WINTOUR_SOAP_ENDPOINTS.creation)
    expect(request.endpoint).toMatch(/^https:\/\//)
    expect(request.soapAction).toBe(WINTOUR_SOAP_ACTIONS.createSales)
    expect(request.headers.SOAPAction).toBe(`"${WINTOUR_SOAP_ACTIONS.createSales}"`)
    expect(request.headers['Content-Type']).toBe('text/xml; charset=utf-8')
    expect(request.body).toContain('<m:importaArquivo2')
    expect(request.body).toContain('xmlns:m="urn:HubInterfacesIntf-IHubInterfaces"')
    expect(request.body).toContain('soapenv:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/"')
    expect(request.body).toContain('<aPin xsi:type="xsd:string">PIN-SUPER-SECRETO</aPin>')

    const base64 = /<aArquivo[^>]*>([^<]+)<\/aArquivo>/.exec(request.body)?.[1]
    expect(base64).toBeTruthy()
    expect(Buffer.from(base64!, 'base64').toString('latin1')).toBe(CREATION_XML)
    expect(JSON.stringify(request.safeMetadata)).not.toContain('PIN-SUPER-SECRETO')
    expect(JSON.stringify(request)).not.toContain('PIN-SUPER-SECRETO')
    expect(JSON.parse(JSON.stringify(request))).toEqual(request.safeMetadata)
    expect(request.safeMetadata.payloadBytes).toBe(Buffer.byteLength(CREATION_XML, 'latin1'))
  })

  it('uses the distinct update and protocol-query WSDL contracts', () => {
    const update = buildWintourUpdateSalesSoapRequest({ pin: '123', xml: '<raiz></raiz>' })
    const createQuery = buildWintourCreateProtocolQuerySoapRequest({ pin: '123', protocol: 'PROTO-1' })
    const updateQuery = buildWintourUpdateProtocolQuerySoapRequest({ pin: '123', protocol: 'PROTO-2' })

    expect(update.endpoint).toBe(WINTOUR_SOAP_ENDPOINTS.update)
    expect(update.soapAction).toBe(WINTOUR_SOAP_ACTIONS.updateSales)
    expect(update.body).toContain('<m:alteraVendas')
    expect(update.body).toContain('urn:HubInterfacesUpdIntf-IHubInterfacesUpd')
    expect(createQuery.soapAction).toBe(WINTOUR_SOAP_ACTIONS.queryCreationProtocol)
    expect(createQuery.body).toContain('<m:consultaProtocoloDet')
    expect(updateQuery.soapAction).toBe(WINTOUR_SOAP_ACTIONS.queryUpdateProtocol)
    expect(updateQuery.body).toContain('<m:consultaProtocolo')
    expect(updateQuery.body).toContain('<aProtocolo xsi:type="xsd:string">PROTO-2</aProtocolo>')
  })

  it('parses direct and RPC/encoded multiRef results without following external references', () => {
    expect(parseWintourSoapResponse(
      successEnvelope('importaArquivo2', 'PROTO-123'),
      'create-sales',
    )).toEqual({ ok: true, value: 'PROTO-123' })

    const multiRef = `
      <soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
        <soapenv:Body>
          <m:importaArquivo2Response xmlns:m="urn:test"><return href="#id0"/></m:importaArquivo2Response>
          <multiRef id="id0" xsi:type="xsd:string">PROTO&amp;456</multiRef>
        </soapenv:Body>
      </soapenv:Envelope>`
    expect(parseWintourSoapResponse(multiRef, 'create-sales')).toEqual({ ok: true, value: 'PROTO&456' })

    const externalHref = multiRef.replace('#id0', 'https://attacker.test/result')
    expect(() => parseWintourSoapResponse(externalHref, 'create-sales')).toThrow(WintourSoapError)
  })

  it('parses WSDL-conformant creation protocol detail with nested RPC multiRef fields', () => {
    // Synthetic fixture built from the WSDL types; it is not a captured production response.
    const xml = `
      <soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:ns1="urn:HubInterfacesIntf">
        <soapenv:Body>
          <m:consultaProtocoloDetResponse xmlns:m="urn:HubInterfacesIntf-IHubInterfaces">
            <return href="#id1"/>
          </m:consultaProtocoloDetResponse>
          <multiRef id="id1" xsi:type="ns1:TInfoProtocoloDet">
            <Ide xsi:type="xsd:int">42</Ide>
            <Protocolo xsi:type="xsd:string">PROTO-42</Protocolo>
            <CodResultado xsi:type="ns1:TResultado">trProcessado</CodResultado>
            <Descricao xsi:type="xsd:string">Processado com pendência</Descricao>
            <DtHrProcessado xsi:type="xsd:dateTime">2026-08-21T08:30:00-03:00</DtHrProcessado>
            <TxtUltErro xsi:type="xsd:string"></TxtUltErro>
            <QtdVendasPendentes xsi:type="xsd:int">1</QtdVendasPendentes>
            <QtdVendasLancadas xsi:type="xsd:int">2</QtdVendasLancadas>
            <NrVendasLancadas xsi:type="xsd:string">101,102</NrVendasLancadas>
            <SitVendasPendentes href="#id2"/>
          </multiRef>
          <multiRef id="id2" xsi:type="ns1:TSit_Vs_Pendentes">
            <QtdVendasErro xsi:type="xsd:int">1</QtdVendasErro>
            <QtdVendasExcluidas xsi:type="xsd:int">0</QtdVendasExcluidas>
            <QtdVendasDtNegada xsi:type="xsd:int">0</QtdVendasDtNegada>
          </multiRef>
        </soapenv:Body>
      </soapenv:Envelope>`

    const detail = parseWintourCreationProtocolResponse(xml)
    expect(detail).toEqual({
      kind: 'creation',
      id: 42,
      protocol: 'PROTO-42',
      status: 'trProcessado',
      description: 'Processado com pendência',
      processedAt: '2026-08-21T08:30:00-03:00',
      lastError: '',
      pendingSalesCount: 1,
      launchedSalesCount: 2,
      launchedSaleNumbers: '101,102',
      pendingSales: { salesWithError: 1, excludedSales: 0, deniedDateSales: 0 },
    })
    expect(parseWintourSoapResponse(xml, 'query-creation-protocol')).toMatchObject({
      ok: true,
      value: 'PROTO-42',
      protocolDetail: detail,
    })
  })

  it('parses inline update protocol detail and rejects missing/unknown critical fields', () => {
    // Synthetic fixture built from the WSDL type; it is not a captured production response.
    const inline = `
      <Envelope><Body><consultaProtocoloResponse><return>
        <Protocolo>UPD-7</Protocolo>
        <CodResultado>trEmFila</CodResultado>
        <Descricao>Na fila</Descricao>
        <DtHrProcessado></DtHrProcessado>
        <TxtUltErro></TxtUltErro>
      </return></consultaProtocoloResponse></Body></Envelope>`
    expect(parseWintourUpdateProtocolResponse(inline)).toEqual({
      kind: 'update',
      protocol: 'UPD-7',
      status: 'trEmFila',
      description: 'Na fila',
      processedAt: null,
      lastError: '',
    })

    expect(() => parseWintourUpdateProtocolResponse(
      inline.replace('<CodResultado>trEmFila</CodResultado>', ''),
    )).toThrow(WintourSoapError)
    expect(() => parseWintourUpdateProtocolResponse(
      inline.replace('trEmFila', 'trNaoEncontrado'),
    )).toThrow(WintourSoapError)
  })

  it('parses SOAP Faults and rejects DTD/entity payloads fail-closed', () => {
    const fault = `
      <soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
        <soap:Body><soap:Fault>
          <faultcode>soap:Client</faultcode>
          <faultstring>PIN inválido</faultstring>
          <detail>Credencial rejeitada</detail>
        </soap:Fault></soap:Body>
      </soap:Envelope>`
    expect(parseWintourSoapResponse(fault, 'create-sales')).toEqual({
      ok: false,
      fault: { faultCode: 'soap:Client', faultString: 'PIN inválido', detail: 'Credencial rejeitada' },
    })

    const xxe = `<!DOCTYPE x [<!ENTITY e SYSTEM "file:///etc/passwd">]>
      <Envelope><Body><importaArquivo2Response><return>&e;</return></importaArquivo2Response></Body></Envelope>`
    expect(() => parseWintourSoapResponse(xxe, 'create-sales')).toThrow(WintourSoapError)
  })

  it('executes through an injected transport, returns protocol, and converts SOAP Fault to a typed safe error', async () => {
    const request = buildWintourCreateSalesSoapRequest({ pin: 'DONT-LOG-ME', xml: '<bilhetes></bilhetes>' })
    const fetchImpl = vi.fn(async () => response(successEnvelope('importaArquivo2', '987654')))
    const result = await executeWintourSoapRequest(request, { fetchImpl })

    expect(result).toMatchObject({ operation: 'create-sales', protocol: '987654', value: '987654', httpStatus: 200 })
    expect(fetchImpl).toHaveBeenCalledWith(WINTOUR_SOAP_ENDPOINTS.creation, expect.objectContaining({
      method: 'POST',
      redirect: 'error',
    }))

    const faultXml = '<Envelope><Body><Fault><faultcode>Client</faultcode><faultstring>Negado</faultstring></Fault></Body></Envelope>'
    await expect(executeWintourSoapRequest(request, {
      fetchImpl: async () => response(faultXml, 500),
    })).rejects.toMatchObject({ code: 'WINTOUR_SOAP_FAULT', ambiguous: false, fault: { faultString: 'Negado' } })
  })

  it('classifies network failures as ambiguous for mutations but safely retryable for protocol queries', async () => {
    const secret = 'PIN-NAO-PODE-VAZAR'
    const mutation = buildWintourCreateSalesSoapRequest({ pin: secret, xml: '<bilhetes></bilhetes>' })
    const query = buildWintourCreateProtocolQuerySoapRequest({ pin: secret, protocol: 'P-1' })
    const failingFetch = async () => { throw new TypeError('socket closed') }

    let mutationError: WintourSoapError | undefined
    try {
      await executeWintourSoapRequest(mutation, { fetchImpl: failingFetch })
    } catch (error) {
      mutationError = error as WintourSoapError
    }
    expect(mutationError).toMatchObject({ code: 'WINTOUR_SOAP_NETWORK_ERROR', ambiguous: true, retryable: false })
    expect(JSON.stringify(mutationError?.toSafeObject())).not.toContain(secret)
    expect(mutationError?.message).not.toContain(secret)

    await expect(executeWintourSoapRequest(query, { fetchImpl: failingFetch })).rejects.toMatchObject({
      code: 'WINTOUR_SOAP_NETWORK_ERROR', ambiguous: false, retryable: true,
    })
  })

  it('preserves timeout/network classification when the response body stream fails after headers', async () => {
    const mutation = buildWintourCreateSalesSoapRequest({ pin: '123', xml: '<bilhetes></bilhetes>' })
    const query = buildWintourCreateProtocolQuerySoapRequest({ pin: '123', protocol: 'P-1' })
    const hangingFetch = async (_input: string | URL, init?: RequestInit): Promise<Response> => {
      const signal = init?.signal
      if (!signal) throw new Error('signal ausente')
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          signal.addEventListener('abort', () => controller.error(new DOMException('aborted', 'AbortError')), { once: true })
        },
      })
      return new Response(body, { status: 200, headers: { 'Content-Type': 'text/xml' } })
    }
    await expect(executeWintourSoapRequest(query, { fetchImpl: hangingFetch, timeoutMs: 10 })).rejects.toMatchObject({
      code: 'WINTOUR_SOAP_TIMEOUT', ambiguous: false, retryable: true,
    })
    await expect(executeWintourSoapRequest(mutation, { fetchImpl: hangingFetch, timeoutMs: 10 })).rejects.toMatchObject({
      code: 'WINTOUR_SOAP_TIMEOUT', ambiguous: true, retryable: false,
    })

    const brokenBodyFetch = async (): Promise<Response> => new Response(new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('<Envelope>'))
        queueMicrotask(() => controller.error(new TypeError('socket reset')))
      },
    }), { status: 200, headers: { 'Content-Type': 'text/xml' } })
    await expect(executeWintourSoapRequest(query, { fetchImpl: brokenBodyFetch })).rejects.toMatchObject({
      code: 'WINTOUR_SOAP_NETWORK_ERROR', ambiguous: false, retryable: true,
    })
    await expect(executeWintourSoapRequest(mutation, { fetchImpl: brokenBodyFetch })).rejects.toMatchObject({
      code: 'WINTOUR_SOAP_NETWORK_ERROR', ambiguous: true, retryable: false,
    })
  })

  it('enforces response and input limits before exposing untrusted content', async () => {
    expect(() => buildWintourCreateSalesSoapRequest({ pin: 'with space', xml: '<x/>' })).toThrow(/PIN/)
    expect(() => buildWintourCreateProtocolQuerySoapRequest({ pin: '123', protocol: '' })).toThrow(/Protocolo/)

    const request = buildWintourCreateSalesSoapRequest({ pin: '123', xml: '<bilhetes></bilhetes>' })
    await expect(executeWintourSoapRequest(request, {
      fetchImpl: async () => response('x'.repeat(2048)),
      maxResponseBytes: 1024,
    })).rejects.toMatchObject({ code: 'WINTOUR_SOAP_RESPONSE_TOO_LARGE' })
  })
})
