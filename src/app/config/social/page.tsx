'use client'

import { useState, useEffect } from 'react'
import { useSession } from 'next-auth/react'
import { useRouter } from 'next/navigation'
import { getInstagramAuthUrl } from '@/lib/instagram-oauth'

interface SocialAccount {
  id: string
  platform: string
  accountId: string
  linkedAt: string
  isActive: boolean
}

export default function SocialConfigPage() {
  const { data: session } = useSession()
  const router = useRouter()
  const [accounts, setAccounts] = useState<SocialAccount[]>([])
  const [loading, setLoading] = useState(true)
  const [linking, setLinking] = useState(false)

  // WhatsApp manual link form
  const [platform, setPlatform] = useState<'whatsapp' | 'instagram'>('whatsapp')
  const [accountId, setAccountId] = useState('')
  const [accessToken, setAccessToken] = useState('')
  const [showWhatsAppGuide, setShowWhatsAppGuide] = useState(false)
  const [validationError, setValidationError] = useState('')
  const [unlinking, setUnlinking] = useState<string | null>(null)
  const [resubscribing, setResubscribing] = useState<string | null>(null)
  const [fbReady, setFbReady] = useState(false)
  const META_APP_ID = process.env.NEXT_PUBLIC_META_APP_ID as string | undefined
  const FB_LOGIN_CONFIG_ID = process.env.NEXT_PUBLIC_FB_LOGIN_CONFIG_ID as string | undefined

  const isOwnerOrMaster = session?.user?.membershipRole === 'OWNER' || session?.user?.role === 'MASTER'

  useEffect(() => {
    // Wait for session to load before checking permissions
    if (!session) return
    
    if (!isOwnerOrMaster) {
      router.push('/')
      return
    }
    fetchAccounts()
  }, [session, isOwnerOrMaster, router])

  // Load Facebook JS SDK once for Embedded Signup
  useEffect(() => {
    if (typeof window === 'undefined') return
    if ((window as any).FB) { setFbReady(true); return }
    const script = document.createElement('script')
    script.async = true
    script.defer = true
    script.crossOrigin = 'anonymous'
    script.src = 'https://connect.facebook.net/en_US/sdk.js'
    script.onload = () => {
      ;(window as any).fbAsyncInit = function () {
        ;(window as any).FB.init({
          appId: META_APP_ID || '',
          autoLogAppEvents: true,
          xfbml: true,
          version: 'v21.0',
        })
        setFbReady(true)
      }
    }
    document.body.appendChild(script)
  }, [META_APP_ID])

  // Capture WA Embedded Signup message events (IDs + signals)
  // Per Meta guidelines: parse JSON and check for WA_EMBEDDED_SIGNUP type
  useEffect(() => {
    function onMessage(event: MessageEvent) {
      if (!String(event.origin).endsWith('facebook.com')) return
      try {
        const data = typeof event.data === 'string' ? JSON.parse(event.data) : event.data
        if (data?.type === 'WA_EMBEDDED_SIGNUP') {
          console.log('[WA Embedded Signup] Message event:', data)
          // Send to backend for processing
          fetch('/api/auth/whatsapp/exchange', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ message: data }),
          }).catch(() => {})
        }
      } catch (err) {
        console.log('[WA Embedded Signup] Message parse error:', err)
      }
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [])

  function launchWhatsAppEmbeddedSignup() {
    const FB = (window as any).FB
    if (!FB || !FB_LOGIN_CONFIG_ID) {
      alert('⚠️ Configuración de Facebook incompleta. Falta FB SDK o CONFIG_ID.\n\nVerifica que NEXT_PUBLIC_META_APP_ID y NEXT_PUBLIC_FB_LOGIN_CONFIG_ID estén configurados.')
      return
    }
    
    // DIAGNOSTIC: Intercept Facebook postMessages to see OAuth details
    const messageListener = (event: MessageEvent) => {
      if (event.origin.includes('facebook.com')) {
        console.log('🔍 [DIAGNOSTIC] Facebook postMessage:', {
          origin: event.origin,
          data: event.data,
          fullEvent: JSON.stringify(event.data, null, 2)
        })
      }
    }
    window.addEventListener('message', messageListener, false)
    
    // DIAGNOSTIC: Log fetch requests without intercepting (to avoid CSP issues)
    if (!(window as any).__fbFetchLogged) {
      const originalFetch = window.fetch
      window.fetch = function(...args: any[]) {
        const url = typeof args[0] === 'string' ? args[0] : args[0]?.url
        if (url && (url.includes('facebook.com') || url.includes('oauth'))) {
          // Log but don't interfere
          setTimeout(() => {
            console.log('🔍 [DIAGNOSTIC] OAuth Request detected:', url)
          }, 0)
        }
        return originalFetch.apply(this, args as any)
      }
      ;(window as any).__fbFetchLogged = true
    }
    
    console.log('[WA Embedded Signup] Launching FB.login', {
      configId: FB_LOGIN_CONFIG_ID,
      appId: META_APP_ID
    })
    
    const cb = (response: any) => {
      console.log('[WA Embedded Signup] FB.login callback received', response)
      
      // Handle response asynchronously but don't make the callback itself async
      const handleResponse = async () => {
        try {
          // Check for user cancellation or errors
          if (!response || response.status === 'unknown') {
            console.warn('[WA Embedded Signup] User closed dialog or not logged in')
            alert('⚠️ Proceso cancelado. Por favor, intenta nuevamente.')
            return
          }
          
          if (response.error) {
            console.error('[WA Embedded Signup] FB.login error:', response.error)
            alert(`❌ Error de Facebook: ${response.error.message || 'Error desconocido'}`)
            return
          }
          
          // Check if we got a token directly or a code
          const accessToken = response?.authResponse?.accessToken
          const code = response?.authResponse?.code
          
          if (!accessToken && !code) {
            console.error('[WA Embedded Signup] No token or code received', response)
            alert('❌ No se recibió token ni código de autorización.')
            return
          }
          
          if (accessToken) {
            console.log('[WA Embedded Signup] Access token received directly!', {
              tokenPrefix: accessToken.substring(0, 20) + '...',
              expiresIn: response.authResponse.expiresIn
            })
          } else {
            console.log('[WA Embedded Signup] Authorization code received', {
              codeLength: code.length,
              codePrefix: code.substring(0, 10) + '...'
            })
          }
          
          // Send to backend (works with both token and code)
          const exchangeRes = await fetch('/api/auth/whatsapp/exchange', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
              code: code || undefined,
              accessToken: accessToken || undefined
            }),
          })
          
          const exchangeData = await exchangeRes.json()
          console.log('[WA Embedded Signup] Exchange response:', exchangeData)
          
          if (!exchangeRes.ok || !exchangeData.success) {
            console.error('[WA Embedded Signup] Token exchange failed', exchangeData)
            const errorMsg = exchangeData.exchangeError?.errorMessage || exchangeData.message || 'Error desconocido'
            const errorCode = exchangeData.exchangeError?.errorCode
            const errorSubcode = exchangeData.exchangeError?.errorSubcode
            
            let userMessage = `❌ Error al conectar WhatsApp:\n${errorMsg}`
            
            if (errorCode === 100 && errorSubcode === 36008) {
              userMessage += '\n\n🔍 Error de configuración: Redirect URI mismatch.\nContacta al administrador del sistema.'
            } else if (errorCode === 190) {
              userMessage += '\n\n⏱️ El código de autorización expiró (30 segundos).\nIntenta nuevamente más rápido.'
            } else if (errorCode === 191) {
              userMessage += '\n\n🌐 Dominio no autorizado.\nVerifica la configuración en Meta Dashboard.'
            }
            
            alert(userMessage)
            return
          }
          
          console.log('[WA Embedded Signup] ✅ Success!', exchangeData)
          alert('✅ WhatsApp conectado exitosamente!')
          fetchAccounts()
          
        } catch (err: any) {
          console.error('[WA Embedded Signup] Unexpected error:', err)
          alert(`❌ Error inesperado: ${err.message || 'Error desconocido'}\n\nRevisa la consola para más detalles.`)
        }
      }
      
      // Execute the async handler without making the callback async
      handleResponse()
    }
    
    // Launch FB.login with Embedded Signup configuration
    // EXPERT RECOMMENDATION: Add auth_type and return_scopes
    console.log('[WA Embedded Signup] Calling FB.login with enhanced options')
    FB.login(cb, {
      config_id: FB_LOGIN_CONFIG_ID,
      response_type: 'code',
      override_default_response_type: true,
      auth_type: 'rerequest', // Force re-authentication to get fresh code
      return_scopes: true, // Return granted scopes in response
      extras: { setup: {} },
    })
  }

  async function fetchAccounts() {
    try {
      const res = await fetch('/api/chat/accounts')
      const json = await res.json()
      if (json.success) setAccounts(json.accounts)
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : 'Error al cargar cuentas sociales'
      alert(message)
    } finally {
      setLoading(false)
    }
  }

  async function handleLinkInstagram() {
    try {
      // Fetch auth URL from server (to access environment variables)
      const res = await fetch('/api/auth/instagram/auth-url')
      if (!res.ok) {
        throw new Error('Failed to get Instagram auth URL')
      }
      const { authUrl } = await res.json()
      
      // Open popup
      const popup = window.open(authUrl, 'instagram_oauth', 'width=600,height=700')
      if (!popup) {
        alert('No se pudo abrir la ventana de inicio de sesión')
        return
      }
      // Poll for closure (simple approach)
      const checkClosed = setInterval(() => {
        if (popup.closed) {
          clearInterval(checkClosed)
          fetchAccounts()
          alert('Recargando cuentas...')
        }
      }, 1000)
    } catch (error) {
      console.error('Error launching Instagram OAuth:', error)
      alert('Error al iniciar sesión con Instagram')
    }
  }

  async function handleLinkWhatsApp(e: React.FormEvent) {
    e.preventDefault()
    setValidationError('')
    
    // Validation
    if (!accountId.trim()) {
      setValidationError('El Phone Number ID es requerido')
      return
    }
    if (!accessToken.trim()) {
      setValidationError('El Access Token es requerido')
      return
    }
    if (accountId.length < 10) {
      setValidationError('El Phone Number ID debe tener al menos 10 caracteres')
      return
    }
    
    setLinking(true)
    try {
      const res = await fetch('/api/social/link', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ platform, accountId: accountId.trim(), accessToken: accessToken.trim() })
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || 'Error desconocido')
      alert('✅ Cuenta de WhatsApp vinculada exitosamente')
      setAccountId('')
      setAccessToken('')
      setValidationError('')
      fetchAccounts()
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : 'Error al vincular WhatsApp'
      setValidationError(message)
    } finally {
      setLinking(false)
    }
  }

  async function handleUnlinkAccount(accountId: string, platform: string) {
    if (!confirm(`¿Estás seguro de que deseas desvincular esta cuenta de ${platform}? Se eliminarán todos los mensajes asociados.`)) {
      return
    }
    
    setUnlinking(accountId)
    try {
      const res = await fetch(`/api/social/unlink?id=${accountId}`, {
        method: 'DELETE'
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || 'Error desconocido')
      alert('✅ Cuenta desvinculada exitosamente')
      fetchAccounts()
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : 'Error al desvincular cuenta'
      alert(message)
    } finally {
      setUnlinking(null)
    }
  }

  async function handleResubscribe(accountId: string) {
    setResubscribing(accountId)
    try {
      const res = await fetch('/api/social/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: accountId })
      })
      const json = await res.json()
      if (!res.ok || json.success === false) {
        const msg = json?.message || json?.error || 'No se pudo re-suscribir'
        alert(`⚠️ ${msg}`)
      } else {
        alert('✅ Re-suscripción realizada')
      }
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : 'Error al re-suscribir'
      alert(message)
    } finally {
      setResubscribing(null)
    }
  }

  if (!session) return null
  if (!isOwnerOrMaster) {
    return <div className="p-8 text-center text-muted-foreground">No tienes permisos para configurar cuentas sociales.</div>
  }

  return (
    <div className="max-w-4xl mx-auto p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Configuración de Cuentas Sociales</h1>
        <p className="text-muted-foreground">Aquí puedes vincular WhatsApp e Instagram para gestionar chats desde Betsy.</p>
      </div>

      {/* Instagram Setup */}
      <div className="border rounded-lg p-6 bg-card shadow-sm">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-xl font-semibold flex items-center gap-2">
              <span className="text-2xl">📸</span>
              Instagram Business
            </h2>
            <p className="text-sm text-muted-foreground mt-1">Conecta tu cuenta de Instagram Business para gestionar DMs</p>
          </div>
        </div>

        <div className="mb-6 p-4 bg-gradient-to-r from-purple-50 to-pink-50 rounded-lg border border-purple-200">
          <h3 className="font-semibold text-purple-900 mb-3">📋 Requisitos previos:</h3>
          <ul className="space-y-2 text-sm text-purple-900">
            <li className="flex gap-2">
              <span>✓</span>
              <span>Cuenta de <strong>Instagram Business</strong> (no personal)</span>
            </li>
            <li className="flex gap-2">
              <span>✓</span>
              <span>Página de Facebook vinculada a tu Instagram</span>
            </li>
            <li className="flex gap-2">
              <span>✓</span>
              <span>Permisos de administrador en la página de Facebook</span>
            </li>
          </ul>
          <div className="mt-3 pt-3 border-t border-purple-200">
            <p className="text-xs text-purple-800">
              💡 <strong>Tip:</strong> Si no tienes una cuenta Business, ve a tu perfil de Instagram → Configuración → Cambiar a cuenta profesional
            </p>
          </div>
        </div>

        <button
          onClick={handleLinkInstagram}
          className="w-full bg-gradient-to-r from-purple-600 to-pink-600 text-white px-6 py-3 rounded-lg hover:from-purple-700 hover:to-pink-700 font-medium transition-all flex items-center justify-center gap-2"
        >
          <span>🔗</span>
          Conectar con Facebook/Instagram
        </button>
        <p className="text-xs text-muted-foreground mt-2 text-center">
          Se abrirá una ventana para iniciar sesión con Facebook y autorizar el acceso a Instagram
        </p>
      </div>

      {/* WhatsApp Setup */}
      <div className="border rounded-lg p-6 bg-card shadow-sm">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-xl font-semibold flex items-center gap-2">
              <span className="text-2xl">💬</span>
              WhatsApp Business API
            </h2>
            <p className="text-sm text-muted-foreground mt-1">Conecta tu número de WhatsApp Business para recibir y enviar mensajes</p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={launchWhatsAppEmbeddedSignup}
              disabled={!fbReady || !FB_LOGIN_CONFIG_ID}
              className={`text-white text-sm font-medium px-4 py-2 rounded-lg ${(!fbReady || !FB_LOGIN_CONFIG_ID) ? 'bg-blue-300 cursor-not-allowed' : 'bg-blue-600 hover:bg-blue-700'}`}
            >
              Conectar con Facebook (WhatsApp)
            </button>
            {(!fbReady || !FB_LOGIN_CONFIG_ID) && (
              <span className="text-xs text-muted-foreground">{!FB_LOGIN_CONFIG_ID ? 'Falta CONFIG_ID' : 'Cargando SDK...'}</span>
            )}
          </div>
          <button
            onClick={() => setShowWhatsAppGuide(!showWhatsAppGuide)}
            className="text-blue-600 hover:text-blue-700 text-sm font-medium"
          >
            {showWhatsAppGuide ? '✕ Cerrar guía' : '📖 Ver guía de configuración'}
          </button>
        </div>

        {showWhatsAppGuide && (
          <div className="mb-6 p-4 bg-blue-50 rounded-lg border border-blue-200">
            <h3 className="font-semibold text-blue-900 mb-3">📋 Guía paso a paso:</h3>
            <ol className="space-y-3 text-sm text-blue-900">
              <li className="flex gap-2">
                <span className="font-bold min-w-[20px]">1.</span>
                <div>
                  <div>Ve a <a href="https://developers.facebook.com/apps" target="_blank" rel="noopener" className="underline font-semibold">Meta for Developers</a></div>
                </div>
              </li>
              <li className="flex gap-2">
                <span className="font-bold min-w-[20px]">2.</span>
                <div>
                  <div className="font-semibold mb-1">Obtener Phone Number ID:</div>
                  <ul className="ml-4 space-y-1 text-xs">
                    <li>• Selecciona tu app → <strong>WhatsApp</strong> → <strong>API Setup</strong></li>
                    <li>• En la sección &quot;Send and receive messages&quot;, verás tu número de prueba</li>
                    <li>• Debajo del número, copia el <strong>Phone number ID</strong> (empieza con números largos)</li>
                    <li>• <span className="bg-yellow-100 px-1">Ejemplo: 123456789012345</span></li>
                  </ul>
                </div>
              </li>
              <li className="flex gap-2">
                <span className="font-bold min-w-[20px]">3.</span>
                <div>
                  <div className="font-semibold mb-1">Obtener Access Token:</div>
                  <ul className="ml-4 space-y-1 text-xs">
                    <li>• En la misma página, busca &quot;Temporary access token&quot;</li>
                    <li>• Click en <strong>Copy</strong> para copiar el token</li>
                    <li>• <span className="text-orange-700">⚠️ Este token expira en 24 horas (solo para pruebas)</span></li>
                    <li>• Para producción: Ve a <strong>Business Settings</strong> → <strong>System Users</strong> → Crea un token permanente</li>
                  </ul>
                </div>
              </li>
              <li className="flex gap-2">
                <span className="font-bold min-w-[20px]">4.</span>
                <span>Pega ambos valores en el formulario abajo y haz click en <strong>Vincular</strong></span>
              </li>
            </ol>
            <div className="mt-4 pt-3 border-t border-blue-200">
              <p className="text-xs text-blue-800 mb-2">
                💡 <strong>Tips importantes:</strong>
              </p>
              <ul className="text-xs text-blue-800 space-y-1 ml-4">
                <li>• El Phone Number ID NO es tu número de teléfono, es un ID único de Meta</li>
                <li>• Para producción, usa un System User Token (no expira)</li>
                <li>• Puedes agregar múltiples números de WhatsApp creando tokens para cada uno</li>
              </ul>
            </div>
          </div>
        )}

        <div className="mb-4 p-3 bg-amber-50 border border-amber-200 rounded-lg">
          <p className="text-sm text-amber-800">
            <strong>💡 Nota:</strong> Por ahora necesitas el Phone Number ID de Meta. Una vez que tu app esté verificada y en modo Live, podrás usar solo el número de teléfono.
          </p>
        </div>

        <form onSubmit={handleLinkWhatsApp} className="space-y-4">
          <div>
            <label htmlFor="accountId" className="block text-sm font-semibold mb-2">
              Phone Number ID <span className="text-red-500">*</span>
            </label>
            <input
              id="accountId"
              type="text"
              value={accountId}
              onChange={(e) => {
                setAccountId(e.target.value)
                setValidationError('')
              }}
              className="border border-border rounded-lg px-4 py-3 w-full focus:ring-2 focus:ring-green-500 focus:border-transparent"
              placeholder="123456789012345"
              disabled={linking}
            />
            <p className="text-xs text-muted-foreground mt-1">
              Copia esto de Meta Dashboard → WhatsApp → API Setup (debajo de tu número de prueba)
            </p>
          </div>

          <div>
            <label htmlFor="accessToken" className="block text-sm font-semibold mb-2">
              Access Token <span className="text-red-500">*</span>
            </label>
            <input
              id="accessToken"
              type="password"
              value={accessToken}
              onChange={(e) => {
                setAccessToken(e.target.value)
                setValidationError('')
              }}
              className="border border-border rounded-lg px-4 py-3 w-full focus:ring-2 focus:ring-green-500 focus:border-transparent font-mono text-sm"
              placeholder="EAAxxxxxxxxxxxxxxxxxxxxxxxxx"
              disabled={linking}
            />
            <p className="text-xs text-muted-foreground mt-1">Token de acceso permanente de Meta (System User Token recomendado)</p>
          </div>

          {validationError && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-lg">
              <p className="text-sm text-red-700 flex items-center gap-2">
                <span>⚠️</span>
                {validationError}
              </p>
            </div>
          )}

          <button
            type="submit"
            disabled={linking}
            className="w-full bg-green-600 text-white px-6 py-3 rounded-lg hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed font-medium transition-colors flex items-center justify-center gap-2"
          >
            {linking ? (
              <>
                <span className="animate-spin">⏳</span>
                Vinculando...
              </>
            ) : (
              <>
                <span>✓</span>
                Vincular WhatsApp Business
              </>
            )}
          </button>
        </form>
      </div>

      {/* Linked Accounts */}
      <div className="border rounded p-4">
        <h2 className="text-lg font-semibold mb-2">Cuentas vinculadas</h2>
        <p className="text-sm text-muted-foreground mb-4">Lista de cuentas sociales conectadas a este tenant.</p>
        {loading ? (
          <div className="text-muted-foreground">Cargando...</div>
        ) : accounts.length === 0 ? (
          <div className="text-muted-foreground">No hay cuentas vinculadas aún.</div>
        ) : (
          <div className="space-y-3">
            {accounts.map((acc) => (
              <div key={acc.id} className="flex items-center justify-between p-4 border rounded-lg bg-card shadow-sm">
                <div className="flex items-center gap-4">
                  <div className="text-3xl">
                    {acc.platform === 'whatsapp' ? '💬' : '📸'}
                  </div>
                  <div>
                    <div className="font-semibold capitalize text-lg">{acc.platform}</div>
                    <div className="text-sm text-muted-foreground">ID: {acc.accountId}</div>
                    <div className="text-xs text-muted-foreground">Vinculada: {new Date(acc.linkedAt).toLocaleDateString('es')}</div>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <div className={`text-xs px-3 py-1 rounded-full font-medium ${acc.isActive ? 'bg-green-100 text-green-800' : 'bg-muted text-foreground'}`}>
                    {acc.isActive ? '✓ Activa' : 'Inactiva'}
                  </div>
                  <button
                    onClick={() => handleResubscribe(acc.id)}
                    disabled={resubscribing === acc.id}
                    className="px-3 py-2 text-sm font-medium text-blue-600 hover:bg-blue-50 border border-blue-200 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {resubscribing === acc.id ? 'Re-suscribiendo...' : '🔄 Re-suscribir'}
                  </button>
                  <button
                    onClick={() => handleUnlinkAccount(acc.id, acc.platform)}
                    disabled={unlinking === acc.id}
                    className="px-4 py-2 text-sm font-medium text-red-600 hover:bg-red-50 border border-red-200 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {unlinking === acc.id ? 'Desvinculando...' : '🗑️ Desvincular'}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
