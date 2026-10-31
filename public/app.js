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
let wizardState = {
  currentStep: 1,
  maxStepReached: 1,
  objective: "Sales",
  channel: "Search",
  campaignName: "",
  reachWebsite: false,
  websiteUrl: "",
  reachPhone: false,
  phoneNumber: "",
  reachShop: false,
  biddingStrategy: "Maximise conversions",
  targetCpa: "",
  optimizeNewCustomers: false,
  reengageLapsedCustomers: false,
  networkSearch: true,
  networkDisplay: false,
  targetLocation: "India",
  customLocation: "",
  language: "English",
  adGroupName: "Ad group 1",
  keywords: "",
  finalUrl: "",
  displayPath1: "",
  displayPath2: "",
  headlines: [],
  descriptions: [],
  sitelinks: [],
  callouts: [],
  assetPhone: "",
  budget: "500.00",
  status: "ENABLED",
};

const STEP_TITLES = {
  1: "What's your campaign objective?",
  2: "Select a campaign type",
  3: "Select ways to reach your goal & campaign name",
  4: "Bidding",
  5: "Campaign settings",
  6: "Keywords and ads",
  7: "Assets",
  8: "Budget",
  9: "Review your campaign",
};

async function openCreateCampaignWizard() {
  wizardState.currentStep = 1;
  wizardState.maxStepReached = 1;
  wizardState.objective = "Sales";
  wizardState.channel = "Search";
  wizardState.campaignName = "";
  wizardState.budget = "500.00";
  wizardState.targetLocation = "India";
  wizardState.status = "ENABLED";
  wizardState.websiteUrl = "";
  wizardState.phoneNumber = "";
  wizardState.targetCpa = "";
  wizardState.keywords = "";
  wizardState.finalUrl = "";
  wizardState.displayPath1 = "";
  wizardState.displayPath2 = "";
  wizardState.headlines = [];
  wizardState.descriptions = [];
  wizardState.sitelinks = [];
  wizardState.callouts = [];
  wizardState.assetPhone = "";

  if ($("wizard-campaign-name")) $("wizard-campaign-name").value = "";
  if ($("wizard-website-url")) $("wizard-website-url").value = "";
  if ($("wizard-phone-number")) $("wizard-phone-number").value = "";
  if ($("wizard-budget-input")) $("wizard-budget-input").value = "500.00";
  if ($("wizard-bidding-focus"))
    $("wizard-bidding-focus").value = "Maximise conversions";
  if ($("wizard-status-select")) $("wizard-status-select").value = "ENABLED";
  if ($("wizard-set-cpa")) $("wizard-set-cpa").checked = false;
  if ($("wizard-cpa-val")) $("wizard-cpa-val").value = "";
  if ($("wizard-cpa-box")) $("wizard-cpa-box").hidden = true;
  if ($("wizard-reach-website")) $("wizard-reach-website").checked = false;
  if ($("wizard-reach-website-box"))
    $("wizard-reach-website-box").hidden = true;
  if ($("wizard-reach-phone")) $("wizard-reach-phone").checked = false;
  if ($("wizard-reach-phone-box")) $("wizard-reach-phone-box").hidden = true;
  if ($("wizard-reach-shop")) $("wizard-reach-shop").checked = false;
  if ($("wizard-opt-new-customers"))
    $("wizard-opt-new-customers").checked = false;
  if ($("wizard-opt-retention")) $("wizard-opt-retention").checked = false;
  if ($("wizard-kw-scan-url")) $("wizard-kw-scan-url").value = "";
  if ($("wizard-keywords-input")) $("wizard-keywords-input").value = "";
  if ($("rsa-final-url")) $("rsa-final-url").value = "";
  if ($("rsa-path-1")) $("rsa-path-1").value = "";
  if ($("rsa-path-2")) $("rsa-path-2").value = "";
  if ($("wizard-asset-phone")) $("wizard-asset-phone").value = "";

  if (
    typeof document !== "undefined" &&
    typeof document.querySelectorAll === "function"
  ) {
    document.querySelectorAll(".rsa-hl-input").forEach((inp) => {
      inp.value = "";
      if (
        inp.parentElement &&
        inp.parentElement.querySelector(".char-counter")
      ) {
        inp.parentElement.querySelector(".char-counter").textContent = "0/30";
      }
    });
    document.querySelectorAll(".rsa-desc-input").forEach((inp) => {
      inp.value = "";
      if (
        inp.parentElement &&
        inp.parentElement.querySelector(".char-counter")
      ) {
        inp.parentElement.querySelector(".char-counter").textContent = "0/90";
      }
    });
    document.querySelectorAll(".sitelink-chk").forEach((chk) => {
      chk.checked = false;
    });
    document.querySelectorAll(".callout-chk").forEach((chk) => {
      chk.checked = false;
    });
  }

  showView("create-campaign");
  configureSupportedWizard();
  setupCampaignTypes();
  renderWizardStep(1);
  await loadAds(activeWs, currentManage);
  document
    .querySelectorAll("#view-create-campaign .wizard-currency")
    .forEach(
      (el) =>
        (el.textContent =
          selectedGoogleAccount?.currency_code || "Account currency"),
    );
}

function updateSuggestedCampaignName() {
  const nameInput = $("wizard-campaign-name");
  if (nameInput) {
    const objClean = (wizardState.objective || "Sales").replace(/\s+/g, "-");
    const chClean = (wizardState.channel || "Search").replace(/\s+/g, "-");
    const newName = `${objClean}-${chClean}-1`;
    if (
      !nameInput.value ||
      /^[A-Za-z]+-[A-Za-z]+-\d+$/.test(nameInput.value.trim())
    ) {
      nameInput.value = newName;
    }
    wizardState.campaignName = nameInput.value.trim() || newName;
  }
}

function renderWizardStep(stepNum) {
  wizardState.currentStep = stepNum;
  if (stepNum > wizardState.maxStepReached) {
    wizardState.maxStepReached = stepNum;
  }

  // Update main title
  if ($("wizard-main-title")) {
    $("wizard-main-title").textContent = stepNum === 6 && wizardState.channel !== "Search" ? (wizardState.channel === "Shopping" ? "Product feed" : "Ad creative") : STEP_TITLES[stepNum] || "New campaign";
  }

  // Update stepper navigation
  for (let i = 1; i <= 9; i++) {
    const navItem = $("wizard-nav-step-" + i);
    const icon = $("wizard-icon-" + i);
    if (!navItem) continue;

    if (i < stepNum) {
      navItem.className = "wizard-step-item completed";
      if (icon) {
        icon.innerHTML =
          '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>';
      }
    } else if (i === stepNum) {
      navItem.className = "wizard-step-item active";
      if (icon) icon.textContent = String(i);
    } else {
      navItem.className = "wizard-step-item";
      if (icon) icon.textContent = String(i);
    }
  }

  // Update sidebar sub labels
  if ($("wizard-nav-sub-1"))
    $("wizard-nav-sub-1").textContent = wizardState.objective;
  if ($("wizard-nav-sub-2"))
    $("wizard-nav-sub-2").textContent = wizardState.channel;
  if ($("wizard-nav-sub-3")) {
    const nameVal = $("wizard-campaign-name")
      ? $("wizard-campaign-name").value.trim()
      : wizardState.campaignName;
    $("wizard-nav-sub-3").textContent = nameVal || "Sales-Search-1";
  }
  if ($("wizard-nav-sub-4")) {
    const bFocus = $("wizard-bidding-focus")
      ? $("wizard-bidding-focus").value
      : "Conversions";
    $("wizard-nav-sub-4").textContent = bFocus.replace("Maximise ", "");
  }
  if ($("wizard-nav-sub-5"))
    $("wizard-nav-sub-5").textContent = wizardState.targetLocation || "India";
  if ($("wizard-nav-sub-8")) {
    const bVal = $("wizard-budget-input")
      ? $("wizard-budget-input").value.trim()
      : wizardState.budget;
    $("wizard-nav-sub-8").textContent =
      ` ${selectedGoogleAccount?.currency_code || ""} ${bVal || "500.00"}/day`;
  }

  // Show only active step pane
  for (let i = 1; i <= 9; i++) {
    const pane = $("wizard-pane-" + i);
    if (pane) pane.hidden = i !== stepNum;
  }

  // Step 6 live ad preview update
  if (stepNum === 6) {
    updateRsaLivePreview();
  }

  // Step 9 Review population
  if (stepNum === 9) {
    populateWizardReview();
  }

  if (typeof window !== "undefined" && typeof window.scrollTo === "function") {
    window.scrollTo({ top: 0, behavior: "smooth" });
  }
}

function updateRsaLivePreview() {
  const finalUrl = $("rsa-final-url") ? $("rsa-final-url").value.trim() : "";
  const path1 = $("rsa-path-1") ? $("rsa-path-1").value.trim() : "";
  const path2 = $("rsa-path-2") ? $("rsa-path-2").value.trim() : "";

  // Update domain next to path inputs
  let domain = "example.com";
  if (finalUrl) {
    try {
      const parsed = new URL(
        finalUrl.startsWith("http") ? finalUrl : "https://" + finalUrl,
      );
      domain = parsed.hostname.replace(/^www\./, "");
    } catch (e) {
      domain =
        finalUrl.replace(/^https?:\/\//, "").split("/")[0] || "example.com";
    }
  }
  if ($("rsa-display-domain"))
    $("rsa-display-domain").textContent = domain + " /";

  // Gather headlines
  const hlInputs = [];
  if (
    typeof document !== "undefined" &&
    typeof document.querySelectorAll === "function"
  ) {
    document.querySelectorAll(".rsa-hl-input").forEach((inp) => {
      if (inp.value && inp.value.trim()) hlInputs.push(inp.value.trim());
    });
  }
  const previewHl = hlInputs.length
    ? hlInputs.slice(0, 3).join(" | ")
    : "Headline 1 | Headline 2";

  // Gather descriptions
  const descInputs = [];
  if (
    typeof document !== "undefined" &&
    typeof document.querySelectorAll === "function"
  ) {
    document.querySelectorAll(".rsa-desc-input").forEach((inp) => {
      if (inp.value && inp.value.trim()) descInputs.push(inp.value.trim());
    });
  }
  const previewDesc = descInputs.length
    ? descInputs[0]
    : "Your ad description will appear here as you type.";

  // Build display URL
  let displayUrl = finalUrl || "https://www.example.com";
  if (path1) displayUrl += ` › ${path1}`;
  if (path2) displayUrl += ` › ${path2}`;

  if ($("mock-preview-url")) $("mock-preview-url").textContent = displayUrl;
  if ($("mock-preview-hl")) $("mock-preview-hl").textContent = previewHl;
  if ($("mock-preview-desc")) $("mock-preview-desc").textContent = previewDesc;

  // Keyword check for dynamic Ad Strength
  const kwInput = $("wizard-keywords-input")
    ? $("wizard-keywords-input").value.toLowerCase()
    : "";
  const kwWords = kwInput.split(/[\n,\s]+/).filter((w) => w.length > 3);
  const hlCombined = hlInputs.join(" ").toLowerCase();
  const hasKeyword = kwWords.some((w) => hlCombined.includes(w));

  const chkKw = $("chk-keywords");
  const chkHl = $("chk-unique-hl");
  const chkDesc = $("chk-desc");
  if (chkKw)
    chkKw.className =
      hasKeyword && hlInputs.length > 0
        ? "ad-strength-check-item done"
        : "ad-strength-check-item";
  if (chkHl)
    chkHl.className =
      hlInputs.length >= 3
        ? "ad-strength-check-item done"
        : "ad-strength-check-item";
  if (chkDesc)
    chkDesc.className =
      descInputs.length >= 2
        ? "ad-strength-check-item done"
        : "ad-strength-check-item";

  // Calculate score
  let score = 0;
  if (hlInputs.length >= 2) score++;
  if (hlInputs.length >= 3) score++;
  if (descInputs.length >= 2) score++;
  if (hasKeyword) score++;

  const strengthLabel = $("rsa-strength-label");
  const bar1 = $("str-bar-1");
  const bar2 = $("str-bar-2");
  const bar3 = $("str-bar-3");
  const bar4 = $("str-bar-4");

  [bar1, bar2, bar3, bar4].forEach((b) => {
    if (b) b.className = "ad-strength-bar";
  });

  if (strengthLabel) {
    if (hlInputs.length === 0 && descInputs.length === 0) {
      strengthLabel.textContent = "Incomplete";
      strengthLabel.style.color = "#5f6368";
    } else if (score >= 4) {
      strengthLabel.textContent = "Excellent";
      strengthLabel.style.color = "#1a73e8";
      if (bar1) bar1.className = "ad-strength-bar bar-exc";
      if (bar2) bar2.className = "ad-strength-bar bar-exc";
      if (bar3) bar3.className = "ad-strength-bar bar-exc";
      if (bar4) bar4.className = "ad-strength-bar bar-exc";
    } else if (score >= 3) {
      strengthLabel.textContent = "Good";
      strengthLabel.style.color = "#1e8e3e";
      if (bar1) bar1.className = "ad-strength-bar bar-good";
      if (bar2) bar2.className = "ad-strength-bar bar-good";
      if (bar3) bar3.className = "ad-strength-bar bar-good";
    } else if (score >= 2) {
      strengthLabel.textContent = "Average";
      strengthLabel.style.color = "#fbbc04";
      if (bar1) bar1.className = "ad-strength-bar bar-avg";
      if (bar2) bar2.className = "ad-strength-bar bar-avg";
    } else {
      strengthLabel.textContent = "Poor";
      strengthLabel.style.color = "#ea4335";
      if (bar1) bar1.className = "ad-strength-bar bar-poor";
    }
  }

  if ($("rsa-headline-count")) {
    $("rsa-headline-count").textContent = `${hlInputs.length} / 15 added`;
  }
  if ($("rsa-desc-count")) {
    $("rsa-desc-count").textContent = `${descInputs.length} / 4 added`;
  }
}

function updateBudgetForecast() {
  for (const id of [
    "forecast-clicks",
    "forecast-cpc",
    "forecast-spend",
    "review-forecast",
  ])
    if ($(id)) $(id).textContent = "Unavailable — no Google forecast requested";
}
function populateWizardReview() {
  const nameVal = $("wizard-campaign-name")
    ? $("wizard-campaign-name").value.trim()
    : wizardState.campaignName;
  const budgetVal = $("wizard-budget-input")
    ? $("wizard-budget-input").value.trim()
    : wizardState.budget;
  const biddingVal = $("wizard-bidding-focus")
    ? $("wizard-bidding-focus").value
    : wizardState.biddingStrategy;

  if ($("review-name"))
    $("review-name").textContent = nameVal || "Sales-Search-1";
  if ($("review-objective"))
    $("review-objective").textContent = wizardState.objective;
  if ($("review-type")) $("review-type").textContent = wizardState.channel;
  if ($("review-bidding")) $("review-bidding").textContent = biddingVal;
  if ($("review-location"))
    $("review-location").textContent = wizardState.targetLocation || "India";
  if ($("review-budget"))
    $("review-budget").textContent =
      ` ${selectedGoogleAccount?.currency_code || ""} ${parseFloat(budgetVal || 500).toFixed(2)} / day`;

  const networks = [];
  if ($("wizard-network-search") && $("wizard-network-search").checked)
    networks.push("Google Search Network (with partners)");
  if ($("wizard-network-display") && $("wizard-network-display").checked)
    networks.push("Google Display Network");
  if ($("review-networks"))
    $("review-networks").textContent = networks.length
      ? networks.join(" + ")
      : "Search Network";

  const kwCount =
    $("wizard-keywords-input") && $("wizard-keywords-input").value.trim()
      ? $("wizard-keywords-input").value.trim().split("\n").filter(Boolean)
          .length
      : 0;
  if ($("review-kw-count"))
    $("review-kw-count").textContent = `${kwCount} keywords configured`;

  if (wizardState.channel !== "Search") {
    $("channel-review").textContent = campaignReviewText(extendedCampaignPayload({name: nameVal, ad_group: $("wizard-adgroup").value, budget: budgetVal, cpc: $("wizard-max-cpc").value, country: wizardState.targetLocation, eu_political: $("wizard-eu").checked ? false : null}));
  }
  updateBudgetForecast(parseFloat(budgetVal || 500));
}

let wizardInitialized = false;
function initCampaignWizard() {
  if (wizardInitialized) return;
  wizardInitialized = true;

  // Safe helper to query cards
  if (
    typeof document !== "undefined" &&
    typeof document.querySelectorAll === "function"
  ) {
    // Step 1: Objective cards
    document
      .querySelectorAll("#wizard-objective-grid .wizard-option-card")
      .forEach((card) => {
        card.onclick = () => {
          document
            .querySelectorAll("#wizard-objective-grid .wizard-option-card")
            .forEach((c) => c.classList.remove("selected"));
          card.classList.add("selected");
          const obj = card.getAttribute("data-objective") || "Sales";
          wizardState.objective = obj;
          if ($("wizard-goals-card-title")) {
            $("wizard-goals-card-title").textContent =
              `Use these conversion goals to improve ${obj}`;
          }
          if ($("wizard-nav-sub-1")) $("wizard-nav-sub-1").textContent = obj;
          updateSuggestedCampaignName();
        };
      });

    // Step 2: Campaign type cards
    document
      .querySelectorAll("#wizard-type-grid .wizard-option-card")
      .forEach((card) => {
        card.onclick = () => {
          document
            .querySelectorAll("#wizard-type-grid .wizard-option-card")
            .forEach((c) => c.classList.remove("selected"));
          card.classList.add("selected");
          const t = card.getAttribute("data-type") || "Search";
          wizardState.channel = t;
          if ($("wizard-nav-sub-2")) $("wizard-nav-sub-2").textContent = t;
          updateSuggestedCampaignName();
        };
      });

    // Step 8: Budget tier cards
    document
      .querySelectorAll("#budget-tiers-container .budget-tier-card")
      .forEach((card) => {
        card.onclick = () => {
          document
            .querySelectorAll("#budget-tiers-container .budget-tier-card")
            .forEach((c) => c.classList.remove("selected"));
          card.classList.add("selected");
          const b = card.getAttribute("data-budget") || "500.00";
          wizardState.budget = b;
          if ($("wizard-budget-input")) $("wizard-budget-input").value = b;
          updateBudgetForecast(b);
        };
      });

    // Left stepper clicks
    document.querySelectorAll(".wizard-step-item").forEach((item) => {
      item.onclick = () => {
        const step = parseInt(item.getAttribute("data-step"), 10);
        if (step && step <= wizardState.maxStepReached) {
          renderWizardStep(step);
        }
      };
    });

    // Input listeners for RSA live preview & char counters
    document.querySelectorAll(".rsa-hl-input").forEach((inp) => {
      inp.oninput = () => {
        const counter = inp.parentElement
          ? inp.parentElement.querySelector(".char-counter")
          : null;
        if (counter) counter.textContent = `${inp.value.length}/30`;
        updateRsaLivePreview();
      };
    });
    document.querySelectorAll(".rsa-desc-input").forEach((inp) => {
      inp.oninput = () => {
        const counter = inp.parentElement
          ? inp.parentElement.querySelector(".char-counter")
          : null;
        if (counter) counter.textContent = `${inp.value.length}/90`;
        updateRsaLivePreview();
      };
    });

    // Location radios
    document
      .querySelectorAll('input[name="wizard-location-opt"]')
      .forEach((radio) => {
        radio.onchange = () => {
          wizardState.targetLocation = radio.value;
          if ($("wizard-custom-location-box")) {
            $("wizard-custom-location-box").hidden = radio.value !== "Custom";
          }
        };
      });
  }

  // Additional preview listeners
  if ($("rsa-final-url")) $("rsa-final-url").oninput = updateRsaLivePreview;
  if ($("rsa-path-1")) $("rsa-path-1").oninput = updateRsaLivePreview;
  if ($("rsa-path-2")) $("rsa-path-2").oninput = updateRsaLivePreview;
  if ($("wizard-keywords-input"))
    $("wizard-keywords-input").oninput = updateRsaLivePreview;

  // Target CPA toggle
  if ($("wizard-set-cpa")) {
    $("wizard-set-cpa").onchange = () => {
      if ($("wizard-cpa-box"))
        $("wizard-cpa-box").hidden = !$("wizard-set-cpa").checked;
    };
  }

  // Reach checkbox toggles
  if ($("wizard-reach-website")) {
    $("wizard-reach-website").onchange = () => {
      if ($("wizard-reach-website-box")) {
        $("wizard-reach-website-box").hidden = !$("wizard-reach-website")
          .checked;
      }
    };
  }
  if ($("wizard-reach-phone")) {
    $("wizard-reach-phone").onchange = () => {
      if ($("wizard-reach-phone-box")) {
        $("wizard-reach-phone-box").hidden = !$("wizard-reach-phone").checked;
      }
    };
  }

  // Device switcher for ad preview
  if ($("btn-preview-mobile")) {
    $("btn-preview-mobile").onclick = () => {
      $("btn-preview-mobile").classList.add("active");
      if ($("btn-preview-desktop"))
        $("btn-preview-desktop").classList.remove("active");
      if ($("rsa-live-mock")) $("rsa-live-mock").style.maxWidth = "360px";
    };
  }
  if ($("btn-preview-desktop")) {
    $("btn-preview-desktop").onclick = () => {
      $("btn-preview-desktop").classList.add("active");
      if ($("btn-preview-mobile"))
        $("btn-preview-mobile").classList.remove("active");
      if ($("rsa-live-mock")) $("rsa-live-mock").style.maxWidth = "100%";
    };
  }

  // Add headline button
  if ($("rsa-add-hl-btn")) {
    $("rsa-add-hl-btn").onclick = () => {
      const container = $("rsa-headlines-container");
      if (!container) return;
      const count = container.querySelectorAll(".char-field-row").length;
      if (count >= 15) {
        toast("Maximum 15 headlines reached.", "error");
        return;
      }
      const div = document.createElement("div");
      div.className = "char-field-row";
      div.innerHTML = `
        <div class="char-input-wrap">
          <input type="text" class="gcp-input rsa-hl-input" placeholder="New headline" maxlength="30" style="width:100%;height:36px;padding-right:45px;box-sizing:border-box;">
          <span class="char-counter">0/30</span>
        </div>
        <button type="button" class="char-pin-btn" title="Pin position">📌</button>
      `;
      const input = div.querySelector("input");
      if (input) {
        input.oninput = (e) => {
          const counter = div.querySelector(".char-counter");
          if (counter) counter.textContent = `${e.target.value.length}/30`;
          updateRsaLivePreview();
        };
      }
      container.appendChild(div);
      if (input) input.focus();
      updateRsaLivePreview();
    };
  }

  // Add description button
  if ($("rsa-add-desc-btn")) {
    $("rsa-add-desc-btn").onclick = () => {
      const container = $("rsa-desc-container");
      if (!container) return;
      const count = container.querySelectorAll(".char-field-row").length;
      if (count >= 4) {
        toast("Maximum 4 descriptions reached.", "error");
        return;
      }
      const div = document.createElement("div");
      div.className = "char-field-row";
      div.innerHTML = `
        <div class="char-input-wrap">
          <textarea class="gcp-input rsa-desc-input" placeholder="New description (optional)" maxlength="90" rows="2" style="width:100%;box-sizing:border-box;resize:none;padding-right:45px;font-size:13px;"></textarea>
          <span class="char-counter">0/90</span>
        </div>
        <button type="button" class="char-pin-btn" title="Pin position">📌</button>
      `;
      const textarea = div.querySelector("textarea");
      if (textarea) {
        textarea.oninput = (e) => {
          const counter = div.querySelector(".char-counter");
          if (counter) counter.textContent = `${e.target.value.length}/90`;
          updateRsaLivePreview();
        };
      }
      container.appendChild(div);
      if (textarea) textarea.focus();
      updateRsaLivePreview();
    };
  }

  // Custom budget input listener
  if ($("wizard-budget-input")) {
    $("wizard-budget-input").oninput = (e) => {
      updateBudgetForecast(e.target.value);
    };
  }

  // Step 1-9 buttons
  if ($("wizard-step-1-cancel"))
    $("wizard-step-1-cancel").onclick = () => showView("campaigns");
  if ($("wizard-step-1-next"))
    $("wizard-step-1-next").onclick = () => renderWizardStep(2);

  if ($("wizard-step-2-back"))
    $("wizard-step-2-back").onclick = () => renderWizardStep(1);
  if ($("wizard-step-2-next"))
    $("wizard-step-2-next").onclick = () => {
      updateSuggestedCampaignName();
      renderWizardStep(3);
    };

  if ($("wizard-step-3-back"))
    $("wizard-step-3-back").onclick = () => renderWizardStep(2);
  if ($("wizard-step-3-next"))
    $("wizard-step-3-next").onclick = () => {
      const name = $("wizard-campaign-name")
        ? $("wizard-campaign-name").value.trim()
        : "";
      if (!name) {
        toast("Please enter a campaign name.", "error");
        if ($("wizard-campaign-name")) $("wizard-campaign-name").focus();
        return;
      }
      wizardState.campaignName = name;
      // Pre-populate URL and phone forward if user entered them in step 3
      if ($("wizard-reach-website") && $("wizard-reach-website").checked) {
        const site = $("wizard-website-url")
          ? $("wizard-website-url").value.trim()
          : "";
        if (site) {
          if ($("channel-url") && !$("channel-url").value.trim()) $("channel-url").value = site;
          if ($("rsa-final-url") && !$("rsa-final-url").value.trim())
            $("rsa-final-url").value = site;
          if ($("wizard-kw-scan-url") && !$("wizard-kw-scan-url").value.trim())
            $("wizard-kw-scan-url").value = site;
        }
      }
      if ($("wizard-reach-phone") && $("wizard-reach-phone").checked) {
        const ph = $("wizard-phone-number")
          ? $("wizard-phone-number").value.trim()
          : "";
        if (
          ph &&
          $("wizard-asset-phone") &&
          !$("wizard-asset-phone").value.trim()
        ) {
          $("wizard-asset-phone").value = ph;
        }
      }
      renderWizardStep(4);
    };

  if ($("wizard-step-4-back"))
    $("wizard-step-4-back").onclick = () => renderWizardStep(3);
  if ($("wizard-step-4-next"))
    $("wizard-step-4-next").onclick = () => renderWizardStep(5);

  if ($("wizard-step-5-back"))
    $("wizard-step-5-back").onclick = () => renderWizardStep(4);
  if ($("wizard-step-5-next"))
    $("wizard-step-5-next").onclick = () => renderWizardStep(6);

  if ($("wizard-step-6-back"))
    $("wizard-step-6-back").onclick = () => renderWizardStep(5);
  if ($("wizard-step-6-next"))
    $("wizard-step-6-next").onclick = () => renderWizardStep(7);

  if ($("wizard-step-7-back"))
    $("wizard-step-7-back").onclick = () => renderWizardStep(6);
  if ($("wizard-step-7-next"))
    $("wizard-step-7-next").onclick = () => renderWizardStep(8);

  if ($("wizard-step-8-back"))
    $("wizard-step-8-back").onclick = () => renderWizardStep(7);
  if ($("wizard-step-8-next"))
    $("wizard-step-8-next").onclick = () => renderWizardStep(9);

  if ($("wizard-step-9-back"))
    $("wizard-step-9-back").onclick = () => renderWizardStep(8);
  if ($("wizard-publish-btn"))
    $("wizard-publish-btn").onclick = submitWizardCampaign;

  // Step 9 edit shortcuts
  if ($("rev-edit-step-1"))
    $("rev-edit-step-1").onclick = () => renderWizardStep(1);
  if ($("rev-edit-step-4"))
    $("rev-edit-step-4").onclick = () => renderWizardStep(4);
  if ($("rev-edit-step-6"))
    $("rev-edit-step-6").onclick = () => renderWizardStep(6);
  if ($("rev-edit-step-8"))
    $("rev-edit-step-8").onclick = () => renderWizardStep(8);

  // Header cancel & breadcrumb
  if ($("wizard-breadcrumb-campaigns"))
    $("wizard-breadcrumb-campaigns").onclick = (e) => {
      e.preventDefault();
      showView("campaigns");
    };
  if ($("wizard-cancel-btn-top"))
    $("wizard-cancel-btn-top").onclick = () => showView("campaigns");
}

function configureSupportedWizard() {
  const root = $("view-create-campaign");
  const notice = document.createElement("p");
  notice.className = "subtle";
  notice.textContent =
    "Search publishing is connected. Unavailable options remain visible but cannot be published. Drafts are reviewed before creating a paused campaign in Google Ads.";
  if (!$("wizard-support-note")) {
    notice.id = "wizard-support-note";
    root.prepend(notice);
  }
  $("wizard-bidding-focus").innerHTML =
    '<option value="Manual CPC">Manual CPC</option><option disabled>Maximise conversions — not connected</option><option disabled>Maximise clicks — not connected</option>';
  $("wizard-status-select").innerHTML =
    '<option value="PAUSED">Paused</option>';
  const disabled = [
    "wizard-set-cpa",
    "wizard-opt-new-customers",
    "wizard-opt-retention",
    "wizard-network-search",
    "wizard-network-display",
    "wizard-reach-phone",
    "wizard-reach-shop",
    "wizard-scan-kw-btn",
    "wizard-add-goal-btn",
    "wizard-asset-phone",
    "rsa-path-1",
    "rsa-path-2",
  ];
  for (const id of disabled) {
    const el = $(id);
    if (el) {
      el.disabled = true;
      if (el.type === "checkbox") el.checked = false;
      el.title = "Not connected to publishing yet";
    }
  }
  root
    .querySelectorAll(".sitelink-chk,.callout-chk,.char-pin-btn")
    .forEach((el) => {
      el.disabled = true;
      el.title = "Not connected to publishing yet";
    });
  root.querySelectorAll('input[name="wizard-location-opt"]').forEach((el) => {
    el.checked = el.value === "India";
    el.disabled = !["India", "United States", "United Kingdom"].includes(
      el.value,
    );
  });
  wizardState.targetLocation = "India";
  wizardState.channel = "Search";
  if (!$("wizard-publish-options")) {
    const box = document.createElement("div");
    box.id = "wizard-publish-options";
    box.className = "gcp-card";
    box.innerHTML =
      '<div class="gcp-card-body"><label for="wizard-adgroup">Ad group name</label><input id="wizard-adgroup" class="gcp-input" value="Ad group 1" maxlength="100"><label for="wizard-max-cpc">Maximum CPC · account currency</label><input id="wizard-max-cpc" class="gcp-input" type="number" min="0.01" step="0.01" value="5"><label for="wizard-match">Keyword match</label><select id="wizard-match" class="gcp-input"><option value="PHRASE">Phrase</option><option value="EXACT">Exact</option></select><label><input id="wizard-eu" type="checkbox"> This campaign does not contain EU political advertising.</label><p class="subtle">Search only · People in your selected country · Search partners and Display off. Google determines language targeting from your ad and landing page.</p></div>';
    $("wizard-pane-9").insertBefore(box, $("wizard-pane-9").firstChild);
  }
  $("wizard-eu").checked = false;
  updateBudgetForecast();
  $("wizard-publish-btn").textContent = "Save draft & review";
  $("wizard-pane-7")
    .querySelectorAll("input")
    .forEach((el) => (el.disabled = true));
  for (const n of [1, 4, 5, 7]) {
    const pane = $("wizard-pane-" + n);
    if (!pane.querySelector(".unsupported-note")) {
      const p = document.createElement("p");
      p.className = "subtle unsupported-note";
      p.textContent = {
        1: "Objective is a planning choice. Conversion goal setup is not connected.",
        4: "Publishing currently uses Manual CPC. Automated bidding and customer acquisition settings are not connected.",
        5: "Search partners and Display are off. Only supported country targeting is sent to Google; language selection is automatic.",
        7: "Asset publishing is not connected yet. These options are shown for reference.",
      }[n];
      pane.prepend(p);
    }
  }
  root
    .querySelectorAll(".mock-ad-sitelinks")
    .forEach((el) => (el.hidden = true));
  root
    .querySelectorAll(".budget-tier-forecast")
    .forEach(
      (el) => (el.textContent = "Preset budget · not a performance forecast"),
    );
  root
    .querySelectorAll(".budget-tier-amount")
    .forEach(
      (el) =>
        (el.textContent = el.textContent.replace("Rs.", "Account currency")),
    );
  root
    .querySelectorAll(".budget-tier-badge")
    .forEach((el) => (el.textContent = "Preset"));
}
async function submitWizardCampaign() {
  const button = $("wizard-publish-btn");
  button.disabled = true;
  const lines = (selector) =>
    [...document.querySelectorAll(selector)]
      .map((el) => el.value.trim())
      .filter(Boolean)
      .join("\n");
  try {
    await workspaceRequest("/" + activeWs + "/campaigns/create", "POST", extendedCampaignPayload({
      name: $("wizard-campaign-name").value,
      channel: "Search",
      ad_group: $("wizard-adgroup").value,
      budget: $("wizard-budget-input").value,
      cpc: $("wizard-max-cpc").value,
      country: wizardState.targetLocation,
      match_type: $("wizard-match").value,
      final_url: $("rsa-final-url").value || $("wizard-website-url").value,
      keywords: $("wizard-keywords-input").value,
      headlines: lines(".rsa-hl-input"),
      descriptions: lines(".rsa-desc-input"),
      eu_political: $("wizard-eu").checked ? false : null,
    }));
    toast("Draft saved. Review it before publishing to Google Ads.", "success");
    showView("campaigns");
  } catch (error) {
    toast(error.message, "error");
  } finally {
    button.disabled = false;
  }
}
async function loadPublications(wsId) {
  const box = $("publication-list");
  box.replaceChildren();
  try {
    const result = await workspaceRequest("/" + wsId + "/campaigns/drafts");
    if (wsId !== activeWs) return;
    if (!result.drafts.length) {
      box.textContent =
        "No drafts yet. Create a campaign to get started.";
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
      text.textContent = campaignReviewText(p);
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
              "Publish this " + (draft.payload.channel || "Search") + " campaign to Google Ads account " +
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
