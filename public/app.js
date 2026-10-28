/* app.js – all frontend logic */
'use strict';

const $ = id => document.getElementById(id);

/* ── Toast ───────────────────────────────────────── */
let toastTimer;
function toast(msg, type) {
  const el = $('toast');
  if (!el) return;
  el.textContent = msg;
  el.className = 'show' + (type ? ' ' + type : '');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.className = ''; }, 5000);
}

/* ── Auth fetch ──────────────────────────────────── */
async function request(path, body) {
  const res = await fetch(path, body
    ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
    : {});
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Please try again.');
  return data;
}

/* ── Workspace fetch (60 s timeout) ─────────────── */
async function workspaceRequest(path, method, body) {
  method = method || 'GET';
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 60000);
  let res;
  try {
    res = await fetch('/api/workspaces' + path, {
      method,
      signal: ctrl.signal,
      headers: { 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch (err) {
    clearTimeout(timer);
    throw new Error(err.name === 'AbortError'
      ? 'Request timed out — the database may be waking up. Click Retry.'
      : err.message);
  }
  clearTimeout(timer);
  let data;
  try { data = await res.json(); } catch { data = { error: 'Unexpected response.' }; }
  if (!res.ok) throw new Error(data.error || 'Request failed.');
  return data;
}

/* ══════════════════════════════════════════════════
   VIEW ROUTING (members | ads)
   ══════════════════════════════════════════════════ */
let currentView = 'members';

function showView(view) {
  currentView = view;
  const viewMembers = $('view-members');
  const viewAds = $('view-ads');
  if (viewMembers) viewMembers.hidden = view !== 'members';
  if (viewAds) viewAds.hidden = view !== 'ads';

  const navMembers = $('nav-members');
  const navAds = $('nav-ads');
  if (navMembers && navMembers.classList) navMembers.classList.toggle('active', view === 'members');
  if (navAds && navAds.classList) navAds.classList.toggle('active', view === 'ads');

  if (view === 'ads') loadAds(activeWs, currentManage);
}

if ($('nav-members')) $('nav-members').onclick = () => showView('members');
if ($('nav-ads')) $('nav-ads').onclick = () => showView('ads');

/* ══════════════════════════════════════════════════
   AUTH
   ══════════════════════════════════════════════════ */
let authMode = 'login';
let currentManage = false;

function renderUser(user) {
  $('auth-screen').hidden = Boolean(user);
  $('password').value     = '';
  $('status').textContent = '';
  if (user) {
    $('nav-email').textContent  = user.email;
    $('nav-avatar').textContent = (user.email[0] || '?').toUpperCase();
    loadWorkspacesOnBoot();
  } else {
    $('app-shell').hidden = true;
    hideOnboarding();
  }
}

$('switch').onclick = () => {
  authMode = authMode === 'login' ? 'signup' : 'login';
  const su = authMode === 'signup';
  $('heading').textContent      = su ? 'Create an account' : 'Log in';
  $('intro').textContent        = su ? 'Your email and a password are all you need.' : 'Use your 8LM account to continue';
  $('submit').textContent       = su ? 'Create account' : 'Sign in';
  $('switch-label').textContent = su ? 'Already have an account?' : 'New to 8LM?';
  $('switch').textContent       = su ? 'Sign in' : 'Create an account';
  $('password').autocomplete    = su ? 'new-password' : 'current-password';
  $('password').minLength       = su ? 12 : 1;
  $('hint').hidden              = !su;
  $('status').textContent       = '';
};

$('show').onclick = () => {
  const vis = $('password').type === 'password';
  $('password').type = vis ? 'text' : 'password';
  $('show').textContent = vis ? 'Hide' : 'Show';
  $('show').setAttribute('aria-label', vis ? 'Hide password' : 'Show password');
  $('show').setAttribute('aria-pressed', String(vis));
};

$('form').onsubmit = async ev => {
  ev.preventDefault();
  await boot;
  $('submit').disabled = true;
  $('switch').disabled = true;
  $('status').textContent = '';
  try {
    const data = await request('/api/auth/' + authMode, {
      email: $('email').value,
      password: $('password').value,
    });
    renderUser(data.user);
  } catch (e) {
    $('status').textContent = e.message;
  } finally {
    $('submit').disabled = false;
    $('switch').disabled = false;
  }
};

$('nav-signout-btn').onclick = async () => {
  try {
    await request('/api/logout', {});
    hideOnboarding();
    renderUser(null);
  } catch (e) {
    toast(e.message, 'error');
  }
};

/* ══════════════════════════════════════════════════
   ONBOARDING: FIRST WORKSPACE (WHEN 0 WORKSPACES EXIST)
   ══════════════════════════════════════════════════ */
let pendingOnboardingName = '';

function showOnboarding() {
  const ob = $('onboarding-screen');
  if (!ob) return;
  pendingOnboardingName = '';
  $('onboarding-step1').hidden = false;
  $('onboarding-step2').hidden = true;
  $('onboarding-ws-name').value = '';
  $('onboarding-ads-id').value = '';
  $('onboarding-ads-name').value = '';
  ob.hidden = false;
  setTimeout(() => $('onboarding-ws-name').focus(), 50);
}

function hideOnboarding() {
  const ob = $('onboarding-screen');
  if (ob) ob.hidden = true;
}

if ($('onboarding-form-step1')) {
  $('onboarding-form-step1').onsubmit = (ev) => {
    ev.preventDefault();
    const name = $('onboarding-ws-name').value.trim();
    if (!name) return;
    pendingOnboardingName = name;
    $('onboarding-step1').hidden = true;
    $('onboarding-step2').hidden = false;
    $('onboarding-ws-name-display').textContent = name;
    setTimeout(() => $('onboarding-ads-id').focus(), 50);
  };
}

if ($('onboarding-back-btn')) {
  $('onboarding-back-btn').onclick = () => {
    $('onboarding-step1').hidden = false;
    $('onboarding-step2').hidden = true;
    setTimeout(() => $('onboarding-ws-name').focus(), 50);
  };
}

if ($('onboarding-skip-btn')) {
  $('onboarding-skip-btn').onclick = async () => {
    const name = pendingOnboardingName;
    const btn = $('onboarding-skip-btn');
    btn.disabled = true;
    try {
      const r = await workspaceRequest('', 'POST', { name });
      hideOnboarding();
      await loadWorkspaces(r.id);
      showView('members');
      toast('Workspace "' + name + '" created!', 'success');
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      btn.disabled = false;
    }
  };
}

if ($('onboarding-connect-btn')) {
  $('onboarding-connect-btn').onclick = async () => {
    const name = pendingOnboardingName;
    const rawId = $('onboarding-ads-id').value.trim();
    const digits = rawId.replace(/-/g, '');
    if (!/^\d{10}$/.test(digits)) {
      toast('Enter a valid 10-digit Google Ads Customer ID (e.g. 123-456-7890).', 'error');
      $('onboarding-ads-id').focus();
      return;
    }
    const btn = $('onboarding-connect-btn');
    btn.disabled = true;
    btn.textContent = 'Setting up…';
    try {
      const r = await workspaceRequest('', 'POST', { name });
      await workspaceRequest('/' + r.id + '/ads', 'POST', {
        customer_id: rawId,
        account_name: $('onboarding-ads-name').value.trim(),
      });
      hideOnboarding();
      await loadWorkspaces(r.id);
      showView('ads');
      toast('Workspace "' + name + '" created! Please approve the link in Google Ads.', 'success');
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      btn.disabled = false;
      btn.textContent = 'Create & Finish';
    }
  };
}

/* ══════════════════════════════════════════════════
   WORKSPACES
   ══════════════════════════════════════════════════ */
let activeWs;
const roleNames = ['Admin', 'Editor', 'Publisher', 'Viewer'];

function roleChipClass(role) {
  if (role === 'Owner') return 'role-chip owner';
  if (role === 'Admin') return 'role-chip admin';
  return 'role-chip';
}

function actionBtn(label, cls, fn) {
  const b = document.createElement('button');
  b.type = 'button';
  b.textContent = label;
  b.className = 'btn' + (cls ? ' ' + cls : '');
  b.onclick = async () => {
    b.disabled = true;
    try { await fn(); }
    catch (e) { toast(e.message, 'error'); }
    finally { b.disabled = false; }
  };
  return b;
}

function showLoadError(msg) {
  $('workspace-title').textContent = 'Failed to load';
  const old = $('retry-btn');
  if (old) old.remove();
  const btn = document.createElement('button');
  btn.id = 'retry-btn';
  btn.className = 'btn btn-filled';
  btn.style.cssText = 'margin-top:12px;display:block';
  btn.textContent = '↺ Retry';
  btn.onclick = () => loadWorkspaces(activeWs);
  $('page-header-left').appendChild(btn);
  toast(msg, 'error');
}

async function loadWorkspaces(preferred) {
  const old = $('retry-btn');
  if (old) old.remove();

  let workspaces;
  try {
    const res = await workspaceRequest('');
    workspaces = res.workspaces;
  } catch (e) {
    showLoadError(e.message);
    return;
  }

  // If user has NO workspaces, show the first-time onboarding wizard!
  if (!workspaces || workspaces.length === 0) {
    $('app-shell').hidden = true;
    showOnboarding();
    return;
  }

  // User has at least one workspace: show app console
  hideOnboarding();
  $('app-shell').hidden = false;

  const sel = $('workspace-select');
  sel.replaceChildren();
  for (const w of workspaces) {
    const o = document.createElement('option');
    o.value = w.id; o.textContent = w.name;
    sel.appendChild(o);
  }

  activeWs = (workspaces.find(w => w.id === Number(preferred)) || workspaces[0] || {}).id;
  if (activeWs) {
    sel.value = activeWs;
    await loadWorkspace();
    showView(currentView);
  }
}

async function loadWorkspace() {
  const id = activeWs;
  let data;
  try { data = await workspaceRequest('/' + id); }
  catch (e) { showLoadError(e.message); return; }
  if (id !== activeWs) return;

  const w = data.workspace;
  const manage = w.role === 'Owner' || w.role === 'Admin';
  currentManage = manage;

  $('nav-ws-name').textContent     = w.name;
  $('workspace-title').textContent = w.name;
  $('your-role').textContent       = w.role;
  $('your-role').className         = roleChipClass(w.role);
  $('workspace-actions').hidden    = !manage;
  $('delete-workspace').hidden     = w.role !== 'Owner';
  $('invite-section').hidden       = !manage;
  $('invite-link-area').hidden     = true;

  // Check Google Ads status in background for sidebar badge
  loadAds(id, manage);

  /* Invite roles */
  $('invite-role').replaceChildren();
  for (const r of roleNames.filter(r => w.role === 'Owner' || r !== 'Admin')) {
    const o = document.createElement('option');
    o.value = r; o.textContent = r;
    $('invite-role').appendChild(o);
  }
  $('invite-role').value = 'Viewer';

  /* Members */
  const mBody = $('members');
  mBody.replaceChildren();
  for (const m of data.members) {
    const tr = document.createElement('tr');
    const tdE = document.createElement('td'); tdE.textContent = m.email;
    const tdR = document.createElement('td');
    const tdA = document.createElement('td');
    const canEdit = manage && m.role !== 'Owner' && (w.role === 'Owner' || m.role !== 'Admin');
    if (canEdit) {
      const sel = document.createElement('select');
      sel.setAttribute('aria-label', 'Role for ' + m.email);
      for (const r of roleNames.filter(r => w.role === 'Owner' || r !== 'Admin')) {
        const o = document.createElement('option'); o.textContent = r; sel.appendChild(o);
      }
      sel.value = m.role;
      tdR.appendChild(sel);
      const wrap = document.createElement('div'); wrap.className = 'row-actions';
      wrap.appendChild(actionBtn('Save role', '', async () => {
        await workspaceRequest('/' + id + '/members/' + m.id, 'PATCH', { role: sel.value });
        toast('Role updated.', 'success'); await loadWorkspace();
      }));
      wrap.appendChild(actionBtn('Remove', 'btn-danger', async () => {
        if (confirm('Remove ' + m.email + ' from this workspace?')) {
          await workspaceRequest('/' + id + '/members/' + m.id, 'DELETE');
          toast(m.email + ' removed.'); await loadWorkspace();
        }
      }));
      if (w.role === 'Owner' && m.role !== 'Owner') {
        wrap.appendChild(actionBtn('Transfer ownership', 'btn-danger', async () => {
          if (confirm('Transfer ownership to ' + m.email + '? You will become an Admin.')) {
            await workspaceRequest('/' + id + '/transfer', 'POST', { user: m.id });
            toast('Ownership transferred.'); await loadWorkspace();
          }
        }));
      }
      tdA.appendChild(wrap);
    } else {
      const chip = document.createElement('span');
      chip.className = roleChipClass(m.role); chip.textContent = m.role;
      tdR.appendChild(chip); tdA.textContent = '—';
    }
    tr.append(tdE, tdR, tdA); mBody.appendChild(tr);
  }
  if (!data.members.length) {
    const tr = document.createElement('tr');
    const td = document.createElement('td'); td.colSpan = 3;
    td.innerHTML = '<div class="empty-state">No members.</div>';
    tr.appendChild(td); mBody.appendChild(tr);
  }

  /* Invites */
  const iBody = $('invites');
  iBody.replaceChildren();
  for (const inv of data.invites) {
    const tr = document.createElement('tr');
    const tdE = document.createElement('td'); tdE.textContent = inv.email;
    const tdR = document.createElement('td');
    const chip = document.createElement('span');
    chip.className = roleChipClass(inv.role); chip.textContent = inv.role; tdR.appendChild(chip);
    const tdX = document.createElement('td');
    tdX.textContent = new Date(Number(inv.expires)).toLocaleDateString();
    const tdA = document.createElement('td');
    if (w.role === 'Owner' || inv.role !== 'Admin') {
      tdA.appendChild(actionBtn('Revoke', 'btn-danger', async () => {
        await workspaceRequest('/' + id + '/invites/' + inv.id, 'DELETE');
        toast('Invitation revoked.'); await loadWorkspace();
      }));
    } else { tdA.textContent = '—'; }
    tr.append(tdE, tdR, tdX, tdA); iBody.appendChild(tr);
  }
  if (!data.invites.length) {
    const tr = document.createElement('tr');
    const td = document.createElement('td'); td.colSpan = 4;
    td.innerHTML = '<div class="empty-state">' + (manage ? 'No pending invitations.' : 'Invitation details are visible to workspace administrators.') + '</div>';
    tr.appendChild(td); iBody.appendChild(tr);
  }

  /* Activity */
  const aDiv = $('activity');
  aDiv.replaceChildren();
  for (const item of data.activity) {
    const d = document.createElement('div'); d.className = 'activity-item';
    const dot = document.createElement('div'); dot.className = 'activity-dot';
    const info = document.createElement('div');
    const txt = document.createElement('div'); txt.className = 'activity-text';
    txt.textContent = item.actor + ' · ' + item.action;
    const time = document.createElement('div'); time.className = 'activity-time';
    time.textContent = new Date(Number(item.created)).toLocaleString();
    info.append(txt, time); d.append(dot, info); aDiv.appendChild(d);
  }
  if (!data.activity.length) {
    const d = document.createElement('div'); d.className = 'empty-state';
    d.textContent = 'No activity yet.'; aDiv.appendChild(d);
  }
}

/* ── Workspace selector ──────────────────────────── */
$('workspace-select').onchange = async e => {
  activeWs = Number(e.target.value);
  try { await loadWorkspace(); showView(currentView); }
  catch (e) { toast(e.message, 'error'); }
};

/* ══════════════════════════════════════════════════
   CREATE WORKSPACE WIZARD (MODAL FOR EXISTING USERS)
   ══════════════════════════════════════════════════ */
let pendingWsName = '';

function openCreateWizard() {
  const modal = $('create-ws-modal');
  if (!modal) return;
  pendingWsName = '';
  $('create-ws-name').value = '';
  $('wizard-ads-id').value = '';
  $('wizard-ads-name').value = '';

  // Show Step 1
  $('create-ws-step1').hidden = false;
  $('create-ws-step2').hidden = true;
  $('modal-step-label').textContent = 'Step 1 of 2';
  $('create-modal-title').textContent = 'Create workspace';

  modal.hidden = false;
  setTimeout(() => $('create-ws-name').focus(), 50);
}

function closeCreateWizard() {
  const modal = $('create-ws-modal');
  if (modal) modal.hidden = true;
}

$('new-workspace').onclick = () => openCreateWizard();
if ($('create-ws-close')) $('create-ws-close').onclick = () => closeCreateWizard();
if ($('create-ws-cancel')) $('create-ws-cancel').onclick = () => closeCreateWizard();

// Step 1: Continue to Step 2
if ($('create-ws-next')) {
  $('create-ws-next').onclick = () => {
    const name = $('create-ws-name').value.trim();
    if (!name) {
      toast('Please enter a workspace name.');
      $('create-ws-name').focus();
      return;
    }
    pendingWsName = name;

    // Transition to Step 2
    $('create-ws-step1').hidden = true;
    $('create-ws-step2').hidden = false;
    $('modal-step-label').textContent = 'Step 2 of 2';
    $('create-modal-title').textContent = 'Connect Google Ads to ' + name;
    setTimeout(() => $('wizard-ads-id').focus(), 50);
  };
}

// Step 2: Go back to Step 1
if ($('create-ws-back')) {
  $('create-ws-back').onclick = () => {
    $('create-ws-step1').hidden = false;
    $('create-ws-step2').hidden = true;
    $('modal-step-label').textContent = 'Step 1 of 2';
    $('create-modal-title').textContent = 'Create workspace';
    setTimeout(() => $('create-ws-name').focus(), 50);
  };
}

// Step 2: Skip Google Ads connection
if ($('wizard-skip-ads')) {
  $('wizard-skip-ads').onclick = async () => {
    const name = pendingWsName;
    const btn = $('wizard-skip-ads');
    btn.disabled = true;
    try {
      const r = await workspaceRequest('', 'POST', { name });
      closeCreateWizard();
      await loadWorkspaces(r.id);
      showView('members');
      toast('Workspace "' + name + '" created.', 'success');
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      btn.disabled = false;
    }
  };
}

// Step 2: Connect Google Ads and Finish
if ($('wizard-connect-ads')) {
  $('wizard-connect-ads').onclick = async () => {
    const name = pendingWsName;
    const rawId = $('wizard-ads-id').value.trim();
    const digits = rawId.replace(/-/g, '');
    if (!/^\d{10}$/.test(digits)) {
      toast('Enter a valid 10-digit Google Ads Customer ID (e.g. 123-456-7890).', 'error');
      $('wizard-ads-id').focus();
      return;
    }
    const btn = $('wizard-connect-ads');
    btn.disabled = true;
    btn.textContent = 'Creating…';
    try {
      const r = await workspaceRequest('', 'POST', { name });
      await workspaceRequest('/' + r.id + '/ads', 'POST', {
        customer_id: rawId,
        account_name: $('wizard-ads-name').value.trim(),
      });
      closeCreateWizard();
      await loadWorkspaces(r.id);
      showView('ads');
      toast('Workspace "' + name + '" created! Please approve the link in Google Ads.', 'success');
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      btn.disabled = false;
      btn.textContent = 'Create & Connect';
    }
  };
}

/* ── Rename & Delete Workspace ──────────────────── */
$('rename-workspace').onclick = async () => {
  const name = prompt('New workspace name', $('workspace-title').textContent);
  if (!name) return;
  try {
    await workspaceRequest('/' + activeWs, 'PATCH', { name });
    await loadWorkspaces(activeWs);
    toast('Workspace renamed.', 'success');
  } catch (e) { toast(e.message, 'error'); }
};

$('delete-workspace').onclick = async () => {
  const wsName = $('workspace-title').textContent;
  const typed = prompt('Permanently delete this workspace?\n\nType "' + wsName + '" to confirm.');
  if (typed === null) return;
  try {
    await workspaceRequest('/' + activeWs, 'DELETE', { name: typed });
    toast('Workspace deleted.');
    await loadWorkspaces();
  } catch (e) { toast(e.message, 'error'); }
};

/* ── Invites ─────────────────────────────────────── */
$('invite-form').onsubmit = async ev => {
  ev.preventDefault();
  const id = activeWs;
  try {
    const r = await workspaceRequest('/' + id + '/invites', 'POST', {
      email: $('invite-email').value,
      role:  $('invite-role').value,
    });
    await loadWorkspace();
    if (activeWs !== id) return;
    $('invite-link-area').hidden = false;
    $('invite-link').value = location.origin + '/#invite=' + r.token;
    $('invite-link').select();
    toast('Invitation created. Share the link privately.', 'success');
  } catch (e) { toast(e.message, 'error'); }
};

$('copy-link-btn').onclick = async () => {
  try {
    await navigator.clipboard.writeText($('invite-link').value);
    toast('Link copied to clipboard.', 'success');
  } catch {
    $('invite-link').select();
    toast('Press Ctrl+C / Cmd+C to copy.');
  }
};

/* ══════════════════════════════════════════════════
   GOOGLE ADS PAGE (OPTION 1: MCC MANAGER LINKING)
   ══════════════════════════════════════════════════ */

async function loadAds(wsId, canManage) {
  if (!wsId) return;
  let data;
  try { data = await workspaceRequest('/' + wsId + '/ads'); }
  catch (e) { return; }

  const ads = data.ads;
  const isLinked = Boolean(ads);
  const status = ads ? (ads.status || 'ACTIVE') : 'DISCONNECTED';
  const managerName = (ads && ads.manager_id) || data.manager_id || '8LM MCC Manager';

  // Badge in sidebar
  const badge = $('ads-sidebar-badge');
  if (badge) {
    badge.hidden = !isLinked;
    if (status === 'ACTIVE') {
      badge.textContent = 'Active';
      badge.className = 'sidebar-badge';
    } else {
      badge.textContent = 'Pending';
      badge.className = 'sidebar-badge pending';
    }
  }

  if (!canManage && !isLinked) {
    $('ads-page-disconnected').hidden = true;
    $('ads-page-pending').hidden      = true;
    $('ads-page-connected').hidden    = true;
    $('ads-no-permission').hidden     = false;
    $('ads-no-permission-msg').textContent = 'No Google Ads account has been linked to this workspace yet. Ask an owner or admin to link one.';
    return;
  }

  $('ads-no-permission').hidden = true;

  if (status === 'PENDING') {
    // Show Pending Approval state
    $('ads-page-disconnected').hidden = true;
    $('ads-page-pending').hidden      = false;
    $('ads-page-connected').hidden    = true;

    $('ads-pending-id').textContent      = ads.customer_id;
    $('ads-pending-name').textContent    = ads.account_name || '—';
    $('ads-pending-manager').textContent = managerName;
    const inst = $('mcc-instruction-name');
    if (inst) inst.textContent = managerName;

    if ($('ads-verify-btn')) $('ads-verify-btn').hidden = !canManage;
    if ($('ads-cancel-pending-btn')) $('ads-cancel-pending-btn').hidden = !canManage;
  } else if (status === 'ACTIVE') {
    // Show Connected & Active state
    $('ads-page-disconnected').hidden = true;
    $('ads-page-pending').hidden      = true;
    $('ads-page-connected').hidden    = false;

    $('ads-display-id').textContent   = ads.customer_id;
    $('ads-display-name').textContent = ads.account_name || '—';
    $('ads-display-date').textContent = new Date(Number(ads.connected_at)).toLocaleDateString(undefined, { year:'numeric', month:'long', day:'numeric' });

    if ($('ads-disconnect-btn')) $('ads-disconnect-btn').hidden = !canManage;
  } else {
    // Disconnected state
    $('ads-page-disconnected').hidden = false;
    $('ads-page-pending').hidden      = true;
    $('ads-page-connected').hidden    = true;
    $('ads-customer-id').value  = '';
    $('ads-account-name').value = '';
  }
}

$('ads-form').onsubmit = async ev => {
  ev.preventDefault();
  const btn = $('ads-connect-btn');
  btn.disabled = true;
  btn.textContent = 'Sending request…';
  try {
    await workspaceRequest('/' + activeWs + '/ads', 'POST', {
      customer_id:  $('ads-customer-id').value,
      account_name: $('ads-account-name').value,
    });
    toast('Link request sent! Please accept in your Google Ads dashboard.', 'success');
    await loadAds(activeWs, currentManage);
  } catch (e) {
    toast(e.message, 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Send link request';
  }
};

// Check / verify link button
if ($('ads-verify-btn')) {
  $('ads-verify-btn').onclick = async () => {
    const btn = $('ads-verify-btn');
    btn.disabled = true;
    btn.textContent = 'Verifying…';
    try {
      await workspaceRequest('/' + activeWs + '/ads/verify', 'POST');
      toast('Google Ads account linked and active!', 'success');
      await loadAds(activeWs, currentManage);
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      btn.disabled = false;
      btn.textContent = "Check status / Link accepted";
    }
  };
}

// Cancel pending link request
if ($('ads-cancel-pending-btn')) {
  $('ads-cancel-pending-btn').onclick = async () => {
    if (!confirm('Cancel this pending link request?')) return;
    const btn = $('ads-cancel-pending-btn');
    btn.disabled = true;
    try {
      await workspaceRequest('/' + activeWs + '/ads', 'DELETE');
      toast('Link request cancelled.');
      await loadAds(activeWs, currentManage);
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      btn.disabled = false;
    }
  };
}

// Unlink connected account
$('ads-disconnect-btn').onclick = async () => {
  if (!confirm('Unlink this Google Ads account from this workspace?')) return;
  $('ads-disconnect-btn').disabled = true;
  try {
    await workspaceRequest('/' + activeWs + '/ads', 'DELETE');
    toast('Google Ads account unlinked.');
    await loadAds(activeWs, currentManage);
  } catch (e) {
    toast(e.message, 'error');
  } finally {
    $('ads-disconnect-btn').disabled = false;
  }
};

/* ── Boot ────────────────────────────────────────── */
async function loadWorkspacesOnBoot() {
  const params = new URLSearchParams(location.hash.slice(1));
  const token = params.get('invite');
  let preferred;
  if (token) {
    try {
      const res = await workspaceRequest('/accept', 'POST', { token });
      preferred = res.id;
      history.replaceState({}, '', location.pathname);
      toast('Invitation accepted.', 'success');
    } catch (e) { toast(e.message, 'error'); }
  }
  await loadWorkspaces(preferred);
  showView('members');
}

const boot = request('/api/me')
  .then(data => renderUser(data.user))
  .catch(() => { $('status').textContent = 'Could not connect. Please refresh and try again.'; });
