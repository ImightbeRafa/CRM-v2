import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  DEEPSLEEP_TENANT_ID,
  canAccessLogistics,
  isDeepSleepTenantId,
} from '../logistics-access'

describe('logistics-access', () => {
  it('identifies DeepSleep tenant id', () => {
    assert.equal(isDeepSleepTenantId(DEEPSLEEP_TENANT_ID), true)
    assert.equal(isDeepSleepTenantId('other'), false)
    assert.equal(isDeepSleepTenantId(null), false)
  })

  it('denies when not logistics admin', () => {
    assert.equal(
      canAccessLogistics({
        isLogisticsAdmin: false,
        membershipTenantIds: [DEEPSLEEP_TENANT_ID],
      }),
      false,
    )
  })

  it('denies logistics admin without DeepSleep membership', () => {
    assert.equal(
      canAccessLogistics({
        isLogisticsAdmin: true,
        membershipTenantIds: ['cmh32z0ol0000k004hvx9tg3p', 'cmm4pv8fl0000jr045en1nik9'],
      }),
      false,
    )
  })

  it('allows logistics admin who is a DeepSleep member', () => {
    assert.equal(
      canAccessLogistics({
        isLogisticsAdmin: true,
        membershipTenantIds: ['other', DEEPSLEEP_TENANT_ID],
      }),
      true,
    )
  })
})
