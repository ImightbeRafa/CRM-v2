/**
 * Browser helper: sends bulk guía generation in chunks so a big batch never
 * hits the server time limit, and merges the answers into one result.
 */

export const BULK_CHUNK_SIZE = 10;

export interface BulkGuiaResponse {
  results: Array<{ success: boolean; orderId: string; guiaNumber?: string; trackingNumber?: string; error?: string; pdfDownloaded?: boolean }>;
  savedGuias: Array<Record<string, unknown>>;
  successful: number;
  failed: number;
}

export function chunk<T>(items: T[], size = BULK_CHUNK_SIZE): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

export async function generateBulkInChunks<T>(
  orders: T[],
  opts: { onProgress?: (done: number, total: number) => void; fetchImpl?: typeof fetch } = {},
): Promise<BulkGuiaResponse | { error: string; partial?: BulkGuiaResponse }> {
  const f = opts.fetchImpl ?? fetch;
  const merged: BulkGuiaResponse = { results: [], savedGuias: [], successful: 0, failed: 0 };
  let done = 0;
  opts.onProgress?.(0, orders.length);
  for (const part of chunk(orders)) {
    let data: any;
    try {
      const res = await f('/api/logistics/guias/generate-bulk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orders: part }),
      });
      data = await res.json().catch(() => ({}));
      if (!res.ok) {
        return { error: data?.error || 'Error generando guías', partial: done ? merged : undefined };
      }
    } catch (e) {
      return { error: e instanceof Error ? e.message : 'Error de conexión', partial: done ? merged : undefined };
    }
    merged.results.push(...(data?.data?.results ?? []));
    merged.savedGuias.push(...(data?.data?.savedGuias ?? []));
    merged.successful += Number(data?.data?.successful) || 0;
    merged.failed += Number(data?.data?.failed) || 0;
    done += part.length;
    opts.onProgress?.(done, orders.length);
  }
  return merged;
}
