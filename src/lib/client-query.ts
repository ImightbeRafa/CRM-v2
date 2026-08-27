import type { Prisma } from '@prisma/client';
import { hashCursorScope } from '@/lib/cursor-pagination';

export interface ClientQueryInput {
  search: string;
  province: string;
  canton: string;
  state: 'all' | 'active' | 'inactive' | 'favorites' | 'top-spenders';
}

export function parseClientQuery(searchParams: URLSearchParams): ClientQueryInput {
  const search = (searchParams.get('search') || '').trim();
  if (search.length === 1) throw new Error('Search must contain at least 2 characters');
  const state = searchParams.get('state') || 'all';
  if (!['all', 'active', 'inactive', 'favorites', 'top-spenders'].includes(state)) {
    throw new Error('Invalid client state');
  }
  return {
    search,
    province: (searchParams.get('province') || '').trim(),
    canton: (searchParams.get('canton') || '').trim(),
    state: state as ClientQueryInput['state'],
  };
}

export function buildClientWhere(input: ClientQueryInput): Prisma.ClientWhereInput {
  const and: Prisma.ClientWhereInput[] = [];
  if (input.search) {
    and.push({
      OR: [
        { name: { contains: input.search, mode: 'insensitive' } },
        { phone: { contains: input.search, mode: 'insensitive' } },
        { email: { contains: input.search, mode: 'insensitive' } },
        { business: { contains: input.search, mode: 'insensitive' } },
      ],
    });
  }
  if (input.province) and.push({ province: input.province });
  if (input.canton) and.push({ canton: input.canton });
  if (input.state === 'active') and.push({ isActive: true });
  if (input.state === 'inactive') and.push({ isActive: false });
  if (input.state === 'favorites') and.push({ isFavorite: true });
  if (input.state === 'top-spenders') and.push({ totalSpent: { gt: 100000 } });
  return and.length > 0 ? { AND: and } : {};
}

export function clientCursorScope(input: ClientQueryInput) {
  return hashCursorScope({
    search: input.search.toLowerCase(),
    province: input.province.toLowerCase(),
    canton: input.canton.toLowerCase(),
    state: input.state,
    sort: 'lastOrder-desc-id-desc',
  });
}
