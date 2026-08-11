import type { CSSProperties, ReactNode } from 'react'

import type {
  VoucherDocumentField,
  VoucherDocumentModel,
} from '@/lib/vouchers/document-model'

export interface VoucherDocumentImageAsset {
  src: string
  alt?: string
  backgroundColor?: string
}

export interface VoucherDocumentAssets {
  agencyLogo?: VoucherDocumentImageAsset | null
  customerLogo?: VoucherDocumentImageAsset | null
  airlineLogos?: Readonly<Record<string, VoucherDocumentImageAsset>>
}

export interface VoucherDocumentProps {
  model: VoucherDocumentModel
  assets?: VoucherDocumentAssets
}

export function VoucherDocument({ model, assets = {} }: VoucherDocumentProps) {
  const primaryStyle = { color: model.branding.primaryColor }
  const sectionStyle = { color: model.branding.primaryColor }
  const headerStyle = { borderBottom: `2px solid ${model.branding.primaryColor}` }
  const totalStyle = { backgroundColor: model.branding.primaryColor }
  const showCustomerBrand = Boolean(
    assets.customerLogo
    || model.branding.displayName !== 'BBT Corporativo'
    || model.branding.documentLegalName
    || model.branding.documentNumber,
  )

  return (
    <main
      className="vd-page"
      data-voucher-document="true"
      data-voucher-id={model.voucherId}
      data-voucher-type={model.voucherType}
      data-voucher-status={model.status}
    >
      <table className="vd-header" role="presentation" style={headerStyle} data-voucher-section="header">
        <tbody>
          <tr>
            <td className="vd-header-agency">
              <table className="vd-agency-row" role="presentation">
                <tbody>
                  <tr>
                    <td className="vd-logo-cell">
                      {assets.agencyLogo ? (
                        <img
                          className="vd-agency-logo"
                          src={assets.agencyLogo.src}
                          alt={assets.agencyLogo.alt || 'BBT Corporativo'}
                          data-voucher-logo="agency"
                        />
                      ) : (
                        <span
                          className="vd-airline-fallback"
                          style={{ ...primaryStyle, borderColor: model.branding.accentColor }}
                          data-voucher-logo="agency"
                        >BBT</span>
                      )}
                    </td>
                    <td>
                      <div className="vd-agency-name" style={primaryStyle}>{model.agency.name}</div>
                      <div className="vd-agency-detail">
                        <div>{model.agency.address}</div>
                        <div>{model.agency.cityPostalCode}</div>
                        <div>Tel: {model.agency.phone}</div>
                        <div>E-mail: {model.agency.email}</div>
                        <div>CNPJ: {model.agency.documentNumber}</div>
                        <div>Ministério do Turismo: {model.agency.tourismRegistry}</div>
                      </div>
                    </td>
                  </tr>
                </tbody>
              </table>
            </td>
            <td className="vd-header-meta">
              {showCustomerBrand && (
                <div className="vd-client-brand" data-voucher-brand="customer">
                  <div className="vd-client-label">Identidade do cliente</div>
                  {assets.customerLogo ? (
                    <img
                      className="vd-customer-logo"
                      src={assets.customerLogo.src}
                      alt={assets.customerLogo.alt || model.branding.displayName}
                      data-voucher-logo="customer"
                    />
                  ) : (
                    <div className="vd-client-text" style={primaryStyle}>{model.branding.displayName}</div>
                  )}
                  {(model.branding.documentLegalName || model.branding.documentNumber) && (
                    <div className="vd-client-legal">
                      {[model.branding.documentLegalName, model.branding.documentNumber].filter(Boolean).join(' · ')}
                    </div>
                  )}
                </div>
              )}
              <div className="vd-voucher-title" style={primaryStyle}>VOUCHER Nº {model.voucherId}</div>
              {model.issuedAt && <div className="vd-meta-line">Data de emissão: {model.issuedAt}</div>}
              <div className="vd-meta-line">Tipo: {model.voucherType}</div>
              {model.air?.primaryAirlineCode || model.air?.primaryAirlineName ? (
                <div className="vd-primary-airline">
                  <AirlineIdentity
                    code={model.air.primaryAirlineCode}
                    name={model.air.primaryAirlineName}
                    assets={assets}
                    large
                  />
                </div>
              ) : null}
              {!model.cancelled && <div className="vd-status">{model.status}</div>}
              {model.cancelled && <div className="vd-cancelled">CANCELADO</div>}
            </td>
          </tr>
        </tbody>
      </table>

      <VoucherSection marker="summary" title="Identificação do pedido" titleStyle={sectionStyle}>
        <FieldTable fields={model.summary} />
      </VoucherSection>

      {model.travelers.length > 0 && (
        <VoucherSection marker="travelers" title={model.travelerTitle} titleStyle={sectionStyle}>
          <table className="vd-table">
            <thead><tr><th>#</th><th>Nome</th><th>Papel</th><th>Código</th><th>Documento</th><th>Contato</th><th>Quarto</th></tr></thead>
            <tbody>
              {model.travelers.map((traveler) => (
                <tr key={`${traveler.index}-${traveler.name}`}>
                  <td className="vd-center">{traveler.index}</td>
                  <td><strong>{traveler.name}</strong></td>
                  <td>{traveler.role || ''}</td>
                  <td>{traveler.code || ''}</td>
                  <td>{traveler.document || ''}</td>
                  <td>{traveler.contact || ''}</td>
                  <td className="vd-center">{traveler.room || ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </VoucherSection>
      )}

      {model.hotel && (
        <VoucherSection marker="hotel" title="Confirmação da hospedagem" titleStyle={sectionStyle}>
          {model.hotel.name && <div className="vd-hotel-name" style={primaryStyle}>{model.hotel.name}</div>}
          <FieldTable fields={model.hotel.fields} />
          {model.hotel.rooms.length > 0 && (
            <div data-voucher-section="rooms" style={{ marginTop: 9 }}>
              <div className="vd-label" style={{ marginBottom: 4 }}>Acomodações escolhidas</div>
              <table className="vd-table">
                <thead><tr><th>Quarto</th><th>Acomodação</th><th>Categoria</th><th>Regime</th><th>Hóspedes</th></tr></thead>
                <tbody>
                  {model.hotel.rooms.map((room) => (
                    <tr key={room.number}>
                      <td className="vd-center"><strong>{room.number}</strong></td>
                      <td>{room.accommodation || ''}</td>
                      <td>{room.category || ''}</td>
                      <td>{room.mealPlan || ''}</td>
                      <td>{room.guests || ''}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </VoucherSection>
      )}

      {model.air && (
        <>
          <VoucherSection marker="air-itinerary" title="Itinerário aéreo" titleStyle={sectionStyle}>
            {model.air.segments.length > 0 ? (
              <table className="vd-table">
                <thead><tr><th>Data e hora</th><th>Trecho</th><th>Companhia / voo</th><th>Classe</th><th>Bagagem</th></tr></thead>
                <tbody>
                  {model.air.segments.map((segment) => (
                    <tr key={`${segment.sequence}-${segment.flightNumber}`}>
                      <td><strong>Sai:</strong> {segment.departure}<br /><strong>Chega:</strong> {segment.arrival}</td>
                      <td>{segment.origin}<br />→ {segment.destination}</td>
                      <td className="vd-airline-cell">
                        <AirlineIdentity code={segment.airlineCode} name={segment.airlineName} assets={assets} />
                        <div className="vd-subtle">Voo {segment.flightNumber}</div>
                      </td>
                      <td>{segment.cabinClass || ''}</td>
                      <td className="vd-center">{segment.baggage || ''}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : <FieldTable fields={model.air.legacyFields} />}
          </VoucherSection>
          {model.air.reservationFields.length > 0 && (
            <VoucherSection marker="air-reservation" title="Dados da reserva aérea" titleStyle={sectionStyle}>
              <FieldTable fields={model.air.reservationFields} />
            </VoucherSection>
          )}
          {model.air.tickets.length > 0 && (
            <VoucherSection marker="air-tickets" title="Bilhetes emitidos" titleStyle={sectionStyle}>
              <table className="vd-table">
                <thead><tr><th>Passageiro</th><th>Número do bilhete</th><th>Companhia emissora</th></tr></thead>
                <tbody>
                  {model.air.tickets.map((ticket, index) => (
                    <tr key={`${index}-${ticket.ticketNumber}`}>
                      <td><strong>{ticket.passenger}</strong>{ticket.passengerReference && <><br /><span className="vd-subtle">{ticket.passengerReference}</span></>}</td>
                      <td>{ticket.ticketNumber}</td>
                      <td className="vd-airline-cell"><AirlineIdentity code={ticket.airlineCode} name={ticket.airlineName} assets={assets} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </VoucherSection>
          )}
        </>
      )}

      {model.car && model.car.fields.length > 0 && (
        <VoucherSection marker="car" title="Dados da locação" titleStyle={sectionStyle}><FieldTable fields={model.car.fields} /></VoucherSection>
      )}
      {model.otherService && model.otherService.fields.length > 0 && (
        <VoucherSection marker="service" title="Dados do serviço" titleStyle={sectionStyle}><FieldTable fields={model.otherService.fields} /></VoucherSection>
      )}
      {model.supplierFields.length > 0 && (
        <VoucherSection marker="supplier" title="Fornecedor da reserva" titleStyle={sectionStyle}><FieldTable fields={model.supplierFields} /></VoucherSection>
      )}
      {model.confirmationFields.length > 0 && (
        <VoucherSection marker="confirmation" title="Confirmação da reserva" titleStyle={sectionStyle}><FieldTable fields={model.confirmationFields} /></VoucherSection>
      )}
      {model.moneyRows.length > 0 && (
        <VoucherSection marker="financial" title="Valores confirmados" titleStyle={sectionStyle}>
          <table className="vd-table">
            <tbody>
              {model.moneyRows.map((row) => (
                <tr key={row.label} className={row.total ? 'vd-total-row' : undefined} style={row.total ? totalStyle : undefined}>
                  <td><strong>{row.label}</strong></td><td className="vd-right">{row.value}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </VoucherSection>
      )}
      {model.paymentFields.length > 0 && (
        <VoucherSection marker="payment" title="Pagamento" titleStyle={sectionStyle}><FieldTable fields={model.paymentFields} /></VoucherSection>
      )}
      {model.cancellationFields.length > 0 && (
        <VoucherSection marker="cancellation" title="Cancelamento e condições" titleStyle={sectionStyle}>
          <FieldTable fields={model.cancellationFields} />
          {model.nonRefundable && <div className="vd-warning">Esta reserva está marcada como não reembolsável. Consulte as condições antes de cancelar ou alterar.</div>}
        </VoucherSection>
      )}
      {model.administrativeFields.length > 0 && (
        <VoucherSection marker="administrative" title="Dados administrativos" titleStyle={sectionStyle}><FieldTable fields={model.administrativeFields} /></VoucherSection>
      )}
      {model.observations && (
        <VoucherSection marker="observations" title="Observações ao cliente" titleStyle={sectionStyle}>
          <div className="vd-observations">{model.observations}</div>
        </VoucherSection>
      )}

      <footer className="vd-footer" data-voucher-section="footer">
        <div>Gestão e emissão de viagens por BBT Corporativo.</div>
        <div>
          {model.presentation.showCancellationTerms
            ? 'Confira os dados, prazos e condições deste voucher antes da utilização.'
            : 'Confira os dados deste voucher antes da utilização.'}
          {' '}Em caso de divergência, acione a equipe BBT.
        </div>
        <div>BBT Agência de Viagens e Turismo Globais · CNPJ {model.agency.documentNumber} · {model.agency.phone}</div>
        {model.issuedBy && <div className="vd-footer-right">Voucher cadastrado por: <strong>{model.issuedBy}</strong></div>}
      </footer>
    </main>
  )
}

function VoucherSection({
  marker,
  title,
  titleStyle,
  children,
}: {
  marker: string
  title: string
  titleStyle: CSSProperties
  children: ReactNode
}) {
  return (
    <section className="vd-section" data-voucher-section={marker}>
      <h2 className="vd-section-title" style={titleStyle}>{title}</h2>
      {children}
    </section>
  )
}

function FieldTable({ fields }: { fields: VoucherDocumentField[] }) {
  if (!fields.length) return null
  const rows: VoucherDocumentField[][] = []
  for (let index = 0; index < fields.length; index += 2) rows.push(fields.slice(index, index + 2))
  return (
    <table className="vd-fields" role="presentation">
      <tbody>
        {rows.map((row, rowIndex) => (
          <tr key={rowIndex}>
            {row.map((field) => (
              <td key={`${field.label}-${field.value}`}>
                <div className="vd-label">{field.label}</div>
                <div className="vd-value">{field.value}</div>
              </td>
            ))}
            {row.length === 1 && <td />}
          </tr>
        ))}
      </tbody>
    </table>
  )
}

function AirlineIdentity({
  code,
  name,
  assets,
  large = false,
}: {
  code?: string
  name?: string
  assets: VoucherDocumentAssets
  large?: boolean
}) {
  const normalizedCode = String(code || '').trim().toUpperCase()
  const asset = normalizedCode ? assets.airlineLogos?.[normalizedCode] : undefined
  const label = String(name || '').trim() || (normalizedCode ? `Companhia ${normalizedCode}` : 'Companhia aérea')
  return (
    <span data-voucher-airline={normalizedCode || undefined}>
      <span className="vd-airline-surface" style={asset?.backgroundColor ? { backgroundColor: asset.backgroundColor } : undefined}>
        {asset ? (
          <img
            className={`vd-airline-logo${large ? ' vd-airline-logo-large' : ''}`}
            src={asset.src}
            alt={asset.alt || `Logomarca da ${label}`}
            data-voucher-logo="airline"
            data-airline-code={normalizedCode || undefined}
          />
        ) : (
          <span
            className="vd-airline-fallback"
            data-voucher-logo="airline"
            data-airline-code={normalizedCode || undefined}
          >{normalizedCode || 'AIR'}</span>
        )}
      </span>
      <span className={large ? 'vd-airline-name' : 'vd-airline-name-inline'}>
        {[label, normalizedCode && `(${normalizedCode})`].filter(Boolean).join(' ')}
      </span>
    </span>
  )
}
