const builder = document.querySelector('#campaign-builder');
const campaignForm = document.querySelector('#campaign-form');
const builderStatus = document.querySelector('#builder-status');
let builderCustomer, savedDraft;
const draftFields = ['name', 'adGroup', 'budget', 'bid', 'url', 'location', 'matchType', 'keywords', 'headlines', 'descriptions', 'political'];
const multiline = ['keywords', 'headlines', 'descriptions'];
function reviewDraft(draft) {
  savedDraft = draft;
  campaignForm.hidden = true; document.querySelector('#draft-review').hidden = false;
  const fields = document.querySelector('#review-fields'); fields.replaceChildren();
  const countries = { '2356': 'India', '2840': 'United States', '2826': 'United Kingdom' };
  for (const [label, value] of [['Account', draft.customer], ['Currency', draft.currency], ['Campaign', draft.name], ['Ad group', draft.adGroup], ['Average daily budget', draft.budget], ['Max. CPC', draft.bid], ['Country', countries[draft.location]], ['Language', 'English'], ['Match type', draft.matchType], ['Landing page', draft.url], ['Keywords', draft.keywords.join('\n')], ['Headlines', draft.headlines.join('\n')], ['Descriptions', draft.descriptions.join('\n')], ['EU political ads', 'No'], ['Draft ID', draft.id], ['Status', draft.status]]) {
    const dt = document.createElement('dt'); dt.textContent = label; const dd = document.createElement('dd'); dd.textContent = value; fields.append(dt, dd);
  }
  document.querySelector('#new-draft').hidden = draft.status !== 'PUBLISHED';
  document.querySelector('#publish-draft').hidden = draft.status !== 'DRAFT';
  document.querySelector('#edit-draft').hidden = draft.status !== 'DRAFT';
}
document.querySelector('#create-campaign').addEventListener('click', async () => {
  builderCustomer = dashboardClient || selectedAccount;
  builder.showModal(); campaignForm.hidden = true; document.querySelector('#draft-review').hidden = true;
  builderStatus.textContent = 'Loading saved draft…';
  try {
    const data = await api(`/api/campaign-draft?customer=${encodeURIComponent(builderCustomer)}`);
    document.querySelector('#builder-context').textContent = `Account ${builderCustomer} · ${data.currency}${data.persistent ? '' : ' · Draft storage is temporary until Redis is configured.'}`;
    campaignForm.reset(); builderStatus.textContent = '';
    if (data.draft) { reviewDraft(data.draft); }
    else { savedDraft = null; campaignForm.hidden = false; }
  } catch (e) { builderStatus.textContent = e.message; }
});
document.querySelector('#close-builder').addEventListener('click', () => builder.close());
document.querySelector('#edit-draft').addEventListener('click', () => {
  for (const key of draftFields) campaignForm.elements[key].value = multiline.includes(key) ? savedDraft[key].join('\n') : savedDraft[key];
  campaignForm.hidden = false; document.querySelector('#draft-review').hidden = true; builderStatus.textContent = '';
});
campaignForm.addEventListener('submit', async event => {
  event.preventDefault(); const button = campaignForm.querySelector('button[type=submit]'); button.disabled = true;
  builderStatus.textContent = 'Saving draft…';
  const draft = Object.fromEntries(draftFields.map(key => [key, multiline.includes(key) ? campaignForm.elements[key].value.split('\n').map(v => v.trim()).filter(Boolean) : campaignForm.elements[key].value]));
  try { const result = await api('/api/campaign-draft', { customer: builderCustomer, draft }); reviewDraft(result.draft); builderStatus.textContent = 'Draft saved. Review every setting before publishing.'; }
  catch (e) { builderStatus.textContent = e.message; }
  finally { button.disabled = false; }
});
document.querySelector('#publish-draft').addEventListener('click', async event => {
  event.target.disabled = true; document.querySelector('#edit-draft').disabled = true;
  builderStatus.textContent = 'Validating with Google Ads, then publishing paused…';
  try { const result = await api('/api/campaign-draft/publish', { customer: builderCustomer, id: savedDraft.id, confirm: true }); reviewDraft(result.draft); builderStatus.textContent = 'Published to Google Ads as paused. You can enable it in Google Ads after reviewing it.'; loadDashboard(); }
  catch (e) { builderStatus.textContent = e.message; }
  finally { event.target.disabled = false; document.querySelector('#edit-draft').disabled = false; }
});

document.querySelector('#new-draft').addEventListener('click', () => { campaignForm.reset(); campaignForm.hidden = false; document.querySelector('#draft-review').hidden = true; builderStatus.textContent = ''; });
