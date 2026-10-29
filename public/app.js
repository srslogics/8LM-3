/* app.js – all frontend logic */
"use strict";

const $ = (id) => document.getElementById(id);

/* ── Toast ───────────────────────────────────────── */
let toastTimer;
function toast(msg, type) {
  const el = $("toast");
  if (!el) return;
  el.textContent = msg;
  el.className = "show" + (type ? " " + type : "");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    el.className = "";
  }, 5000);
}

/* ── Auth fetch ──────────────────────────────────── */
async function request(path, body) {
  const res = await fetch(
    path,
    body
      ? {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }
      : {},
  );
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Please try again.");
  return data;
}

/* ── Workspace fetch (60 s timeout) ─────────────── */
async function workspaceRequest(path, method, body) {
  method = method || "GET";
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 60000);
  let res;
  try {
    res = await fetch("/api/workspaces" + path, {
      method,
      signal: ctrl.signal,
      headers: { "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch (err) {
    clearTimeout(timer);
    throw new Error(
      err.name === "AbortError"
        ? "Request timed out — the database may be waking up. Click Retry."
        : err.message,
    );
  }
  clearTimeout(timer);
  let data;
  try {
    data = await res.json();
  } catch {
    data = { error: "Unexpected response." };
  }
  if (!res.ok) throw new Error(data.error || "Request failed.");
  return data;
}

/* ══════════════════════════════════════════════════
   VIEW ROUTING (campaigns | members | ads)
   ══════════════════════════════════════════════════ */
let currentView = "members";

function showView(view) {
  currentView = view;
  const viewCampaigns = $("view-campaigns");
  const viewMembers = $("view-members");
  const viewAds = $("view-ads");
  const viewCreateCampaign = $("view-create-campaign");
  if (viewCampaigns) viewCampaigns.hidden = view !== "campaigns";
  if (viewMembers) viewMembers.hidden = view !== "members";
  if (viewAds) viewAds.hidden = view !== "ads";
  if (viewCreateCampaign)
    viewCreateCampaign.hidden = view !== "create-campaign";

  const navCampaigns = $("nav-campaigns");
  const navMembers = $("nav-members");
  const navAds = $("nav-ads");
  if (navCampaigns && navCampaigns.classList)
    navCampaigns.classList.toggle(
      "active",
      view === "campaigns" || view === "create-campaign",
    );
  if (navMembers && navMembers.classList)
    navMembers.classList.toggle("active", view === "members");
  if (navAds && navAds.classList)
    navAds.classList.toggle("active", view === "ads");

  if (view === "campaigns") loadWorkspaceCampaigns(activeWs);
  if (view === "ads") loadAds(activeWs, currentManage);
  if (view === "create-campaign") initCampaignWizard();
}

if ($("nav-campaigns"))
  $("nav-campaigns").onclick = () => showView("campaigns");
if ($("nav-members")) $("nav-members").onclick = () => showView("members");
if ($("nav-ads")) $("nav-ads").onclick = () => showView("ads");
if ($("campaigns-manage-sync-btn"))
  $("campaigns-manage-sync-btn").onclick = () => showView("ads");
if ($("campaigns-go-fetch-btn"))
  $("campaigns-go-fetch-btn").onclick = () => showView("ads");

/* ══════════════════════════════════════════════════
   AUTH
   ══════════════════════════════════════════════════ */
let authMode = "login";
let currentManage = false;

function renderUser(user) {
  $("auth-screen").hidden = Boolean(user);
  $("password").value = "";
  $("status").textContent = "";
  if (user) {
    $("nav-email").textContent = user.email;
    $("nav-avatar").textContent = (user.email[0] || "?").toUpperCase();
    loadWorkspacesOnBoot();
  } else {
    $("app-shell").hidden = true;
    hideOnboarding();
  }
}

$("switch").onclick = () => {
  authMode = authMode === "login" ? "signup" : "login";
  const su = authMode === "signup";
  $("heading").textContent = su ? "Create an account" : "Log in";
  $("intro").textContent = su
    ? "Your email and a password are all you need."
    : "Use your 8LM account to continue";
  $("submit").textContent = su ? "Create account" : "Sign in";
  $("switch-label").textContent = su
    ? "Already have an account?"
    : "New to 8LM?";
  $("switch").textContent = su ? "Sign in" : "Create an account";
  $("password").autocomplete = su ? "new-password" : "current-password";
  $("password").minLength = su ? 12 : 1;
  $("hint").hidden = !su;
  $("status").textContent = "";
};

$("show").onclick = () => {
  const vis = $("password").type === "password";
  $("password").type = vis ? "text" : "password";
  $("show").textContent = vis ? "Hide" : "Show";
  $("show").setAttribute("aria-label", vis ? "Hide password" : "Show password");
  $("show").setAttribute("aria-pressed", String(vis));
};

$("form").onsubmit = async (ev) => {
  ev.preventDefault();
  await boot;
  $("submit").disabled = true;
  $("switch").disabled = true;
  $("status").textContent = "";
  try {
    const data = await request("/api/auth/" + authMode, {
      email: $("email").value,
      password: $("password").value,
    });
    renderUser(data.user);
  } catch (e) {
    $("status").textContent = e.message;
  } finally {
    $("submit").disabled = false;
    $("switch").disabled = false;
  }
};

$("nav-signout-btn").onclick = async () => {
  try {
    await request("/api/logout", {});
    hideOnboarding();
    renderUser(null);
  } catch (e) {
    toast(e.message, "error");
  }
};

/* ══════════════════════════════════════════════════
   ONBOARDING: FIRST WORKSPACE (WHEN 0 WORKSPACES EXIST)
   ══════════════════════════════════════════════════ */
let pendingOnboardingName = "";

function showOnboarding() {
  const ob = $("onboarding-screen");
  if (!ob) return;
  pendingOnboardingName = "";
  $("onboarding-step1").hidden = false;
  $("onboarding-step2").hidden = true;
  $("onboarding-ws-name").value = "";
  $("onboarding-ads-id").value = "";
  $("onboarding-ads-name").value = "";
  ob.hidden = false;
  setTimeout(() => $("onboarding-ws-name").focus(), 50);
}

function hideOnboarding() {
  const ob = $("onboarding-screen");
  if (ob) ob.hidden = true;
}

if ($("onboarding-form-step1"))
  $("onboarding-form-step1").onsubmit = async (event) => {
    event.preventDefault();
    const name = $("onboarding-ws-name").value.trim();
    if (!name) return;
    const button = event.submitter;
    button.disabled = true;
    try {
      const result = await workspaceRequest("", "POST", { name });
      hideOnboarding();
      await loadWorkspaces(result.id);
      showView("ads");
    } catch (error) {
      toast(error.message, "error");
    } finally {
      button.disabled = false;
    }
  };

/* ══════════════════════════════════════════════════
   WORKSPACES
   ══════════════════════════════════════════════════ */
let activeWs;
const roleNames = ["Admin", "Editor", "Publisher", "Viewer"];

function roleChipClass(role) {
  if (role === "Owner") return "role-chip owner";
  if (role === "Admin") return "role-chip admin";
  return "role-chip";
}

function actionBtn(label, cls, fn) {
  const b = document.createElement("button");
  b.type = "button";
  b.textContent = label;
  b.className = "btn" + (cls ? " " + cls : "");
  b.onclick = async () => {
    b.disabled = true;
    try {
      await fn();
    } catch (e) {
      toast(e.message, "error");
    } finally {
      b.disabled = false;
    }
  };
  return b;
}

function showLoadError(msg) {
  $("workspace-title").textContent = "Failed to load";
  const old = $("retry-btn");
  if (old) old.remove();
  const btn = document.createElement("button");
  btn.id = "retry-btn";
  btn.className = "btn btn-filled";
  btn.style.cssText = "margin-top:12px;display:block";
  btn.textContent = "↺ Retry";
  btn.onclick = () => loadWorkspaces(activeWs);
  $("page-header-left").appendChild(btn);
  toast(msg, "error");
}

async function loadWorkspaces(preferred) {
  const old = $("retry-btn");
  if (old) old.remove();

  let workspaces;
  try {
    const res = await workspaceRequest("");
    workspaces = res.workspaces;
  } catch (e) {
    showLoadError(e.message);
    return;
  }

  // If user has NO workspaces, show the first-time onboarding wizard!
  if (!workspaces || workspaces.length === 0) {
    $("app-shell").hidden = true;
    showOnboarding();
    return;
  }

  // User has at least one workspace: show app console
  hideOnboarding();
  $("app-shell").hidden = false;

  const sel = $("workspace-select");
  sel.replaceChildren();
  for (const w of workspaces) {
    const o = document.createElement("option");
    o.value = w.id;
    o.textContent = w.name;
    sel.appendChild(o);
  }

  activeWs = (
    workspaces.find((w) => w.id === Number(preferred)) ||
    workspaces[0] ||
    {}
  ).id;
  if (activeWs) {
    sel.value = activeWs;
    await loadWorkspace();
    showView(currentView);
  }
}

async function loadWorkspace() {
  const id = activeWs;
  let data;
  try {
    data = await workspaceRequest("/" + id);
  } catch (e) {
    showLoadError(e.message);
    return;
  }
  if (id !== activeWs) return;

  const w = data.workspace;
  const manage = w.role === "Owner" || w.role === "Admin";
  currentManage = manage;
  currentRole = w.role;

  $("nav-ws-name").textContent = w.name;
  $("workspace-title").textContent = w.name;
  $("your-role").textContent = w.role;
  $("your-role").className = roleChipClass(w.role);
  $("workspace-actions").hidden = !manage;
  $("delete-workspace").hidden = w.role !== "Owner";
  $("invite-section").hidden = !manage;
  for (const buttonId of [
    "create-campaign-open-btn",
    "table-create-campaign-btn",
    "empty-create-campaign-btn",
  ])
    if ($(buttonId)) $(buttonId).hidden = w.role === "Viewer";
  $("invite-link-area").hidden = true;

  // Check Google Ads status in background for sidebar badge
  loadAds(id, manage);
  if (currentView === "campaigns") loadWorkspaceCampaigns(id);

  /* Invite roles */
  $("invite-role").replaceChildren();
  for (const r of roleNames.filter(
    (r) => w.role === "Owner" || r !== "Admin",
  )) {
    const o = document.createElement("option");
    o.value = r;
    o.textContent = r;
    $("invite-role").appendChild(o);
  }
  $("invite-role").value = "Viewer";

  /* Members */
  const mBody = $("members");
  mBody.replaceChildren();
  for (const m of data.members) {
    const tr = document.createElement("tr");
    const tdE = document.createElement("td");
    tdE.textContent = m.email;
    const tdR = document.createElement("td");
    const tdA = document.createElement("td");
    const canEdit =
      manage &&
      m.role !== "Owner" &&
      (w.role === "Owner" || m.role !== "Admin");
    if (canEdit) {
      const sel = document.createElement("select");
      sel.setAttribute("aria-label", "Role for " + m.email);
      for (const r of roleNames.filter(
        (r) => w.role === "Owner" || r !== "Admin",
      )) {
        const o = document.createElement("option");
        o.textContent = r;
        sel.appendChild(o);
      }
      sel.value = m.role;
      tdR.appendChild(sel);
      const wrap = document.createElement("div");
      wrap.className = "row-actions";
      wrap.appendChild(
        actionBtn("Save role", "", async () => {
          await workspaceRequest("/" + id + "/members/" + m.id, "PATCH", {
            role: sel.value,
          });
          toast("Role updated.", "success");
          await loadWorkspace();
        }),
      );
      wrap.appendChild(
        actionBtn("Remove", "btn-danger", async () => {
          if (confirm("Remove " + m.email + " from this workspace?")) {
            await workspaceRequest("/" + id + "/members/" + m.id, "DELETE");
            toast(m.email + " removed.");
            await loadWorkspace();
          }
        }),
      );
      if (w.role === "Owner" && m.role !== "Owner") {
        wrap.appendChild(
          actionBtn("Transfer ownership", "btn-danger", async () => {
            if (
              confirm(
                "Transfer ownership to " +
                  m.email +
                  "? You will become an Admin.",
              )
            ) {
              await workspaceRequest("/" + id + "/transfer", "POST", {
                user: m.id,
              });
              toast("Ownership transferred.");
              await loadWorkspace();
            }
          }),
        );
      }
      tdA.appendChild(wrap);
    } else {
      const chip = document.createElement("span");
      chip.className = roleChipClass(m.role);
      chip.textContent = m.role;
      tdR.appendChild(chip);
      tdA.textContent = "—";
    }
    tr.append(tdE, tdR, tdA);
    mBody.appendChild(tr);
  }
  if (!data.members.length) {
    const tr = document.createElement("tr");
    const td = document.createElement("td");
    td.colSpan = 3;
    td.innerHTML = '<div class="empty-state">No members.</div>';
    tr.appendChild(td);
    mBody.appendChild(tr);
  }

  /* Invites */
  const iBody = $("invites");
  iBody.replaceChildren();
  for (const inv of data.invites) {
    const tr = document.createElement("tr");
    const tdE = document.createElement("td");
    tdE.textContent = inv.email;
    const tdR = document.createElement("td");
    const chip = document.createElement("span");
    chip.className = roleChipClass(inv.role);
    chip.textContent = inv.role;
    tdR.appendChild(chip);
    const tdX = document.createElement("td");
    tdX.textContent = new Date(Number(inv.expires)).toLocaleDateString();
    const tdA = document.createElement("td");
    if (w.role === "Owner" || inv.role !== "Admin") {
      tdA.appendChild(
        actionBtn("Revoke", "btn-danger", async () => {
          await workspaceRequest("/" + id + "/invites/" + inv.id, "DELETE");
          toast("Invitation revoked.");
          await loadWorkspace();
        }),
      );
    } else {
      tdA.textContent = "—";
    }
    tr.append(tdE, tdR, tdX, tdA);
    iBody.appendChild(tr);
  }
  if (!data.invites.length) {
    const tr = document.createElement("tr");
    const td = document.createElement("td");
    td.colSpan = 4;
    td.innerHTML =
      '<div class="empty-state">' +
      (manage
        ? "No pending invitations."
        : "Invitation details are visible to workspace administrators.") +
      "</div>";
    tr.appendChild(td);
    iBody.appendChild(tr);
  }

  /* Activity */
  const aDiv = $("activity");
  aDiv.replaceChildren();
  for (const item of data.activity) {
    const d = document.createElement("div");
    d.className = "activity-item";
    const dot = document.createElement("div");
    dot.className = "activity-dot";
    const info = document.createElement("div");
    const txt = document.createElement("div");
    txt.className = "activity-text";
    txt.textContent = item.actor + " · " + item.action;
    const time = document.createElement("div");
    time.className = "activity-time";
    time.textContent = new Date(Number(item.created)).toLocaleString();
    info.append(txt, time);
    d.append(dot, info);
    aDiv.appendChild(d);
  }
  if (!data.activity.length) {
    const d = document.createElement("div");
    d.className = "empty-state";
    d.textContent = "No activity yet.";
    aDiv.appendChild(d);
  }
}

/* ── Workspace selector ──────────────────────────── */
$("workspace-select").onchange = async (e) => {
  activeWs = Number(e.target.value);
  try {
    await loadWorkspace();
    showView(currentView);
  } catch (e) {
    toast(e.message, "error");
  }
};

/* ══════════════════════════════════════════════════
   CREATE WORKSPACE WIZARD (MODAL FOR EXISTING USERS)
   ══════════════════════════════════════════════════ */
let pendingWsName = "";

function openCreateWizard() {
  const modal = $("create-ws-modal");
  if (!modal) return;
  pendingWsName = "";
  $("create-ws-name").value = "";
  $("wizard-ads-id").value = "";
  $("wizard-ads-name").value = "";

  // Show Step 1
  $("create-ws-step1").hidden = false;
  $("create-ws-step2").hidden = true;
  $("modal-step-label").textContent = "NEW WORKSPACE";
  $("create-modal-title").textContent = "Create workspace";

  modal.hidden = false;
  setTimeout(() => $("create-ws-name").focus(), 50);
}

function closeCreateWizard() {
  const modal = $("create-ws-modal");
  if (modal) modal.hidden = true;
}

$("new-workspace").onclick = () => openCreateWizard();
if ($("create-ws-close"))
  $("create-ws-close").onclick = () => closeCreateWizard();
if ($("create-ws-cancel"))
  $("create-ws-cancel").onclick = () => closeCreateWizard();

if ($("create-ws-next"))
  $("create-ws-next").onclick = async () => {
    const name = $("create-ws-name").value.trim();
    if (!name) return;
    const button = $("create-ws-next");
    button.disabled = true;
    try {
      const result = await workspaceRequest("", "POST", { name });
      closeCreateWizard();
      await loadWorkspaces(result.id);
      showView("ads");
    } catch (error) {
      toast(error.message, "error");
    } finally {
      button.disabled = false;
    }
  };

/* ── Rename & Delete Workspace ──────────────────── */
$("rename-workspace").onclick = async () => {
  const name = prompt("New workspace name", $("workspace-title").textContent);
  if (!name) return;
  try {
    await workspaceRequest("/" + activeWs, "PATCH", { name });
    await loadWorkspaces(activeWs);
    toast("Workspace renamed.", "success");
  } catch (e) {
    toast(e.message, "error");
  }
};

$("delete-workspace").onclick = async () => {
  const wsName = $("workspace-title").textContent;
  const typed = prompt(
    'Permanently delete this workspace?\n\nType "' + wsName + '" to confirm.',
  );
  if (typed === null) return;
  try {
    await workspaceRequest("/" + activeWs, "DELETE", { name: typed });
    toast("Workspace deleted.");
    await loadWorkspaces();
  } catch (e) {
    toast(e.message, "error");
  }
};

/* ── Invites ─────────────────────────────────────── */
$("invite-form").onsubmit = async (ev) => {
  ev.preventDefault();
  const id = activeWs;
  try {
    const r = await workspaceRequest("/" + id + "/invites", "POST", {
      email: $("invite-email").value,
      role: $("invite-role").value,
    });
    await loadWorkspace();
    if (activeWs !== id) return;
    $("invite-link-area").hidden = false;
    $("invite-link").value = location.origin + "/#invite=" + r.token;
    $("invite-link").select();
    toast("Invitation created. Share the link privately.", "success");
  } catch (e) {
    toast(e.message, "error");
  }
};

$("copy-link-btn").onclick = async () => {
  try {
    await navigator.clipboard.writeText($("invite-link").value);
    toast("Link copied to clipboard.", "success");
  } catch {
    $("invite-link").select();
    toast("Press Ctrl+C / Cmd+C to copy.");
  }
};

/* ══════════════════════════════════════════════════
   GOOGLE ADS PAGE (OPTION 1: MCC MANAGER LINKING)
   ══════════════════════════════════════════════════ */

let selectedGoogleAccount = null;
let googleAccounts = [];
let currentRole = "Viewer";
async function loadAds(wsId, canManage) {
  if (!wsId) return;
  try {
    const data = await workspaceRequest("/" + wsId + "/ads");
    if (wsId !== activeWs) return;
    selectedGoogleAccount = data.ads;
    const connected = Boolean(data.oauth);
    $("connection-title").textContent = connected
      ? data.oauth.account_email
      : "Connect Google Ads";
    $("connection-description").textContent = connected
      ? "Choose an advertising account below. Only accessible accounts are listed."
      : "Your 8LM login stays separate from your Google account.";
    $("ads-sidebar-badge-status").textContent = data.ads
      ? "Account selected"
      : connected
        ? "Choose account"
        : "Not connected";
    $("google-oauth-connect-btn").textContent = connected
      ? "Reconnect Google"
      : "Connect with Google";
    $("google-oauth-connect-btn").hidden = !canManage;
    $("ads-disconnect-btn").hidden = !connected || !canManage;
    $("account-selection-form").hidden = !connected || !canManage;
    $("selected-account").hidden = !data.ads;
    $("campaigns-card").hidden = !data.ads;
    if (data.ads) {
      $("ads-display-name").textContent = data.ads.account_name;
      $("ads-display-id").textContent = data.ads.customer_id;
      $("ads-currency").textContent = data.ads.currency_code;
    }
    $("connection-error").textContent = "";
    if (connected && canManage) await reloadAccounts(wsId);
    if (data.ads && currentView === "ads") await loadCampaigns(wsId, canManage);
  } catch (error) {
    if (wsId === activeWs) $("connection-error").textContent = error.message;
  }
}
async function reloadAccounts(wsId = activeWs) {
  $("account-selection-notice").textContent = "Loading accessible accounts…";
  try {
    const result = await workspaceRequest("/" + wsId + "/ads/accounts");
    if (wsId !== activeWs) return;
    googleAccounts = result.accounts;
    const select = $("google-account-select");
    select.replaceChildren();
    for (const account of googleAccounts) {
      const option = document.createElement("option");
      option.value = account.id;
      option.textContent =
        account.name + " · " + account.id + " · " + account.currency;
      select.append(option);
    }
    if (selectedGoogleAccount) select.value = selectedGoogleAccount.customer_id;
    $("account-selection-notice").textContent =
      result.notices.join(" ") ||
      (!googleAccounts.length
        ? "No accessible advertising accounts were found."
        : "Select the account you want to manage in this workspace.");
  } catch (error) {
    $("account-selection-notice").textContent = error.message;
  }
}
$("reload-google-accounts").onclick = () => reloadAccounts();
$("google-oauth-connect-btn").onclick = async () => {
  try {
    const result = await workspaceRequest("/" + activeWs + "/auth/google/url");
    location.href = result.url;
  } catch (error) {
    $("connection-error").textContent = error.message;
  }
};
$("account-selection-form").onsubmit = async (event) => {
  event.preventDefault();
  const account = googleAccounts.find(
    (a) => a.id === $("google-account-select").value,
  );
  if (!account) return;
  try {
    await workspaceRequest("/" + activeWs + "/ads/customer-id", "POST", {
      customer_id: account.id,
      manager_id: account.managerId,
    });
    await loadAds(activeWs, currentManage);
    toast("Google Ads account selected.", "success");
  } catch (error) {
    $("connection-error").textContent = error.message;
  }
};
$("ads-disconnect-btn").onclick = async () => {
  if (
    !confirm(
      "Disconnect Google and remove stored Google credentials from this workspace?",
    )
  )
    return;
  try {
    await workspaceRequest("/" + activeWs + "/ads", "DELETE");
    await loadAds(activeWs, currentManage);
    toast("Disconnected. Stored Google credentials removed.");
  } catch (error) {
    $("connection-error").textContent = error.message;
  }
};

let currentCampaigns = [];

function getCampaignCheckboxes() {
  if (
    typeof document !== "undefined" &&
    typeof document.querySelectorAll === "function"
  ) {
    return Array.from(document.querySelectorAll(".campaign-checkbox"));
  }
  return [];
}

async function loadCampaigns(wsId, canManage) {
  const tbody = $("campaigns-table-body");
  if (!tbody) return;

  let data;
  try {
    data = await workspaceRequest("/" + wsId + "/ads/campaigns");
  } catch (e) {
    tbody.replaceChildren();
    const row = document.createElement("tr"),
      cell = document.createElement("td");
    cell.colSpan = 6;
    cell.textContent = e.message;
    row.append(cell);
    tbody.append(row);
    return;
  }

  const devNotice = $("dev-token-notice");
  if (devNotice) {
    devNotice.hidden = Boolean(data.hasDeveloperToken);
  }

  const apiNotice = $("google-ads-api-notice");
  const apiNoticeText = $("google-ads-api-notice-text");
  if (apiNotice && apiNoticeText) {
    if (data.apiNotice) {
      apiNotice.hidden = false;
      apiNoticeText.textContent = "Google Ads: " + data.apiNotice;
    } else {
      apiNotice.hidden = true;
    }
  }

  if (data.customer_id && $("ads-display-id")) {
    $("ads-display-id").textContent = data.customer_id;
  }

  currentCampaigns = data.campaigns || [];
  renderCampaigns(
    currentCampaigns,
    canManage,
    data.hasDeveloperToken,
    data.apiNotice,
  );

  const importedCount = currentCampaigns.filter((c) => c.imported).length;
  const cBadge = $("campaigns-sidebar-badge");
  if (cBadge) {
    cBadge.textContent = importedCount;
    cBadge.hidden = importedCount === 0;
  }
}

function getChannelChipClass(channel) {
  const norm = (channel || "").toLowerCase().replace(/[^a-z]/g, "");
  if (norm.includes("pmax") || norm.includes("performance")) return "pmax";
  if (norm.includes("ctv") || norm.includes("connected")) return "ctv";
  if (norm.includes("rich")) return "richmedia";
  if (norm.includes("audio")) return "audio";
  if (norm.includes("video")) return "video";
  if (norm.includes("display")) return "display";
  return "search";
}

function renderCampaigns(campaigns, canManage, hasDevToken, apiNotice) {
  const tbody = $("campaigns-table-body");
  if (!tbody) return;
  tbody.innerHTML = "";

  if (campaigns.length === 0) {
    let hint = "No active campaigns found in this Google Ads account.";
    if (hasDevToken === false) {
      hint =
        "No campaigns imported yet. Add GOOGLE_ADS_DEVELOPER_TOKEN to Render to automatically sync live Search &amp; Performance Max campaigns.";
    } else if (apiNotice) {
      hint =
        "Google Ads API notice: " +
        apiNotice +
        '<br><span style="font-size:12px;margin-top:8px;display:inline-block;color:var(--gcp-text-2);">Tip: If your Google Ads account is a client account under a manager (MCC), click "Change ID" above to enter your 10-digit Google Ads account ID directly.</span>';
    }
    const row = document.createElement("tr"),
      cell = document.createElement("td");
    cell.colSpan = 6;
    cell.textContent =
      apiNotice || "No campaigns found in this selected account.";
    row.append(cell);
    tbody.append(row);
    updateSelectedCount();
    return;
  }

  campaigns.forEach((c) => {
    const tr = document.createElement("tr");

    // Checkbox cell
    const tdCheck = document.createElement("td");
    const chk = document.createElement("input");
    chk.type = "checkbox";
    chk.className = "campaign-checkbox";
    chk.dataset.id = c.id;
    chk.checked = Boolean(c.imported);
    chk.disabled = !canManage;
    chk.onchange = updateSelectedCount;
    tdCheck.appendChild(chk);
    tr.appendChild(tdCheck);

    // Name cell
    const tdName = document.createElement("td");
    tdName.style.fontWeight = "500";
    tdName.textContent = c.name;
    tr.appendChild(tdName);

    // Channel cell
    const tdChannel = document.createElement("td");
    const chip = document.createElement("span");
    chip.className = "campaign-channel-chip " + getChannelChipClass(c.channel);
    chip.textContent = c.channel;
    tdChannel.appendChild(chip);
    tr.appendChild(tdChannel);

    // Status cell
    const tdStatus = document.createElement("td");
    const stChip = document.createElement("span");
    stChip.className =
      "campaign-status-chip " + (c.status === "ENABLED" ? "enabled" : "paused");
    stChip.textContent = c.status === "ENABLED" ? "Enabled" : "Paused";
    tdStatus.appendChild(stChip);
    tr.appendChild(tdStatus);

    // Budget cell
    const tdBudget = document.createElement("td");
    tdBudget.textContent = c.budget;
    tr.appendChild(tdBudget);

    // Sync status cell
    const tdSync = document.createElement("td");
    if (c.imported) {
      tdSync.innerHTML =
        '<span class="imported-badge"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg> In 8LM</span>';
    } else {
      tdSync.innerHTML = '<span class="not-imported-badge">Not fetched</span>';
    }
    tr.appendChild(tdSync);

    tbody.appendChild(tr);
  });

  updateSelectedCount();
  if ($("import-campaigns-btn"))
    $("import-campaigns-btn").disabled = !canManage;
}

function updateSelectedCount() {
  const checkboxes = getCampaignCheckboxes();
  let selected = 0;
  checkboxes.forEach((cb) => {
    if (cb.checked) selected++;
  });
  const badge = $("campaigns-count-badge");
  if (badge)
    badge.textContent = selected + " of " + checkboxes.length + " selected";

  const selectAll = $("campaigns-select-all");
  if (selectAll && checkboxes.length > 0) {
    selectAll.checked = selected === checkboxes.length && checkboxes.length > 0;
    selectAll.indeterminate = selected > 0 && selected < checkboxes.length;
  }
}

if ($("campaigns-select-all")) {
  $("campaigns-select-all").onchange = (ev) => {
    const checked = ev.target.checked;
    getCampaignCheckboxes().forEach((cb) => {
      cb.checked = checked;
    });
    updateSelectedCount();
  };
}

if ($("import-campaigns-btn")) {
  $("import-campaigns-btn").onclick = async () => {
    const btn = $("import-campaigns-btn");
    const checkedIds = getCampaignCheckboxes()
      .filter((cb) => cb.checked)
      .map((cb) => cb.dataset.id);

    btn.disabled = true;
    btn.textContent = "Fetching…";
    try {
      const res = await workspaceRequest(
        "/" + activeWs + "/ads/campaigns/import",
        "POST",
        {
          campaign_ids: checkedIds,
        },
      );
      toast(
        res.imported_count +
          " campaign" +
          (res.imported_count === 1 ? "" : "s") +
          " fetched into 8LM!",
        "success",
      );
      await loadCampaigns(activeWs, currentManage);
      showView("campaigns");
    } catch (e) {
      toast(e.message, "error");
    } finally {
      btn.disabled = false;
      btn.textContent = "Fetch selected campaigns";
    }
  };
}

if ($("refresh-campaigns-btn")) {
  $("refresh-campaigns-btn").onclick = async () => {
    toast("Syncing campaigns…");
    await loadCampaigns(activeWs, currentManage);
  };
}

if ($("edit-customer-id-btn")) {
  $("edit-customer-id-btn").onclick = async () => {
    const currentId =
      ($("ads-display-id") ? $("ads-display-id").textContent : "") || "";
    const newId = prompt(
      "Enter your 10-digit Google Ads Customer ID (e.g. 123-456-7890 from the top-right of your Google Ads dashboard):",
      currentId,
    );
    if (!newId || newId.trim() === currentId.trim()) return;
    try {
      const res = await workspaceRequest(
        "/" + activeWs + "/ads/customer-id",
        "POST",
        { customer_id: newId },
      );
      toast(
        "Customer ID updated to " + res.customer_id + "! Syncing…",
        "success",
      );
      if ($("ads-display-id"))
        $("ads-display-id").textContent = res.customer_id;
      await loadCampaigns(activeWs, currentManage);
    } catch (e) {
      toast(e.message, "error");
    }
  };
}

/* ══════════════════════════════════════════════════
   WORKSPACE CAMPAIGNS VIEW
   ══════════════════════════════════════════════════ */
async function loadWorkspaceCampaigns(wsId) {
  if (!wsId) return;
  loadPublications(wsId);
  const tbody = $("workspace-campaigns-body");
  const emptyState = $("campaigns-empty-state");
  const tableCard = $("campaigns-table-card");
  const kpiGrid = $("campaigns-kpis");
  if (!tbody) return;

  let data;
  try {
    data = await workspaceRequest("/" + wsId + "/ads/campaigns");
  } catch (e) {
    if (emptyState) emptyState.hidden = false;
    if (tableCard) tableCard.hidden = true;
    if (kpiGrid) kpiGrid.hidden = true;
    $("campaign-report-notice").textContent = e.message;
    return;
  }

  if (wsId !== activeWs) return;
  $("campaign-report-notice").textContent =
    data.apiNotice || "Account performance · Last 30 completed days";
  const all = data.campaigns || [];
  const imported = all.filter((c) => c.imported);

  // Update sidebar badge
  const cBadge = $("campaigns-sidebar-badge");
  if (cBadge) {
    cBadge.textContent = imported.length;
    cBadge.hidden = imported.length === 0;
  }

  if (imported.length === 0) {
    if (emptyState) emptyState.hidden = false;
    if (tableCard) tableCard.hidden = true;
    if (kpiGrid) kpiGrid.hidden = true;
    return;
  }

  if (emptyState) emptyState.hidden = true;
  if (tableCard) tableCard.hidden = false;
  if (kpiGrid) kpiGrid.hidden = false;

  // Calculate KPIs
  let totalDaily = 0;
  imported.forEach((c) => {
    const num = parseFloat((c.budget || "").replace(/[^0-9.]/g, ""));
    if (!isNaN(num)) totalDaily += num;
  });

  const activeCount = imported.filter((c) => c.status === "ENABLED").length;
  if ($("kpi-active-count")) $("kpi-active-count").textContent = activeCount;
  if ($("kpi-total-budget"))
    $("kpi-total-budget").textContent =
      (data.currency_code || "") +
      " " +
      totalDaily.toLocaleString("en-IN", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      }) +
      "/day";
  if ($("kpi-impressions"))
    $("kpi-impressions").textContent = data.metrics
      ? data.metrics.impressions.toLocaleString()
      : "—";
  if ($("kpi-clicks"))
    $("kpi-clicks").textContent = data.metrics
      ? data.metrics.clicks.toLocaleString()
      : "—";

  // Render rows
  tbody.innerHTML = "";
  imported.forEach((c) => {
    const tr = document.createElement("tr");

    // Name
    const tdName = document.createElement("td");
    tdName.style.fontWeight = "500";
    tdName.textContent = c.name;
    tr.appendChild(tdName);

    // Channel
    const tdChannel = document.createElement("td");
    const chip = document.createElement("span");
    chip.className = "campaign-channel-chip " + getChannelChipClass(c.channel);
    chip.textContent = c.channel;
    tdChannel.appendChild(chip);
    tr.appendChild(tdChannel);

    // Status (Interactive Toggle)
    const tdStatus = document.createElement("td");
    const stChip = document.createElement("button");
    stChip.type = "button";
    stChip.className =
      "campaign-status-chip " + (c.status === "ENABLED" ? "enabled" : "paused");
    stChip.style.border = "none";
    stChip.style.background = "transparent";
    stChip.style.cursor = "pointer";
    stChip.style.padding = "0";
    stChip.title = "Click to toggle campaign status";
    stChip.textContent = c.status === "ENABLED" ? "Enabled" : "Paused";
    stChip.disabled =
      !c.google_resource ||
      !["Owner", "Admin", "Publisher"].includes(currentRole);
    stChip.onclick = async () => {
      const next = c.status === "ENABLED" ? "PAUSED" : "ENABLED";
      if (
        next === "ENABLED" &&
        !confirm(
          "Enable this campaign in Google Ads? It can start spending its configured budget.",
        )
      )
        return;
      try {
        await workspaceRequest(
          "/" + wsId + "/campaigns/" + c.id + "/status",
          "PATCH",
          { status: next },
        );
        toast(`Campaign status updated to ${next}`, "success");
        await loadWorkspaceCampaigns(wsId);
      } catch (e) {
        toast(e.message, "error");
      }
    };
    tdStatus.appendChild(stChip);
    tr.appendChild(tdStatus);

    // Budget
    const tdBudget = document.createElement("td");
    const rawBudget = c.budget || "";
    tdBudget.textContent = rawBudget || "—";
    tr.appendChild(tdBudget);

    // Source
    const tdSource = document.createElement("td");
    tdSource.innerHTML =
      '<span style="font-size:12px;color:var(--gcp-text-2);display:inline-flex;align-items:center;gap:4px;"><svg width="12" height="12" viewBox="0 0 24 24" fill="none"><rect width="24" height="24" rx="4" fill="#F8F9FA"/><path d="M12.5 4.5l-6 10.4a3 3 0 004.1 4.1l6-10.4a3 3 0 00-4.1-4.1z" fill="#FBBC04"/><path d="M15.5 14.8l-1.5 2.6a3 3 0 01-4.1-4.1l1.5-2.6a3 3 0 014.1 4.1z" fill="#4285F4"/><circle cx="7" cy="17" r="2.5" fill="#34A853"/></svg> Google Ads</span>';
    tdSource.textContent = c.google_resource
      ? "Google Ads · " + c.google_resource.split("/").pop()
      : "Legacy local record";
    tr.appendChild(tdSource);

    // Actions
    const tdActions = document.createElement("td");
    tdActions.style.textAlign = "right";
    const delBtn = document.createElement("button");
    delBtn.type = "button";
    delBtn.className = "btn btn-outline";
    delBtn.style.padding = "3px 8px";
    delBtn.style.fontSize = "11px";
    delBtn.title = "Remove campaign from workspace";
    delBtn.textContent = "Untrack";
    delBtn.disabled = !currentManage;
    delBtn.onclick = async () => {
      if (!confirm(`Remove campaign "${c.name}" from this workspace?`)) return;
      try {
        await workspaceRequest("/" + wsId + "/campaigns/" + c.id, "DELETE");
        toast("Campaign removed.", "success");
        await loadWorkspaceCampaigns(wsId);
        await loadCampaigns(wsId, currentManage);
      } catch (e) {
        toast(e.message, "error");
      }
    };
    tdActions.appendChild(delBtn);
    tr.appendChild(tdActions);

    tbody.appendChild(tr);
  });
}

/* ══════════════════════════════════════════════════
   CAMPAIGN CREATION WIZARD (FULL GOOGLE ADS FLOW)
   ══════════════════════════════════════════════════ */
let activeDraft = null;
function initCampaignWizard() {}
async function openCreateCampaignWizard() {
  activeDraft = null;
  showView("create-campaign");
  $("search-campaign-form").reset();
  $("search-error").textContent = "";
  await loadAds(activeWs, currentManage);
  $("publish-account").textContent = selectedGoogleAccount
    ? selectedGoogleAccount.customer_id +
      " · " +
      selectedGoogleAccount.currency_code
    : "Select an account in Connections first";
  document
    .querySelectorAll(".account-currency")
    .forEach(
      (el) => (el.textContent = selectedGoogleAccount?.currency_code || ""),
    );
}
$("search-cancel").onclick = () => showView("campaigns");
$("search-campaign-form").oninput = () => {
  const lines = (id) =>
    $(id)
      .value.split("\n")
      .map((x) => x.trim())
      .filter(Boolean);
  $("search-preview-headline").textContent =
    lines("search-headlines").slice(0, 3).join(" | ") ||
    "Your headlines appear here";
  $("search-preview-description").textContent =
    lines("search-descriptions").join(" ") ||
    "Add your descriptions to preview the ad.";
  $("search-preview-url").textContent =
    $("search-url").value || "your-company.com";
};
$("search-campaign-form").onsubmit = async (event) => {
  event.preventDefault();
  const btn = $("save-search-draft");
  btn.disabled = true;
  $("search-error").textContent = "";
  try {
    const result = await workspaceRequest(
      "/" + activeWs + "/campaigns/create",
      "POST",
      {
        name: $("search-name").value,
        ad_group: $("search-adgroup").value,
        channel: "Search",
        budget: $("search-budget").value,
        cpc: $("search-cpc").value,
        country: $("search-country").value,
        match_type: $("search-match").value,
        final_url: $("search-url").value,
        keywords: $("search-keywords").value,
        headlines: $("search-headlines").value,
        descriptions: $("search-descriptions").value,
        eu_political: $("search-eu").checked ? false : null,
      },
    );
    activeDraft = result.draft.id;
    toast("Draft saved. Review it below before publishing.", "success");
    showView("campaigns");
  } catch (error) {
    $("search-error").textContent = error.message;
  } finally {
    btn.disabled = false;
  }
};
async function loadPublications(wsId) {
  const box = $("publication-list");
  box.replaceChildren();
  try {
    const result = await workspaceRequest("/" + wsId + "/campaigns/drafts");
    if (wsId !== activeWs) return;
    if (!result.drafts.length) {
      box.textContent =
        "No drafts yet. Create a Search campaign to get started.";
      return;
    }
    for (const draft of result.drafts) {
      const row = document.createElement("div");
      row.className = "publication-row";
      const details = document.createElement("div");
      const title = document.createElement("strong");
      title.textContent = draft.payload.name;
      const info = document.createElement("p");
      info.className = "subtle";
      info.textContent =
        "Account " +
        draft.customer_id +
        " · " +
        draft.state +
        (draft.resource_name
          ? " · Google ID " + draft.resource_name.split("/").pop()
          : "");
      details.append(title, info);
      const review = document.createElement("details");
      const summary = document.createElement("summary");
      summary.textContent = "Review configuration";
      const text = document.createElement("pre");
      const p = draft.payload;
      text.textContent = [
        "Ad group: " + p.ad_group,
        "Daily budget: " + p.budget + " (account currency)",
        "Maximum CPC: " + p.cpc + " (account currency)",
        "Country: " + p.country,
        "Keyword match: " + p.match_type,
        "Landing page: " + p.final_url,
        "",
        "Keywords", ...p.keywords,
        "",
        "Headlines", ...p.headlines,
        "",
        "Descriptions", ...p.descriptions,
        "",
        "Search only · Manual CPC · Published paused",
      ].join("\n");
      review.append(summary, text);
      details.append(review);
      if (draft.error) {
        const error = document.createElement("p");
        error.textContent = draft.error;
        error.className = "publish-error";
        details.append(error);
      }
      row.append(details);
      if (
        draft.state !== "PUBLISHED" &&
        ["Owner", "Admin", "Publisher"].includes(currentRole)
      ) {
        const button = document.createElement("button");
        button.className = "btn btn-filled";
        button.textContent =
          draft.state === "DRAFT"
            ? "Publish paused"
            : "Check publication status";
        button.onclick = async () => {
          if (
            draft.state === "DRAFT" &&
            !confirm(
              "Publish this Search campaign to Google Ads account " +
                draft.customer_id +
                "? It will be created paused with the reviewed budget.",
            )
          )
            return;
          button.disabled = true;
          try {
            const response = await workspaceRequest(
              "/" + wsId + "/campaigns/" + draft.id + "/publish",
              "POST",
              {},
            );
            toast(
              response.ok
                ? "Confirmed in Google Ads · Paused · " +
                    response.resource.split("/").pop()
                : response.error,
              response.ok ? "success" : "error",
            );
            await loadPublications(wsId);
            await loadWorkspaceCampaigns(wsId);
          } catch (error) {
            toast(error.message, "error");
            await loadPublications(wsId);
          } finally {
            button.disabled = false;
          }
        };
        row.append(button);
      }
      box.append(row);
    }
  } catch (error) {
    box.textContent = error.message;
  }
}
for (const id of [
  "create-campaign-open-btn",
  "table-create-campaign-btn",
  "empty-create-campaign-btn",
])
  if ($(id)) $(id).onclick = openCreateCampaignWizard;

/* ── Boot ────────────────────────────────────────── */
async function loadWorkspacesOnBoot() {
  const params = new URLSearchParams(location.hash.slice(1));
  const token = params.get("invite");
  const oauth = params.get("oauth");
  const oauthErr = params.get("oauth_error");
  let preferred = params.get("workspace");

  if (token) {
    try {
      const res = await workspaceRequest("/accept", "POST", { token });
      preferred = res.id;
      history.replaceState({}, "", location.pathname);
      toast("Invitation accepted.", "success");
    } catch (e) {
      toast(e.message, "error");
    }
  } else if (oauth === "success") {
    history.replaceState({}, "", location.pathname);
    toast("Google connected. Select your advertising account.", "success");
  } else if (oauthErr) {
    history.replaceState({}, "", location.pathname);
    toast(
      "Google authorization error: " + decodeURIComponent(oauthErr),
      "error",
    );
  }

  await loadWorkspaces(preferred);
  if (oauth === "success") {
    showView("ads");
  } else {
    showView("members");
  }
}

const boot = request("/api/me")
  .then((data) => renderUser(data.user))
  .catch(() => {
    $("status").textContent =
      "Could not connect. Please refresh and try again.";
  });
