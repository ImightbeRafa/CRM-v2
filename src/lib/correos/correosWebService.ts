import { CorreosSoapClient } from './soapClient';
import { CorreosGeoMapper } from './geoMapper';
import type {
  CorreosWSCredentials,
  CcrDatosEnvio,
  GenerateGuiaRequest,
  GenerateGuiaResult,
  RateQuoteRequest,
  RateQuoteResult,
  TrackingResult,
} from './types';

export class CorreosWebService {
  private soapClient: CorreosSoapClient;
  private geoMapper: CorreosGeoMapper;
  private credentials: CorreosWSCredentials;

  constructor(credentials: CorreosWSCredentials) {
    this.credentials = credentials;
    this.soapClient = new CorreosSoapClient(credentials);
    this.geoMapper = new CorreosGeoMapper(this.soapClient);
  }

  // ─── Full guía workflow ───────────────────────────────────────────────────

  /**
   * Generates a shipping guide and registers the shipment in a single call.
   * 1. ccrGenerarGuia  → get NumeroEnvio
   * 2. ccrRegistroEnvio → register shipment, receive PDF
   */
  async generateAndRegisterGuia(
    req: GenerateGuiaRequest
  ): Promise<GenerateGuiaResult> {
    // Step 1: Generate the guía number
    const guiaRes = await this.soapClient.generarGuia();
    if (guiaRes.CodRespuesta !== '00') {
      return {
        success: false,
        guiaNumber: '',
        error: `ccrGenerarGuia failed: ${guiaRes.MensajeRespuesta}`,
        responseCode: guiaRes.CodRespuesta,
        responseMessage: guiaRes.MensajeRespuesta,
      };
    }

    const guiaNumber = guiaRes.NumeroEnvio;

    // WCF DataContract serialization requires alphabetical field order
    const envio: CcrDatosEnvio = {
      COD_CLIENTE: this.credentials.codCliente,
      DEST_APARTADO: req.customerApartado,
      DEST_DIRECCION: req.customerAddress,
      DEST_NOMBRE: req.customerName,
      DEST_TELEFONO: req.customerPhone,
      DEST_ZIP: req.customerZip,
      ENVIO_ID: guiaNumber,
      FECHA_ENVIO: new Date().toISOString(),
      MONTO_FLETE: req.fleteAmount ?? 0,
      OBSERVACIONES: req.description,
      PESO: req.weight,
      SEND_DIRECCION: req.senderAddress,
      SEND_NOMBRE: req.senderName,
      SEND_TELEFONO: req.senderPhone,
      SEND_ZIP: req.senderZip,
      SERVICIO: String(this.credentials.servicioId),
      USUARIO_ID: String(this.credentials.usuarioId),
    };

    // Step 3: Register the shipment
    const envioRes = await this.soapClient.registroEnvio({
      Cliente: this.credentials.codCliente,
      Envio: envio,
    });

    if (envioRes.CodRespuesta !== '00') {
      return {
        success: false,
        guiaNumber,
        error: `ccrRegistroEnvio failed: ${envioRes.MensajeRespuesta}`,
        responseCode: envioRes.CodRespuesta,
        responseMessage: envioRes.MensajeRespuesta,
      };
    }

    let pdfBuffer: Buffer | undefined;
    if (envioRes.PDF) {
      pdfBuffer = Buffer.from(envioRes.PDF, 'base64');
    }

    return {
      success: true,
      guiaNumber,
      pdfBase64: envioRes.PDF,
      pdfBuffer,
      responseCode: envioRes.CodRespuesta,
      responseMessage: envioRes.MensajeRespuesta,
    };
  }

  // ─── Rate quote ───────────────────────────────────────────────────────────

  /**
   * Get a shipping rate for a given origin/destination and weight.
   * Accepts province/canton names and resolves them to codes internally.
   */
  async getRate(req: RateQuoteRequest): Promise<RateQuoteResult> {
    try {
      const codProvOrigen = await this.geoMapper.getProvinceCode(req.provinciaOrigen);
      const codCantonOrigen = await this.geoMapper.getCantonCode(codProvOrigen, req.cantonOrigen);
      const codDistOrigen = await this.geoMapper.getDistritoCode(codProvOrigen, codCantonOrigen, req.distritoOrigen);
      const codProvDestino = await this.geoMapper.getProvinceCode(req.provinciaDestino);
      const codCantonDestino = await this.geoMapper.getCantonCode(codProvDestino, req.cantonDestino);
      const codDistDestino = await this.geoMapper.getDistritoCode(codProvDestino, codCantonDestino, req.distritoDestino);

      const res = await this.soapClient.getTarifa({
        CantonDestino: codCantonDestino,
        CantonOrigen: codCantonOrigen,
        DistritoDestino: codDistDestino,
        DistritoOrigen: codDistOrigen,
        Peso: req.peso,
        ProvinciaDestino: codProvDestino,
        ProvinciaOrigen: codProvOrigen,
        Servicio: String(this.credentials.servicioId),
      });

      if (res.CodRespuesta !== '00') {
        return {
          success: false,
          montoTarifa: 0,
          descuento: 0,
          impuesto: 0,
          total: 0,
          error: res.MensajeRespuesta,
        };
      }

      return {
        success: true,
        montoTarifa: res.MontoTarifa,
        descuento: res.Descuento,
        impuesto: res.Impuesto,
        total: res.MontoTarifa - res.Descuento + res.Impuesto,
      };
    } catch (err: any) {
      return {
        success: false,
        montoTarifa: 0,
        descuento: 0,
        impuesto: 0,
        total: 0,
        error: err.message,
      };
    }
  }

  // ─── Tracking ─────────────────────────────────────────────────────────────

  async trackShipment(guiaNumber: string): Promise<TrackingResult> {
    try {
      const res = await this.soapClient.movilTracking(guiaNumber);
      if (res.CodRespuesta !== '00') {
        return { success: false, events: [], error: res.MensajeRespuesta };
      }
      return {
        success: true,
        header: res.Encabezado ?? undefined,
        events: res.Eventos ?? [],
      };
    } catch (err: any) {
      return { success: false, events: [], error: err.message };
    }
  }

  // ─── Geographic helpers (delegated) ───────────────────────────────────────

  async resolveLocation(province: string, canton: string, distrito: string) {
    return this.geoMapper.resolveLocation(province, canton, distrito);
  }

  async getPostalCode(province: string, canton: string, distrito: string) {
    return this.geoMapper.getPostalCode(province, canton, distrito);
  }

  // ─── Direct access to lower layers when needed ────────────────────────────

  getSoapClient(): CorreosSoapClient {
    return this.soapClient;
  }

  getGeoMapper(): CorreosGeoMapper {
    return this.geoMapper;
  }
}
