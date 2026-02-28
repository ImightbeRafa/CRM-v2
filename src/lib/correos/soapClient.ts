import * as soap from 'soap';
import * as path from 'path';
import * as fs from 'fs';
import { fileURLToPath } from 'url';
import { correosHttp } from './http';
import { CorreosTokenManager } from './tokenManager';
import type {
  CorreosWSCredentials,
  CcrRespuestaProvincia,
  CcrRespuestaCanton,
  CcrRespuestaDistrito,
  CcrRespuestaBarrios,
  CcrRespuestaCodPostal,
  CcrReqTarifa,
  CcrRespuestaTarifa,
  CcrRespuestaGuia,
  CcrReqDatosEnvio,
  CcrRespuestaEnvio,
  CcrRespuestaTracking,
} from './types';

const SOAP_ENDPOINT =
  'http://amistad.correos.go.cr:84/wsAppCorreos.wsAppCorreos.svc';

// Remote WSDL URL — only used as fallback when local bundle is unavailable
const REMOTE_WSDL =
  'http://amistad.correos.go.cr:84/wsAppCorreos.wsAppCorreos.svc?wsdl';

const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 2_000;
const SOAP_TIMEOUT_MS = 120_000;

const TRANSIENT_PATTERNS = [
  'socket hang up',
  'ECONNRESET',
  'ECONNREFUSED',
  'ETIMEDOUT',
  'EPIPE',
  'EAI_AGAIN',
  'timeout',
  'network error',
  'ENOTFOUND',
  'fetch failed',
];

function isTransientError(err: any): boolean {
  const msg = String(err?.message ?? err ?? '').toLowerCase();
  return TRANSIENT_PATTERNS.some((p) => msg.includes(p));
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Resolve the local WSDL path. Tries multiple locations so it works in:
 *  - Local dev (process.cwd() = project root)
 *  - Vercel standalone (files traced via outputFileTracingIncludes)
 *  - ESM import.meta.url fallback
 */
function resolveWsdlPath(): string | null {
  let esmDir: string | undefined;
  try {
    esmDir = path.dirname(fileURLToPath(import.meta.url));
  } catch { /* not available in all bundlers */ }

  const candidates = [
    path.join(process.cwd(), 'src', 'lib', 'correos', 'wsdl', 'correos.wsdl'),
    esmDir ? path.join(esmDir, 'wsdl', 'correos.wsdl') : '',
    path.join(process.cwd(), 'wsdl', 'correos.wsdl'),
  ].filter(Boolean);

  for (const p of candidates) {
    try {
      if (fs.existsSync(p)) return p;
    } catch { /* ignore */ }
  }
  return null;
}

type SoapClient = soap.Client;

export class CorreosSoapClient {
  private tokenManager: CorreosTokenManager;
  private clientPromise: Promise<SoapClient> | null = null;

  constructor(credentials: CorreosWSCredentials) {
    this.tokenManager = new CorreosTokenManager(credentials);
  }

  // ─── SOAP client singleton ────────────────────────────────────────────────

  private getClient(): Promise<SoapClient> {
    if (!this.clientPromise) {
      const localWsdl = resolveWsdlPath();
      const wsdlSource = localWsdl || REMOTE_WSDL;

      console.log(`[CorreosSoap] Loading WSDL from ${localWsdl ? 'local bundle' : 'remote URL'}`);

      this.clientPromise = soap
        .createClientAsync(wsdlSource, {
          forceSoap12Headers: false,
          endpoint: SOAP_ENDPOINT,
          wsdl_options: { timeout: SOAP_TIMEOUT_MS },
          request: correosHttp as any,
        })
        .then((client) => {
          client.setEndpoint(SOAP_ENDPOINT);
          return client;
        })
        .catch((err) => {
          this.clientPromise = null;
          throw err;
        });
    }
    return this.clientPromise;
  }

  /** Discard the cached SOAP client so the next call creates a fresh connection. */
  private resetClient(): void {
    this.clientPromise = null;
  }

  // ─── Generic invoke with retry for transient errors + token refresh ────────

  private async invoke<T>(method: string, args: Record<string, unknown>): Promise<T> {
    let lastError: any;

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        const client = await this.getClient();
        const token = await this.tokenManager.getToken();

        client.addHttpHeader('Authorization', `Bearer ${token}`);

        const [result] = await (client as any)[`${method}Async`](args, {
          timeout: SOAP_TIMEOUT_MS,
        });

        const body: T = result?.[`${method}Result`] ?? result;

        // Code 20 = expired token → refresh and retry once
        const code = (body as any)?.CodRespuesta;
        if (code === '20') {
          this.tokenManager.invalidate();
          const freshToken = await this.tokenManager.getToken();
          client.addHttpHeader('Authorization', `Bearer ${freshToken}`);
          const [retryResult] = await (client as any)[`${method}Async`](args, {
            timeout: SOAP_TIMEOUT_MS,
          });
          return retryResult?.[`${method}Result`] ?? retryResult;
        }

        return body;
      } catch (err: any) {
        lastError = err;
        if (isTransientError(err) && attempt < MAX_RETRIES) {
          const delay = RETRY_DELAY_MS * attempt;
          console.warn(
            `[CorreosSoap] Transient error on ${method} (attempt ${attempt}/${MAX_RETRIES}): ${err.message}. Retrying in ${delay}ms...`
          );
          this.resetClient();
          await sleep(delay);
          continue;
        }
        throw err;
      }
    }

    throw lastError;
  }

  // ─── Helpers to unwrap SOAP array containers ───────────────────────────────

  private static unwrapArray<T>(container: any, innerKey: string): T[] | null {
    if (!container) return null;
    const inner = container[innerKey];
    if (!inner) return null;
    return Array.isArray(inner) ? inner : [inner];
  }

  // ─── Geographic lookups ───────────────────────────────────────────────────

  async getProvincias(): Promise<CcrRespuestaProvincia> {
    const raw = await this.invoke<any>('ccrCodProvincia', {});
    return {
      ...raw,
      Provincias: CorreosSoapClient.unwrapArray(raw.Provincias, 'ccrItemGeografico'),
    };
  }

  async getCantones(codProvincia: string): Promise<CcrRespuestaCanton> {
    const raw = await this.invoke<any>('ccrCodCanton', { CodProvincia: codProvincia });
    return {
      ...raw,
      Cantones: CorreosSoapClient.unwrapArray(raw.Cantones, 'ccrItemGeografico'),
    };
  }

  async getDistritos(codProvincia: string, codCanton: string): Promise<CcrRespuestaDistrito> {
    const raw = await this.invoke<any>('ccrCodDistrito', {
      CodProvincia: codProvincia,
      CodCanton: codCanton,
    });
    return {
      ...raw,
      Distritos: CorreosSoapClient.unwrapArray(raw.Distritos, 'ccrItemGeografico'),
    };
  }

  async getBarrios(
    codProvincia: string,
    codCanton: string,
    codDistrito: string
  ): Promise<CcrRespuestaBarrios> {
    const raw = await this.invoke<any>('ccrCodBarrio', {
      CodProvincia: codProvincia,
      CodCanton: codCanton,
      CodDistrito: codDistrito,
    });
    return {
      ...raw,
      Barrios: CorreosSoapClient.unwrapArray(raw.Barrios, 'ccrBarrio'),
    };
  }

  async getCodigoPostal(
    codProvincia: string,
    codCanton: string,
    codDistrito: string
  ): Promise<CcrRespuestaCodPostal> {
    return this.invoke<CcrRespuestaCodPostal>('ccrCodPostal', {
      CodProvincia: codProvincia,
      CodCanton: codCanton,
      CodDistrito: codDistrito,
    });
  }

  // ─── Tarifa ───────────────────────────────────────────────────────────────

  async getTarifa(reqTarifa: CcrReqTarifa): Promise<CcrRespuestaTarifa> {
    return this.invoke<CcrRespuestaTarifa>('ccrTarifa', { reqTarifa });
  }

  // ─── Guía generation ─────────────────────────────────────────────────────

  async generarGuia(): Promise<CcrRespuestaGuia> {
    return this.invoke<CcrRespuestaGuia>('ccrGenerarGuia', {});
  }

  // ─── Shipment registration ────────────────────────────────────────────────

  async registroEnvio(envioData: CcrReqDatosEnvio): Promise<CcrRespuestaEnvio> {
    return this.invoke<CcrRespuestaEnvio>('ccrRegistroEnvio', {
      ccrReqEnvio: envioData,
    });
  }

  // ─── Tracking ─────────────────────────────────────────────────────────────

  async movilTracking(numeroEnvio: string): Promise<CcrRespuestaTracking> {
    const raw = await this.invoke<any>('ccrMovilTracking', { NumeroEnvio: numeroEnvio });
    return {
      ...raw,
      Eventos: CorreosSoapClient.unwrapArray(raw.Eventos, 'ccrEvento'),
    };
  }

  // ─── Utilities ────────────────────────────────────────────────────────────

  getTokenManager(): CorreosTokenManager {
    return this.tokenManager;
  }

  async describeService(): Promise<Record<string, unknown>> {
    const client = await this.getClient();
    return client.describe();
  }
}
