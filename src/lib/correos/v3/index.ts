export { CorreosV3Client, CorreosV3Error, resolveV3BaseUrl } from './client';
export { CorreosV3Geo, matchByName, foldName } from './geo';
export { CorreosV3Service } from './service';
export type { V3GuiaInput, V3GuiaOutcome, V3Quote, V3AddressCheck, V3Place } from './service';
export { selectV3Config, resolveV3Config, parseV3Environment, V3_DB_KEYS } from './config';
export { decideCorreosApi, tenantWantsV3, getCorreosV3ForRead, getCorreosV3ForWrite, correosV3Status } from './select';
export * from './mappers';
export type * from './types';
