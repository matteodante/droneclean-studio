import { Link } from '@tanstack/react-router'
import { Trans, useTranslation } from 'react-i18next'
import { ArrowLeft } from 'lucide-react'
import { FreeCutLogo } from '@/components/brand/freecut-logo'
import { Button } from '@/components/ui/button'
import { FONT_LICENSES } from './font-licenses'
import { FREECUT_LICENSE_TEXT } from './freecut-license'

const OFL_LICENSE_URL = 'https://openfontlicense.org/open-font-license-official-text/'
const APACHE_LICENSE_URL = 'https://www.apache.org/licenses/LICENSE-2.0'

export function LicensesPage() {
  const { t } = useTranslation()

  return (
    <div className="min-h-screen bg-background text-foreground select-text">
      <header className="border-b border-border/70 px-6 py-5">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-4">
          <Link to="/" aria-label={t('licenses.backToHome')}>
            <FreeCutLogo size="md" />
          </Link>
          <Button asChild variant="ghost" size="sm" className="gap-2">
            <Link to="/">
              <ArrowLeft className="h-4 w-4" />
              {t('licenses.backToHome')}
            </Link>
          </Button>
        </div>
      </header>

      <main className="px-6 py-12 sm:py-16">
        <div className="mx-auto max-w-3xl space-y-10">
          <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">{t('licenses.title')}</h1>

          <section>
            <h2 className="text-xl font-semibold">{t('licenses.projectTitle')}</h2>
            <p className="mt-3 text-sm text-muted-foreground">{t('licenses.intro')}</p>
          </section>

          <section>
            <h2 className="text-xl font-semibold">{t('licenses.freeCutTitle')}</h2>
            <pre className="mt-3 overflow-x-auto whitespace-pre-wrap rounded-lg border border-border bg-card p-5 font-mono text-xs leading-6 text-muted-foreground">
              {FREECUT_LICENSE_TEXT}
            </pre>
          </section>

          <section>
            <h2 className="text-xl font-semibold">{t('licenses.fontsTitle')}</h2>
            <ul className="mt-3 divide-y divide-border rounded-lg border border-border bg-card">
              {FONT_LICENSES.map((font) => (
                <li
                  key={font.family}
                  className="flex flex-col gap-1 p-4 sm:flex-row sm:items-baseline sm:justify-between"
                >
                  <div>
                    <p className="font-medium">{font.family}</p>
                    <p className="text-xs text-muted-foreground">{font.copyright}</p>
                  </div>
                  <div className="text-xs text-muted-foreground sm:text-right">
                    <span className="rounded bg-muted px-1.5 py-0.5 font-mono">{font.license}</span>{' '}
                    <a
                      href={font.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="underline hover:text-foreground"
                    >
                      {font.url}
                    </a>
                  </div>
                </li>
              ))}
            </ul>
            <p className="mt-3 text-sm text-muted-foreground">
              <Trans
                i18nKey="licenses.fontsLicense"
                components={{
                  ofl: (
                    <a
                      href={OFL_LICENSE_URL}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-primary underline hover:text-primary/80"
                    />
                  ),
                  apache: (
                    <a
                      href={APACHE_LICENSE_URL}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-primary underline hover:text-primary/80"
                    />
                  ),
                }}
              />
            </p>
          </section>
        </div>
      </main>
    </div>
  )
}
