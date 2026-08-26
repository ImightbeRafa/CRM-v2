import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { getIntegrationAllowedOrigins, isIntegrationOriginAllowed } from '../integration-cors';

describe('integration CORS', () => {
  it('allows originless server-to-server requests', () => {
    assert.equal(isIntegrationOriginAllowed(null, 'production', ''), true);
  });

  it('allows exact configured and production origins', () => {
    const configured = ' https://store.example.com,https://other.example.com/path ';
    const origins = getIntegrationAllowedOrigins('production', configured);
    assert.equal(origins.has('https://betsycrm.com'), true);
    assert.equal(origins.has('https://store.example.com'), true);
    assert.equal(origins.has('https://other.example.com'), true);
  });

  it('rejects hostile and substring-spoofed origins', () => {
    assert.equal(isIntegrationOriginAllowed('https://evil.example', 'production', ''), false);
    assert.equal(isIntegrationOriginAllowed('https://betsycrm.com.evil.example', 'production', ''), false);
  });

  it('allows localhost only outside production', () => {
    assert.equal(isIntegrationOriginAllowed('http://localhost:3000', 'development', ''), true);
    assert.equal(isIntegrationOriginAllowed('http://localhost:3000', 'production', ''), false);
  });
});
