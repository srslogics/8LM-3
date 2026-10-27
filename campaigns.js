import { randomUUID } from 'node:crypto';
export function validateDraft(input) {
  const d = {};
  for (const [key, max] of [['name', 100], ['adGroup', 100]]) {
    if (typeof input[key] !== 'string' || !input[key].trim() || input[key].length > max) throw new Error(`Enter ${key === 'name' ? 'a campaign name' : 'an ad group name'} (up to ${max} characters).`);
    d[key] = input[key].trim();
  }
  for (const key of ['budget', 'bid']) {
    if (!/^\d+(\.\d{1,2})?$/.test(String(input[key])) || Number(input[key]) <= 0 || Number(input[key]) > 1000000) throw new Error('Enter a positive daily budget and CPC bid, with up to two decimal places.');
    d[key] = String(input[key]);
  }
  const url = new URL(input.url);
  if (url.protocol !== 'https:' || url.username || url.password) throw new Error('Enter a valid HTTPS landing page URL.');
  d.url = url.href;
  for (const [key, min, max, length] of [['headlines', 3, 15, 30], ['descriptions', 2, 4, 90], ['keywords', 1, 50, 80]]) {
    const values = input[key];
    if (!Array.isArray(values) || values.length < min || values.length > max || values.some(v => typeof v !== 'string' || !v.trim() || [...v.trim()].length > length)) throw new Error(`Provide ${min}–${max} ${key}, each up to ${length} characters.`);
    d[key] = [...new Set(values.map(v => v.trim()))];
    if (d[key].length < min) throw new Error(`Provide at least ${min} different ${key}.`);
  }
  if (!['EXACT', 'PHRASE'].includes(input.matchType)) throw new Error('Choose exact or phrase keyword matching.');
  d.matchType = input.matchType;
  if (!['2356', '2840', '2826'].includes(input.location)) throw new Error('Choose a target location.');
  d.location = input.location;
  if (input.political !== 'NO') throw new Error('This builder supports campaigns without EU political advertising only.');
  d.political = 'NO';
  return d;
}
export function campaignOperations(d, customer, id) {
  const prefix = `customers/${customer}`;
  const budget = `${prefix}/campaignBudgets/-1`, campaign = `${prefix}/campaigns/-2`, group = `${prefix}/adGroups/-3`;
  return [
    { campaignBudgetOperation: { create: { resourceName: budget, name: `${d.name} · ${id}`, amountMicros: String(Math.round(Number(d.budget) * 1e6)), deliveryMethod: 'STANDARD', explicitlyShared: false } } },
    { campaignOperation: { create: { resourceName: campaign, name: `${d.name} [8LM ${id}]`, status: 'PAUSED', advertisingChannelType: 'SEARCH', campaignBudget: budget, manualCpc: {}, containsEuPoliticalAdvertising: 'DOES_NOT_CONTAIN_EU_POLITICAL_ADVERTISING', networkSettings: { targetGoogleSearch: true, targetSearchNetwork: false, targetContentNetwork: false }, geoTargetTypeSetting: { positiveGeoTargetType: 'PRESENCE' } } } },
    { campaignCriterionOperation: { create: { campaign, location: { geoTargetConstant: `geoTargetConstants/${d.location}` } } } },
    { campaignCriterionOperation: { create: { campaign, language: { languageConstant: 'languageConstants/1000' } } } },
    { adGroupOperation: { create: { resourceName: group, name: d.adGroup, campaign, status: 'ENABLED', type: 'SEARCH_STANDARD', cpcBidMicros: String(Math.round(Number(d.bid) * 1e6)) } } },
    ...d.keywords.map(text => ({ adGroupCriterionOperation: { create: { adGroup: group, status: 'ENABLED', keyword: { text, matchType: d.matchType } } } })),
    { adGroupAdOperation: { create: { adGroup: group, status: 'ENABLED', ad: { finalUrls: [d.url], responsiveSearchAd: { headlines: d.headlines.map(text => ({ text })), descriptions: d.descriptions.map(text => ({ text })) } } } } }
  ];
}
// Drafts live outside sessions, keyed by verified Google identity and account.
export function draftRepository(redis) {
  const memory = new Map();
  return {
    persistent: Boolean(redis),
    async get(key) { const data = redis ? await redis.get(`8lm:draft:${key}`) : memory.get(key); return data ? JSON.parse(data) : null; },
    async put(key, value) { const data = JSON.stringify(value); if (redis) await redis.set(`8lm:draft:${key}`, data); else memory.set(key, data); },
    async lock(key) { if (redis) return Boolean(await redis.set(`8lm:publish:${key}`, randomUUID(), { NX: true })); if (memory.has(`lock:${key}`)) return false; memory.set(`lock:${key}`, '1'); return true; },
    async unlock(key) { if (redis) await redis.del(`8lm:publish:${key}`); else memory.delete(`lock:${key}`); }
  };
}
