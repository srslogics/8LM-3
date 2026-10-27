export const ranges = ['LAST_7_DAYS', 'LAST_30_DAYS', 'THIS_MONTH', 'LAST_MONTH'];
export function summarize(campaigns) {
  const totals = campaigns.reduce((sum, row) => {
    for (const key of ['impressions', 'clicks', 'cost', 'conversions']) sum[key] += row[key];
    return sum;
  }, { impressions: 0, clicks: 0, cost: 0, conversions: 0 });
  return { ...totals, ctr: totals.impressions ? totals.clicks / totals.impressions : 0, averageCpc: totals.clicks ? totals.cost / totals.clicks : 0 };
}
export function normalizeCampaign(row) {
  const m = row.metrics || {};
  return { id: row.campaign.id, name: row.campaign.name, status: row.campaign.status, channel: row.campaign.advertisingChannelType,
    impressions: Number(m.impressions || 0), clicks: Number(m.clicks || 0), cost: Number(m.costMicros || 0) / 1e6, conversions: Number(m.conversions || 0) };
}

export function reportingError(error) {
  let body = error.response?.data;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch { body = null; }
  }
  // SearchStream may wrap failures in an array, unlike ordinary REST errors.
  const envelopes = Array.isArray(body) ? body : [body];
  const payloads = envelopes.map(item => item?.error || item).filter(item => item && typeof item === 'object');
  const details = payloads.flatMap(payload => Array.isArray(payload.details) ? payload.details : []);
  const validCode = code => typeof code === 'string' && /^[A-Z][A-Z0-9_]{1,100}$/.test(code);
  const codes = details.flatMap(detail => [detail.reason, ...(Array.isArray(detail.errors) ? detail.errors.flatMap(item => Object.values(item.errorCode || {})) : [])]).filter(validCode);
  const code = codes[0] || payloads.map(payload => payload.status).find(validCode) || 'REPORTING_FAILED';
  const guidance = {
    CLOUD_PROJECT_NOT_APPROVED_FOR_PRODUCTION: 'Your Google Cloud project has test-only Google Ads API access. Open Google Ads API Overview in project lm-3-demo and apply for Explorer or higher access to use real accounts.',
    DEVELOPER_TOKEN_NOT_APPROVED: 'Google Ads API access is limited to test accounts. Check the production access level for project lm-3-demo.',
    SERVICE_DISABLED: 'Enable Google Ads API in the Google Cloud project that owns your OAuth client, then retry.',
    ACCESS_TOKEN_SCOPE_INSUFFICIENT: 'Reconnect Google Ads and grant the requested Google Ads permission.',
    USER_PERMISSION_DENIED: 'This Google user does not have reporting access to the account. Check Google Ads Access and security; if access is through a manager, select that manager and then its client.',
    CUSTOMER_NOT_ENABLED: 'This Google Ads account is not enabled. Complete its signup or check its account status in Google Ads.',
    NOT_ADS_USER: 'Sign in with a Google user that has access to Google Ads.',
    RESOURCE_EXHAUSTED: 'Google Ads is rate limiting requests. Try again shortly.'
  };
  const status = error.response?.status;
  const fallback = status === 401 ? 'Google authorization expired. Reconnect Google Ads.' : status === 403 ? 'Google denied reporting access. Check your account permissions and Cloud project API access.' : 'Could not load campaign performance. Try again shortly.';
  return { error: `${guidance[code] || fallback} (Google code: ${code})`, code };
}
