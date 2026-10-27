import test from 'node:test';
import assert from 'node:assert/strict';
import { validateDraft, campaignOperations, draftRepository } from '../campaigns.js';
const input = { name: 'Search', adGroup: 'Group', budget: '20.50', bid: '1.25', url: 'https://example.com', location: '2356', matchType: 'EXACT', keywords: ['test product'], headlines: ['Headline one', 'Headline two', 'Headline three'], descriptions: ['First description', 'Second description'], political: 'NO' };
test('Search campaign publication is atomic and paused with correct budget units', () => {
 const ops = campaignOperations(validateDraft(input), '1234567890', 'draft-id');
 assert.equal(ops[0].campaignBudgetOperation.create.amountMicros, '20500000');
 assert.equal(ops[1].campaignOperation.create.status, 'PAUSED');
 assert.equal(ops[1].campaignOperation.create.networkSettings.targetContentNetwork, false);
 assert.equal(ops[4].adGroupOperation.create.cpcBidMicros, '1250000');
 assert.equal(ops[5].adGroupCriterionOperation.create.keyword.matchType, 'EXACT');
 assert.equal(ops[6].adGroupAdOperation.create.ad.responsiveSearchAd.headlines.length, 3);
});
test('reject invalid or incomplete creative, budget, targeting and declarations', () => {
 for (const change of [{budget: '-1'}, {bid: 'Infinity'}, {url:'javascript:alert(1)'}, {headlines:['one']}, {headlines:['same','same','same']}, {descriptions:['x'.repeat(91),'second']}, {political:''}, {location:'999'}, {matchType:'INVALID'}]) assert.throws(() => validateDraft({...input,...change}));
});
test('draft storage isolates identities and prevents concurrent publish locks', async () => {
 const repo = draftRepository();
 await repo.put('user:account', input);
 assert.equal(await repo.get('other:account'), null);
 assert.deepEqual(await repo.get('user:account'), input);
 assert.equal(await repo.lock('user:account'), true);
 assert.equal(await repo.lock('user:account'), false);
 await repo.unlock('user:account');
 assert.equal(await repo.lock('user:account'), true);
});
