/* Meta is isolated from the Google wizard and scoped to the active workspace. */
let metaAccount = null, metaRows = [], metaSelected = new Set(), metaStep = 1, metaGeneration = 0;
let metaBuilderWs = null, metaBuilderAccount = null;
const metaCanEdit = () => ["Owner", "Admin", "Publisher", "Editor"].includes(currentRole);
const metaCall = (path = "", method = "GET", data, ws = activeWs) => workspaceRequest(`/${ws}/meta${path}`, method, data);
const metaText = (tag, value, className) => { const el = document.createElement(tag); el.textContent = value; if (className) el.className = className; return el; };
function metaError(error) { $("meta-error").textContent = error.message || String(error); }

function initMeta() {
  $("nav-meta").onclick = () => showView("meta");
  $("meta-connect").onclick = async () => { try { const r = await workspaceRequest(`/${activeWs}/auth/meta/url`); location.href = r.url; } catch (e) { metaError(e); } };
  $("meta-change").onclick = () => { $("meta-account-form").hidden = false; loadMetaAccounts(); };
  $("meta-reload-accounts").onclick = loadMetaAccounts;
  $("meta-account-form").onsubmit = async e => {
    e.preventDefault(); const ws = activeWs, button = e.submitter; button.disabled = true;
    try { await metaCall("/account", "POST", {account_id: $("meta-account").value}, ws); if (ws === activeWs) await loadMeta(); }
    catch (err) { if (ws === activeWs) metaError(err); } finally { button.disabled = false; }
  };
  $("meta-disconnect").onclick = async () => {
    if (!confirm("Disconnect Meta from this workspace? Stored credentials will be removed. Campaigns in Meta remain unchanged.")) return;
    const ws = activeWs;
    try { await metaCall("", "DELETE", undefined, ws); if (ws === activeWs) await loadMeta(); } catch (e) { if (ws === activeWs) metaError(e); }
  };
  $("meta-refresh").onclick = loadMetaReport;
  $("meta-range").onchange = loadMetaReport;
  $("meta-imported-only").onchange = renderMetaReport;
  $("meta-refresh-drafts").onclick = loadMetaDrafts;
  $("meta-import").onclick = async () => {
    const ws = activeWs, button = $("meta-import"); button.disabled = true;
    try { await metaCall("/campaigns/import", "POST", {campaign_ids: [...metaSelected]}, ws); if (ws === activeWs) { toast("Meta campaign selection saved.", "success"); await loadMetaReport(); } }
    catch (e) { if (ws === activeWs) metaError(e); } finally { button.disabled = false; }
  };
  $("meta-create").onclick = () => {
    if (!metaAccount) return;
    metaBuilderWs = activeWs; metaBuilderAccount = metaAccount.account_id;
    $("meta-builder").reset(); $("meta-builder-error").textContent = "";
    $("meta-image-preview").hidden = true;
    $("meta-page").replaceChildren(new Option("Choose a Page", "")); $("meta-image").replaceChildren(new Option("Choose an image", ""));
    $("meta-builder-account").textContent = `${metaAccount.name} · ${metaAccount.account_id} · ${metaAccount.currency}`;
    $("meta-budget-label").textContent = `Average daily budget · ${metaAccount.currency}`;
    $("meta-dashboard").hidden = true; $("meta-builder").hidden = false; $("meta-create").hidden = true;
    setMetaStep(1); loadMetaResources();
  };
  $("meta-builder-cancel").onclick = () => { $("meta-builder").hidden = true; $("meta-dashboard").hidden = false; $("meta-create").hidden = !metaCanEdit(); };
  $("meta-next").onclick = () => {
    const inputs = $("meta-builder").querySelectorAll(`[data-meta-step="${metaStep}"] input, [data-meta-step="${metaStep}"] select, [data-meta-step="${metaStep}"] textarea`);
    for (const input of inputs) if (!input.reportValidity()) return;
    if (metaStep === 3 && !$("meta-url").value.startsWith("https://")) { $("meta-builder-error").textContent = "Use an HTTPS landing page."; return; }
    $("meta-builder-error").textContent = ""; setMetaStep(metaStep + 1);
  };
  $("meta-back").onclick = () => setMetaStep(metaStep - 1);
  $("meta-refresh-resources").onclick = loadMetaResources;
  $("meta-image").onchange = () => {
    const url = $("meta-image").selectedOptions[0]?.dataset.url;
    $("meta-image-preview").hidden = !url;
    if (url) $("meta-image-preview").src = url; else $("meta-image-preview").removeAttribute("src");
  };
  $("meta-builder").onsubmit = async e => {
    e.preventDefault();
    if (metaStep !== 4) { $("meta-next").click(); return; }
    for (const input of $("meta-builder").querySelectorAll("input, select, textarea")) {
      if (!input.checkValidity()) { setMetaStep(Number(input.closest("[data-meta-step]").dataset.metaStep)); input.reportValidity(); return; }
    }
    if (metaBuilderWs !== activeWs || metaBuilderAccount !== metaAccount?.account_id) { $("meta-builder-error").textContent = "The account changed. Reopen the campaign builder."; return; }
    const ws = activeWs; $("meta-save").disabled = true;
    try { await metaCall("/drafts", "POST", metaFormData(), ws); if (ws === activeWs) { $("meta-builder-cancel").click(); await loadMetaDrafts(); toast("Meta draft saved. Review before publishing.", "success"); } }
    catch (err) { if (ws === activeWs) $("meta-builder-error").textContent = err.message; } finally { $("meta-save").disabled = false; }
  };
}

async function loadMeta() {
  if (!activeWs) return;
  const ws = activeWs, generation = ++metaGeneration;
  metaAccount = null; metaRows = []; metaSelected = new Set();
  $("meta-builder").hidden = true; $("meta-dashboard").hidden = true; $("meta-create").hidden = true;
  $("meta-selected").textContent = ""; $("meta-error").textContent = "";
  $("meta-account-form").hidden = true; $("meta-change").hidden = true; $("meta-disconnect").hidden = true;
  $("meta-connection-title").textContent = "Loading Meta connection…";
  try {
    const data = await metaCall("", "GET", undefined, ws);
    if (ws !== activeWs || generation !== metaGeneration) return;
    metaAccount = data.account;
    const expired = data.connection && data.connection.expires_at <= Date.now();
    $("meta-connection-title").textContent = data.connection?.account_name || "Connect Meta";
    $("meta-connection-detail").textContent = data.connection ? (expired ? "Your Meta authorization expired. Reconnect to continue." : "Authorization expires " + new Date(data.connection.expires_at).toLocaleDateString() + ". Reconnect when required by Meta.") : "Your 8LM login stays separate from your Meta account.";
    $("meta-connection-status").textContent = expired ? "Reconnect required" : data.account ? "Account selected" : data.connection ? "Choose an account" : "Not connected";
    $("meta-setup").hidden = data.configured;
    $("meta-connect").hidden = !currentManage; $("meta-connect").disabled = !data.configured;
    $("meta-connect").textContent = data.connection ? "Reconnect Meta" : "Connect with Meta";
    $("meta-disconnect").hidden = !data.connection || !currentManage;
    $("meta-change").hidden = !metaAccount || !currentManage || expired;
    $("meta-account-form").hidden = !data.connection || !!metaAccount || !currentManage || expired;
    if (data.connection && !metaAccount && currentManage && !expired) await loadMetaAccounts();
    if (metaAccount) {
      $("meta-selected").textContent = `${metaAccount.name} · ${metaAccount.account_id} · ${metaAccount.currency} · ${metaAccount.timezone_name}`;
      $("meta-dashboard").hidden = false; $("meta-create").hidden = !metaCanEdit() || expired;
      $("meta-import").hidden = !metaCanEdit();
      await Promise.all([loadMetaReport(), loadMetaDrafts()]);
    }
  } catch (e) { if (ws === activeWs && generation === metaGeneration) metaError(e); }
}
async function loadMetaAccounts() {
  const ws = activeWs;
  $("meta-accounts-status").textContent = "Loading accessible accounts…";
  try {
    const data = await metaCall("/accounts", "GET", undefined, ws);
    if (ws !== activeWs) return;
    $("meta-account").replaceChildren(new Option("Choose an account", ""));
    for (const a of data.accounts) {
      const option = new Option(`${a.name} · ${a.id} · ${a.currency}${a.account_status === 1 ? "" : " · unavailable"}`, a.id);
      option.disabled = a.account_status !== 1; $("meta-account").append(option);
    }
    $("meta-account").value = metaAccount?.account_id || "";
    $("meta-accounts-status").textContent = data.accounts.length ? "Choose an active account for this workspace." : "No accounts found. Check the assets granted during Meta login.";
  } catch (e) { if (ws === activeWs) $("meta-accounts-status").textContent = e.message; }
}
let metaReportSequence = 0;
async function loadMetaReport() {
  const ws = activeWs, sequence = ++metaReportSequence;
  $("meta-report-notice").textContent = "Loading campaign performance…";
  $("meta-refresh").disabled = true;
  try {
    const data = await metaCall("/campaigns?date_preset=" + $("meta-range").value, "GET", undefined, ws);
    if (ws !== activeWs || sequence !== metaReportSequence) return;
    metaRows = data.campaigns; metaSelected = new Set(metaRows.filter(r => r.imported).map(r => r.id));
    $("meta-report-notice").textContent = data.reporting_error || "Updated " + new Date().toLocaleTimeString();
    renderMetaReport();
  } catch (e) { if (ws === activeWs && sequence === metaReportSequence) { metaRows = []; renderMetaReport(); $("meta-report-notice").textContent = e.message; } }
  finally { if (sequence === metaReportSequence) $("meta-refresh").disabled = false; }
}
function renderMetaReport() {
  const rows = $("meta-imported-only").checked ? metaRows.filter(r => r.imported) : metaRows;
  const currency = metaAccount?.currency || "USD";
  const money = v => { try { return new Intl.NumberFormat(undefined, {style: "currency", currency}).format(Number(v || 0)); } catch { return `${Number(v || 0).toFixed(2)} ${currency}`; } };
  $("meta-campaigns").replaceChildren(); $("meta-kpis").replaceChildren();
  const totals = {spend: 0, impressions: 0, clicks: 0};
  const available = rows.length > 0 && rows.every(r => r.metrics !== null);
  for (const row of rows) {
    const tr = document.createElement("tr"), td = document.createElement("td"), check = document.createElement("input");
    check.type = "checkbox"; check.checked = metaSelected.has(row.id); check.disabled = !metaCanEdit(); check.setAttribute("aria-label", "Import " + row.name);
    check.onchange = () => check.checked ? metaSelected.add(row.id) : metaSelected.delete(row.id); td.append(check); tr.append(td);
    const title = document.createElement("td"); title.append(metaText("strong", row.name), metaText("div", (row.objective || "Campaign").replace("OUTCOME_", "") + " · " + row.id, "subtle"));
    tr.append(title, metaText("td", row.effective_status || row.status));
    const m = row.metrics;
    for (const key of Object.keys(totals)) totals[key] += Number(m?.[key] || 0);
    for (const value of m === null ? ["—", "—", "—", "—", "—"] : [Number(m.impressions || 0).toLocaleString(), Number(m.clicks || 0).toLocaleString(), money(m.spend), Number(m.ctr || 0).toFixed(2) + "%", Number(m.clicks) ? money(m.cpc) : "—"]) tr.append(metaText("td", value));
    $("meta-campaigns").append(tr);
  }
  if (!rows.length) { const tr = document.createElement("tr"), td = metaText("td", "No campaigns to show. Refresh or change the imported-campaign filter."); td.colSpan = 8; tr.append(td); $("meta-campaigns").append(tr); }
  for (const [label, value] of [["Spend", money(totals.spend)], ["Impressions", totals.impressions.toLocaleString()], ["Clicks", totals.clicks.toLocaleString()], ["CTR", (totals.impressions ? totals.clicks / totals.impressions * 100 : 0).toFixed(2) + "%"]]) {
    const card = document.createElement("div"); card.append(metaText("span", label, "subtle"), metaText("strong", available ? value : "—")); $("meta-kpis").append(card);
  }
}
function metaFormData() {
  const data = Object.fromEntries(new FormData($("meta-builder")));
  data.no_special_category = $("meta-builder").elements.no_special_category.checked;
  return data;
}
function metaReview(p, currency) {
  return `Campaign: ${p.name}\nAd set: ${p.adset_name}\nAd: ${p.ad_name}\nObjective: Website traffic\nDaily budget: ${p.daily_budget} ${currency}\nCountry: ${p.country}\nAudience: Broad · ages 18–65+\nPlacement: Facebook Feed\nOptimisation: Link clicks\nPage: ${p.page_id}\nImage: ${p.image_hash}\nLanding page: ${p.final_url}\n\n${p.headline}\n${p.primary_text}\n${p.description || ""}\nCall to action: ${p.call_to_action}\n\nCampaign, ad set and ad will all be paused.`;
}
function setMetaStep(step) {
  metaStep = Math.max(1, Math.min(step, 4));
  document.querySelectorAll("[data-meta-step]").forEach(el => el.hidden = Number(el.dataset.metaStep) !== metaStep);
  for (let i = 1; i <= 4; i++) $("meta-step-label-" + i).classList.toggle("active", i === metaStep);
  $("meta-back").hidden = metaStep === 1; $("meta-next").hidden = metaStep === 4; $("meta-save").hidden = metaStep !== 4;
  if (metaStep === 4) $("meta-review").textContent = metaReview(metaFormData(), metaAccount.currency);
}
async function loadMetaResources() {
  const ws = activeWs, account = metaBuilderAccount;
  $("meta-refresh-resources").disabled = true; $("meta-resources-status").textContent = "Loading Pages and account images…";
  try {
    const data = await metaCall("/resources", "GET", undefined, ws);
    if (ws !== activeWs || metaBuilderWs !== ws || metaBuilderAccount !== account || data.account_id !== account) return;
    const selectedPage = $("meta-page").value, selectedImage = $("meta-image").value;
    $("meta-page").replaceChildren(new Option("Choose a Page", "")); $("meta-image").replaceChildren(new Option("Choose an image", ""));
    for (const page of data.pages) $("meta-page").append(new Option(page.name + " · " + page.id, page.id));
    for (const image of data.images) { const option = new Option(`${image.name || image.hash} · ${image.width || "?"} × ${image.height || "?"}`, image.hash); if (image.url?.startsWith("https://")) option.dataset.url = image.url; $("meta-image").append(option); }
    $("meta-page").value = selectedPage; $("meta-image").value = selectedImage; $("meta-image").dispatchEvent(new Event("change"));
    $("meta-resources-status").textContent = data.pages.length && data.images.length ? "Pages and images loaded." : "Missing Pages or images. Grant Page advertising access and upload an image in Ads Manager, then refresh.";
  } catch (e) { if (ws === activeWs) $("meta-resources-status").textContent = e.message; }
  finally { $("meta-refresh-resources").disabled = false; }
}
async function loadMetaDrafts() {
  const ws = activeWs;
  try {
    const result = await metaCall("/drafts", "GET", undefined, ws);
    if (ws !== activeWs) return;
    $("meta-drafts").replaceChildren();
    for (const d of result.drafts) {
      const row = document.createElement("div"); row.className = "publication-row";
      const body = document.createElement("div"); body.append(metaText("strong", d.payload.name), metaText("p", `${d.account_id} · ${d.state}${d.pending_step ? " · " + d.pending_step : ""}`, "subtle"));
      const details = document.createElement("details"); details.append(metaText("summary", "Review configuration"), metaText("pre", metaReview(d.payload, d.currency), "meta-review")); body.append(details);
      if (d.error) body.append(metaText("p", d.error, "publish-error"));
      if (Object.keys(d.resources).length) body.append(metaText("p", Object.entries(d.resources).map(([k,v]) => `${k}: ${v}`).join(" · "), "subtle"));
      if (d.resources.campaign) { const a = metaText("a", "Open in Ads Manager ↗"); a.href = `https://adsmanager.facebook.com/adsmanager/manage/campaigns?act=${encodeURIComponent(d.account_id.replace("act_", ""))}&selected_campaign_ids=${encodeURIComponent(d.resources.campaign)}`; a.target = "_blank"; a.rel = "noopener noreferrer"; body.append(a); }
      row.append(body);
      if (d.state !== "PUBLISHED" && ["Owner", "Admin", "Publisher"].includes(currentRole)) {
        const button = metaText("button", ["UNKNOWN", "SENDING"].includes(d.state) ? "Check publication status" : d.state === "FAILED" ? "Resume publication" : "Publish paused", "btn btn-filled");
        button.disabled = d.account_id !== metaAccount?.account_id;
        button.onclick = async () => {
          if (!["UNKNOWN", "SENDING"].includes(d.state) && !confirm(`Publish this traffic campaign to ${d.account_id} with daily budget ${d.payload.daily_budget} ${d.currency}? Campaign, ad set and ad will be paused. Existing completed steps are reused.`)) return;
          button.disabled = true;
          try { const result = await metaCall(`/drafts/${d.id}/publish`, "POST", {}, ws); if (ws === activeWs) toast(result.ok ? "Meta campaign published paused." : result.error, result.ok ? "success" : "error"); }
          catch (e) { if (ws === activeWs) metaError(e); }
          finally { if (ws === activeWs) { await loadMetaDrafts(); await loadMetaReport(); } }
        };
        row.append(button);
      }
      $("meta-drafts").append(row);
    }
    if (!result.drafts.length) $("meta-drafts").textContent = "No Meta drafts yet. Create a campaign to get started.";
  } catch (e) { if (ws === activeWs) metaError(e); }
}
