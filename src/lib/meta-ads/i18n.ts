'use client'

/**
 * ES / EN for the ad account card and the ad spend & ROAS card only (Meta's ads_read screencast must be in
 * English). Spanish by default; the saved choice is applied after mount, so server and first client render match.
 */
import { useCallback, useEffect, useState } from 'react'

export type AdsLang = 'es' | 'en'
const KEY = 'betsy-ads-lang'
const EVENT = 'betsy-ads-lang'

export function useAdsLang(): [AdsLang, (lang: AdsLang) => void] {
  const [lang, setLang] = useState<AdsLang>('es')
  useEffect(() => {
    try {
      if (window.localStorage.getItem(KEY) === 'en') setLang('en')
    } catch {
      /* storage blocked: Spanish */
    }
    const onChange = (e: Event) => setLang((e as CustomEvent<AdsLang>).detail === 'en' ? 'en' : 'es')
    window.addEventListener(EVENT, onChange)
    return () => window.removeEventListener(EVENT, onChange)
  }, [])
  const update = useCallback((next: AdsLang) => {
    setLang(next)
    try {
      window.localStorage.setItem(KEY, next)
    } catch {
      /* not saved */
    }
    window.dispatchEvent(new CustomEvent<AdsLang>(EVENT, { detail: next }))
  }, [])
  return [lang, update]
}

const ES = {
  langLabel: 'Idioma',
  // Card
  cardTitle: 'Cuenta publicitaria (Meta Ads)',
  cardSubtitle: 'Betsy lee lo que gastás en tus anuncios (solo lectura) para mostrarte cuánto vendió cada uno.',
  readOnly: 'Solo lectura: Betsy nunca crea, cambia ni paga anuncios.',
  connect: 'Conectar cuenta publicitaria',
  reconnect: 'Volver a conectar',
  disconnect: 'Desconectar',
  disconnectConfirm: '¿Desconectar? Betsy deja de leer tu gasto y borra el acceso.',
  yesDisconnect: 'Sí, desconectar',
  cancel: 'Cancelar',
  pickTitle: 'Elegí la cuenta publicitaria de este negocio',
  save: 'Guardar',
  connectedTo: 'Conectada a',
  currency: 'Moneda',
  expiresIn: (d: number) => `El acceso vence en ${d} días: volvé a conectar antes.`,
  expired: 'El acceso venció o fue revocado. Volvé a conectar.',
  missingPermission: 'Falta el permiso para leer anuncios (ads_read). Volvé a conectar y aceptalo.',
  notConfigured: 'La conexión con Meta Ads todavía no está configurada en Betsy.',
  unavailable: 'Esta función todavía no está activa.',
  fxTitle: 'Tipo de cambio (opcional)',
  fxHelp: (ad: string) => `Si tu cuenta publicitaria cobra en ${ad} y tu tienda vende en otra moneda, poné cuánto vale 1 ${ad} en la moneda de tu tienda para calcular el ROAS. Es una estimación tuya.`,
  fxPlaceholder: 'Ej. 510',
  results: {
    connected: 'Cuenta publicitaria conectada.',
    pick: 'Conectado. Ahora elegí la cuenta publicitaria.',
    cancelled: 'Cancelaste la conexión con Meta.',
    no_permission: 'Meta no dio el permiso para leer anuncios. Volvé a intentar y aceptalo.',
    no_accounts: 'Tu usuario de Facebook no tiene cuentas publicitarias que Betsy pueda leer.',
    state: 'La conexión expiró o se inició desde otro negocio. Volvé a intentar.',
    signin: 'Iniciá sesión en Betsy y volvé a intentar.',
    forbidden: 'Necesitás permiso de configuración para conectar la cuenta.',
    unavailable: 'Esta función todavía no está activa.',
    error: 'No se pudo conectar con Meta. Volvé a intentar.',
  } as Record<string, string>,
  // Report
  roasTitle: 'Gasto en anuncios y ROAS',
  roasSubtitle: 'Lo que gastaste en Meta por anuncio contra lo que vendió en Betsy',
  connectCta: 'Conectá tu cuenta publicitaria para ver cuánto gastaste y el ROAS de cada anuncio.',
  connectLink: 'Conectar en Configuración',
  pickCta: 'Elegí tu cuenta publicitaria en Configuración para ver el gasto.',
  problemCta: 'No pudimos leer tu cuenta publicitaria.',
  rateLimited: 'Meta pidió esperar un momento. Probá de nuevo en unos minutos.',
  colAd: 'Campaña · conjunto · anuncio',
  colSpend: 'Gasto',
  colImpressions: 'Impresiones',
  colClicks: 'Clics',
  colOrders: 'Pedidos',
  colRevenueBooked: 'Vendido',
  colRevenueCollected: 'Cobrado',
  colRoas: 'ROAS',
  total: 'Total',
  noSpend: 'No hubo gasto en anuncios en estas fechas.',
  unnamed: 'Anuncio',
  roasHelp: 'ROAS = ventas ÷ gasto. 3,0× quiere decir que por cada 1 que gastaste vendiste 3.',
  mismatch: (ad: string, store: string) =>
    `Tu cuenta publicitaria cobra en ${ad} y tu tienda vende en ${store}: poné un tipo de cambio en Configuración para ver el ROAS.`,
  fxUsed: (rate: number, ad: string, store: string) => `ROAS calculado con tu tipo de cambio: 1 ${ad} = ${rate} ${store}.`,
  tzNote: (tz: string) => `El gasto usa la zona horaria de tu cuenta publicitaria (${tz}).`,
  windowNote: 'El gasto es por fecha de entrega del anuncio; los pedidos por el último anuncio tocado en los 7 días anteriores.',
  truncated: 'Hay más anuncios con gasto de los que mostramos.',
  withoutSpend: (ads: number, revenue: string) => `Además, ${ads} anuncio(s) sin gasto en esta cuenta en estas fechas vendieron ${revenue} (otra cuenta publicitaria o gasto de antes). No cuentan en el ROAS total.`,
  saved: 'Guardado.',
}

const EN: typeof ES = {
  langLabel: 'Language',
  cardTitle: 'Ad account (Meta Ads)',
  cardSubtitle: 'Betsy reads what you spend on your ads (read-only) to show how much each ad sold.',
  readOnly: 'Read-only: Betsy never creates, edits or pays for ads.',
  connect: 'Connect ad account',
  reconnect: 'Reconnect',
  disconnect: 'Disconnect',
  disconnectConfirm: 'Disconnect? Betsy stops reading your spend and deletes the access.',
  yesDisconnect: 'Yes, disconnect',
  cancel: 'Cancel',
  pickTitle: "Choose this business's ad account",
  save: 'Save',
  connectedTo: 'Connected to',
  currency: 'Currency',
  expiresIn: (d: number) => `Access expires in ${d} days: reconnect before then.`,
  expired: 'Access expired or was revoked. Reconnect.',
  missingPermission: 'The permission to read ads (ads_read) is missing. Reconnect and accept it.',
  notConfigured: 'The Meta Ads connection is not set up in Betsy yet.',
  unavailable: 'This feature is not active yet.',
  fxTitle: 'Exchange rate (optional)',
  fxHelp: (ad: string) => `If your ad account bills in ${ad} and your store sells in another currency, enter what 1 ${ad} is worth in your store's currency to calculate ROAS. It is your own estimate.`,
  fxPlaceholder: 'e.g. 510',
  results: {
    connected: 'Ad account connected.',
    pick: 'Connected. Now choose the ad account.',
    cancelled: 'You cancelled the Meta connection.',
    no_permission: 'Meta did not grant the permission to read ads. Try again and accept it.',
    no_accounts: 'Your Facebook user has no ad accounts Betsy can read.',
    state: 'The connection expired or was started from another business. Try again.',
    signin: 'Sign in to Betsy and try again.',
    forbidden: 'You need settings permission to connect the account.',
    unavailable: 'This feature is not active yet.',
    error: 'Could not connect to Meta. Try again.',
  },
  roasTitle: 'Ad spend & ROAS',
  roasSubtitle: 'What you spent on Meta per ad vs. what it sold in Betsy',
  connectCta: 'Connect your ad account to see what you spent and the ROAS of each ad.',
  connectLink: 'Connect in Settings',
  pickCta: 'Choose your ad account in Settings to see spend.',
  problemCta: 'We could not read your ad account.',
  rateLimited: 'Meta asked us to wait. Try again in a few minutes.',
  colAd: 'Campaign · ad set · ad',
  colSpend: 'Spend',
  colImpressions: 'Impressions',
  colClicks: 'Clicks',
  colOrders: 'Orders',
  colRevenueBooked: 'Revenue',
  colRevenueCollected: 'Collected',
  colRoas: 'ROAS',
  total: 'Total',
  noSpend: 'No ad spend in these dates.',
  unnamed: 'Ad',
  roasHelp: 'ROAS = revenue ÷ spend. 3.0× means every 1 you spent brought 3 in sales.',
  mismatch: (ad: string, store: string) =>
    `Your ad account bills in ${ad} and your store sells in ${store}: set an exchange rate in Settings to see ROAS.`,
  fxUsed: (rate: number, ad: string, store: string) => `ROAS uses your exchange rate: 1 ${ad} = ${rate} ${store}.`,
  tzNote: (tz: string) => `Spend uses your ad account's time zone (${tz}).`,
  windowNote: "Spend is by the ad's delivery date; orders by the last ad touched in the 7 days before.",
  truncated: 'There are more ads with spend than we show.',
  withoutSpend: (ads: number, revenue: string) => `Also, ${ads} ad(s) with no spend in this account for these dates sold ${revenue} (another ad account or earlier spend). Not counted in the total ROAS.`,
  saved: 'Saved.',
}

export function adsText(lang: AdsLang): typeof ES {
  return lang === 'en' ? EN : ES
}

