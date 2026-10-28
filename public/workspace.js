/* workspace.js – workspace management UI */

let activeWorkspace;
const roleNames = ['Admin', 'Editor', 'Publisher', 'Viewer'];
const $ = id => document.getElementById(id);

/* ── API helper (20 s timeout) ───────────────────── */
async function workspaceRequest(path, method = 'GET', body) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20000);
  let r;
  try {
    r = await fetch('/api/workspaces' + path, {
      method,
      signal: controller.signal,
      headers: { 'Content-Type': 'application/json' },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
  } catch (err) {
    clearTimeout(timer);
    if (err.name === 'AbortError') throw Error('Request timed out. The database may be waking up — please retry.');
    throw err;
  }
  clearTimeout(timer);
  let data;
  try { data = await r.json(); } catch { data = { error: 'Action not permitted.' }; }
  if (!r.ok) throw Error(data.error);
  return data;
}

/* ── Role chip class ─────────────────────────────── */
function roleClass(role) {
  if (role === 'Owner') return 'role-chip owner';
  if (role === 'Admin') return 'role-chip admin';
  return 'role-chip';
}

/* ── Load error with retry button ────────────────── */
function showLoadError(msg) {
  $('workspace-title').textContent = 'Could not load workspace';
  const existing = $('retry-btn');
  if (existing) existing.remove();
  const btn = document.createElement('button');
  btn.id = 'retry-btn';
  btn.className = 'btn btn-filled';
  btn.textContent = '↺ Retry';
  btn.style.marginTop = '12px';
  btn.onclick = () => loadWorkspaces(activeWorkspace).catch(() => {});
  $('page-header-left').append(btn);
  toast(msg, 'error');
}

/* ── Small action button ─────────────────────────── */
function actionBtn(label, cls, run) {
  const b = document.createElement('button');
  b.type = 'button';
  b.textContent = label;
  b.className = 'btn' + (cls ? ' ' + cls : '');
  b.onclick = async () => {
    b.disabled = true;
    try { await run(); }
    catch (e) { toast(e.message, 'error'); }
    finally { b.disabled = false; }
  };
  return b;
}

/* ── Load workspace list ─────────────────────────── */
async function loadWorkspaces(preferred) {
  $('workspace-title').textContent = 'Loading…';
  $('retry-btn') && $('retry-btn').remove();
  let workspaces;
  try {
    const res = await workspaceRequest('');
    workspaces = res.workspaces;
  } catch (e) {
    showLoadError(e.message);
    return;
  }
  $('workspace-select').replaceChildren();
  for (const w of workspaces) {
    const o = document.createElement('option');
    o.value = w.id;
    o.textContent = w.name;
    $('workspace-select').append(o);
  }
  activeWorkspace = workspaces.find(w => w.id === Number(preferred))?.id || workspaces[0]?.id;
  if (activeWorkspace) {
    $('workspace-select').value = activeWorkspace;
    await loadWorkspace();
  } else {
    $('workspace-title').textContent = 'No workspaces';
  }
}

/* ── Load single workspace ───────────────────────── */
async function loadWorkspace() {
  const id = activeWorkspace;
  let data;
  try {
    data = await workspaceRequest('/' + id);
  } catch (e) {
    showLoadError(e.message);
    return;
  }
  if (id !== activeWorkspace) return;

  const w = data.workspace;
  const manage = ['Owner', 'Admin'].includes(w.role);

  /* Header */
  $('workspace-title').textContent = w.name;
  $('your-role').textContent = w.role;
  $('your-role').className = roleClass(w.role);
  $('workspace-actions').hidden = !manage;
  $('delete-workspace').hidden = w.role !== 'Owner';
  $('invite-section').hidden = !manage;
  $('invite-link-area').hidden = true;

  /* Invite roles */
  $('invite-role').replaceChildren();
  for (const role of roleNames.filter(r => w.role === 'Owner' || r !== 'Admin')) {
    const o = document.createElement('option');
    o.value = role;
    o.textContent = role;
    $('invite-role').append(o);
  }
  $('invite-role').value = 'Viewer';

  /* ── Members table ────────────────────────────── */
  const tbody = $('members');
  tbody.replaceChildren();

  for (const m of data.members) {
    const tr = document.createElement('tr');

    /* Email cell */
    const tdEmail = document.createElement('td');
    tdEmail.textContent = m.email;
    tr.append(tdEmail);

    /* Role cell */
    const tdRole = document.createElement('td');
    const canEdit = manage && m.role !== 'Owner' && (w.role === 'Owner' || m.role !== 'Admin');
    if (canEdit) {
      const sel = document.createElement('select');
      sel.setAttribute('aria-label', 'Role for ' + m.email);
      for (const role of roleNames.filter(r => w.role === 'Owner' || r !== 'Admin')) {
        const o = document.createElement('option');
        o.textContent = role;
        sel.append(o);
      }
      sel.value = m.role;
      tdRole.append(sel);
      tr.append(tdRole);

      /* Actions cell */
      const tdActions = document.createElement('td');
      const wrap = document.createElement('div');
      wrap.className = 'row-actions';
      wrap.append(
        actionBtn('Save role', '', async () => {
          await workspaceRequest(`/${id}/members/${m.id}`, 'PATCH', { role: sel.value });
          toast('Role updated.', 'success');
          await loadWorkspace();
        }),
        actionBtn('Remove', 'btn-danger', async () => {
          if (confirm(`Remove ${m.email} from this workspace?`)) {
            await workspaceRequest(`/${id}/members/${m.id}`, 'DELETE');
            toast(`${m.email} removed.`);
            await loadWorkspace();
          }
        }),
      );
      if (w.role === 'Owner' && m.role !== 'Owner') {
        wrap.append(actionBtn('Transfer ownership', 'btn-danger', async () => {
          if (confirm(`Transfer ownership to ${m.email}? You will become an Admin.`)) {
            await workspaceRequest(`/${id}/transfer`, 'POST', { user: m.id });
            toast('Ownership transferred.');
            await loadWorkspace();
          }
        }));
      }
      tdActions.append(wrap);
      tr.append(tdActions);
    } else {
      const chip = document.createElement('span');
      chip.className = roleClass(m.role);
      chip.textContent = m.role;
      tdRole.append(chip);
      tr.append(tdRole);
      const tdActions = document.createElement('td');
      tdActions.textContent = '—';
      tr.append(tdActions);
    }

    tbody.append(tr);
  }

  if (!data.members.length) {
    const tr = document.createElement('tr');
    const td = document.createElement('td');
    td.colSpan = 3;
    td.innerHTML = '<div class="empty-state">No members.</div>';
    tr.append(td);
    tbody.append(tr);
  }

  /* ── Invites table ────────────────────────────── */
  const invBody = $('invites');
  invBody.replaceChildren();

  for (const inv of data.invites) {
    const tr = document.createElement('tr');

    const tdEmail = document.createElement('td');
    tdEmail.textContent = inv.email;
    tr.append(tdEmail);

    const tdRole = document.createElement('td');
    const chip = document.createElement('span');
    chip.className = roleClass(inv.role);
    chip.textContent = inv.role;
    tdRole.append(chip);
    tr.append(tdRole);

    const tdExp = document.createElement('td');
    tdExp.textContent = new Date(Number(inv.expires)).toLocaleDateString();
    tr.append(tdExp);

    const tdActions = document.createElement('td');
    if (w.role === 'Owner' || inv.role !== 'Admin') {
      tdActions.append(actionBtn('Revoke', 'btn-danger', async () => {
        await workspaceRequest(`/${id}/invites/${inv.id}`, 'DELETE');
        toast('Invitation revoked.');
        await loadWorkspace();
      }));
    } else {
      tdActions.textContent = '—';
    }
    tr.append(tdActions);
    invBody.append(tr);
  }

  if (!data.invites.length) {
    const tr = document.createElement('tr');
    const td = document.createElement('td');
    td.colSpan = 4;
    td.innerHTML = `<div class="empty-state">${manage ? 'No pending invitations.' : 'Invitation details are visible to workspace administrators.'}</div>`;
    tr.append(td);
    invBody.append(tr);
  }

  /* ── Activity log ─────────────────────────────── */
  const actDiv = $('activity');
  actDiv.replaceChildren();

  for (const item of data.activity) {
    const d = document.createElement('div');
    d.className = 'activity-item';
    d.innerHTML = `
      <div class="activity-dot"></div>
      <div>
        <div class="activity-text">${escHtml(item.actor)} · ${escHtml(item.action)}</div>
        <div class="activity-time">${new Date(Number(item.created)).toLocaleString()}</div>
      </div>`;
    actDiv.append(d);
  }

  if (!data.activity.length) {
    const d = document.createElement('div');
    d.className = 'empty-state';
    d.textContent = 'No activity yet.';
    actDiv.append(d);
  }
}

/* ── Tiny HTML escape ─────────────────────────────── */
function escHtml(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

/* ── Workspace selector ──────────────────────────── */
$('workspace-select').onchange = async e => {
  activeWorkspace = Number(e.target.value);
  try { await loadWorkspace(); }
  catch (e) { toast(e.message, 'error'); }
};

/* ── New workspace ───────────────────────────────── */
$('new-workspace').onclick = async () => {
  const name = prompt('Workspace name');
  if (!name) return;
  try {
    const r = await workspaceRequest('', 'POST', { name });
    await loadWorkspaces(r.id);
    toast(`Workspace "${name}" created.`, 'success');
  } catch (e) { toast(e.message, 'error'); }
};

/* ── Rename ──────────────────────────────────────── */
$('rename-workspace').onclick = async () => {
  const name = prompt('New workspace name', $('workspace-title').textContent);
  if (!name) return;
  try {
    await workspaceRequest('/' + activeWorkspace, 'PATCH', { name });
    await loadWorkspaces(activeWorkspace);
    toast('Workspace renamed.', 'success');
  } catch (e) { toast(e.message, 'error'); }
};

/* ── Delete ──────────────────────────────────────── */
$('delete-workspace').onclick = async () => {
  const wsName = $('workspace-title').textContent;
  const name = prompt(`This will permanently delete the workspace and all its data.\n\nType "${wsName}" to confirm.`);
  if (name === null) return;
  try {
    await workspaceRequest('/' + activeWorkspace, 'DELETE', { name });
    toast('Workspace deleted.');
    await loadWorkspaces();
  } catch (e) { toast(e.message, 'error'); }
};

/* ── Invite form ─────────────────────────────────── */
$('invite-form').onsubmit = async e => {
  e.preventDefault();
  const id = activeWorkspace;
  try {
    const r = await workspaceRequest(`/${id}/invites`, 'POST', {
      email: $('invite-email').value,
      role: $('invite-role').value,
    });
    await loadWorkspace();
    if (activeWorkspace !== id) return;
    $('invite-link-area').hidden = false;
    $('invite-link').value = `${location.origin}/#invite=${r.token}`;
    $('invite-link').select();
    toast('Invitation created. Copy and share the link privately.', 'success');
  } catch (e) { toast(e.message, 'error'); }
};

/* ── Copy link button ────────────────────────────── */
$('copy-link-btn').onclick = async () => {
  const val = $('invite-link').value;
  try {
    await navigator.clipboard.writeText(val);
    toast('Link copied to clipboard.', 'success');
  } catch {
    $('invite-link').select();
    toast('Press Ctrl+C / Cmd+C to copy.');
  }
};

/* ── Boot after sign-in ──────────────────────────── */
window.addEventListener('signed-in', async () => {
  const params = new URLSearchParams(location.hash.slice(1));
  const token = params.get('invite');
  let id;
  if (token) {
    try {
      const result = await workspaceRequest('/accept', 'POST', { token });
      id = result.id;
      history.replaceState({}, '', location.pathname);
      toast('Invitation accepted.', 'success');
    } catch (e) {
      toast(e.message, 'error');
    }
  }
  await loadWorkspaces(id);
});
