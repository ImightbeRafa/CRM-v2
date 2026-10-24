'use client'

/**
 * Config › Cuentas sociales › Cuenta publicitaria (Meta Ads): connect the business's own ad account with
 * Facebook Login for Business asking ONLY ads_read, pick the account, optional exchange rate, disconnect.
 * Read-only use: spend per ad for Estadísticas › Anuncios (ROAS). ES / EN for Meta's screencast.
 */
import { useCallback, useEffect, useState } from 'react'
import { BarChart3, ExternalLink, RefreshCw } from 'lucide-react'
import { AdsLangToggle } from '@/components/meta-ads/AdsLangToggle'
import { adsText, useAdsLang } from '@/lib/meta-ads/i18n'

type Connection = {
  status: 'pending_pick' | 'connected' | 'token_invalid' | 'missing_permission'
  adAccountId: string | null
  adAccountName: string | null
  currency: string | null
  timezoneName: string | null
  storeFxRate: number | null
  daysLeft: number | null
  accounts: Array<{ id: string; name: string; currency: string | null }>
}
type Data = { available: boolean; configured: boolean; connection: Connection | null }

async function call(method: 'GET' | 'POST' | 'DELETE', body?: unknown): Promise<{ ok: boolean; data?: Data; error?: string }> {
  const res = await fetch('/api/config/meta-ads', {
    method,
    headers: method === 'GET' ? undefined : { 'Content-Type': 'application/json' },
    body: method === 'POST' ? JSON.stringify(body) : method === 'DELETE' ? '{}' : undefined,
    cache: 'no-store',
  })
  const json = (await res.json().catch(() => null)) as { success?: boolean; data?: Data; error?: string } | null
  return { ok: Boolean(res.ok && json?.success), data: json?.data, error: json?.error }
}

export function MetaAdAccountCard() {
  const [lang, setLang] = useAdsLang()
  const t = adsText(lang)
  const [data, setData] = useState<Data | null>(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [picked, setPicked] = useState('')
  const [fx, setFx] = useState('')
  const [confirming, setConfirming] = useState(false)
  const [result, setResult] = useState<string | null>(null)

  const load = useCallback(async () => {
    const r = await call('GET').catch(() => ({ ok: false as const, data: undefined, error: undefined }))
    if (r.ok && r.data) {
      setData(r.data)
      setFx(r.data.connection?.storeFxRate ? String(r.data.connection.storeFxRate) : '')
    } else {
      // Still show the card (and the login result) when the status cannot be read.
      setData({ available: true, configured: true, connection: null })
      setError(r.error || null)
    }
  }, [])

  // Coming back from Meta: the card renders after its fetch, so the #anchor alone does not scroll to it.
  useEffect(() => {
    if (result && data) document.getElementById('cuenta-publicitaria')?.scrollIntoView({ block: 'center' })
  }, [result, data])

  useEffect(() => {
    void load()
    // Result of the Meta login (?ads=connected|pick|…): shown once, then removed from the address bar.
    const params = new URLSearchParams(window.location.search)
    const ads = params.get('ads')
    if (ads) {
      setResult(ads)
      params.delete('ads')
      const q = params.toString()
      window.history.replaceState(null, '', `${window.location.pathname}${q ? `?${q}` : ''}${window.location.hash}`)
    }
  }, [load])

  const run = async (work: () => Promise<{ ok: boolean; data?: Data; error?: string }>, done?: string) => {
    setBusy(true)
    setError(null)
    setMessage(null)
    try {
      const r = await work()
      if (r.ok && r.data) {
        setData(r.data)
        if (done) setMessage(done)
      } else setError(r.error || t.results.error)
    } finally {
      setBusy(false)
    }
  }

  const connect = async () => {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch('/api/auth/meta-ads/auth-url', { cache: 'no-store' })
      const json = (await res.json().catch(() => null)) as { authUrl?: string; error?: string } | null
      if (res.ok && json?.authUrl) window.location.href = json.authUrl
      else {
        setError(json?.error || t.notConfigured)
        setBusy(false)
      }
    } catch {
      setError(t.results.error)
      setBusy(false)
    }
  }

  if (!data) return null
  const c = data.connection
  const needsReconnect = c?.status === 'token_invalid' || c?.status === 'missing_permission'

  return (
    <section id="cuenta-publicitaria" className="scroll-mt-24 rounded-2xl border border-slate-200/70 bg-white p-5" data-testid="meta-ad-account">
      <div className="flex items-start gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-sky-50 text-sky-700">
          <BarChart3 className="h-[18px] w-[18px]" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="text-[15px] font-semibold text-slate-900">{t.cardTitle}</h2>
          <p className="mt-0.5 text-[12.5px] leading-relaxed text-slate-500">{t.cardSubtitle}</p>
          <p className="mt-0.5 text-[11.5px] text-slate-400">{t.readOnly}</p>
        </div>
        <AdsLangToggle lang={lang} onChange={setLang} label={t.langLabel} />
      </div>

      {result && Object.hasOwn(t.results, result) ? (
        <p
          className={`mt-3 rounded-xl px-3 py-2 text-[12.5px] ${result === 'connected' || result === 'pick' ? 'bg-emerald-50 text-emerald-800' : 'bg-amber-50 text-amber-900'}`}
          role="status"
          data-testid="meta-ads-result"
        >
          {t.results[result]}
        </p>
      ) : null}

      <div className="mt-4 space-y-3 text-[12.5px]">
        {!data.available ? (
          <p className="text-slate-500">{t.unavailable}</p>
        ) : !data.configured ? (
          <p className="text-slate-500">{t.notConfigured}</p>
        ) : !c ? (
          <button
            type="button"
            onClick={() => void connect()}
            disabled={busy}
            className="inline-flex items-center gap-1.5 rounded-lg bg-[#1877F2] px-3 py-2 font-semibold text-white hover:bg-[#166FE5] disabled:opacity-60"
            data-testid="meta-ads-connect"
          >
            {t.connect} <ExternalLink className="h-3.5 w-3.5" aria-hidden />
          </button>
        ) : c.status === 'pending_pick' ? (
          <form
            onSubmit={(e) => {
              e.preventDefault()
              if (picked) void run(() => call('POST', { action: 'pick', adAccountId: picked }), t.results.connected)
            }}
            className="space-y-2"
            data-testid="meta-ads-pick"
          >
            <p className="font-medium text-slate-800">{t.pickTitle}</p>
            {c.accounts.map((a) => (
              <label key={a.id} className="flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 hover:bg-slate-50">
                <input type="radio" name="ad-account" value={a.id} checked={picked === a.id} onChange={() => setPicked(a.id)} className="accent-[#5B6CFF]" />
                <span className="min-w-0 flex-1 truncate text-slate-800">{a.name}</span>
                <span className="text-[11px] tabular-nums text-slate-400">
                  {a.currency ?? ''} · act_{a.id}
                </span>
              </label>
            ))}
            <button type="submit" disabled={busy || !picked} className="rounded-lg bg-slate-900 px-3 py-1.5 font-semibold text-white disabled:opacity-50">
              {t.save}
            </button>
          </form>
        ) : (
          <div className="space-y-2" data-testid="meta-ads-connected">
            <p className="text-slate-700">
              {t.connectedTo} <strong className="text-slate-900">{c.adAccountName}</strong>
              <span className="ml-1 text-[11px] tabular-nums text-slate-400">act_{c.adAccountId}</span>
              {c.currency ? (
                <span className="ml-2 rounded-full bg-slate-100 px-2 py-0.5 text-[11px] text-slate-600">
                  {t.currency}: {c.currency}
                </span>
              ) : null}
            </p>
            {needsReconnect ? (
              <p className="rounded-xl bg-amber-50 px-3 py-2 text-amber-900" data-testid="meta-ads-reconnect">
                {c.status === 'missing_permission' ? t.missingPermission : t.expired}
              </p>
            ) : c.daysLeft !== null && c.daysLeft <= 14 ? (
              <p className="text-amber-800">{t.expiresIn(c.daysLeft)}</p>
            ) : null}

            <form
              onSubmit={(e) => {
                e.preventDefault()
                void run(() => call('POST', { action: 'fx', rate: fx.trim() || null }), t.saved)
              }}
              className="rounded-xl bg-slate-50 px-3 py-2.5"
            >
              <p className="font-medium text-slate-700">{t.fxTitle}</p>
              <p className="mt-0.5 text-[11.5px] text-slate-500">{t.fxHelp(c.currency ?? 'USD')}</p>
              <div className="mt-2 flex items-center gap-2">
                <span className="text-[11.5px] text-slate-500">1 {c.currency ?? 'USD'} =</span>
                <input
                  inputMode="decimal"
                  value={fx}
                  onChange={(e) => setFx(e.target.value)}
                  placeholder={t.fxPlaceholder}
                  className="w-28 rounded-lg border border-slate-200 px-2 py-1 text-[12.5px] tabular-nums"
                  aria-label={t.fxTitle}
                  data-testid="meta-ads-fx"
                />
                <button type="submit" disabled={busy} className="rounded-lg bg-white px-2.5 py-1 text-slate-700 ring-1 ring-slate-200 hover:bg-slate-50 disabled:opacity-50">
                  {t.save}
                </button>
              </div>
            </form>
          </div>
        )}

        {c ? (
          <div className="flex flex-wrap items-center gap-2 pt-1">
            {needsReconnect || c.status === 'pending_pick' ? (
              <button type="button" onClick={() => void connect()} disabled={busy} className="inline-flex items-center gap-1.5 rounded-lg bg-[#1877F2] px-3 py-1.5 font-semibold text-white disabled:opacity-60">
                <RefreshCw className="h-3.5 w-3.5" aria-hidden /> {t.reconnect}
              </button>
            ) : null}
            {confirming ? (
              <span className="inline-flex flex-wrap items-center gap-2 rounded-lg bg-red-50 px-2.5 py-1.5 text-red-800" data-testid="meta-ads-disconnect-confirm">
                {t.disconnectConfirm}
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    setConfirming(false)
                    void run(() => call('DELETE'))
                  }}
                  className="rounded-md bg-red-600 px-2 py-0.5 font-semibold text-white disabled:opacity-60"
                >
                  {t.yesDisconnect}
                </button>
                <button type="button" onClick={() => setConfirming(false)} className="rounded-md px-2 py-0.5 text-red-800 hover:bg-red-100">
                  {t.cancel}
                </button>
              </span>
            ) : (
              <button type="button" onClick={() => setConfirming(true)} disabled={busy} className="rounded-lg px-2.5 py-1.5 text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50" data-testid="meta-ads-disconnect">
                {t.disconnect}
              </button>
            )}
          </div>
        ) : null}

        {message ? <p className="text-emerald-700">{message}</p> : null}
        {error ? <p className="text-red-700">{error}</p> : null}
      </div>
    </section>
  )
}
