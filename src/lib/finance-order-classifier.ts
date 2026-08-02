import { isTilopayOrder } from '@/lib/tilopay-fees';

/** Bump when classification rules change — consumers should re-bootstrap periods. */
export const FINANCE_ORDER_CLASSIFIER_VERSION = '1.0.1';

export type FinanceTenantSlug = 'deepsleep' | 'bloom';
export type FinanceBusinessSlug =
  | 'deepsleep'
  | 'patchhouse'
  | 'purasonrisa'
  | 'bloom'
  | 'unassigned';
export type FinanceChannelSlug = 'web' | 'messages';
export type FinanceConfidence = 'high' | 'medium' | 'low';

export type FinanceOrderClassification = {
  tenant: FinanceTenantSlug;
  business: FinanceBusinessSlug;
  channel: FinanceChannelSlug;
  businessRule: string;
  channelRule: string;
  confidence: FinanceConfidence;
  needsManualAssignment: boolean;
  classifierVersion: string;
};

export type FinanceOrderClassifyInput = {
  tenantSlug: FinanceTenantSlug;
  seller?: string | null;
  salesChannel?: string | null;
  product?: string | null;
  productDetails?: string | null;
  comments?: string | null;
  customFields?: unknown;
};

const WEB_SOURCE_TO_BUSINESS: Record<string, Exclude<FinanceBusinessSlug, 'unassigned' | 'bloom'>> = {
  'deepsleep website': 'deepsleep',
  'patchhouse website': 'patchhouse',
  'pura sonrisa cr website': 'purasonrisa',
};

const BLOOM_WEB_SOURCES = new Set(['sleeping patches cr website', 'bloom website']);

/** Sellers that indicate message/bot intake — never used for business. */
const MESSAGE_SELLER_ALIASES = [
  'whatsdeepsleep',
  'whatspatchhouse',
  'whatsbloom',
  'website confirmado',
  'website pago',
  'website ya pago',
  'laura',
  'compu ma',
  'rafael garcia',
  'rafa g',
  'rafa',
  'ian kupfer',
  'cuantas ventanas llevamos hoy?',
  'bloom',
  'hola',
];

type ProductHit = Exclude<FinanceBusinessSlug, 'unassigned' | 'bloom'>;

/** Primitive-only normalize — never call String() on objects (can throw). */
function normalize(value: unknown): string {
  if (value == null) return '';
  if (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'boolean') {
    return '';
  }
  try {
    return String(value)
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/\s+/g, ' ')
      .trim();
  } catch {
    return '';
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function getCustomSource(customFields: unknown): string | null {
  const obj = asRecord(customFields);
  if (!obj) return null;
  const source = normalize(obj.source);
  return source || null;
}

function collectProductTexts(product?: string | null, productDetails?: string | null): string[] {
  const texts: string[] = [];
  const flat = normalize(product);
  if (flat) texts.push(flat);

  if (!productDetails?.trim()) return texts;
  try {
    const parsed = JSON.parse(productDetails) as unknown;
    let list: unknown[] = [];
    if (Array.isArray(parsed)) list = parsed;
    else {
      const obj = asRecord(parsed);
      if (obj && Array.isArray(obj.products)) list = obj.products;
      else if (obj) list = [obj];
    }
    for (const item of list) {
      const row = asRecord(item);
      if (!row) continue;
      for (const key of ['name', 'product', 'nombre', 'title', 'sku', 'type'] as const) {
        const value = normalize(row[key]);
        if (value) texts.push(value);
      }
    }
  } catch {
    // ignore malformed productDetails
  }
  return texts;
}

function matchDeepSleepBusinessFromText(text: string): ProductHit | null {
  // PuraSonrisa — whitening / brand / flavors (typos included)
  if (
    /\bpura\s*sori/.test(text) ||
    /\bpura\s*sonrisa\b/.test(text) ||
    /\btira\s*blanqueadora\b/.test(text) ||
    /\bblanque/.test(text) ||
    /\bindividual\s*-/.test(text) ||
    /\b(strawberry|fresa|sandia|menta|mora|rasp|blue\s*rasp)\b/.test(text)
  ) {
    return 'purasonrisa';
  }

  // PatchHouse — patches / wellness lines / Spanish duo wording
  if (
    /\bpatch(house)?\b/.test(text) ||
    /\bparche/.test(text) ||
    /\bdopamine\b/.test(text) ||
    /\bdopamina\b/.test(text) ||
    /\bfocus\b/.test(text) ||
    /\benfoque\b/.test(text) ||
    /\bstress\b/.test(text) ||
    /\bestres\b/.test(text) ||
    /\bglp\b/.test(text) ||
    /\benergy\b/.test(text) ||
    /\benergia\b/.test(text) ||
    /\bnad\+?\b/.test(text) ||
    /\bfull\s*house\b/.test(text) ||
    /\bcombo\b/.test(text) ||
    /\bduo\b/.test(text)
  ) {
    return 'patchhouse';
  }

  // DeepSleep — mouthpieces / anti-snore (bucal / bucales)
  if (/\bbucal(?:es)?\b/.test(text) || /\bdeepsleep\b/.test(text) || /\bronqu/.test(text)) {
    return 'deepsleep';
  }

  return null;
}

function classifyDeepSleepBusiness(
  input: FinanceOrderClassifyInput,
): Pick<
  FinanceOrderClassification,
  'business' | 'businessRule' | 'confidence' | 'needsManualAssignment'
> {
  const source = getCustomSource(input.customFields);
  if (source && WEB_SOURCE_TO_BUSINESS[source]) {
    return {
      business: WEB_SOURCE_TO_BUSINESS[source],
      businessRule: `source:${source}`,
      confidence: 'high',
      needsManualAssignment: false,
    };
  }

  const texts = collectProductTexts(input.product, input.productDetails);
  const hits = new Set<ProductHit>();
  for (const text of texts) {
    // Skip opaque multi-item placeholders; source already handled web cases.
    if (text.includes('pedido multiple') || text.includes('pedido múltiple')) continue;
    const hit = matchDeepSleepBusinessFromText(text);
    if (hit) hits.add(hit);
  }

  if (hits.size === 1) {
    const business = [...hits][0]!;
    return {
      business,
      businessRule: 'product-alias',
      confidence: 'medium',
      needsManualAssignment: false,
    };
  }

  if (hits.size > 1) {
    return {
      business: 'unassigned',
      businessRule: 'conflict-product-multi-business',
      confidence: 'low',
      needsManualAssignment: true,
    };
  }

  return {
    business: 'unassigned',
    businessRule: 'unassigned-no-confident-match',
    confidence: 'low',
    needsManualAssignment: true,
  };
}

function isMessageSeller(seller: string | null | undefined): boolean {
  const s = normalize(seller);
  if (!s) return false;
  if (s.startsWith('whats')) return true;
  if (s === 'website') return false;
  return MESSAGE_SELLER_ALIASES.some((alias) => s === alias || s.startsWith(alias));
}

function classifyChannel(
  input: FinanceOrderClassifyInput,
): Pick<FinanceOrderClassification, 'channel' | 'channelRule'> {
  const source = getCustomSource(input.customFields);
  const salesChannel = normalize(input.salesChannel);
  const custom = asRecord(input.customFields);

  if (source && (WEB_SOURCE_TO_BUSINESS[source] || BLOOM_WEB_SOURCES.has(source))) {
    return { channel: 'web', channelRule: `source:${source}` };
  }
  if (salesChannel === 'website' || salesChannel === 'web') {
    return { channel: 'web', channelRule: 'salesChannel:website' };
  }
  if (custom?.external === true) {
    return { channel: 'web', channelRule: 'customFields.external' };
  }
  if (
    isTilopayOrder({
      comments: input.comments,
      customFields: input.customFields,
      salesChannel: input.salesChannel,
    })
  ) {
    return { channel: 'web', channelRule: 'tilopay' };
  }
  if (isMessageSeller(input.seller)) {
    return { channel: 'messages', channelRule: 'seller:messages' };
  }
  // Deterministic default for remaining CRM intake (manual/bot without markers).
  return { channel: 'messages', channelRule: 'default-messages' };
}

function failSafeClassification(
  tenantSlug: FinanceTenantSlug,
  reason: string,
): FinanceOrderClassification {
  if (tenantSlug === 'bloom') {
    return {
      tenant: 'bloom',
      business: 'bloom',
      channel: 'messages',
      businessRule: reason,
      channelRule: 'fail-safe-default-messages',
      confidence: 'low',
      needsManualAssignment: false,
      classifierVersion: FINANCE_ORDER_CLASSIFIER_VERSION,
    };
  }
  return {
    tenant: 'deepsleep',
    business: 'unassigned',
    channel: 'messages',
    businessRule: reason,
    channelRule: 'fail-safe-default-messages',
    confidence: 'low',
    needsManualAssignment: true,
    classifierVersion: FINANCE_ORDER_CLASSIFIER_VERSION,
  };
}

/**
 * Classify a finance order for tenant/business/channel.
 * DeepSleep leftovers that cannot be confidently tagged become `unassigned`
 * for manual assignment in the finance app (not in Betsy).
 * Never throws — malformed input falls back to a safe classification so rows are still served.
 */
export function classifyFinanceOrder(input: FinanceOrderClassifyInput): FinanceOrderClassification {
  try {
    const channel = classifyChannel(input);

    if (input.tenantSlug === 'bloom') {
      return {
        tenant: 'bloom',
        business: 'bloom',
        ...channel,
        businessRule: 'tenant-bloom',
        confidence: 'high',
        needsManualAssignment: false,
        classifierVersion: FINANCE_ORDER_CLASSIFIER_VERSION,
      };
    }

    if (input.tenantSlug === 'deepsleep') {
      const business = classifyDeepSleepBusiness(input);
      return {
        tenant: 'deepsleep',
        ...business,
        ...channel,
        classifierVersion: FINANCE_ORDER_CLASSIFIER_VERSION,
      };
    }

    const _exhaustive: never = input.tenantSlug;
    void _exhaustive;
    return failSafeClassification('deepsleep', 'invalid-tenant');
  } catch {
    return failSafeClassification(input.tenantSlug, 'fail-safe-classifier-error');
  }
}
