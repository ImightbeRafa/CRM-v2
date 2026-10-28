import { CorreosV3Client, CorreosV3Error, type CorreosV3ClientOptions } from './client';
import { CorreosV3Geo, matchByName, type ResolvedPlace } from './geo';
import { clip, normalizeTracking, toGrams, toPhone8, toZip5, type NormalizedTracking } from './mappers';
import type { CorreosV3Config, V3Sucursal, V3TipoDestino } from './types';

/**
 * High-level Correos v3 operations in Betsy terms. Everything that can be
 * checked before calling Correos is checked here, so a bad phone or a missing
 * branch never reaches `registrar` (and never burns the once-per-order claim).
 */

export interface V3Party {
  name: string;
  phone: string | null | undefined;
  address: string | null | undefined;
}

export interface V3Place {
  province: string | null | undefined;
  canton: string | null | undefined;
  district: string | null | undefined;
  barrio?: string | null;
}

export interface V3GuiaInput {
  dest: V3Party & V3Place;
  sender: V3Party & { zip: string | null | undefined };
  /** Sender place, used to quote the freight when montoFlete is not given. */
  origin?: V3Place | null;
  pesoG?: number | null;
  dims?: { alto: number; largo: number; ancho: number } | null;
  tipoDestino: V3TipoDestino;
  codigoSucursal?: string | null;
  montoFlete?: number | null;
  observaciones?: string | null;
}

export type V3GuiaOutcome =
  | {
      ok: true;
      guiaNumber: string;
      pdf: Buffer | null;
      zpl: string | null;
      montoFlete: number;
      pesoG: number;
      destZip: string | null;
    }
  | {
      ok: false;
      /** false = Correos was never asked to register anything (safe to retry / fall back). */
      sent: boolean;
      /** true = Correos may have registered it (timeout / network after send). */
      unknown: boolean;
      error: string;
      field?: string;
    };

export interface V3QuoteInput {
  origin: V3Place;
  dest: V3Place;
  pesoG?: number | null;
  dims?: { alto: number; largo: number; ancho: number } | null;
}

export interface V3Quote {
  monto: number;
  descuento: number;
  impuesto: number;
  total: number;
}

export interface V3AddressCheck {
  ok: boolean;
  place: ResolvedPlace | null;
  codigoPostal: string | null;
  poseeSucursal: boolean;
  restricted: boolean;
  /** Something in this district is restricted, even if the barrio is unknown. */
  districtHasRestricted: boolean;
  problems: string[];
}

export class CorreosV3Service {
  readonly client: CorreosV3Client;
  readonly geo: CorreosV3Geo;

  constructor(config: CorreosV3Config, options?: CorreosV3ClientOptions) {
    this.client = new CorreosV3Client(config, options);
    this.geo = new CorreosV3Geo(this.client);
  }

  get environment() {
    return this.client.config.environment;
  }

  async checkAddress(place: V3Place): Promise<V3AddressCheck> {
    const problems: string[] = [];
    if (!place.province || !place.canton || !place.district) {
      problems.push('Falta provincia, cantón o distrito.');
      return { ok: false, place: null, codigoPostal: null, poseeSucursal: false, restricted: false, districtHasRestricted: false, problems };
    }
    const resolved = await this.geo.resolve(place.province, place.canton, place.district);
    if (!resolved) {
      problems.push('Correos no reconoce esa provincia / cantón / distrito.');
      return { ok: false, place: null, codigoPostal: null, poseeSucursal: false, restricted: false, districtHasRestricted: false, problems };
    }
    let restricted = false;
    let districtHasRestricted = false;
    try {
      const r = await this.geo.isRestricted(resolved, place.barrio);
      restricted = r.restricted;
      districtHasRestricted = r.anyRestricted;
    } catch {
      // barrios is advisory; never block on it
    }
    if (restricted) problems.push('El barrio está en zona restringida para entrega a domicilio. Usá entrega en sucursal.');
    return {
      ok: !restricted,
      place: resolved,
      codigoPostal: resolved.codigoPostal,
      poseeSucursal: resolved.poseeSucursal,
      restricted,
      districtHasRestricted,
      problems,
    };
  }

  async branchesFor(place: V3Place): Promise<{ place: ResolvedPlace | null; branches: V3Sucursal[] }> {
    if (!place.province || !place.canton) return { place: null, branches: [] };
    const provs = await this.geo.provincias();
    const p = provs.find((x) => x.codigo === place.province) ?? matchByName(provs, place.province);
    if (!p) return { place: null, branches: [] };
    const cants = await this.geo.cantones(p.codigo);
    const c = cants.find((x) => x.codigo === place.canton) ?? matchByName(cants, place.canton);
    if (!c) return { place: null, branches: [] };
    const branches = await this.geo.sucursales(p.codigo, c.codigo);
    const resolved = place.district ? await this.geo.resolve(p.codigo, c.codigo, place.district) : null;
    return { place: resolved, branches };
  }

  async quote(input: V3QuoteInput): Promise<V3Quote> {
    const [o, d] = await Promise.all([
      this.geo.resolve(String(input.origin.province ?? ''), String(input.origin.canton ?? ''), String(input.origin.district ?? '')),
      this.geo.resolve(String(input.dest.province ?? ''), String(input.dest.canton ?? ''), String(input.dest.district ?? '')),
    ]);
    if (!o) throw new CorreosV3Error('No se reconoce la ubicación de origen', 400);
    if (!d) throw new CorreosV3Error('No se reconoce la ubicación de destino', 400);
    const dims = input.dims ?? { alto: 0, largo: 0, ancho: 0 };
    const t = await this.client.tarifa({
      codProvinciaOrigen: o.provincia.codigo,
      codCantonOrigen: o.canton.codigo,
      codDistritoOrigen: o.distrito.codigo,
      codProvinciaDestino: d.provincia.codigo,
      codCantonDestino: d.canton.codigo,
      codDistritoDestino: d.distrito.codigo,
      peso: toGrams(input.pesoG),
      alto: Math.max(0, Number(dims.alto) || 0),
      largo: Math.max(0, Number(dims.largo) || 0),
      ancho: Math.max(0, Number(dims.ancho) || 0),
    });
    const monto = Number(t?.monto) || 0;
    const descuento = Number(t?.descuento) || 0;
    const impuesto = Number(t?.impuesto) || 0;
    return { monto, descuento, impuesto, total: Math.max(0, monto - descuento + impuesto) };
  }

  async track(guiaNumber: string): Promise<NormalizedTracking> {
    return normalizeTracking(guiaNumber, await this.client.rastreo(guiaNumber));
  }

  /** Validates everything locally and returns the request, or a pre-send error. */
  async prepareGuia(input: V3GuiaInput) {
    const fail = (error: string, field?: string) => ({ ok: false as const, sent: false, unknown: false, error, field });
    const destPhone = toPhone8(input.dest.phone);
    if (!destPhone) return fail('El teléfono del cliente debe tener 8 dígitos.', 'dest.phone');
    const sendPhone = toPhone8(input.sender.phone);
    if (!sendPhone) return fail('El teléfono del remitente (Configuración › Envíos) debe tener 8 dígitos.', 'sender.phone');
    const sendZip = toZip5(input.sender.zip);
    if (!sendZip) return fail('El código postal del remitente (Configuración › Envíos) debe tener 5 dígitos.', 'sender.zip');
    if (!clip(input.sender.name, 200) || !clip(input.sender.address, 500)) {
      return fail('Falta el nombre o la dirección del remitente (Configuración › Envíos).', 'sender');
    }
    const destName = clip(input.dest.name, 200);
    if (!destName) return fail('Falta el nombre del cliente.', 'dest.name');

    let destZip: string | null = null;
    let destAddress: string | undefined;
    let codigoSucursal: string | undefined;
    if (input.tipoDestino === 'SUC') {
      codigoSucursal = clip(input.codigoSucursal, 20) || undefined;
      if (!codigoSucursal) return fail('Elegí la sucursal de Correos donde el cliente retira.', 'codigoSucursal');
      // The branch must be one Correos lists for the customer's canton (a stale pick after an address change).
      if (input.dest.province && input.dest.canton) {
        const { branches } = await this.branchesFor({ province: input.dest.province, canton: input.dest.canton, district: null });
        if (branches.length > 0 && !branches.some((b) => b.codigo === codigoSucursal)) {
          return fail('La sucursal elegida no es de ese cantón. Elegila de nuevo.', 'codigoSucursal');
        }
      }
    } else {
      const check = await this.checkAddress(input.dest);
      if (!check.place) return fail(check.problems[0] || 'Dirección inválida.', 'dest.place');
      if (check.restricted) return fail(check.problems[0], 'dest.barrio');
      destZip = check.codigoPostal;
      if (!destZip) return fail('Correos no tiene código postal para ese distrito.', 'dest.place');
      destAddress = clip(input.dest.address, 500);
      if (!destAddress) return fail('Falta la dirección exacta del cliente.', 'dest.address');
    }

    const pesoG = toGrams(input.pesoG);
    let montoFlete = Number(input.montoFlete);
    if (!Number.isFinite(montoFlete) || montoFlete < 0) montoFlete = NaN;
    if (Number.isNaN(montoFlete)) {
      montoFlete = 0;
      if (input.origin) {
        try {
          montoFlete = (await this.quote({ origin: input.origin, dest: input.dest, pesoG, dims: input.dims })).total;
        } catch {
          montoFlete = 0;
        }
      }
    }

    return {
      ok: true as const,
      pesoG,
      destZip,
      montoFlete,
      request: {
        fechaImposicion: new Date().toISOString(),
        envioId: '',
        montoFlete,
        destNombre: destName,
        destDireccion: destAddress,
        destTelefono: destPhone,
        destZip: destZip ?? undefined,
        sendNombre: clip(input.sender.name, 200),
        sendDireccion: clip(input.sender.address, 500),
        sendTelefono: sendPhone,
        sendZip,
        observaciones: clip(input.observaciones, 200) || undefined,
        peso: pesoG,
        tipoDestino: input.tipoDestino,
        codigoSucursal,
      },
    };
  }

  /** Registers one guía. Never retried; a failure after sending is "unknown". */
  async createGuia(input: V3GuiaInput, prepared?: Awaited<ReturnType<CorreosV3Service['prepareGuia']>>): Promise<V3GuiaOutcome> {
    let prep: Awaited<ReturnType<CorreosV3Service['prepareGuia']>>;
    try {
      prep = prepared ?? (await this.prepareGuia(input));
    } catch (err) {
      return { ok: false, sent: false, unknown: false, error: err instanceof Error ? err.message : 'No se pudo validar la guía' };
    }
    if (!prep.ok) return prep;
    try {
      // Login first so an auth failure is a clean "not sent".
      await this.client.getToken();
    } catch (err) {
      return { ok: false, sent: false, unknown: false, error: err instanceof Error ? err.message : 'Correos rechazó las credenciales' };
    }
    try {
      const res = await this.client.registrarGuia(prep.request);
      if (!res?.envioId) {
        return { ok: false, sent: true, unknown: true, error: 'Correos no devolvió número de guía. Revisá en Correos antes de reintentar.' };
      }
      return {
        ok: true,
        guiaNumber: res.envioId,
        pdf: res.pdfBase64 ? Buffer.from(res.pdfBase64, 'base64') : null,
        zpl: res.zpl || null,
        montoFlete: prep.montoFlete,
        pesoG: prep.pesoG,
        destZip: prep.destZip,
      };
    } catch (err) {
      if (err instanceof CorreosV3Error && err.status >= 400 && err.status < 500) {
        // Correos answered and refused: nothing was registered.
        return { ok: false, sent: true, unknown: false, error: err.message };
      }
      return {
        ok: false,
        sent: true,
        unknown: true,
        error: `${err instanceof Error ? err.message : 'Error de conexión'}. Puede que Correos sí la haya creado: revisá antes de reintentar.`,
      };
    }
  }

  async requestPickup(input: {
    cedula: string;
    nombre: string;
    apellidos: string;
    place: V3Place;
    direccion: string;
    telefono: string;
    correo: string;
    envios: string[];
  }) {
    const tel = toPhone8(input.telefono);
    if (!tel) throw new CorreosV3Error('El teléfono para la recolección debe tener 8 dígitos.', 400);
    const cedula = String(input.cedula ?? '').replace(/[^0-9A-Za-z]/g, '');
    if (cedula.length < 9 || cedula.length > 20) throw new CorreosV3Error('La cédula para la recolección no es válida.', 400);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.correo)) throw new CorreosV3Error('El correo para la recolección no es válido.', 400);
    const envios = [...new Set(input.envios.map((e) => e.trim()).filter((e) => /^[A-Za-z0-9-]{4,50}$/.test(e)))];
    if (envios.length === 0) throw new CorreosV3Error('No hay guías para recolectar.', 400);
    const place = await this.geo.resolve(String(input.place.province ?? ''), String(input.place.canton ?? ''), String(input.place.district ?? ''));
    if (!place?.codigoPostal) throw new CorreosV3Error('No se reconoce la dirección de recolección.', 400);
    // The manual's table says "descripción" but its example sends codes; codes it is.
    await this.client.solicitarRecoleccion({
      cedula,
      nombre: clip(input.nombre, 100),
      apellidos: clip(input.apellidos, 100) || '-',
      provincia: place.provincia.codigo,
      canton: place.canton.codigo,
      distrito: place.distrito.codigo,
      codigoPostal: place.codigoPostal,
      direccion: clip(input.direccion, 300),
      telefono: tel,
      correo: clip(input.correo, 150),
      envios,
    });
    return { envios };
  }
}
