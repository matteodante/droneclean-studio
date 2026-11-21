import { createLazyFileRoute, Link } from '@tanstack/react-router'
import { DocsArticle, DocsShell } from '@/features/docs/docs-shell'
import { useDocPage } from '@/features/docs/docs-content'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'

export const Route = createLazyFileRoute('/docs/$slug')({
  component: DocsSlugPage,
})

function DocsSlugPage() {
  const { slug } = Route.useParams()
  const { t } = useTranslation()
  const page = useDocPage(slug)

  if (!page) {
    return (
      <DocsShell>
        <div className="rounded-lg border border-border bg-card p-8">
          <h1 className="text-2xl font-semibold">{t('docs.notFoundTitle')}</h1>
          <p className="mt-3 text-muted-foreground">{t('docs.notFoundText')}</p>
          <Button asChild className="mt-6">
            <Link to="/docs">{t('docs.backToDocs')}</Link>
          </Button>
        </div>
      </DocsShell>
    )
  }

  return (
    <DocsShell currentSlug={page.slug}>
      <DocsArticle page={page} />
    </DocsShell>
  )
}
