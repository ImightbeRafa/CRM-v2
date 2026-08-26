import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  cancelTilopayRepeatPlan,
  TilopayCancellationError,
} from '../tilopay-repeat';

const originalUser = process.env.TILOPAY_USER;
const originalPassword = process.env.TILOPAY_PASSWORD;
const originalBaseUrl = process.env.TILOPAY_BASE_URL;
const originalFetch = global.fetch;

afterEach(() => {
  if (originalUser === undefined) delete process.env.TILOPAY_USER;
  else process.env.TILOPAY_USER = originalUser;
  if (originalPassword === undefined) delete process.env.TILOPAY_PASSWORD;
  else process.env.TILOPAY_PASSWORD = originalPassword;
  if (originalBaseUrl === undefined) delete process.env.TILOPAY_BASE_URL;
  else process.env.TILOPAY_BASE_URL = originalBaseUrl;
  global.fetch = originalFetch;
});

describe('Tilopay cancellation', () => {
  it('fails closed when provider credentials are absent', async () => {
    delete process.env.TILOPAY_USER;
    delete process.env.TILOPAY_PASSWORD;
    await assert.rejects(
      cancelTilopayRepeatPlan('provider-plan'),
      (error: unknown) => error instanceof TilopayCancellationError && error.code === 'not_configured',
    );
  });

  it('does not report success when the provider rejects cancellation', async () => {
    process.env.TILOPAY_USER = 'test-user';
    process.env.TILOPAY_PASSWORD = 'test-password';
    process.env.TILOPAY_BASE_URL = 'https://tilopay.invalid/api';
    let call = 0;
    global.fetch = (async () => {
      call += 1;
      if (call === 1) {
        return new Response(JSON.stringify({ access_token: 'test-token' }), { status: 200 });
      }
      return new Response(JSON.stringify({ type: '400' }), { status: 400 });
    }) as typeof fetch;

    await assert.rejects(
      cancelTilopayRepeatPlan('provider-plan'),
      (error: unknown) => error instanceof TilopayCancellationError && error.code === 'provider_rejected',
    );
    assert.equal(call, 2);
  });

  it('resolves only after provider confirmation', async () => {
    process.env.TILOPAY_USER = 'test-user';
    process.env.TILOPAY_PASSWORD = 'test-password';
    process.env.TILOPAY_BASE_URL = 'https://tilopay.invalid/api';
    const requests: Array<{ url: string; authorization: string | null }> = [];
    global.fetch = (async (input, init) => {
      requests.push({
        url: String(input),
        authorization: new Headers(init?.headers).get('authorization'),
      });
      if (requests.length === 1) {
        return new Response(JSON.stringify({ access_token: 'test-token' }), { status: 200 });
      }
      return new Response(JSON.stringify({ type: '200' }), { status: 200 });
    }) as typeof fetch;

    await cancelTilopayRepeatPlan('provider-plan');
    assert.equal(requests.length, 2);
    assert.equal(requests[1].authorization, 'Bearer test-token');
  });
});
