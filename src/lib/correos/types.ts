// ============================================================================
// Correos de Costa Rica — SOAP Web Service Type Definitions
// Based on: "Descripción de Interfaces del Web Service" (Feb 2023)
// ============================================================================

// ─── Authentication ─────────────────────────────────────────────────────────

export interface CorreosWSCredentials {
  username: string;
  password: string;
  sistema: string;
  usuarioId: number;
  servicioId: number;
  codCliente: string;
}

export interface TokenRequest {
  Username: string;
  Password: string;
  Sistema: string;
}

export interface TokenResponse {
  token?: string;
  Token?: string;
  access_token?: string;
}

// ─── Common / Geographic ────────────────────────────────────────────────────

export interface CcrItemGeografico {
  Codigo: string;
  Descripcion: string;
}

export interface CcrBarrio {
  CodBarrio: string;
  CodSucursal: string;
  Nombre: string;
}

// ─── Response Envelopes ─────────────────────────────────────────────────────

export type CcrResponseCode = '00' | '15' | '17' | '20';

interface CcrBaseResponse {
  CodRespuesta: string;
  MensajeRespuesta: string;
}

export interface CcrRespuestaProvincia extends CcrBaseResponse {
  Provincias: CcrItemGeografico[] | null;
}

export interface CcrRespuestaCanton extends CcrBaseResponse {
  Cantones: CcrItemGeografico[] | null;
}

export interface CcrRespuestaDistrito extends CcrBaseResponse {
  Distritos: CcrItemGeografico[] | null;
}

export interface CcrRespuestaBarrios extends CcrBaseResponse {
  Barrios: CcrBarrio[] | null;
}

export interface CcrRespuestaCodPostal extends CcrBaseResponse {
  CodPostal: string;
}

// ─── Tarifa (Rate Quote) ────────────────────────────────────────────────────

export interface CcrReqTarifa {
  CantonDestino: string;
  CantonOrigen: string;
  DistritoDestino: string;
  DistritoOrigen: string;
  Peso: number;
  ProvinciaDestino: string;
  ProvinciaOrigen: string;
  Servicio: string;
}

export interface CcrRespuestaTarifa extends CcrBaseResponse {
  MontoTarifa: number;
  Descuento: number;
  Impuesto: number;
}

// ─── Guía Generation ────────────────────────────────────────────────────────

export interface CcrRespuestaGuia extends CcrBaseResponse {
  NumeroEnvio: string;
}

// ─── Shipment Registration ──────────────────────────────────────────────────

// Fields MUST be in alphabetical order — WCF DataContract serialization requires this
export interface CcrDatosEnvio {
  COD_CLIENTE: string;
  DEST_APARTADO: string;
  DEST_DIRECCION: string;
  DEST_NOMBRE: string;
  DEST_TELEFONO: string;
  DEST_ZIP: string;
  ENVIO_ID: string;
  FECHA_ENVIO: string;
  MONTO_FLETE: number;
  OBSERVACIONES: string;
  PESO: number;
  SEND_DIRECCION: string;
  SEND_NOMBRE: string;
  SEND_TELEFONO: string;
  SEND_ZIP: string;
  SERVICIO: string;
  USUARIO_ID: string;
  VARIABLE_1?: string | null;
  VARIABLE_10?: string | null;
  VARIABLE_11?: string | null;
  VARIABLE_12?: string | null;
  VARIABLE_13?: string | null;
  VARIABLE_14?: string | null;
  VARIABLE_15?: string | null;
  VARIABLE_16?: string | null;
  VARIABLE_3?: string | null;
  VARIABLE_4?: string | null;
  VARIABLE_5?: string | null;
  VARIABLE_6?: string | null;
  VARIABLE_7?: string | null;
  VARIABLE_8?: string | null;
  VARIABLE_9?: string | null;
}

export interface CcrReqDatosEnvio {
  Cliente: string;
  Envio: CcrDatosEnvio;
}

export interface CcrRespuestaEnvio extends CcrBaseResponse {
  PDF: string;  // Base64-encoded PDF
}

// ─── Tracking ───────────────────────────────────────────────────────────────

export interface CcrEncabezado {
  NumeroEnvio: string;
  FechaRecepcion: string;
  NombreDestinatario: string;
  Estado: string;
  Referencia: string;
}

export interface CcrEvento {
  FechaHora: string;
  Unidad: string;
  Evento: string;
  NumeroOrigen: string;
  Servicio: string;
  RecibidoPor: string;
}

export interface CcrRespuestaTracking extends CcrBaseResponse {
  Encabezado: CcrEncabezado | null;
  Eventos: CcrEvento[] | null;
}

// ─── High-level service types ───────────────────────────────────────────────

export interface GenerateGuiaRequest {
  customerName: string;
  customerPhone: string;
  customerAddress: string;
  customerZip: string;
  customerApartado: string;
  senderName: string;
  senderAddress: string;
  senderZip: string;
  senderPhone: string;
  weight: number;
  description: string;
  fleteAmount?: number;
}

export interface GenerateGuiaResult {
  success: boolean;
  guiaNumber: string;
  pdfBase64?: string;
  pdfBuffer?: Buffer;
  error?: string;
  responseCode?: string;
  responseMessage?: string;
}

export interface RateQuoteRequest {
  provinciaOrigen: string;
  cantonOrigen: string;
  distritoOrigen: string;
  provinciaDestino: string;
  cantonDestino: string;
  distritoDestino: string;
  peso: number;
}

export interface RateQuoteResult {
  success: boolean;
  montoTarifa: number;
  descuento: number;
  impuesto: number;
  total: number;
  error?: string;
}

export interface TrackingResult {
  success: boolean;
  header?: CcrEncabezado;
  events: CcrEvento[];
  error?: string;
}
