// ============================================================================
// Correos de Costa Rica — REST API v3 types
// Source: "Manual Integración API v3" (Correos, 2026-06-17) + the Swagger
// spec served at https://servicios.correos.go.cr:459/swagger/v3/swagger.json
// ============================================================================

export type CorreosV3Environment = 'test' | 'prod';

export interface CorreosV3Config {
  environment: CorreosV3Environment;
  username: string;
  password: string;
  /** Correos "Código de cliente" (remitente). */
  codCliente: number;
  /** Correos "Código de servicio", e.g. 1564 = PYMEXPRES. */
  servicioId: number;
  /** Optional "usuarioId" sent on guía registration. */
  usuarioId?: string;
  /** Override the base URL (tests, proxy). Ends with /api/v3. */
  baseUrl?: string;
}

/** Every v3 response uses this envelope (except auth/login + auth/refresh). */
export interface V3Envelope<T> {
  exito: boolean;
  mensaje: string | null;
  datos: T | null;
  errores: string[] | null;
}

export interface V3TokenResponse {
  accessToken: string | null;
  expiresIn: number;
  refreshToken: string | null;
}

// ─── Ubicaciones ────────────────────────────────────────────────────────────

export interface V3Provincia {
  codigo: string;
  nombre: string;
}

export type V3Canton = V3Provincia;

export interface V3Distrito {
  codigo: string;
  nombre: string;
  codigoPostal: string | null;
  /** "S" / "N" */
  poseeSucursal: string | null;
}

export interface V3Barrio {
  codigo: string | null;
  nombre: string;
  /** "S" / "N" */
  zonaRestringida: string | null;
}

export interface V3Sucursal {
  codigo: string;
  nombre: string;
  correo: string | null;
  direccion: string | null;
  horario: string | null;
  latitud: number;
  longitud: number;
}

// ─── Tarifas ────────────────────────────────────────────────────────────────

export interface V3TarifaRequest {
  codProvinciaOrigen: string;
  codCantonOrigen: string;
  codDistritoOrigen?: string;
  codProvinciaDestino: string;
  codCantonDestino: string;
  codDistritoDestino?: string;
  servicio: number;
  /** grams */
  peso: number;
  alto: number;
  largo: number;
  ancho: number;
  codCliente: number;
}

export interface V3Tarifa {
  monto: number;
  descuento: number;
  impuesto: number;
}

// ─── Guías ──────────────────────────────────────────────────────────────────

export type V3TipoDestino = 'DOM' | 'SUC';

export interface V3GuiaRequest {
  codigoCliente: number;
  fechaImposicion: string;
  /** "" lets Correos assign the number. */
  envioId: string;
  servicioId: number;
  montoFlete: number;
  destNombre: string;
  destDireccion?: string;
  destTelefono: string;
  destZip?: string;
  sendNombre: string;
  sendDireccion: string;
  sendTelefono: string;
  sendZip: string;
  observaciones?: string;
  usuarioId?: string;
  /** grams */
  peso: number;
  tipoDestino: V3TipoDestino;
  codigoSucursal?: string;
}

export interface V3GuiaResponse {
  envioId: string;
  pdfBase64: string | null;
  zpl: string | null;
}

// ─── Rastreo ────────────────────────────────────────────────────────────────

export interface V3Envio {
  envioId: string | null;
  unidadOrigen: string | null;
  latitudUnidadOrigen: number | null;
  longitudUnidadOrigen: number | null;
  envioReferencia: string | null;
  nombreDestinatario: string | null;
  fechaEntrega: string | null;
  personaEntrega: string | null;
  codigoEstado: string | null;
  estado: string | null;
  fechaRecepcion: string | null;
  codigoServicio: number | null;
  servicio: string | null;
  telefono: string | null;
  direccion: string | null;
  codigoPostal: string | null;
}

export interface V3Evento {
  fecha: string | null;
  ubicacion: string | null;
  codigo: string | null;
  descripcion: string | null;
  recibidoPor: string | null;
  latitud: number | null;
  longitud: number | null;
}

export interface V3Rastreo {
  envio: V3Envio | null;
  eventos: V3Evento[] | null;
}

// ─── Recolecciones ──────────────────────────────────────────────────────────

export interface V3RecoleccionRequest {
  cedula: string;
  nombre: string;
  apellidos: string;
  provincia: string;
  canton: string;
  distrito: string;
  codigoPostal: string;
  direccion: string;
  telefono: string;
  correo: string;
  envios: string[];
}
