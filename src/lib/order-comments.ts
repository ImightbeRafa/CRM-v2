export const ORDER_COMMENT_FIELD_ALIASES = [
  'comments',
  'comment',
  'comentarios',
  'comentario',
  'sellerComments',
  'sellerComment',
  'seller_comments',
  'seller_comment',
  'orderComments',
  'orderComment',
  'order_comments',
  'order_comment',
  'observaciones',
  'observacion',
  'notas',
  'nota',
] as const;

const COMMENT_KEYWORDS = [
  'comentario',
  'comentarios',
  'comment',
  'comments',
  'observacion',
  'observaciones',
  'nota',
  'notas',
  'note',
  'notes',
  'descripcion',
  'description',
];

const normalizeKey = (key: string) => key.toLowerCase().replace(/[^a-z0-9]/g, '');
const normalizedAliases = new Set(ORDER_COMMENT_FIELD_ALIASES.map(normalizeKey));

function normalizeTextValue(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  const text = String(value).trim();
  return text || undefined;
}

function findDirectCommentValue(source?: Record<string, unknown> | null): string | undefined {
  if (!source) return undefined;

  for (const alias of ORDER_COMMENT_FIELD_ALIASES) {
    const value = normalizeTextValue(source[alias]);
    if (value) return value;
  }

  for (const [key, value] of Object.entries(source)) {
    if (normalizedAliases.has(normalizeKey(key))) {
      const text = normalizeTextValue(value);
      if (text) return text;
    }
  }

  return undefined;
}

function findKeywordCommentValue(source?: Record<string, unknown> | null): string | undefined {
  if (!source) return undefined;

  for (const [key, value] of Object.entries(source)) {
    const lowerKey = key.toLowerCase();
    if (COMMENT_KEYWORDS.some((keyword) => lowerKey.includes(keyword))) {
      const text = normalizeTextValue(value);
      if (text) return text;
    }
  }

  return undefined;
}

export function hasOrderCommentInput(
  source?: Record<string, unknown> | null,
  customFields?: Record<string, unknown> | null
): boolean {
  const hasCommentKey = (record?: Record<string, unknown> | null) =>
    !!record &&
    Object.keys(record).some((key) => {
      const lowerKey = key.toLowerCase();
      return normalizedAliases.has(normalizeKey(key)) ||
        COMMENT_KEYWORDS.some((keyword) => lowerKey.includes(keyword));
    });

  return hasCommentKey(source) || hasCommentKey(customFields);
}

export function resolveOrderComment(
  source?: Record<string, unknown> | null,
  customFields?: Record<string, unknown> | null
): string | undefined {
  return findDirectCommentValue(source) ??
    findDirectCommentValue(customFields) ??
    findKeywordCommentValue(customFields) ??
    findKeywordCommentValue(source);
}
