/* app.js – all frontend logic */
'use strict';

const $ = id => document.getElementById(id);

/* ── Toast ───────────────────────────────────────── */
let toastTimer;
function toast(msg, type) {
  const el = $('toast');
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
   VIEW ROUTING  (members | ads)
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

  const sidebarSection = $('sidebar-integrations-section');
  if (sidebarSection && view === 'ads') {
    sidebarSection.hidden = false;
  }

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
  $('app-shell').hidden   = !user;
  $('password').value     = '';
  $('status').textContent = '';
  if (user) {
    $('nav-email').textContent  = user.email;
    $('nav-avatar').textContent = (user.email[0] || '?').toUpperCase();
    loadWorkspacesOnBoot();
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
  try { await request('/api/logout', {}); renderUser(null); }
  catch (e) { toast(e.message, 'error'); }
};

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
  $('workspace-title').textContent = 'Loading…';
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
    // show view that was active (or default to members)
    showView(currentView);
  } else {
    $('workspace-title').textContent = 'No workspaces';
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

/* ── Workspace controls ──────────────────────────── */
$('workspace-select').onchange = async e => {
  activeWs = Number(e.target.value);
  try { await loadWorkspace(); showView(currentView); }
  catch (e) { toast(e.message, 'error'); }
};

$('new-workspace').onclick = async () => {
  const name = prompt('Workspace name');
  if (!name) return;
  try {
    const r = await workspaceRequest('', 'POST', { name });
    await loadWorkspaces(r.id);

    // First they make their workspace, then Google Ads gets visible!
    const sidebarSection = $('sidebar-integrations-section');
    if (sidebarSection) sidebarSection.hidden = false;
    showView('ads');
    const banner = $('ads-onboarding-banner');
    if (banner) banner.hidden = false;
    const txt = $('ads-onboarding-text');
    if (txt) txt.textContent = 'Workspace "' + name + '" created! Connect your Google Ads account to complete setup.';
    toast('Workspace "' + name + '" created.', 'success');
  } catch (e) { toast(e.message, 'error'); }
};

if ($('promo-connect-ads-btn')) {
  $('promo-connect-ads-btn').onclick = () => {
    const sidebarSection = $('sidebar-integrations-section');
    if (sidebarSection) sidebarSection.hidden = false;
    showView('ads');
    const banner = $('ads-onboarding-banner');
    if (banner) banner.hidden = true;
  };
}

const skipAdsAction = () => {
  const banner = $('ads-onboarding-banner');
  if (banner) banner.hidden = true;
  showView('members');
};
if ($('ads-skip-top-btn')) $('ads-skip-top-btn').onclick = skipAdsAction;
if ($('ads-form-skip-btn')) $('ads-form-skip-btn').onclick = skipAdsAction;

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
   GOOGLE ADS PAGE
   ══════════════════════════════════════════════════ */

async function loadAds(wsId, canManage) {
  if (!wsId) return;
  let data;
  try { data = await workspaceRequest('/' + wsId + '/ads'); }
  catch (e) { return; }

  const connected = Boolean(data.ads);

  // Sidebar section: only visible if Google Ads is connected or user is currently on the ads page
  const sidebarSection = $('sidebar-integrations-section');
  if (sidebarSection) {
    sidebarSection.hidden = !connected && currentView !== 'ads';
  }

  // Sidebar badge
  const badge = $('ads-sidebar-badge');
  if (badge) badge.hidden = !connected;

  // Promo banner on view-members
  const promo = $('ads-promo-banner');
  if (promo) {
    promo.hidden = connected || !canManage;
  }

  if (!canManage && !connected) {
    // Non-admin, nothing connected — show info message
    $('ads-page-disconnected').hidden  = true;
    $('ads-page-connected').hidden     = true;
    $('ads-no-permission').hidden      = false;
    $('ads-no-permission-msg').textContent = 'No Google Ads account has been connected to this workspace yet. Ask an owner or admin to connect one.';
    return;
  }

  if (!canManage && connected) {
    // Non-admin, connected — show read-only info
    $('ads-page-disconnected').hidden  = true;
    $('ads-page-connected').hidden     = false;
    $('ads-no-permission').hidden      = true;
    renderAdsConnected(data.ads);
    $('ads-edit-btn').hidden           = true;
    $('ads-disconnect-btn').hidden     = true;
    return;
  }

  // Admin/Owner
  $('ads-no-permission').hidden = true;
  if (connected) {
    $('ads-page-disconnected').hidden = true;
    $('ads-page-connected').hidden    = false;
    renderAdsConnected(data.ads);
    $('ads-edit-btn').hidden          = false;
    $('ads-disconnect-btn').hidden    = false;
  } else {
    $('ads-page-disconnected').hidden = false;
    $('ads-page-connected').hidden    = true;
    $('ads-customer-id').value  = '';
    $('ads-account-name').value = '';
  }
}

function renderAdsConnected(ads) {
  $('ads-display-id').textContent   = ads.customer_id;
  $('ads-display-name').textContent = ads.account_name || '—';
  $('ads-display-date').textContent = new Date(Number(ads.connected_at)).toLocaleDateString(undefined, { year:'numeric', month:'long', day:'numeric' });
}

$('ads-form').onsubmit = async ev => {
  ev.preventDefault();
  const btn = $('ads-connect-btn');
  btn.disabled = true;
  btn.textContent = 'Connecting…';
  try {
    await workspaceRequest('/' + activeWs + '/ads', 'POST', {
      customer_id:  $('ads-customer-id').value,
      account_name: $('ads-account-name').value,
    });
    toast('Google Ads account connected!', 'success');
    await loadAds(activeWs, currentManage);
  } catch (e) {
    toast(e.message, 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Connect account';
  }
};

$('ads-edit-btn').onclick = () => {
  $('ads-page-connected').hidden    = true;
  $('ads-page-disconnected').hidden = false;
  $('ads-customer-id').focus();
};

$('ads-disconnect-btn').onclick = async () => {
  if (!confirm('Disconnect the Google Ads account from this workspace?')) return;
  $('ads-disconnect-btn').disabled = true;
  try {
    await workspaceRequest('/' + activeWs + '/ads', 'DELETE');
    toast('Google Ads account disconnected.');
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
