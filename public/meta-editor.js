/* Screenshot-aligned Meta editor shell. Existing form/API contracts stay authoritative. */
function initMetaEditor() {
  const open = $("meta-create").onclick, close = $("meta-builder-cancel").onclick;
  $("meta-create").onclick = () => {
    open(); if (!metaAccount) return;
    document.body.classList.add("me-is-editing");
    $("me-objective-screen").hidden = false; $("me-edit-screen").hidden = true;
    $("me-setup-screen").hidden = true;
    document.querySelector(".me-onboarding-card").hidden = false;
    updateMetaEditor(); $("me-objective-next").focus();
  };
  $("meta-builder-cancel").onclick = () => { close(); document.body.classList.remove("me-is-editing"); $("meta-create").focus(); };
  $("me-onboarding-close").onclick = () => $("meta-builder-cancel").click();
  for (const button of document.querySelectorAll("[data-me-objective]")) button.onclick = () => {
    $("meta-objective").value = button.dataset.meObjective;
    $("meta-objective").dispatchEvent(new Event("change")); updateMetaEditor();
  };
  $("me-objective-next").onclick = () => {
    document.querySelector(".me-onboarding-card").hidden = true;
    $("me-setup-screen").hidden = false;
    $("me-setup-title").textContent = `Manual ${$("meta-objective").value === "OUTCOME_SALES" ? "sales" : "traffic"} campaign`;
    $("me-setup-create").focus();
  };
  $("me-setup-back").onclick = () => { $("me-setup-screen").hidden = true; document.querySelector(".me-onboarding-card").hidden = false; };
  $("me-setup-create").onclick = () => {
    $("me-objective-screen").hidden = true; $("me-edit-screen").hidden = false;
    setMetaStep(1); $("meta-name").focus();
  };
  document.querySelectorAll("[data-me-nav]").forEach(button => button.onclick = () => setMetaStep(Number(button.dataset.meNav)));
  $("me-edit-tab").onclick = () => setMetaStep(metaStep === 4 ? 1 : metaStep);
  $("meta-builder").addEventListener("input", updateMetaEditor);
  $("meta-builder").addEventListener("change", updateMetaEditor);
}
function metaEditorIssues() {
  const issues = [];
  for (const input of $("meta-builder").querySelectorAll("input, select, textarea")) {
    if (input.disabled || input.checkValidity()) continue;
    const label = $("meta-builder").querySelector(`label[for="${input.id}"]`)?.textContent || "Special ad category confirmation";
    issues.push({input, message: `${label}: ${input.validity.valueMissing ? "required" : "check the value"}.`});
  }
  if (+$("meta-age-min").value > +$("meta-age-max").value) issues.push({input: $("meta-age-min"), message: "Minimum age must not exceed maximum age."});
  const start = $("meta-start").value, end = $("meta-end").value;
  if (end && new Date(end) <= (start ? new Date(start) : new Date())) issues.push({input: $("meta-end"), message: "End date must be after the start date and in the future."});
  const url = $("meta-url").value;
  if (url && !url.startsWith("https://")) issues.push({input: $("meta-url"), message: "Use an HTTPS landing page URL."});
  return issues;
}
function updateMetaEditor() {
  const sales = $("meta-objective").value === "OUTCOME_SALES";
  for (const button of document.querySelectorAll("[data-me-objective]")) {
    const active = button.dataset.meObjective === $("meta-objective").value;
    button.classList.toggle("selected", active); button.setAttribute("aria-pressed", String(active));
  }
  const names = [$("meta-name").value || `New ${sales ? "Sales" : "Traffic"} campaign`, $("meta-adset-name").value || "New ad set", $("meta-ad-name").value || "New ad"];
  ["me-tree-campaign", "me-tree-adset", "me-tree-ad"].forEach((id, i) => $(id).textContent = names[i]);
  $("me-breadcrumb").textContent = metaStep === 4 ? `${names[0]} › Review` : names.slice(0, metaStep).join("  ›  ");
  $("me-objective-summary").textContent = sales ? "Sales" : "Traffic";
  $("me-performance").textContent = sales ? "Maximise website conversions" : "Maximise link clicks";
  $("me-edit-tab").classList.toggle("active", metaStep !== 4);
  const list = $("me-validation-list"); list.replaceChildren();
  const issues = metaEditorIssues();
  for (const issue of issues) {
    const item = document.createElement("div"); item.className = "me-validation-item";
    item.append(metaText("p", issue.message));
    const button = metaText("button", "Edit", "btn btn-outline"); button.type = "button";
    button.onclick = () => { setMetaStep(Number(issue.input.closest("[data-meta-step]").dataset.metaStep)); issue.input.focus(); };
    item.append(button); list.append(item);
  }
  if (!issues.length) list.append(metaText("p", "✓ Required fields are complete. Review the draft before saving. Meta performs final checks when you publish.", "me-valid"));
  $("me-footer-status").textContent = issues.length ? `${issues.length} ${issues.length === 1 ? "item needs" : "items need"} attention · Draft not saved` : "All required fields complete · Ready to save draft";
}
