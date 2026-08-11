/**
 * CSS canônico do voucher. O layout estrutural usa tabelas para continuar
 * legível em clientes de e-mail que não implementam Grid/Flex por completo.
 */
export const VOUCHER_DOCUMENT_STYLES = `
  * { box-sizing: border-box; }
  body { margin: 0; background: #f8fafc; color: #172033; font-family: Arial, Helvetica, sans-serif; }
  .vd-page { width: 100%; max-width: 820px; margin: 0 auto; background: #ffffff; padding: 28px; font-size: 11px; line-height: 1.4; }
  .vd-layout { width: 100%; border-collapse: collapse; border-spacing: 0; }
  .vd-layout > tbody > tr > td { border: 0; padding: 0; vertical-align: top; }
  .vd-header { width: 100%; border-collapse: collapse; border-spacing: 0; }
  .vd-header td { border: 0; padding: 0 0 14px; vertical-align: top; }
  .vd-header-agency { width: 62%; padding-right: 18px !important; }
  .vd-header-meta { width: 38%; text-align: right; }
  .vd-agency-row { width: 100%; border-collapse: collapse; border-spacing: 0; }
  .vd-agency-row td { border: 0; padding: 0; vertical-align: top; }
  .vd-logo-cell { width: 82px; padding-right: 12px !important; }
  .vd-agency-logo { display: block; width: 72px; height: 72px; object-fit: contain; }
  .vd-customer-logo { display: inline-block; max-width: 210px; max-height: 54px; object-fit: contain; }
  .vd-airline-logo { display: inline-block; width: 70px; max-width: 70px; height: 28px; object-fit: contain; vertical-align: middle; }
  .vd-airline-logo-large { width: 112px; max-width: 112px; height: 42px; }
  .vd-airline-surface { display: inline-block; padding: 3px 5px; border-radius: 4px; vertical-align: middle; }
  .vd-airline-fallback { display: inline-block; min-width: 42px; padding: 4px 6px; border: 1px solid #cbd5e1; border-radius: 4px; background: #f8fafc; color: #475569; font-weight: 700; text-align: center; vertical-align: middle; }
  .vd-agency-name { margin-bottom: 2px; font-size: 14px; font-weight: 800; }
  .vd-agency-detail { color: #334155; font-size: 9px; line-height: 1.45; }
  .vd-client-brand { margin-bottom: 8px; }
  .vd-client-label { margin-bottom: 2px; color: #64748b; font-size: 8px; font-weight: 700; letter-spacing: .06em; text-transform: uppercase; }
  .vd-client-text { font-size: 12px; font-weight: 800; }
  .vd-client-legal { color: #64748b; font-size: 8px; }
  .vd-voucher-title { font-size: 20px; font-weight: 800; line-height: 1.15; }
  .vd-meta-line { margin-top: 3px; font-size: 9px; }
  .vd-status { display: inline-block; margin-top: 7px; padding: 3px 7px; border-radius: 999px; background: #e0f2fe; color: #075985; font-size: 9px; font-weight: 800; text-transform: uppercase; }
  .vd-cancelled { display: inline-block; margin-top: 9px; border: 2px solid #dc2626; padding: 3px 8px; color: #dc2626; font-size: 18px; font-weight: 900; transform: rotate(-6deg); }
  .vd-primary-airline { margin-top: 8px; }
  .vd-airline-name { margin-top: 2px; color: #475569; font-size: 8px; font-weight: 700; text-transform: uppercase; }
  .vd-section { margin-top: 16px; break-inside: avoid; page-break-inside: avoid; }
  .vd-section-title { margin: 0 0 7px; border-bottom: 1px solid #cbd5e1; padding-bottom: 4px; font-size: 13px; font-weight: 800; }
  .vd-fields { width: 100%; border-collapse: separate; border-spacing: 0; table-layout: fixed; }
  .vd-fields td { width: 50%; border: 1px solid #d8dee8; padding: 7px; vertical-align: top; }
  .vd-fields td:empty { border: 0; }
  .vd-label { color: #64748b; font-size: 8px; font-weight: 700; letter-spacing: .04em; text-transform: uppercase; }
  .vd-value { margin-top: 2px; color: #0f172a; font-size: 10px; font-weight: 600; overflow-wrap: anywhere; white-space: pre-line; }
  .vd-hotel-name { margin-bottom: 7px; font-size: 15px; font-weight: 800; }
  .vd-table { width: 100%; border-collapse: collapse; table-layout: fixed; }
  .vd-table th, .vd-table td { border: 1px solid #9ca3af; padding: 5px 6px; font-size: 9px; text-align: left; vertical-align: top; overflow-wrap: anywhere; }
  .vd-table th { background: #f1f5f9; color: #334155; font-weight: 700; text-align: center; }
  .vd-table .vd-center { text-align: center; }
  .vd-table .vd-right { text-align: right; font-variant-numeric: tabular-nums; }
  .vd-subtle { color: #64748b; font-size: 8px; }
  .vd-airline-cell { white-space: normal; }
  .vd-airline-cell .vd-airline-name-inline { display: inline-block; margin-left: 6px; vertical-align: middle; }
  .vd-total-row td { color: #ffffff; font-weight: 800; }
  .vd-warning { margin-top: 7px; border-left: 4px solid #dc2626; background: #fef2f2; padding: 8px 10px; color: #991b1b; font-size: 9px; font-weight: 700; }
  .vd-observations { min-height: 52px; border: 1px solid #9ca3af; padding: 8px; white-space: pre-wrap; }
  .vd-footer { margin-top: 22px; border-top: 1px solid #cbd5e1; padding-top: 9px; color: #64748b; font-size: 8px; }
  .vd-footer-right { margin-top: 8px; text-align: right; }
  @media print {
    @page { size: A4; margin: 12mm; }
    body { background: #ffffff !important; }
    .vd-page { max-width: none; padding: 0; }
    .vd-section { break-inside: avoid; page-break-inside: avoid; }
  }
  @media only screen and (max-width: 640px) {
    .vd-page { padding: 16px; }
    .vd-header-agency, .vd-header-meta { display: block; width: 100%; text-align: left; }
    .vd-header-meta { padding-top: 12px !important; }
  }
`
