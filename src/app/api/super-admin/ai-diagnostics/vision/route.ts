/**
 * POST /api/super-admin/ai-diagnostics/vision { model } — owner-only check that a model can read images
 * (F3 needs it for product photos). Sends a generated 4-color test image (no customer data) and checks the
 * answer. Betsy platform admins only (404 otherwise), same-origin, 3/min. Metered as feature 'vision'.
 */
import { NextRequest, NextResponse } from 'next/server'
import sharp from 'sharp'
import { authenticateAPI } from '@/lib/auth-helpers'
import { isSuperAdmin } from '@/lib/super-admin-helpers'
import { isSameOriginRequest } from '@/lib/same-origin'
import { createIdentifierRateLimit } from '@/lib/rate-limit'
import { describeImages, VISION_MODEL_CANDIDATES } from '@/lib/soft-ai/llm/vision'
import { aiErrorCode } from '@/lib/ai-usage/record'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
const NO_STORE = { 'Cache-Control': 'no-store' }
const visionDiagLimit = createIdentifierRateLimit({ windowMs: 60_000, maxRequests: 3, identifier: 'ai-diag-vision' })

const QUADRANTS = { topLeft: 'red', topRight: 'green', bottomLeft: 'blue', bottomRight: 'yellow' } as const
const RGB: Record<string, [number, number, number]> = { red: [220, 30, 30], green: [30, 170, 60], blue: [30, 60, 220], yellow: [240, 210, 30] }

async function testImage(): Promise<string> {
  const size = 256
  const half = size / 2
  const px = Buffer.alloc(size * size * 3)
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const key = y < half ? (x < half ? 'topLeft' : 'topRight') : x < half ? 'bottomLeft' : 'bottomRight'
      const [r, g, b] = RGB[QUADRANTS[key]]
      const i = (y * size + x) * 3
      px[i] = r
      px[i + 1] = g
      px[i + 2] = b
    }
  }
  const png = await sharp(px, { raw: { width: size, height: size, channels: 3 } }).png().toBuffer()
  return png.toString('base64')
}

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    topLeft: { type: 'string' },
    topRight: { type: 'string' },
    bottomLeft: { type: 'string' },
    bottomRight: { type: 'string' },
  },
  required: ['topLeft', 'topRight', 'bottomLeft', 'bottomRight'],
}

export async function POST(request: NextRequest) {
  const auth = await authenticateAPI(request)
  if (!auth.ok) return auth.response
  if (!(await isSuperAdmin(auth.userId))) return NextResponse.json({ error: 'Not found' }, { status: 404, headers: NO_STORE })
  if (!isSameOriginRequest(request)) return NextResponse.json({ error: 'Origen no permitido.' }, { status: 403, headers: NO_STORE })
  const rate = await visionDiagLimit(auth.userId)
  if (!rate.allowed) return NextResponse.json({ error: 'Esperá un momento.' }, { status: 429, headers: rate.headers })
  const body = (await request.json().catch(() => null)) as { model?: unknown } | null
  const model = typeof body?.model === 'string' ? body.model : VISION_MODEL_CANDIDATES[0]
  if (!(VISION_MODEL_CANDIDATES as readonly string[]).includes(model)) {
    return NextResponse.json({ error: 'Modelo no permitido' }, { status: 400, headers: NO_STORE })
  }
  const started = Date.now()
  try {
    const { text } = await describeImages({
      model,
      instructions: 'You check colors in an image. Answer only the JSON asked, with one English color word per field.',
      prompt: 'The image has four solid color squares. Name the color of each quadrant: red, green, blue or yellow.',
      images: [{ mime: 'image/png', base64: await testImage() }],
      schema: { name: 'quadrant_colors', schema: SCHEMA },
      usage: { tenantId: null, userId: auth.userId },
      maxOutputTokens: 900,
      timeoutMs: 30_000,
    })
    let answer: Record<string, string> = {}
    try {
      answer = JSON.parse(text)
    } catch {
      /* not JSON */
    }
    const pass = (Object.keys(QUADRANTS) as Array<keyof typeof QUADRANTS>).every(
      (k) => String(answer[k] || '').toLowerCase().includes(QUADRANTS[k]),
    )
    return NextResponse.json({ model, pass, latencyMs: Date.now() - started, answer }, { headers: NO_STORE })
  } catch (error) {
    return NextResponse.json(
      { model, pass: false, latencyMs: Date.now() - started, errorCode: aiErrorCode(error) },
      { headers: NO_STORE },
    )
  }
}
