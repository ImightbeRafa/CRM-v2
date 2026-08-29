import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  credentialTokenCacheKey,
  selectCorreosWSCredentials,
} from '../correos/credential-select';
import { formatGuiaFailureDetail, formatGuiaFailureLabel } from '../correos/auth-error';

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
});
