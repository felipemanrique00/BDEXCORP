export type IAInteractionScope = 'tudo' | 'sistema_viagens' | 'restrito'

export interface IAConfig {
  scope: IAInteractionScope
  permitirInternet: boolean
  permitirCriarDemandas: boolean
  permitirCadastrarHoteis: boolean
  permitirReservasTech: boolean
  permitirFinanceiro: boolean
  exigirConfirmacaoExecucao: boolean
  assuntosBloqueados: string
}

export const IA_CONFIG_DEFAULT: IAConfig = {
  scope: 'tudo',
  permitirInternet: true,
  permitirCriarDemandas: true,
  permitirCadastrarHoteis: true,
  permitirReservasTech: true,
  permitirFinanceiro: true,
  exigirConfirmacaoExecucao: true,
  assuntosBloqueados: '',
}

export const IA_CONFIG_MAXIMA: IAConfig = {
  ...IA_CONFIG_DEFAULT,
}
