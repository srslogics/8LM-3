/* Campaigns is a platform-aware workspace entry point, independent of workspace names. */
const campaignPlatformChoices = new Map();
let campaignPlatformSequence = 0;
function initCampaignPlatforms() {
  for (const platform of ["google", "meta"]) $("campaign-platform-" + platform).onclick = () => {
    campaignPlatformChoices.set(activeWs, platform);
    showView("campaigns");
  };
}
async function openWorkspaceCampaigns(ws) {
  const sequence = ++campaignPlatformSequence;
  $("view-campaigns").hidden = true; $("view-meta").hidden = true;
  $("campaign-platform-status").textContent = "Loading workspace campaigns…";
  let platform = campaignPlatformChoices.get(ws);
  if (!platform) {
    const results = await Promise.allSettled([
      workspaceRequest(`/${ws}/ads`), workspaceRequest(`/${ws}/meta`)
    ]);
    const google = results[0].status === "fulfilled" ? results[0].value : null;
    const meta = results[1].status === "fulfilled" ? results[1].value : null;
    platform = !google?.ads && (meta?.account || meta?.connection) ? "meta" : "google";
  }
  if (ws !== activeWs || sequence !== campaignPlatformSequence || currentView !== "campaigns") return;
  $("campaign-platform-status").textContent = "";
  for (const name of ["google", "meta"]) {
    const button = $("campaign-platform-" + name);
    button.classList.toggle("active", name === platform);
    button.setAttribute("aria-pressed", String(name === platform));
  }
  $("view-campaigns").hidden = platform !== "google";
  $("view-meta").hidden = platform !== "meta";
  if (platform === "meta") {
    $("meta-page-title").textContent = "Campaigns · Meta Ads";
    $("meta-page-eyebrow").textContent = "WORKSPACE CAMPAIGNS";
    await loadMeta();
  } else await loadWorkspaceCampaigns(ws);
}
