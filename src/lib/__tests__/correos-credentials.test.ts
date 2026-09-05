import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  credentialTokenCacheKey,
  selectCorreosWSCredentials,
} from '../correos/credential-select';
import {
  CorreosAuthError,
  formatGuiaFailureDetail,
  formatGuiaFailureLabel,
  formatLogisticsGuiaError,
  isCorreosCredentialRejection,
  isCorreosProxyUnavailable,
} from '../correos/auth-error';
import { getProxyUrl, getTokenUrl } from '../correos/proxy';

describe('Correos credential selection', () => {
  it('prefers a complete logistics DB set over environment variables', () => {
    const resolved = selectCorreosWSCredentials({
      db: {
        correos_ws_username: 'db-user',
        correos_ws_password: 'db-pass',
        correos_ws_sistema: 'PYMEXPRESS',
        correos_ws_usuario_id: '12',
        correos_ws_servicio_id: '3',
        correos_ws_cod_cliente: 'CLI-DB',
      },
      env: {
        CORREOS_WS_USERNAME: 'env-user',
        CORREOS_WS_PASSWORD: 'env-pass',
        CORREOS_WS_SISTEMA: 'OTHER',
        CORREOS_WS_COD_CLIENTE: 'CLI-ENV',
      },
    });

    assert.equal(resolved.source, 'logistics_db');
    assert.equal(resolved.credentials.username, 'db-user');
    assert.equal(resolved.credentials.password, 'db-pass');
    assert.equal(resolved.credentials.sistema, 'PYMEXPRESS');
    assert.equal(resolved.credentials.usuarioId, 12);
    assert.equal(resolved.credentials.codCliente, 'CLI-DB');
  });

  it('does not mix a DB username with an environment password', () => {
    const resolved = selectCorreosWSCredentials({
      db: { correos_ws_username: 'db-user' },
      env: {
        CORREOS_WS_USERNAME: 'env-user',
        CORREOS_WS_PASSWORD: 'env-pass',
      },
    });

    assert.equal(resolved.source, 'environment');
    assert.equal(resolved.credentials.username, 'env-user');
    assert.equal(resolved.credentials.password, 'env-pass');
  });

  it('falls back to a complete environment set when the DB is empty', () => {
    const resolved = selectCorreosWSCredentials({
      db: {},
      env: {
        CORREOS_WS_USERNAME: 'env-user',
        CORREOS_WS_PASSWORD: 'env-pass',
      },
    });

    assert.equal(resolved.source, 'environment');
    assert.equal(resolved.credentials.sistema, 'PYMEXPRESS');
  });

  it('throws a sanitized error when neither source is complete', () => {
    assert.throws(
      () => selectCorreosWSCredentials({ db: { correos_ws_username: 'db-user' }, env: {} }),
      { message: 'Correos WS credentials are not configured.' },
    );
  });

  it('fingerprints token cache keys so password rotation cannot reuse a token', () => {
    const first = credentialTokenCacheKey({
      username: 'user',
      password: 'old',
      sistema: 'PYMEXPRESS',
      usuarioId: 1,
      servicioId: 1,
      codCliente: 'A',
    });
    const rotated = credentialTokenCacheKey({
      username: 'user',
      password: 'new',
      sistema: 'PYMEXPRESS',
      usuarioId: 1,
      servicioId: 1,
      codCliente: 'A',
    });
    assert.notEqual(first, rotated);
    assert.equal(first.length, 64);
    assert.match(first, /^[a-f0-9]+$/);
  });
});

describe('Correos guía failure copy', () => {
  it('labels 401 token failures as credential rejection', () => {
    assert.equal(formatGuiaFailureLabel('Correos token auth failed (401)'), 'Correos rechazó las credenciales');
    assert.equal(formatGuiaFailureDetail('Correos token auth failed (401)'), 'Correos rechazó las credenciales');
    assert.equal(formatGuiaFailureLabel('timeout'), 'Fallida');
  });

  it('does not treat proxy 502 as a credential rejection', () => {
    assert.equal(isCorreosCredentialRejection('Correos token auth failed (502)'), false);
    assert.equal(isCorreosProxyUnavailable('Correos token auth failed (502)'), true);
    assert.equal(formatGuiaFailureLabel('Correos token auth failed (502)'), 'Correos no disponible');
    assert.match(formatGuiaFailureDetail('Correos token auth failed (502)') || '', /ECONNREFUSED|:447/);
  });

  it('strips a trailing slash from CORREOS_PROXY_URL', () => {
    const prevUrl = process.env.CORREOS_PROXY_URL;
    const prevSecret = process.env.CORREOS_PROXY_SECRET;
    process.env.CORREOS_PROXY_URL = 'https://proxy.example.test/';
    process.env.CORREOS_PROXY_SECRET = 'x';
    try {
      assert.equal(getProxyUrl(), 'https://proxy.example.test');
      assert.equal(getTokenUrl(), 'https://proxy.example.test/token/authenticate');
    } finally {
      if (prevUrl === undefined) delete process.env.CORREOS_PROXY_URL;
      else process.env.CORREOS_PROXY_URL = prevUrl;
      if (prevSecret === undefined) delete process.env.CORREOS_PROXY_SECRET;
      else process.env.CORREOS_PROXY_SECRET = prevSecret;
    }
  });

  it('surfaces admin-safe 502 copy from CorreosAuthError', () => {
    const err = new CorreosAuthError(502);
    assert.equal(err.message, 'Correos proxy/token unavailable (502)');
    assert.equal(formatLogisticsGuiaError(err), 'Correos proxy/token unavailable (502)');
    assert.equal(
      formatLogisticsGuiaError(new Error('socket hang up')),
      'Guia generation failed due to a connection or service error',
    );
    assert.equal(
      formatLogisticsGuiaError(new Error('ccrGenerarGuia failed: peso invalido')),
      'ccrGenerarGuia failed: peso invalido',
    );
  });
});
