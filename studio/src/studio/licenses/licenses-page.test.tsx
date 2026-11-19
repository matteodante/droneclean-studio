import type { ReactNode } from 'react'
import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { i18n } from '@/i18n'
import { FONT_LICENSES } from './font-licenses'
import { FREECUT_LICENSE_TEXT } from './freecut-license'
import { LicensesPage } from './licenses-page'

vi.mock('@tanstack/react-router', () => ({
  Link: ({
    children,
    to,
    ...props
  }: { children: ReactNode; to: string } & Record<string, unknown>) => (
    <a href={to} {...props}>
      {children}
    </a>
  ),
}))

const OFL_LICENSE_URL = 'https://openfontlicense.org/open-font-license-official-text/'
const APACHE_LICENSE_URL = 'https://www.apache.org/licenses/LICENSE-2.0'

/**
 * Read the rendered font rows once, as data. One pass over the DOM instead of
 * three queries per row: the page lists 121 families, and per-row text and role
 * searches are what made this test slow on a busy machine.
 */
function renderedFontRows(container: HTMLElement) {
  return [...container.querySelectorAll('main ul > li')].map((item) => {
    const [family, copyright] = item.querySelectorAll('p')
    const link = item.querySelector('a')
    return {
      family: family?.textContent,
      copyright: copyright?.textContent,
      license: item.querySelector('span')?.textContent,
      link: link?.getAttribute('href'),
      linkText: link?.textContent,
    }
  })
}

describe('LicensesPage', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('en')
  })

  it('shows the product, the FreeCut MIT notice and the font licences', () => {
    const { container } = render(<LicensesPage />)

    expect(screen.getByRole('heading', { level: 1, name: 'Licences' })).toBeTruthy()
    expect(screen.getByRole('heading', { level: 2, name: 'DroneClean Studio' })).toBeTruthy()
    expect(
      screen.getByText('© 2026 DroneClean. Built on the open-source projects below.'),
    ).toBeTruthy()

    expect(screen.getByRole('heading', { level: 2, name: 'FreeCut' })).toBeTruthy()
    expect(container.querySelector('pre')?.textContent).toBe(FREECUT_LICENSE_TEXT)

    expect(screen.getByRole('heading', { level: 2, name: 'Fonts' })).toBeTruthy()
    expect(renderedFontRows(container)).toEqual(
      FONT_LICENSES.map((font) => ({
        family: font.family,
        copyright: font.copyright,
        license: font.license,
        link: font.url,
        linkText: font.url,
      })),
    )
  })

  it('links the font licence texts and the way back', () => {
    const { container } = render(<LicensesPage />)
    const links = [...container.querySelectorAll('a')]
    const hrefsOf = (text: string) =>
      links.filter((link) => link.textContent === text).map((link) => link.getAttribute('href'))

    expect(hrefsOf('SIL Open Font License 1.1')).toEqual([OFL_LICENSE_URL])
    expect(hrefsOf('Apache License 2.0')).toEqual([APACHE_LICENSE_URL])
    const homeLinks = links.filter((link) => link.getAttribute('href') === '/')
    expect(homeLinks).toHaveLength(2)
    for (const link of homeLinks) {
      expect(link.getAttribute('aria-label') ?? link.textContent).toBe('Back to home')
    }
  })
})
