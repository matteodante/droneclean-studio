import { createFileRoute, Link } from '@tanstack/react-router'
import { Trans, useTranslation } from 'react-i18next'
import { ArrowRight, ExternalLink } from 'lucide-react'
import { FreeCutLogo } from '@/components/brand/freecut-logo'
import { Button } from '@/components/ui/button'
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion'

export const Route = createFileRoute('/')({
  component: LandingPage,
})

const DRONECLEAN_SITE_URL = 'https://droneclean.app'
const FREECUT_REPOSITORY_URL = 'https://github.com/walterlow/freecut'

const featureItems = [
  {
    id: 'timeline',
    titleKey: 'projects.landing.features.timeline.title',
    descriptionKey: 'projects.landing.features.timeline.description',
  },
  {
    id: 'colour',
    titleKey: 'projects.landing.features.colour.title',
    descriptionKey: 'projects.landing.features.colour.description',
  },
  {
    id: 'keyframes',
    titleKey: 'projects.landing.features.keyframes.title',
    descriptionKey: 'projects.landing.features.keyframes.description',
  },
  {
    id: 'titlesAudio',
    titleKey: 'projects.landing.features.titlesAudio.title',
    descriptionKey: 'projects.landing.features.titlesAudio.description',
  },
  {
    id: 'export',
    titleKey: 'projects.landing.features.export.title',
    descriptionKey: 'projects.landing.features.export.description',
  },
  {
    id: 'private',
    titleKey: 'projects.landing.features.private.title',
    descriptionKey: 'projects.landing.features.private.description',
  },
]

function LandingPage() {
  const { t } = useTranslation()
  const faqItems: Array<{ id?: string; question: string; answer: React.ReactNode }> = [
    {
      question: t('projects.landing.faq.free.question'),
      answer: t('projects.landing.faq.free.answer'),
    },
    {
      question: t('projects.landing.faq.upload.question'),
      answer: t('projects.landing.faq.upload.answer'),
    },
    {
      question: t('projects.landing.faq.browsers.question'),
      answer: t('projects.landing.faq.browsers.answer'),
    },
    {
      question: t('projects.landing.faq.builtOn.question'),
      answer: (
        <Trans
          i18nKey="projects.landing.faq.builtOn.answer"
          components={{
            licenses: (
              <Link to="/licenses" className="text-primary underline hover:text-primary/80" />
            ),
          }}
        />
      ),
    },
    {
      question: t('projects.landing.faq.drones.question'),
      answer: t('projects.landing.faq.drones.answer'),
    },
  ]
  return (
    <div className="min-h-screen bg-background text-foreground select-text">
      {/* Hero Section */}
      <section className="relative flex min-h-[60vh] flex-col items-center justify-center px-6 py-12">
        {/* Subtle gradient background */}
        <div className="pointer-events-none absolute inset-0 overflow-hidden">
          <div className="absolute left-1/2 top-1/2 h-[600px] w-[600px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-primary/5 blur-3xl" />
        </div>

        <div className="relative z-10 flex flex-col items-center text-center animate-fade-in">
          <div className="mb-6 flex items-center gap-3">
            <FreeCutLogo size="lg" />
            <span className="rounded-full bg-primary/15 px-3 py-1 text-xs font-medium text-primary">
              {t('projects.landing.beta')}
            </span>
          </div>

          <h1 className="mb-4 max-w-2xl text-4xl font-bold tracking-tight sm:text-5xl md:text-6xl">
            {t('projects.landing.heroTitle')}
          </h1>

          <p className="mb-6 max-w-lg text-lg text-muted-foreground sm:text-xl">
            {t('projects.landing.heroSubtitle')}
          </p>

          <p className="mb-6 max-w-lg text-sm text-amber-600 dark:text-amber-500">
            {t('projects.landing.disclaimer')}
          </p>

          <div className="flex flex-col items-center gap-4 sm:flex-row sm:flex-wrap sm:justify-center">
            <Button asChild size="lg" className="gap-2 px-8">
              <Link to="/projects">
                {t('projects.landing.openEditor')}
                <ArrowRight className="h-4 w-4" />
              </Link>
            </Button>

            <Button asChild variant="outline" size="lg" className="gap-2 px-8">
              <a href={DRONECLEAN_SITE_URL} target="_blank" rel="noopener noreferrer">
                {t('projects.landing.removeShadow')}
                <ExternalLink className="h-4 w-4" />
              </a>
            </Button>
          </div>
        </div>
      </section>

      {/* Features */}
      <section className="border-t border-border px-6 py-20">
        <div className="mx-auto grid max-w-6xl gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {featureItems.map((item) => (
            <div key={item.id} className="rounded-xl border border-border bg-card p-5">
              <h2 className="font-semibold">{t(item.titleKey)}</h2>
              <p className="mt-1.5 text-sm text-muted-foreground">{t(item.descriptionKey)}</p>
            </div>
          ))}
        </div>
      </section>

      {/* FAQ Section */}
      <section className="border-t border-border bg-card/50 px-6 py-20">
        <div className="mx-auto max-w-3xl">
          <div className="mb-10 text-center">
            <h2 className="mb-4 text-3xl font-bold tracking-tight sm:text-4xl">
              {t('projects.landing.faqHeading')}
            </h2>
            <p className="text-muted-foreground">{t('projects.landing.faqSubheading')}</p>
          </div>

          <Accordion type="single" collapsible className="w-full">
            {faqItems.map((item, index) => (
              <AccordionItem key={index} value={`item-${index}`} id={item.id}>
                <AccordionTrigger className="text-left">{item.question}</AccordionTrigger>
                <AccordionContent className="text-muted-foreground">{item.answer}</AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>
        </div>
      </section>

      {/* CTA Footer Section */}
      <section className="border-t border-border px-6 py-20">
        <div className="mx-auto flex max-w-2xl flex-col items-center text-center">
          <h2 className="mb-4 text-2xl font-bold sm:text-3xl">
            {t('projects.landing.ctaHeading')}
          </h2>
          <p className="mb-8 text-muted-foreground">{t('projects.landing.ctaSubheading')}</p>
          <div className="flex flex-col items-center gap-4 sm:flex-row">
            <Button asChild size="lg" className="gap-2 px-8">
              <Link to="/projects">
                {t('projects.landing.startEditing')}
                <ArrowRight className="h-4 w-4" />
              </Link>
            </Button>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-border px-6 py-8">
        <div className="mx-auto max-w-5xl text-center text-sm text-muted-foreground">
          <Trans
            i18nKey="projects.landing.footer"
            values={{ year: new Date().getFullYear() }}
            components={{
              freecut: (
                <a
                  href={FREECUT_REPOSITORY_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline hover:text-foreground"
                />
              ),
              licenses: <Link to="/licenses" className="underline hover:text-foreground" />,
            }}
          />
        </div>
      </footer>
    </div>
  )
}
