import test from 'node:test';
import assert from 'node:assert/strict';
import { summarize, normalizeCampaign } from '../reporting.js';
test('zero activity and weighted totals retain fractional conversions', () => {
  assert.equal(summarize([]).averageCpc, 0);
  assert.equal(summarize([]).ctr, 0);
  const totals = summarize([{ impressions: 100, clicks: 10, cost: 2, conversions: 1.5 }, { impressions: 900, clicks: 0, cost: 0, conversions: 0 }]);
  assert.equal(totals.ctr, .01);
  assert.equal(totals.conversions, 1.5);
  assert.equal(normalizeCampaign({ campaign: { id: '1' }, metrics: {} }).cost, 0);
});

import { reportingError } from '../reporting.js';
test('Google errors identify production access without exposing raw credentials', () => {
  const result = reportingError({ response: { status: 403, data: { error: { message: 'SECRET', details: [{ errors: [{ errorCode: { authorizationError: 'CLOUD_PROJECT_NOT_APPROVED_FOR_PRODUCTION' }, message: 'SECRET' }] }] } } } });
  assert.match(result.error, /Explorer/);
  assert.equal(result.code, 'CLOUD_PROJECT_NOT_APPROVED_FOR_PRODUCTION');
  assert.ok(!result.error.includes('SECRET'));
  assert.equal(reportingError({ response: { data: { error: { details: [{ reason: 'SERVICE_DISABLED' }] } } } }).code, 'SERVICE_DISABLED');
  assert.equal(reportingError({}).code, 'REPORTING_FAILED');
});
