import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { AirlineLogo } from '../../components/travel/services/air/airline-logo'

describe('AirlineLogo', () => {
  it('renders the bundled GOL wordmark for G3', () => {
    const markup = renderToStaticMarkup(createElement(AirlineLogo, {
      iataCode: 'G3',
      airlineName: 'GOL',
      size: 'lg',
    }))

    expect(markup).toContain('data-airline-logo="G3"')
    expect(markup).toContain('src="/airlines/G3.svg"')
    expect(markup).toContain('alt="Logomarca da GOL"')
    expect(markup).not.toContain('data-airline-logo-fallback')
  })

  it('renders the light LATAM wordmark on its brand-safe surface', () => {
    const markup = renderToStaticMarkup(createElement(AirlineLogo, {
      iataCode: 'LA',
      airlineName: 'LATAM',
      size: 'md',
    }))

    expect(markup).toContain('data-airline-logo="LA"')
    expect(markup).toContain('src="/airlines/LA.svg"')
    expect(markup).toContain('background-color:#1b0088')
  })

  it('uses an accessible IATA monogram when no bundled brand exists', () => {
    const markup = renderToStaticMarkup(createElement(AirlineLogo, {
      iataCode: 'XX',
      airlineName: 'Companhia Teste',
    }))

    expect(markup).toContain('data-airline-logo-fallback="XX"')
    expect(markup).toContain('role="img"')
    expect(markup).toContain('aria-label="Companhia Teste (XX)"')
    expect(markup).toContain('>XX</span>')
    expect(markup).not.toContain('<img')
  })
})
