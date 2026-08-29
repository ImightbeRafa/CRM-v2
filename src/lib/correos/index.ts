export { CorreosWebService } from './correosWebService';
export { CorreosSoapClient } from './soapClient';
export { CorreosTokenManager } from './tokenManager';
export { CorreosGeoMapper } from './geoMapper';
export {
  getCorreosWSCredentials,
  isCorreosWSConfigured,
  isCorreosWSReady,
  resolveCorreosWSCredentials,
  selectCorreosWSCredentials,
  credentialTokenCacheKey,
} from './credentials';
export type { CorreosCredentialSource, ResolvedCorreosCredentials } from './credentials';
export { buildGuiaDescription, buildFullAddress } from './utils';
export type * from './types';
