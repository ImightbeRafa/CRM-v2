'use client'

import type { AdsLang } from '@/lib/meta-ads/i18n'

/** ES | EN switch (ad account card + ad spend card), for Meta's English screencast. */
export function AdsLangToggle({ lang, onChange, label }: { lang: AdsLang; onChange: (lang: AdsLang) => void; label: string }) {
  return (
    <div role="group" aria-label={label} className="inline-flex shrink-0 rounded-lg bg-slate-100 p-0.5 text-[11px] font-semibold" data-testid="ads-lang-toggle">
      {(['es', 'en'] as const).map((l) => (
        <button
          key={l}
          type="button"
          aria-pressed={lang === l}
          onClick={() => onChange(l)}
          className={`rounded-md px-2 py-0.5 ${lang === l ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
        >
          {l.toUpperCase()}
        </button>
      ))}
    </div>
  )
}
