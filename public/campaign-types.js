/* Channel-specific panels extend the existing nine-step campaign wizard. */
const campaignFormats = {
  Search: { bid: "Manual CPC", format: "Responsive search ad", network: "Google Search · partners off", note: "Keywords and responsive search ads. Maximum CPC controls each bid." },
  "Performance Max": { bid: "Maximise conversions", format: "Asset group", network: "Google networks · automated placement", note: "Uses your account’s conversion goals. Configure conversion tracking in Google Ads first. Google may generate video from your assets. Final URL expansion is off." },
  "Demand Gen": { bid: "Maximise clicks", format: "Multi-asset image ad", network: "Demand Gen · eligible image placements", note: "Image ads with an existing audience. Optimised audience expansion is off. Google selects eligible placements and may generate video and image variations." },
  Display: { bid: "Manual CPC", format: "Responsive display ad", network: "Google Display Network", note: "Responsive image ads. This starter campaign targets your selected country broadly; no audience or placement exclusions are added." },
  Shopping: { bid: "Manual CPC", format: "Standard Shopping product ad", network: "Shopping · product feed", note: "Requires a linked Merchant Center account and approved products. Includes all eligible products in the chosen feed label." },
};

function setupCampaignTypes() {
  campaignResourceSequence++;
  if (!$("channel-creative")) {
    const creative = document.createElement("div");
    creative.id = "channel-creative";
    creative.className = "wizard-card channel-panel";
    creative.innerHTML = `<h2 id="channel-creative-title">Ad creative</h2>
      <p class="subtle" id="channel-text-help"></p>
      <div data-creative-field><label for="channel-url">Landing page URL</label><input id="channel-url" class="gcp-input" type="url" placeholder="https://example.com" maxlength="2048"></div>
      <div data-creative-field><label for="channel-business">Business name · up to 25 characters</label><input id="channel-business" class="gcp-input" maxlength="25"></div>
      <div data-creative-field><label for="channel-headlines">Headlines · one per line, up to 30 characters each</label><textarea id="channel-headlines" class="gcp-input" rows="4"></textarea></div>
      <div id="channel-long-wrap"><label for="channel-long">Long headline · up to 90 characters</label><input id="channel-long" class="gcp-input" maxlength="90"></div>
      <div data-creative-field><label for="channel-descriptions">Descriptions · one per line, up to 90 characters each</label><textarea id="channel-descriptions" class="gcp-input" rows="3"></textarea></div>
      <div id="channel-shopping" hidden>
        <label for="channel-merchant">Linked Merchant Center account ID</label><input id="channel-merchant" class="gcp-input" inputmode="numeric" placeholder="Merchant Center ID, not Google Ads ID">
        <label for="channel-feed">Feed label</label><input id="channel-feed" class="gcp-input" maxlength="20" placeholder="Exact feed label, e.g. IN">
        <label for="channel-priority">Campaign priority</label><select id="channel-priority" class="gcp-input"><option value="0">Low</option><option value="1">Medium</option><option value="2">High</option></select>
        <label class="channel-check"><input type="checkbox" id="channel-products"> Include all eligible products in this feed. I have linked this Merchant Center account to the selected Google Ads account.</label>
      </div>
      <label id="channel-conversions-wrap" class="channel-check"><input type="checkbox" id="channel-conversions"> Conversion tracking and account conversion goals are configured in Google Ads.</label>`;
    $("wizard-pane-6").prepend(creative);
    const assets = document.createElement("div");
    assets.id = "channel-assets";
    assets.className = "wizard-card channel-panel";
    assets.innerHTML = `<h2>Account assets</h2><p class="subtle">Choose images already uploaded to the selected Google Ads account. Showing up to 200 recent images. Upload new images in Google Ads → Asset library, then refresh here.</p>
      <button id="channel-assets-refresh" type="button" class="btn btn-outline">Refresh assets</button>
      <p id="channel-assets-status" role="status"></p><div class="channel-image-grid"></div>
      <div id="channel-audience-wrap"><label for="channel-audience">Audience</label><select id="channel-audience" class="gcp-input"><option value="">Choose an audience</option></select><p class="subtle">Create an audience in Google Ads Audience manager if none appear here.</p></div>`;
    for (const [field, title, help] of [["landscape_image", "Landscape image", "1.91:1 · minimum 600 × 314"], ["square_image", "Square image", "1:1 · minimum 300 × 300"], ["logo", "Square logo", "1:1 · minimum 128 × 128"]]) {
      const box = document.createElement("div");
      box.className = "channel-image-slot";
      box.innerHTML = `<label for="channel-${field}">${title}</label><p class="subtle">${help}</p><img hidden alt="Selected ${title.toLowerCase()}"><select id="channel-${field}" class="gcp-input"><option value="">Choose an image</option></select>`;
      box.querySelector("select").onchange = () => {
        const option = box.querySelector("select").selectedOptions[0];
        const img = box.querySelector("img");
        const url = option?.dataset.url;
        img.hidden = !url;
        if (url) img.src = url;
        else img.removeAttribute("src");
      };
      assets.querySelector(".channel-image-grid").append(box);
    }
    $("wizard-pane-7").prepend(assets);
    $("channel-assets-refresh").onclick = loadCampaignResources;
    const review = document.createElement("pre");
    review.id = "channel-review";
    review.className = "wizard-card channel-review";
    $("wizard-pane-9").insertBefore(review, $("wizard-pane-9").querySelector(".wizard-actions"));
  }
  for (const input of document.querySelectorAll("#channel-creative input, #channel-creative textarea")) {
    input.value = "";
    if (input.type === "checkbox") input.checked = false;
  }
  $("channel-priority").value = "0";
  $("channel-assets-refresh").disabled = false;
  $("wizard-publish-options").oninput = () => populateWizardReview();
  for (const id of ["landscape_image", "square_image", "logo", "audience"]) $("channel-" + id).replaceChildren(new Option("Choose " + (id === "audience" ? "an audience" : "an image"), ""));
  document.querySelectorAll("#channel-assets img").forEach(img => { img.hidden = true; img.removeAttribute("src"); });
  $("channel-assets-status").textContent = "Refresh to load assets from this account.";
  $("wizard-support-note").textContent = "Save a draft, review its settings, then publish a paused campaign to Google Ads.";
  document.querySelectorAll("#wizard-type-grid [data-type]").forEach(card => {
    const type = card.dataset.type;
    card.removeAttribute("aria-disabled");
    card.setAttribute("role", "button");
    card.tabIndex = 0;
    card.title = type === "Video" ? "Create standard Video campaigns in Google Ads" : "Create a " + type + " campaign";
    card.onclick = () => {
      if (type === "Video") {
        $("channel-video-note").hidden = false;
        return;
      }
      $("channel-video-note").hidden = true;
      wizardState.channel = type;
      document.querySelectorAll("#wizard-type-grid [data-type]").forEach(c => { c.classList.toggle("selected", c === card); c.setAttribute("aria-pressed", String(c === card)); });
      updateSuggestedCampaignName();
      updateCampaignType();
    };
    card.onkeydown = e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); card.click(); } };
  });
  if (!$("channel-video-note")) {
    const note = document.createElement("p");
    note.id = "channel-video-note";
    note.className = "wizard-card";
    note.hidden = true;
    note.innerHTML = 'Standard Video creation is not supported by this API flow. Use Demand Gen or Performance Max for supported YouTube placements, or <a href="https://ads.google.com/" target="_blank" rel="noopener noreferrer">create a Video campaign in Google Ads ↗</a>.';
    $("wizard-type-grid").after(note);
  }
  $("channel-video-note").hidden = true;
  document.querySelectorAll("#wizard-type-grid [data-type]").forEach(c => { c.classList.toggle("selected", c.dataset.type === "Search"); c.setAttribute("aria-pressed", String(c.dataset.type === "Search")); });
  updateCampaignType();
}

function updateCampaignType() {
  const type = wizardState.channel, search = type === "Search", shopping = type === "Shopping";
  const config = campaignFormats[type];
  $("wizard-bidding-focus").replaceChildren(new Option(config.bid, config.bid));
  $("wizard-nav-sub-2").textContent = type;
  $("wizard-nav-sub-4").textContent = config.bid;
  $("wizard-nav-sub-6").textContent = config.format;
  $("wizard-nav-sub-7").textContent = shopping ? "Merchant Center feed" : search ? "Optional extensions" : "Images & brand";
  for (const step of [6, 7]) {
    for (const child of $("wizard-pane-" + step).children) {
      if (child.classList.contains("wizard-actions")) continue;
      child.hidden = child.id === "channel-creative" ? search : child.id === "channel-assets" ? search || shopping : !search;
    }
  }
  if (shopping) {
    $("channel-assets").hidden = false;
    // Retain the seventh step with a clear product-feed explanation, no irrelevant images.
  }
  $("channel-assets").querySelectorAll("button,.channel-image-grid,#channel-audience-wrap").forEach(el => el.hidden = shopping);
  $("channel-assets").querySelector("h2").textContent = shopping ? "Product assets" : "Account assets";
  $("channel-assets").querySelector("p").textContent = shopping ? "Google uses product titles, images, prices and landing pages from Merchant Center. All eligible products in the selected feed label are included. Product approval and feed linking are checked by Google." : "Choose images already uploaded to this Google Ads account (up to 200 recent images). Upload new images in Google Ads → Asset library, then refresh here.";
  $("channel-assets-status").hidden = shopping;
  $("channel-audience-wrap").hidden = type !== "Demand Gen";
  document.querySelectorAll("[data-creative-field]").forEach(el => el.hidden = shopping);
  $("channel-shopping").hidden = !shopping;
  $("channel-long-wrap").hidden = !["Performance Max", "Display"].includes(type);
  $("channel-conversions-wrap").hidden = type !== "Performance Max";
  $("channel-creative-title").textContent = shopping ? "Product feed" : "Ad creative";
  $("channel-text-help").textContent = type === "Performance Max" ? "Add 3–15 headlines (one ≤15 characters), one long headline and 2–5 descriptions (one ≤60 characters)." : shopping ? config.note : "Add 1–5 headlines and 1–5 descriptions. Your images are selected in the next step.";
  for (const id of ["wizard-max-cpc", "wizard-match"]) {
    const show = id === "wizard-match" ? search : ["Search", "Display", "Shopping"].includes(type);
    $(id).hidden = !show;
    document.querySelector(`label[for="${id}"]`).hidden = !show;
  }
  document.querySelector('label[for="wizard-adgroup"]').textContent = type === "Performance Max" ? "Asset group name" : "Ad group name";
  $("wizard-publish-options").querySelector("p").textContent = config.note + " Published paused.";
  for (const step of [4, 5]) $("wizard-pane-" + step).querySelector(".unsupported-note").textContent = step === 4 ? config.note : search ? "Search partners and Display are off. Country targeting is sent to Google; language is automatic." : "People in the selected country · English. " + config.network;
  // Network checkboxes describe Search only, so hide their entire card for other types.
  $("wizard-network-search").closest(".wizard-card").hidden = !search;
  for (const child of $("wizard-pane-9").children) {
    if (child.id === "wizard-publish-options" || child.classList.contains("wizard-actions")) continue;
    child.hidden = child.id === "channel-review" ? search : !search;
  }
}

let campaignResourceSequence = 0;
async function loadCampaignResources() {
  const sequence = ++campaignResourceSequence, ws = activeWs;
  const status = $("channel-assets-status"), button = $("channel-assets-refresh");
  button.disabled = true;
  status.textContent = "Loading account resources…";
  try {
    const result = await workspaceRequest("/" + ws + "/ads/creative-resources/images");
    if (sequence !== campaignResourceSequence || ws !== activeWs) return;
    for (const [field, min, ratio] of [["landscape_image", 600, 1.91], ["square_image", 300, 1], ["logo", 128, 1]]) {
      const select = $("channel-" + field), selected = select.value;
      select.replaceChildren(new Option("Choose an image", ""));
      for (const image of result.items) {
        const w = Number(image.widthPixels), h = Number(image.heightPixels);
        if (w < min || h < (field === "landscape_image" ? 314 : min) || Math.abs(w / h - ratio) > ratio * .01) continue;
        const option = new Option(`${image.name || "Image"} · ${w} × ${h} · ${image.resource.split("/").pop()}`, image.resource);
        if (image.url?.startsWith("https://")) option.dataset.url = image.url;
        select.append(option);
      }
      select.value = selected;
      if (!select.value) select.value = "";
      select.dispatchEvent(new Event("change"));
    }
    status.textContent = result.items.length ? "Images loaded. Only correctly sized assets appear in each list." : "No images found. Upload images in Google Ads Asset library and refresh.";
    if (wizardState.channel === "Demand Gen") {
      const audiences = await workspaceRequest("/" + ws + "/ads/creative-resources/audiences");
      if (sequence !== campaignResourceSequence || ws !== activeWs) return;
      const select = $("channel-audience"), selected = select.value;
      select.replaceChildren(new Option("Choose an audience", ""));
      for (const a of audiences.items) select.append(new Option(a.name, a.resource));
      select.value = selected;
      if (!select.value) select.value = "";
      if (!audiences.items.length) status.textContent += " No audiences found; create one in Google Ads Audience manager.";
    }
  } catch (error) {
    if (sequence === campaignResourceSequence && ws === activeWs) status.textContent = error.message + " Use Refresh assets to retry.";
  } finally {
    if (sequence === campaignResourceSequence) button.disabled = false;
  }
}

function extendedCampaignPayload(base) {
  const type = wizardState.channel;
  if (type === "Search") return base;
  const p = {name: base.name, channel: type, ad_group: base.ad_group, budget: base.budget, country: base.country, eu_political: base.eu_political};
  if (["Display", "Shopping"].includes(type)) p.cpc = base.cpc;
  if (type === "Shopping") return {...p, merchant_id: $("channel-merchant").value.trim(), feed_label: $("channel-feed").value.trim(), campaign_priority: Number($("channel-priority").value), all_products_confirmed: $("channel-products").checked};
  Object.assign(p, {final_url: $("channel-url").value.trim(), business_name: $("channel-business").value.trim(), headlines: $("channel-headlines").value, descriptions: $("channel-descriptions").value});
  for (const field of ["landscape_image", "square_image", "logo"]) p[field] = $("channel-" + field).value;
  if (["Display", "Performance Max"].includes(type)) p.long_headline = $("channel-long").value.trim();
  if (type === "Performance Max") p.conversions_ready = $("channel-conversions").checked;
  if (type === "Demand Gen") p.audience = $("channel-audience").value;
  return p;
}

function campaignReviewText(p) {
  const lines = [`Campaign: ${p.name}`, `Type: ${p.channel || "Search"}`, `Group: ${p.ad_group}`, `Daily budget: ${p.budget} (account currency)`, `Country: ${p.country}`, `Bidding: ${campaignFormats[p.channel || "Search"].bid}`];
  const labels = {cpc: "Maximum CPC", match_type: "Keyword match", final_url: "Landing page", business_name: "Business name", long_headline: "Long headline", landscape_image: "Landscape image", square_image: "Square image", logo: "Logo", audience: "Audience", merchant_id: "Merchant Center ID", feed_label: "Feed label", campaign_priority: "Shopping priority"};
  for (const [field, label] of Object.entries(labels)) if (p[field] !== undefined) lines.push(`${label}: ${p[field] || "Not selected"}`);
  for (const field of ["keywords", "headlines", "descriptions"]) if (p[field]) lines.push("", field[0].toUpperCase() + field.slice(1), ...(Array.isArray(p[field]) ? p[field] : p[field].split("\n")));
  lines.push("", campaignFormats[p.channel || "Search"].note, "Published paused · Google validates before creation");
  return lines.join("\n");
}
