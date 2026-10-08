/**
 * SSRF-safe fetch for "Crear desde fuentes" (F3): the owner gives a website URL; Betsy reads public pages only.
 *  - http/https, ports 80/443 only, no credentials in the URL, no cookies sent.
 *  - DNS is resolved by us; if ANY address is private / loopback / link-local / metadata / multicast / reserved
 *    (IPv4 and IPv6, incl. IPv4-mapped, NAT64 and 6to4) the request is refused. The connection uses the address we
 *    checked (custom lookup), so DNS rebinding between check and connect is not possible. IP literals are checked
 *    directly (Node does not call lookup for them).
 *  - Redirects are followed by hand (≤3), every hop re-validated.
 *  - 10s timeout, 2 MB cap on DECOMPRESSED bytes, text/html or text/plain only.
 */
import 'server-only'

import http from 'node:http'
import https from 'node:https'
import net from 'node:net'
import dns from 'node:dns'
import zlib from 'node:zlib'

export class SafeFetchError extends Error {
  constructor(readonly code: string) {
    super(code)
    this.name = 'SafeFetchError'
  }
}

const blocked = new net.BlockList()
for (const [addr, prefix] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
] as const) {
  blocked.addSubnet(addr, prefix, 'ipv4')
}
for (const [addr, prefix] of [
  ['::', 128],
  ['::1', 128],
  ['fc00::', 7],
  ['fe80::', 10],
  ['ff00::', 8],
  ['2001:db8::', 32],
] as const) {
  blocked.addSubnet(addr, prefix, 'ipv6')
}

function embeddedIpv4(ipv6: string): string | null {
  const lower = ipv6.toLowerCase()
  // ::ffff:a.b.c.d (mapped), 64:ff9b::a.b.c.d (NAT64)
  const dotted = lower.match(/^(?:::ffff:|64:ff9b::)(\d+\.\d+\.\d+\.\d+)$/)
  if (dotted) return dotted[1]
  const hexMapped = lower.match(/^(?:::ffff:|64:ff9b::)([0-9a-f]{1,4}):([0-9a-f]{1,4})$/)
  if (hexMapped) {
    const hi = parseInt(hexMapped[1], 16)
    const lo = parseInt(hexMapped[2], 16)
    return `${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`
  }
  // 2002:AABB:CCDD::/16 (6to4)
  const sixToFour = lower.match(/^2002:([0-9a-f]{1,4}):([0-9a-f]{1,4})(:|$)/)
  if (sixToFour) {
    const hi = parseInt(sixToFour[1], 16)
    const lo = parseInt(sixToFour[2], 16)
    return `${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`
  }
  return null
}

/** True when an address must never be contacted. Unknown formats are blocked. */
export function isBlockedAddress(address: string): boolean {
  const family = net.isIP(address)
  if (family === 4) return blocked.check(address, 'ipv4')
  if (family === 6) {
    const v4 = embeddedIpv4(address)
    if (v4 && blocked.check(v4, 'ipv4')) return true
    return blocked.check(address, 'ipv6')
  }
  return true
}

export function validateUrl(raw: string): URL {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    throw new SafeFetchError('invalid_url')
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new SafeFetchError('protocol')
  if (url.username || url.password) throw new SafeFetchError('credentials')
  if (url.port && url.port !== '80' && url.port !== '443') throw new SafeFetchError('port')
  const host = url.hostname.replace(/^\[|\]$/g, '')
  if (!host || host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.internal') || host.endsWith('.local')) {
    throw new SafeFetchError('host')
  }
  if (net.isIP(host) && isBlockedAddress(host)) throw new SafeFetchError('blocked_address')
  return url
}

type LookupCallback = (err: NodeJS.ErrnoException | null, address: string | dns.LookupAddress[], family?: number) => void

/** dns lookup that refuses the host if any resolved address is blocked, and pins the connection to it. */
function safeLookup(hostname: string, options: dns.LookupOptions, callback: LookupCallback) {
  dns.lookup(hostname, { all: true, verbatim: true }, (err, addresses) => {
    if (err) return callback(err, '')
    const list = addresses as dns.LookupAddress[]
    if (!list.length || list.some((a) => isBlockedAddress(a.address))) {
      const e = new Error('blocked_address') as NodeJS.ErrnoException
      e.code = 'EBLOCKED'
      return callback(e, '')
    }
    if (options.all) return callback(null, list)
    callback(null, list[0].address, list[0].family)
  })
}

export type SafeFetchResult = { finalUrl: string; status: number; contentType: string; body: Buffer }

function requestOnce(url: URL, opts: { timeoutMs: number; maxBytes: number }): Promise<{ status: number; headers: http.IncomingHttpHeaders; body: Buffer }> {
  return new Promise((resolve, reject) => {
    const lib = url.protocol === 'https:' ? https : http
    const req = lib.request(
      url,
      {
        method: 'GET',
        lookup: safeLookup as unknown as typeof dns.lookup,
        headers: {
          'User-Agent': 'BetsyCRM-AgentStudio/1.0 (+https://www.betsycrm.com)',
          Accept: 'text/html,text/plain;q=0.9,*/*;q=0.1',
          'Accept-Encoding': 'gzip, deflate, br',
        },
        timeout: opts.timeoutMs,
      },
      (res) => {
        const status = res.statusCode || 0
        if (status >= 300 && status < 400) {
          res.resume()
          return resolve({ status, headers: res.headers, body: Buffer.alloc(0) })
        }
        const enc = String(res.headers['content-encoding'] || '').toLowerCase()
        let stream: NodeJS.ReadableStream = res
        if (enc === 'gzip') stream = res.pipe(zlib.createGunzip())
        else if (enc === 'deflate') stream = res.pipe(zlib.createInflate())
        else if (enc === 'br') stream = res.pipe(zlib.createBrotliDecompress())
        const chunks: Buffer[] = []
        let total = 0
        stream.on('data', (chunk: Buffer) => {
          total += chunk.length
          if (total > opts.maxBytes) {
            req.destroy(new SafeFetchError('too_large'))
            return
          }
          chunks.push(chunk)
        })
        stream.on('end', () => resolve({ status, headers: res.headers, body: Buffer.concat(chunks) }))
        stream.on('error', (e) => reject(e))
      },
    )
    req.on('timeout', () => req.destroy(new SafeFetchError('timeout')))
    req.on('error', (e: NodeJS.ErrnoException) => {
      if (e instanceof SafeFetchError) return reject(e)
      reject(new SafeFetchError(e.code === 'EBLOCKED' ? 'blocked_address' : 'network'))
    })
    req.end()
  })
}

export async function safeFetch(
  raw: string,
  opts: { maxBytes?: number; timeoutMs?: number; maxRedirects?: number } = {},
): Promise<SafeFetchResult> {
  const maxBytes = opts.maxBytes ?? 2_000_000
  const timeoutMs = opts.timeoutMs ?? 10_000
  const maxRedirects = opts.maxRedirects ?? 3
  let url = validateUrl(raw)
  for (let hop = 0; hop <= maxRedirects; hop += 1) {
    const res = await requestOnce(url, { timeoutMs, maxBytes })
    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.location
      if (!location || hop === maxRedirects) throw new SafeFetchError('redirects')
      url = validateUrl(new URL(String(location), url).toString())
      continue
    }
    const contentType = String(res.headers['content-type'] || '').toLowerCase()
    if (!/^text\/(html|plain)\b/.test(contentType) && !/^application\/xhtml\+xml\b/.test(contentType) && !/^application\/xml\b|^text\/xml\b/.test(contentType)) {
      throw new SafeFetchError('content_type')
    }
    return { finalUrl: url.toString(), status: res.status, contentType, body: res.body }
  }
  throw new SafeFetchError('redirects')
}
