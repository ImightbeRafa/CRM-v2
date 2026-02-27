import * as soap from 'soap';
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

const WSDL_URL =
  'http://amistad.correos.go.cr:84/wsAppCorreos.wsAppCorreos.svc?wsdl';

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
      this.clientPromise = soap
        .createClientAsync(WSDL_URL, {
          // WCF endpoints sometimes need explicit binding
          forceSoap12Headers: false,
        })
        .catch((err) => {
          this.clientPromise = null;
          throw err;
        });
    }
    return this.clientPromise;
  }

  // ─── Generic invoke with auto-token & retry on 20 ─────────────────────────

  private async invoke<T>(method: string, args: Record<string, unknown>): Promise<T> {
    const client = await this.getClient();
    const token = await this.tokenManager.getToken();

    // Token is sent as an HTTP Authorization header, not a SOAP body param
    client.addHttpHeader('Authorization', `Bearer ${token}`);

    const [result] = await client[`${method}Async`](args);

    const body: T =
      result?.[`${method}Result`] ?? result;

    const code = (body as any)?.CodRespuesta;
    if (code === '20') {
      this.tokenManager.invalidate();
      const freshToken = await this.tokenManager.getToken();
      client.addHttpHeader('Authorization', `Bearer ${freshToken}`);
      const [retryResult] = await client[`${method}Async`](args);
      return retryResult?.[`${method}Result`] ?? retryResult;
    }

    return body;
  }

  // ─── Helpers to unwrap SOAP array containers ───────────────────────────────
  // The SOAP response nests arrays inside container objects, e.g.:
  //   Provincias: { ccrItemGeografico: [...] }
  // We normalize these to flat arrays for consumer convenience.

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
