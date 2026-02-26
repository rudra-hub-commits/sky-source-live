console.log("SUPABASE BUILD ACTIVE");

import "./style.css";
import { supabase } from "./supabaseClient";

// DEBUG (keep)
window.supabase = supabase;
console.log("✅ window.supabase set", supabase);

// ══════════════════════════════════════════
// HELPERS
// ══════════════════════════════════════════

function esc(str = "") {
  return String(str).replace(/[&<>"']/g, (m) => {
    const map = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" };
    return map[m];
  });
}

function safeJsonParse(s, fallback = null) {
  try {
    return JSON.parse(s);
  } catch {
    return fallback;
  }
}

function showEl(id, show) {
  const el = document.getElementById(id);
  if (el) el.style.display = show ? "" : "none";
}

function el(id) {
  return document.getElementById(id);
}

function isEmailLike(v) {
  return String(v || "").includes("@");
}

// Convert lob_fields rows into UI-friendly structure:
// COVERAGE_FIELDS["General Liability"] = [ {isHeader:true,label:"Section"}, {id,label}, ...]
function buildCoverageFieldsFromDb(lobsById, lobFieldsRows) {
  const byLobName = {};

  // group by lob_id then by section
  const grouped = new Map(); // lob_id -> Map(section -> rows[])
  for (const r of lobFieldsRows || []) {
    const lobId = r.lob_id;
    if (!grouped.has(lobId)) grouped.set(lobId, new Map());
    const section = r.section || "General";
    const secMap = grouped.get(lobId);
    if (!secMap.has(section)) secMap.set(section, []);
    secMap.get(section).push(r);
  }

  for (const [lobId, secMap] of grouped.entries()) {
    const lobName = lobsById.get(lobId)?.name;
    if (!lobName) continue;

    const arr = [];
    const sections = Array.from(secMap.keys()).sort((a, b) => a.localeCompare(b));

    for (const sectionName of sections) {
      arr.push({ id: `hdr-${lobId}-${sectionName}`, label: sectionName, isHeader: true });

      const rows = secMap.get(sectionName) || [];
      rows.sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));

      for (const f of rows) {
        arr.push({ id: String(f.id), label: f.label, isHeader: false });
      }
    }

    byLobName[lobName] = arr;
  }

  return byLobName;
}

// Determine if current user is admin from profile role
async function buildCurrentUserFromSupabase(user) {
  let role = "user";
  let username = user?.email || "user";

  try {
    const { data: profile, error } = await supabase
      .from("profiles")
      .select("role, username, full_name")
      .eq("id", user.id)
      .single();

    if (!error && profile?.role) role = profile.role;
    if (!error && profile?.username) username = profile.username;
    const fullname =
      (!error && profile?.full_name) ||
      (user.email || "User").split("@")[0];

    return {
      id: user.id,
      email: user.email,
      username,
      fullname,
      role,
    };
  } catch (e) {
    console.warn("profiles lookup failed:", e);
  }

  return {
    id: user.id,
    email: user.email,
    username,
    fullname: (user.email || "User").split("@")[0],
    role,
  };
}

function isAdmin() {
  return currentUser?.role === "admin";
}

// ══════════════════════════════════════════
// GLOBAL STATE (DB-backed)
// ══════════════════════════════════════════

let currentUser = null;

let ALL_LOBS = []; // from DB: [{id, name, is_active}]
let LOBS_BY_ID = new Map(); // id -> lob
let LOBS_BY_NAME = new Map(); // name -> lob

let COVERAGE_FIELDS = {}; // built from lob_fields
let CHECKLISTS = []; // from DB (normalized to UI objects)

let currentFilter = "all";
let activeChecklistId = null;
let snapshotCount = 1;
let lobModalSelectedIds = []; // PKG selection uses lob IDs

// lob fields editor (admin)
let activeLobForFieldEdit = null;
let lobFieldsDraft = []; // [{id?, label, section, sort_order, is_header}]
let lobFieldsDragIndex = null;

// ══════════════════════════════════════════
// DB: LOADERS
// ══════════════════════════════════════════

async function loadLobsFromDb() {
  const { data, error } = await supabase
    .from("lobs")
    .select("id, name, is_active, created_at")
    .eq("is_active", true)
    .order("id", { ascending: true });

  if (error) throw error;

  ALL_LOBS = (data || []).map((l) => ({
    id: l.id,
    name: l.name,
    is_active: l.is_active,
    locked: String(l.name).trim().toLowerCase() === "common declarations",
    code: (l.name || "")
      .split(" ")
      .map((w) => w[0])
      .join("")
      .toUpperCase()
      .slice(0, 4),
  }));

  LOBS_BY_ID = new Map(ALL_LOBS.map((l) => [l.id, l]));
  LOBS_BY_NAME = new Map(ALL_LOBS.map((l) => [l.name, l]));
}

async function loadLobFieldsFromDb() {
  const { data, error } = await supabase
    .from("lob_fields")
    .select("id, lob_id, section, label, sort_order, is_active")
    .eq("is_active", true);

  if (error) throw error;

  COVERAGE_FIELDS = buildCoverageFieldsFromDb(LOBS_BY_ID, data || []);
}

async function loadChecklistsFromDb() {
  const { data, error } = await supabase
    .from("checklists")
    .select("id, user_id, lob_id, title, data_json, created_at, updated_at")
    .order("updated_at", { ascending: false });

  if (error) throw error;

  const rows = data || [];
  if (rows.length === 0) {
    CHECKLISTS = [];
    return;
  }

  // Fetch join table mapping (PKG)
  const checklistIds = rows.map((r) => r.id);
  const { data: joinRows, error: joinErr } = await supabase
    .from("checklist_lobs")
    .select("checklist_id, lob_id")
    .in("checklist_id", checklistIds);

  if (joinErr) {
    console.warn("checklist_lobs missing or blocked by RLS. PKG will fallback.", joinErr);
  }

  const lobMapByChecklist = new Map(); // checklist_id -> [lob_id,...]
  for (const jr of joinRows || []) {
    if (!lobMapByChecklist.has(jr.checklist_id)) lobMapByChecklist.set(jr.checklist_id, []);
    lobMapByChecklist.get(jr.checklist_id).push(jr.lob_id);
  }

  CHECKLISTS = rows.map((r) => {
    const dj = r.data_json || {};

    const lobIds = lobMapByChecklist.get(r.id) || (r.lob_id ? [r.lob_id] : []);
    const lobNames = lobIds.map((id) => LOBS_BY_ID.get(id)?.name).filter(Boolean);

    return {
      id: r.id,
      db_user_id: r.user_id,
      title: r.title || dj.insured || "Checklist",
      insured: dj.insured || "",
      policy: dj.policy || "",
      term: dj.term || "",
      date: dj.date || "",
      checkedby: dj.checkedby || "",
      am: dj.am || "",
      notes: dj.notes || "",
      entries: dj.entries || {},
      status: dj.status || "draft",
      updated: r.updated_at || new Date().toISOString(),
      user: dj.userEmail || currentUser?.username || "",
      lobs: lobNames.length ? lobNames : (dj.lobs || []),
      lob_ids: lobIds,
      snapshots: dj.snapshots || [], // reserved
    };
  });
}

// ══════════════════════════════════════════
// ADMIN API HELPERS
// ══════════════════════════════════════════

async function apiAdminCreateUser({ email, password, username, full_name, role }) {
  const { data: sess } = await supabase.auth.getSession();
  const accessToken = sess?.session?.access_token;
  if (!accessToken) throw new Error("No session token");

  const resp = await fetch("/api/admin/create-user", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({ email, password, username, full_name, role }),
  });

  const json = await resp.json();
  if (!resp.ok) throw new Error(json?.error || "Create user failed");
  return json;
}

// ══════════════════════════════════════════
// DB: WRITERS
// ══════════════════════════════════════════

async function upsertChecklistToDb(cl) {
  const payload = {
    id: cl.id || undefined,
    user_id: currentUser.id,
    lob_id: cl.lob_ids?.[0] ?? null,
    title: cl.title || cl.insured || "Checklist",
    data_json: {
      insured: cl.insured || "",
      policy: cl.policy || "",
      term: cl.term || "",
      date: cl.date || "",
      checkedby: cl.checkedby || "",
      am: cl.am || "",
      notes: cl.notes || "",
      entries: cl.entries || {},
      status: cl.status || "draft",
      userEmail: currentUser.username,
      lobs: cl.lobs || [],
      snapshots: cl.snapshots || [],
    },
    updated_at: new Date().toISOString(),
  };

  const { data, error } = await supabase
    .from("checklists")
    .upsert(payload)
    .select("id")
    .single();

  if (error) throw error;

  const checklistId = data.id;

  // Sync join table for LOBs (PKG)
  const lobIds = cl.lob_ids || [];
  if (lobIds.length) {
    await supabase.from("checklist_lobs").delete().eq("checklist_id", checklistId);

    const insertRows = lobIds.map((lobId) => ({
      checklist_id: checklistId,
      lob_id: lobId,
    }));
    const { error: jErr } = await supabase.from("checklist_lobs").insert(insertRows);
    if (jErr) throw jErr;
  }

  return checklistId;
}

async function deleteChecklistFromDb(id) {
  const { error } = await supabase.from("checklists").delete().eq("id", id);
  if (error) throw error;
}

// ══════════════════════════════════════════
// AUTH
// ══════════════════════════════════════════

async function doLogin() {
  const login = el("login-user")?.value?.trim() || "";
  const password = el("login-pass")?.value || "";
  const err = el("login-err");
  const btn = el("login-btn");

  if (err) {
    err.classList.remove("show");
    err.textContent = "";
  }

  try {
    if (btn) btn.disabled = true;

    let email = login;

    // If it's not an email, treat it as username and resolve via API
    if (!isEmailLike(login)) {
      const r = await fetch("/api/auth/resolve-username", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ username: login }),
      });

      const j = await r.json();
      if (!r.ok) {
        if (err) {
          err.textContent = "Invalid username or password";
          err.classList.add("show");
        }
        return;
      }
      email = j.email;
    }

    const { data, error } = await supabase.auth.signInWithPassword({ email, password });

    if (error || !data?.user) {
      if (err) {
        err.textContent = "Invalid email/username or password";
        err.classList.add("show");
      }
      return;
    }

    currentUser = await buildCurrentUserFromSupabase(data.user);
    await initAppData();
    setupUI();
    goTo("dashboard");
  } catch (e) {
    console.error(e);
    if (err) {
      err.textContent = "Login failed. Try again.";
      err.classList.add("show");
    }
  } finally {
    if (btn) btn.disabled = false;
  }
}

async function doLogout() {
  currentUser = null;
  activeChecklistId = null;
  CHECKLISTS = [];
  await supabase.auth.signOut();
  goTo("login");
}

document.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && el("screen-login")?.classList.contains("active")) {
    doLogin();
  }
});

// ══════════════════════════════════════════
// INIT DATA
// ══════════════════════════════════════════

async function initAppData() {
  await loadLobsFromDb();
  await loadLobFieldsFromDb();
  await loadChecklistsFromDb();
}

// ══════════════════════════════════════════
// UI SETUP
// ══════════════════════════════════════════

function setupUI() {
  el("user-badge-name").textContent = currentUser.fullname || currentUser.username;
  el("user-avatar").textContent = (currentUser.fullname || currentUser.username)[0].toUpperCase();

  showEl("admin-chip", isAdmin());
  el("nav-admin").style.display = isAdmin() ? "" : "none";

  const h = new Date().getHours();
  const greet = h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";

  el("dash-greeting").textContent = `${greet}, ${(currentUser.fullname || currentUser.username).split(" ")[0]} 👋`;

  populateNewLobDropdown();
}

// ══════════════════════════════════════════
// NAVIGATION
// ══════════════════════════════════════════

function goTo(screen) {
  document.querySelectorAll(".screen").forEach((s) => s.classList.remove("active"));
  if (screen === "login") {
    el("screen-login").classList.add("active");
  } else {
    el("screen-app").classList.add("active");
    if (screen === "dashboard") showTab("dashboard");
  }
}

function showTab(tab) {
  ["dashboard", "new-checklist", "editor", "admin"].forEach((p) => {
    const node = el("tab-" + p);
    if (node) node.style.display = "none";
  });
  document.querySelectorAll(".nav-link").forEach((l) => l.classList.remove("active"));

  if (tab === "dashboard") {
    el("tab-dashboard").style.display = "";
    el("nav-dash").classList.add("active");
    renderDashboard();
  } else if (tab === "new-checklist") {
    el("tab-new-checklist").style.display = "";
    el("nav-new").classList.add("active");
    el("new-date").value = new Date().toISOString().split("T")[0];
    el("new-checkedby").value = currentUser?.fullname || currentUser?.username || "";
  } else if (tab === "editor") {
    el("tab-editor").style.display = "flex";
    el("nav-dash").classList.add("active");
    renderEditor();
  } else if (tab === "admin") {
    if (!isAdmin()) {
      showToast("⛔ Admin access only");
      return;
    }
    el("tab-admin").style.display = "";
    el("nav-admin").classList.add("active");
    renderAdmin();
  }
}

function switchEditorTab(tab) {
  el("editor-panel-checklist").style.display = tab === "checklist" ? "" : "none";
  el("editor-panel-snapshots").style.display = tab === "snapshots" ? "" : "none";
  el("editor-tab-checklist").classList.toggle("active", tab === "checklist");
  el("editor-tab-snapshots").classList.toggle("active", tab === "snapshots");
}

function switchAdminTab(tab) {
  ["stats", "users", "lobs", "credentials"].forEach((t) => {
    const panel = el("admin-panel-" + t);
    if (panel) panel.style.display = t === tab ? "" : "none";
    const btn = el("admin-tab-" + t);
    if (btn) btn.classList.toggle("active", t === tab);
  });
  if (tab === "lobs") renderLobManagement();
  if (tab === "users") renderAdminUsers();
}

// ══════════════════════════════════════════
// DASHBOARD
// ══════════════════════════════════════════

function renderDashboard() {
  renderRecentStrip();
  renderChecklistGrid(el("search-input")?.value || "");
}

function getRecentCompleted() {
  const fiveDaysMs = 5 * 24 * 60 * 60 * 1000;
  const now = Date.now();
  return CHECKLISTS
    .filter((c) => c.status === "complete")
    .filter((c) => now - new Date(c.updated).getTime() < fiveDaysMs)
    .filter((c) => (isAdmin() ? true : c.user === currentUser.username));
}

function renderRecentStrip() {
  const section = el("recent-section");
  const strip = el("recent-strip");

  const myRecent = getRecentCompleted();
  if (myRecent.length === 0) {
    section.style.display = "none";
    return;
  }
  section.style.display = "";

  strip.innerHTML = myRecent
    .slice(0, 12)
    .map((cl) => {
      const daysLeft = Math.ceil((5 * 86400000 - (Date.now() - new Date(cl.updated).getTime())) / 86400000);
      return `<div class="recent-card" onclick="openChecklist('${esc(cl.id)}')">
        <div class="recent-expire-badge">${daysLeft}d left</div>
        <div class="recent-card-insured">${esc(cl.insured)}</div>
        <div class="recent-card-policy">${esc(cl.policy)}</div>
        <div class="recent-card-meta">✅ Completed · ${esc(cl.lobs.join(", "))}</div>
      </div>`;
    })
    .join("");
}

function renderChecklistGrid(searchVal) {
  const grid = el("checklist-grid");
  let list = CHECKLISTS;

  if (!isAdmin()) list = list.filter((c) => c.user === currentUser.username);
  if (currentFilter !== "all") list = list.filter((c) => c.status === currentFilter);

  if (searchVal) {
    const s = searchVal.toLowerCase();
    list = list.filter(
      (c) => (c.insured || "").toLowerCase().includes(s) || (c.policy || "").toLowerCase().includes(s)
    );
  }

  if (list.length === 0) {
    grid.innerHTML = `<div class="empty-state" style="grid-column:1/-1">
      <div class="empty-state-icon">📋</div>
      <p style="font-weight:700;font-size:16px">No checklists found</p>
      <p style="margin-top:6px;font-size:13px">Create your first checklist to get started</p>
    </div>`;
    return;
  }

  grid.innerHTML = list
    .map((cl) => {
      const lobDisplay = cl.lobs.slice(0, 2).join(", ") + (cl.lobs.length > 2 ? ` +${cl.lobs.length - 2}` : "");
      const date = new Date(cl.updated).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

      return `<div class="cl-card" onclick="openChecklist('${esc(cl.id)}')">
        <div class="cl-card-top">
          <div>
            <div class="cl-insured">${esc(cl.insured)}</div>
            <div class="cl-policy">${esc(cl.policy)}</div>
          </div>
          <span class="status-chip ${cl.status === "complete" ? "chip-complete" : "chip-draft"}">${esc(cl.status)}</span>
        </div>
        <div class="cl-meta">📅 ${esc(date)}</div>
        <div class="cl-meta">👤 ${esc(cl.user)}</div>
        <div class="cl-footer">
          <span class="cl-lob">${esc(lobDisplay)}</span>
          <button class="icon-btn" title="Delete" onclick="event.stopPropagation();deleteChecklist('${esc(cl.id)}')">🗑</button>
        </div>
      </div>`;
    })
    .join("");
}

function filterChecklists(val) {
  renderChecklistGrid(val);
}

function setFilter(btn, filter) {
  currentFilter = filter;
  document.querySelectorAll(".cl-filter-btn").forEach((b) => b.classList.remove("active"));
  btn.classList.add("active");
  renderChecklistGrid(el("search-input").value);
}

function openChecklist(id) {
  activeChecklistId = id;
  showTab("editor");
}

async function deleteChecklist(id) {
  if (!confirm("Delete this checklist? This cannot be undone.")) return;
  try {
    await deleteChecklistFromDb(id);
    CHECKLISTS = CHECKLISTS.filter((c) => c.id !== id);
    renderDashboard();
    showToast("Checklist deleted");
  } catch (e) {
    console.error(e);
    showToast("❌ Delete failed (check RLS)");
  }
}

// ══════════════════════════════════════════
// NEW CHECKLIST
// ══════════════════════════════════════════

function populateNewLobDropdown() {
  const sel = el("new-lob");
  if (!sel) return;

  sel.innerHTML = '<option value="">— Select LOB —</option>';

  const opt = document.createElement("option");
  opt.value = "PKG";
  opt.textContent = "PKG — Package (select multiple LOBs)";
  sel.appendChild(opt);

  ALL_LOBS.filter((l) => !l.locked).forEach((l) => {
    const o = document.createElement("option");
    o.value = String(l.id);
    o.textContent = l.name;
    sel.appendChild(o);
  });

  sel.onchange = () => {
    el("new-lob-note").style.display = sel.value ? "" : "none";
  };
}

function createChecklist() {
  const insured = el("new-insured").value.trim();
  const policy = el("new-policy").value.trim();
  const term = el("new-term").value.trim();
  const date = el("new-date").value;
  const checkedby = el("new-checkedby").value.trim();
  const am = el("new-am").value.trim();
  const lobVal = el("new-lob").value;

  if (!insured) return showToast("⚠ Insured Name is required");
  if (!lobVal) return showToast("⚠ Please select a LOB");

  if (lobVal === "PKG") {
    openLobSelectionModal(async () => {
      const selected = lobModalSelectedIds.length ? lobModalSelectedIds : [];
      if (!selected.length) return showToast("⚠ Select at least one LOB");
      await doCreateChecklist(insured, policy, term, date, checkedby, am, selected);
    });
    return;
  }

  const lobId = Number(lobVal);
  doCreateChecklist(insured, policy, term, date, checkedby, am, [lobId]);
}

let _createCallback = null;

function openLobSelectionModal(cb) {
  _createCallback = cb;
  lobModalSelectedIds = [];
  const list = el("new-lob-modal-list");

  list.innerHTML = ALL_LOBS.filter((l) => !l.locked)
    .map(
      (l) => `
    <div class="modal-item" onclick="toggleNewLob(${l.id},this)">
      <span>${esc(l.name)}</span>
      <span class="modal-check" style="display:none">✓</span>
    </div>
  `
    )
    .join("");

  openModal("new-lob-modal");
}

function toggleNewLob(lobId, elRow) {
  const idx = lobModalSelectedIds.indexOf(lobId);
  if (idx > -1) {
    lobModalSelectedIds.splice(idx, 1);
    elRow.classList.remove("selected");
    elRow.querySelector(".modal-check").style.display = "none";
  } else {
    lobModalSelectedIds.push(lobId);
    elRow.classList.add("selected");
    elRow.querySelector(".modal-check").style.display = "";
  }
}

function applyNewLobSelection() {
  closeModal("new-lob-modal");
  if (_createCallback) _createCallback();
}

async function doCreateChecklist(insured, policy, term, date, checkedby, am, lobIds) {
  try {
    const lobNames = lobIds.map((id) => LOBS_BY_ID.get(id)?.name).filter(Boolean);

    const cl = {
      id: null,
      title: insured,
      insured,
      policy,
      term,
      date,
      checkedby,
      am,
      lobs: lobNames,
      lob_ids: lobIds,
      status: "draft",
      updated: new Date().toISOString(),
      user: currentUser.username,
      entries: {},
      notes: "",
      snapshots: [],
    };

    const newId = await upsertChecklistToDb(cl);
    cl.id = newId;

    CHECKLISTS.unshift(cl);
    activeChecklistId = newId;
    showTab("editor");
    showToast("✓ Checklist created");
  } catch (e) {
    console.error(e);
    showToast("❌ Create failed (check RLS / join table)");
  }
}

// ══════════════════════════════════════════
// ADMIN: Add LOB (FIXED)
// ══════════════════════════════════════════

async function addNewLOB() {
  try {
    if (!isAdmin()) return showToast("⛔ Admin only");

    const nameEl = el("new-lob-name");
    const codeEl = el("new-lob-code");

    const name = (nameEl?.value || "").trim();
    const code = (codeEl?.value || "").trim().toUpperCase();

    if (!name) return showToast("⚠ Enter LOB name");

    // If your lobs table does NOT have `code` column, we ignore it safely.
    // We'll try insert with code first, then fallback without code if it errors.
    let { error } = await supabase.from("lobs").insert([{ name, is_active: true, code }]);
    if (error) {
      // fallback without code if "column does not exist"
      const msg = String(error.message || "").toLowerCase();
      if (msg.includes("column") && msg.includes("code")) {
        const r2 = await supabase.from("lobs").insert([{ name, is_active: true }]);
        error = r2.error;
      }
    }
    if (error) throw error;

    if (nameEl) nameEl.value = "";
    if (codeEl) codeEl.value = "";

    closeModal("add-lob-modal");
    showToast("✅ LOB added");

    await loadLobsFromDb();
    await loadLobFieldsFromDb();
    populateNewLobDropdown();
    renderLobManagement();
  } catch (e) {
    console.error(e);
    showToast("❌ Add LOB failed (check RLS)");
  }
}

// ══════════════════════════════════════════
// ADMIN: Save User (FIXED - no crash)
// ══════════════════════════════════════════

async function saveUser() {
  try {
    if (!isAdmin()) return showToast("⛔ Admin only");

    const username = el("uf-username")?.value?.trim();
    const full_name = el("uf-fullname")?.value?.trim();
    const email = el("uf-email")?.value?.trim();
    const password = el("uf-password")?.value;
    const role = el("uf-role")?.value || "user";

    if (!username || !email || !password) return showToast("⚠ Username, Email, Password required");

    await apiAdminCreateUser({ email, password, username, full_name, role });

    closeModal("add-user-modal");
    showToast("✅ User created");
  } catch (e) {
    console.error(e);
    showToast(`❌ Create user failed`);
  }
}

// ══════════════════════════════════════════
// EDITOR
// ══════════════════════════════════════════

function getActiveChecklist() {
  return CHECKLISTS.find((c) => c.id === activeChecklistId);
}

function renderEditor() {
  const cl = getActiveChecklist();
  if (!cl) {
    showTab("dashboard");
    return;
  }

  el("editor-title-name").textContent = cl.insured || "Checklist";
  el("editor-title-policy").textContent = cl.policy || "—";
  el("ed-insured").value = cl.insured || "";
  el("ed-policy").value = cl.policy || "";
  el("ed-term").value = cl.term || "";
  el("ed-date").value = cl.date || "";
  el("ed-checkedby").value = cl.checkedby || "";
  el("ed-am").value = cl.am || "";
  el("checklist-notes").value = cl.notes || "";
  el("complete-banner").style.display = cl.status === "complete" ? "" : "none";

  el("ed-lob-display").textContent = cl.lobs.join(", ");
  el("ed-lob-tags").innerHTML = cl.lobs.map((l) => `<span class="pkg-tag">${esc(l)}</span>`).join("");

  renderCoverageSections(cl);
  renderSnapshots();
  updateProgress(cl);
}

function renderCoverageSections(cl) {
  if (!cl) cl = getActiveChecklist();
  if (!cl) return;

  const sections = [];
  if (COVERAGE_FIELDS["Common Declarations"]) sections.push("Common Declarations");
  sections.push(...cl.lobs);

  const container = el("coverage-sections");

  container.innerHTML = sections
    .map((lobName) => {
      const fields = COVERAGE_FIELDS[lobName];
      if (!fields) {
        return `<div class="section-wrap">
          <div class="section-header" style="background:linear-gradient(135deg,#374151,#4b5563)">
            <span class="section-name">${esc(lobName)}</span>
            <span style="color:rgba(255,255,255,.5);font-size:12px">No fields defined</span>
          </div>
        </div>`;
      }

      const rows = fields
        .map((f) => {
          if (f.isHeader) return `<tr class="header-row"><td colspan="7">${esc(f.label)}</td></tr>`;

          const e = (cl.entries && cl.entries[f.id]) || {};
          const statusCls =
            { Match: "ss-match", "Not Match": "ss-notmatch", "Not Found": "ss-notfound", "N/A": "ss-na" }[
              e.status || "N/A"
            ] || "ss-na";

          const isLocked = e.status === "Match" || e.status === "N/A";
          const isNotMatch = e.status === "Not Match";
          const rowCls = isLocked ? "row-locked" : isNotMatch ? "row-notmatch" : "";
          const readonly = isLocked ? "readonly" : "";

          return `<tr class="${rowCls}" id="row-${esc(f.id)}">
            <td style="width:26%;font-size:12px;font-weight:500;padding:6px 10px">${esc(f.label)}</td>
            <td style="width:6%;text-align:center"><input class="cell-input cell-pg" value="${esc(
              e.pg || ""
            )}" oninput="updateEntry('${esc(f.id)}','pg',this.value)" placeholder="—"/></td>
            <td style="width:18%"><input class="cell-input" value="${esc(
              e.pol || ""
            )}" oninput="updateEntry('${esc(f.id)}','pol',this.value)" placeholder="Policy data" ${readonly}/></td>
            <td style="width:18%"><input class="cell-input" value="${esc(
              e.nex || ""
            )}" oninput="updateEntry('${esc(f.id)}','nex',this.value)" placeholder="Nexsure data" ${readonly}/></td>
            <td style="width:12%;text-align:center">
              <select class="status-select ${statusCls}" onchange="updateStatusAndRow('${esc(f.id)}',this)">
                <option ${e.status === "Match" ? "selected" : ""}>Match</option>
                <option ${e.status === "Not Match" ? "selected" : ""}>Not Match</option>
                <option ${e.status === "Not Found" ? "selected" : ""}>Not Found</option>
                <option ${(e.status === "N/A" || !e.status) ? "selected" : ""}>N/A</option>
              </select>
            </td>
            <td style="width:12%"><input class="cell-input" value="${esc(
              e.skyComments || ""
            )}" oninput="updateEntry('${esc(f.id)}','skyComments',this.value)" placeholder="Sky Source…"/></td>
            <td style="width:8%"><input class="cell-input" value="${esc(
              e.amComments || ""
            )}" oninput="updateEntry('${esc(f.id)}','amComments',this.value)" placeholder="AM…"/></td>
          </tr>`;
        })
        .join("");

      return `<div class="section-wrap">
        <div class="section-header" onclick="toggleSection(this)">
          <span class="section-name">${esc(lobName)}${
        lobName === "Common Declarations"
          ? ' <span style="font-size:10px;opacity:.6;font-weight:400">(always included)</span>'
          : ""
      }</span>
          <span class="section-chevron open">▼</span>
        </div>
        <div>
          <table class="checklist-table">
            <thead><tr>
              <th style="width:26%">Field</th>
              <th style="width:6%;text-align:center">Pg #</th>
              <th style="width:18%">Policy Data</th>
              <th style="width:18%">Nexsure Data</th>
              <th style="width:12%;text-align:center">Status</th>
              <th style="width:12%">Sky Source</th>
              <th style="width:8%">AM</th>
            </tr></thead>
            <tbody>${rows}</tbody>
          </table>
        </div>
      </div>`;
    })
    .join("");
}

function toggleSection(header) {
  const body = header.nextElementSibling;
  const chevron = header.querySelector(".section-chevron");
  if (body.style.display === "none") {
    body.style.display = "";
    chevron.classList.add("open");
  } else {
    body.style.display = "none";
    chevron.classList.remove("open");
  }
}

let saveTimer;
function showSaved() {
  const ind = el("save-indicator");
  if (ind) {
    ind.innerHTML = "⟳ Saving…";
    ind.style.color = "#8b5cf6";
  }
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    if (ind) {
      ind.innerHTML = "✓ Saved";
      ind.style.color = "var(--match)";
    }
  }, 700);
}

let _debounce;
async function persistActiveChecklistDebounced() {
  clearTimeout(_debounce);
  _debounce = setTimeout(async () => {
    const cl = getActiveChecklist();
    if (!cl) return;
    try {
      await upsertChecklistToDb(cl);
    } catch (e) {
      console.error(e);
      showToast("❌ Save failed (check RLS)");
    }
  }, 450);
}

function updateEntry(fId, field, val) {
  const cl = getActiveChecklist();
  if (!cl) return;
  if (!cl.entries) cl.entries = {};
  if (!cl.entries[fId]) cl.entries[fId] = {};
  cl.entries[fId][field] = val;
  cl.updated = new Date().toISOString();
  showSaved();
  updateProgress(cl);
  persistActiveChecklistDebounced();
}

function updateStatusAndRow(fId, sel) {
  const cl = getActiveChecklist();
  if (!cl) return;
  if (!cl.entries) cl.entries = {};
  if (!cl.entries[fId]) cl.entries[fId] = {};

  cl.entries[fId].status = sel.value;

  const cls =
    { Match: "ss-match", "Not Match": "ss-notmatch", "Not Found": "ss-notfound", "N/A": "ss-na" }[sel.value] ||
    "ss-na";
  sel.className = "status-select " + cls;

  cl.updated = new Date().toISOString();
  showSaved();
  updateProgress(cl);
  persistActiveChecklistDebounced();

  const row = el("row-" + fId);
  if (row) {
    row.classList.remove("row-locked", "row-notmatch");
    const inputs = row.querySelectorAll(".cell-input");
    inputs.forEach((inp) => inp.removeAttribute("readonly"));

    if (sel.value === "Match" || sel.value === "N/A") {
      row.classList.add("row-locked");
      const cells = row.querySelectorAll("td");
      if (cells[2]) cells[2].querySelector(".cell-input")?.setAttribute("readonly", "");
      if (cells[3]) cells[3].querySelector(".cell-input")?.setAttribute("readonly", "");
    } else if (sel.value === "Not Match") {
      row.classList.add("row-notmatch");
    }
  }
}

function updateProgress(cl) {
  if (!cl) return;

  const sections = [];
  if (COVERAGE_FIELDS["Common Declarations"]) sections.push("Common Declarations");
  sections.push(...cl.lobs);

  let total = 0,
    filled = 0;

  sections.forEach((lobName) => {
    const fields = COVERAGE_FIELDS[lobName] || [];
    fields
      .filter((f) => !f.isHeader)
      .forEach((f) => {
        total++;
        const e = cl.entries?.[f.id];
        if (e && (e.pol || e.nex || e.status !== "N/A")) filled++;
      });
  });

  const pct = total > 0 ? Math.round((filled / total) * 100) : 0;
  const fill = el("progress-fill");
  const label = el("progress-label");
  if (fill) fill.style.width = pct + "%";
  if (label) label.textContent = pct + "%";
}

function saveHeaderFields() {
  const cl = getActiveChecklist();
  if (!cl) return;

  cl.insured = el("ed-insured").value;
  cl.policy = el("ed-policy").value;
  cl.term = el("ed-term").value;
  cl.date = el("ed-date").value;
  cl.checkedby = el("ed-checkedby").value;
  cl.am = el("ed-am").value;
  cl.notes = el("checklist-notes").value;
  cl.updated = new Date().toISOString();

  el("editor-title-name").textContent = cl.insured || "Checklist";
  el("editor-title-policy").textContent = cl.policy || "—";

  showSaved();
  persistActiveChecklistDebounced();
}

["ed-insured", "ed-policy", "ed-term", "ed-date", "ed-checkedby", "ed-am", "checklist-notes"].forEach((id) =>
  el(id)?.addEventListener("input", saveHeaderFields)
);

async function markComplete() {
  const cl = getActiveChecklist();
  if (!cl) return;
  cl.status = "complete";
  cl.updated = new Date().toISOString();
  el("complete-banner").style.display = "";
  showToast("✅ Marked as complete! (Recent shows last 5 days)");
  try {
    await upsertChecklistToDb(cl);
    await loadChecklistsFromDb();
    renderDashboard();
  } catch (e) {
    console.error(e);
    showToast("❌ Complete save failed (check RLS)");
  }
}

function resetEditor() {
  if (!confirm("Reset all entries in this checklist?")) return;
  const cl = getActiveChecklist();
  if (!cl) return;
  cl.entries = {};
  cl.notes = "";
  showSaved();
  persistActiveChecklistDebounced();
  renderEditor();
  showToast("↺ Checklist reset");
}

// ══════════════════════════════════════════
// MODALS (LOB selection editor)
// ══════════════════════════════════════════

let editorLobSelectedIds = [];

function openModal(id) {
  if (id === "lob-modal") {
    const cl = getActiveChecklist();
    editorLobSelectedIds = cl ? [...(cl.lob_ids || [])] : [];
    renderLobModalList("");
  }
  el(id).classList.add("open");
}

function closeModal(id) {
  el(id).classList.remove("open");
}

function renderLobModalList(search) {
  const list = el("lob-modal-list");
  if (!list) return;

  const filtered = ALL_LOBS.filter((l) => !l.locked && l.name.toLowerCase().includes((search || "").toLowerCase()));

  list.innerHTML = filtered
    .map((l) => {
      const sel = editorLobSelectedIds.includes(l.id);
      return `<div class="modal-item ${sel ? "selected" : ""}" onclick="toggleEditorLob(${l.id},this)">
        <span>${esc(l.name)}</span>
        <span class="modal-check" style="display:${sel ? "" : "none"}">✓</span>
      </div>`;
    })
    .join("");

  el("lob-modal-apply").textContent = `Apply (${editorLobSelectedIds.length} selected)`;
}

function filterLobModal(val) {
  renderLobModalList(val);
}

function toggleEditorLob(lobId, elRow) {
  const idx = editorLobSelectedIds.indexOf(lobId);
  if (idx > -1) {
    editorLobSelectedIds.splice(idx, 1);
    elRow.classList.remove("selected");
    elRow.querySelector(".modal-check").style.display = "none";
  } else {
    editorLobSelectedIds.push(lobId);
    elRow.classList.add("selected");
    elRow.querySelector(".modal-check").style.display = "";
  }
  el("lob-modal-apply").textContent = `Apply (${editorLobSelectedIds.length} selected)`;
}

async function applyLobSelection() {
  closeModal("lob-modal");
  if (editorLobSelectedIds.length === 0) {
    showToast("⚠ Select at least one LOB");
    return;
  }
  const cl = getActiveChecklist();
  if (!cl) return;

  cl.lob_ids = [...editorLobSelectedIds];
  cl.lobs = cl.lob_ids.map((id) => LOBS_BY_ID.get(id)?.name).filter(Boolean);

  el("ed-lob-display").textContent = cl.lobs.join(", ");
  el("ed-lob-tags").innerHTML = cl.lobs.map((l) => `<span class="pkg-tag">${esc(l)}</span>`).join("");

  renderCoverageSections(cl);
  showToast(`✓ LOBs updated: ${cl.lobs.join(", ")}`);

  try {
    await upsertChecklistToDb(cl);
    await loadChecklistsFromDb();
    renderDashboard();
  } catch (e) {
    console.error(e);
    showToast("❌ LOB update failed (check RLS)");
  }
}

// ══════════════════════════════════════════
// SNAPSHOTS (placeholder)
// ══════════════════════════════════════════

function renderSnapshots() {
  const container = el("snapshots-container");
  if (!container) return;

  if (snapshotCount === 0) {
    container.innerHTML = `<div class="snap-empty"><div style="font-size:40px;opacity:.2;margin-bottom:12px">🖼️</div>
      <p style="font-weight:700;font-size:15px">No snapshots yet</p>
      <p style="font-size:13px;margin-top:6px;color:var(--muted)">Add snapshots to compare policy documents with Nexsure data</p></div>`;
    return;
  }

  let html = "";
  for (let i = 1; i <= snapshotCount; i++) {
    html += `<div class="snapshot-card">
      <div class="snapshot-num">Snapshot ${i} <button onclick="deleteSnapshot(${i})" style="background:none;border:none;color:#fca5a5;cursor:pointer;font-size:18px;padding:2px 8px;border-radius:8px">🗑</button></div>
      <div class="snap-grid">
        <div><div class="snap-label">Policy Document</div>
          ${
            i === 1
              ? `<div class="snap-img-wrap"><img src="https://placehold.co/400x200/e0e7ff/4f46e5?text=Policy+Document" alt=""/><div class="snap-img-overlay">📤 Replace</div></div>`
              : `<div class="snap-upload-area"><div style="font-size:30px;opacity:.3">🖼️</div><div style="font-size:12px;font-weight:600">Drop image or click</div><div style="font-size:11px;opacity:.6">PNG, JPG up to 10MB</div></div>`
          }
        </div>
        <div><div class="snap-label">Nexsure Screenshot</div>
          ${
            i === 1
              ? `<div class="snap-img-wrap"><img src="https://placehold.co/400x200/fdf4ff/7c3aed?text=Nexsure+Screenshot" alt=""/><div class="snap-img-overlay">📤 Replace</div></div>`
              : `<div class="snap-upload-area"><div style="font-size:30px;opacity:.3">🖼️</div><div style="font-size:12px;font-weight:600">Drop image or click</div><div style="font-size:11px;opacity:.6">PNG, JPG up to 10MB</div></div>`
          }
        </div>
      </div>
      <div><div class="snap-label">Notes</div>
        <textarea class="snap-notes" rows="2" placeholder="Comparison notes…">${
          i === 1 ? "Verified against original policy document. Limits and endorsements match." : ""
        }</textarea>
      </div>
    </div>`;
  }
  container.innerHTML = html;
}

function addSnapshot() {
  snapshotCount++;
  renderSnapshots();
  showToast("Snapshot added");
}

function deleteSnapshot() {
  if (!confirm("Delete snapshot?")) return;
  snapshotCount = Math.max(0, snapshotCount - 1);
  renderSnapshots();
}

// ══════════════════════════════════════════
// DOWNLOAD / PREVIEW / DROPDOWN (STUBS so app never crashes)
// ══════════════════════════════════════════

function toggleDropdown(id) {
  const wrap = el(id);
  if (!wrap) return;
  const isOpen = wrap.classList.contains("open");
  document.querySelectorAll(".download-dropdown-wrap.open").forEach((w) => w.classList.remove("open"));
  if (!isOpen) wrap.classList.add("open");
}

function showPreview(mode) {
  // Minimal: show a modal with JSON preview (you can upgrade to proper PDF later)
  const cl = getActiveChecklist();
  if (!cl) return;

  el("preview-title").textContent =
    mode === "excel" ? "Excel Preview" : mode === "combined" ? "Checklist + Snapshots" : "Clean Preview";

  const body = el("preview-body");
  body.innerHTML = `<div style="padding:18px">
    <div style="font-weight:800;margin-bottom:8px">Preview (temporary)</div>
    <pre style="white-space:pre-wrap;font-size:12px;line-height:1.4;background:rgba(255,255,255,.06);padding:12px;border-radius:12px;border:1px solid rgba(255,255,255,.08)">${esc(
      JSON.stringify({ header: { insured: cl.insured, policy: cl.policy, term: cl.term, lobs: cl.lobs }, notes: cl.notes, entries: cl.entries }, null, 2)
    )}</pre>
    <div style="margin-top:10px;font-size:12px;opacity:.7">We can replace this with a real PDF/Excel-style preview next.</div>
  </div>`;

  openModal("preview-modal");
}

function downloadAs(mode) {
  // Minimal: download JSON now (no crash); later replace with PDF generator
  const cl = getActiveChecklist();
  if (!cl) return;

  const payload = {
    mode,
    header: { insured: cl.insured, policy: cl.policy, term: cl.term, date: cl.date, checkedby: cl.checkedby, am: cl.am, lobs: cl.lobs },
    notes: cl.notes,
    entries: cl.entries,
  };

  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `checklist-${mode}-${(cl.policy || cl.insured || "export").replace(/\s+/g, "_")}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();

  showToast("⬇ Download started (JSON temporary)");
}

function printChecklist() {
  // Print whatever is in preview
  window.print();
}

// ══════════════════════════════════════════
// ADMIN (Render)
// ══════════════════════════════════════════

function renderAdmin() {
  renderAdminStats();
  renderAdminUsers();
  renderLobManagement();
  switchAdminTab("stats");
}

function renderAdminStats() {
  const completed = CHECKLISTS.filter((c) => c.status === "complete").length;
  const totalLobs = ALL_LOBS.filter((l) => !l.locked).length;

  el("admin-stat-grid").innerHTML = `
    <div class="stat-card stat-1"><div class="stat-label">Total Checklists</div><div class="stat-value">${CHECKLISTS.length}</div><div class="stat-trend">↑ Active</div></div>
    <div class="stat-card stat-2"><div class="stat-label">Supabase Users</div><div class="stat-value">—</div><div class="stat-trend">Manage in Supabase</div></div>
    <div class="stat-card stat-3"><div class="stat-label">Completed</div><div class="stat-value">${completed}</div><div class="stat-trend">${CHECKLISTS.length - completed} drafts</div></div>
    <div class="stat-card stat-4"><div class="stat-label">LOBs Active</div><div class="stat-value">${totalLobs}</div><div class="stat-trend">+ locked COM</div></div>
  `;

  const recent = [...CHECKLISTS].sort((a, b) => new Date(b.updated) - new Date(a.updated)).slice(0, 5);

  el("admin-recent-body").innerHTML = recent
    .map((cl) => {
      const date = new Date(cl.updated).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
      return `<tr>
        <td><b>${esc(cl.insured)}</b><div style="font-size:11px;color:var(--vivid);font-family:monospace">${esc(cl.policy)}</div></td>
        <td>${esc(cl.user)}</td>
        <td><span class="pkg-tag">${esc(cl.lobs.join(", "))}</span></td>
        <td><span class="status-chip ${cl.status === "complete" ? "chip-complete" : "chip-draft"}">${esc(cl.status)}</span></td>
        <td style="color:var(--muted);font-size:12px">${esc(date)}</td>
      </tr>`;
    })
    .join("");
}

function renderAdminUsers() {
  const body = el("admin-users-body");
  if (!body) return;

  body.innerHTML = `<tr><td colspan="6" style="padding:14px;color:var(--muted);font-size:13px">
    Use “Add User” button to create users (requires /api/admin/create-user).<br/>
    If it fails, verify Vercel env vars: SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY.
  </td></tr>`;
}

function renderLobManagement() {
  const list = el("lob-manage-list");
  if (!list) return;

  list.innerHTML = ALL_LOBS
    .map(
      (l) => `
    <div class="lob-manage-card">
      <div style="font-size:18px">${l.locked ? "🔒" : "📋"}</div>
      <div class="lob-manage-name">${esc(l.name)}</div>
      <span class="pkg-tag" style="margin-right:8px">${esc(l.code)}</span>
      <div class="lob-manage-fields">${(COVERAGE_FIELDS[l.name] || []).filter((f) => !f.isHeader).length} fields</div>
      ${
        l.locked
          ? '<span class="lob-locked-badge">LOCKED</span>'
          : `<button class="btn-sm btn-outline" style="margin-left:auto" onclick="openLobFieldsEditor(${l.id})">✏ Edit Fields</button>`
      }
    </div>
  `
    )
    .join("");
}

// ══════════════════════════════════════════
// ADMIN: LOB FIELDS EDITOR (basic implementation)
// ══════════════════════════════════════════

async function openLobFieldsEditor(lobId) {
  if (!isAdmin()) return showToast("⛔ Admin only");

  const lob = LOBS_BY_ID.get(lobId);
  if (!lob) return;

  activeLobForFieldEdit = lobId;

  // Load fields for this lob (including inactive? we keep active only for now)
  const { data, error } = await supabase
    .from("lob_fields")
    .select("id, lob_id, section, label, sort_order, is_active")
    .eq("lob_id", lobId)
    .order("sort_order", { ascending: true });

  if (error) {
    console.error(error);
    return showToast("❌ Failed to load LOB fields");
  }

  // Convert to draft structure
  lobFieldsDraft = (data || [])
    .filter((r) => r.is_active !== false)
    .map((r) => ({
      id: r.id,
      label: r.label,
      section: r.section || "General",
      sort_order: r.sort_order ?? 0,
      is_header: false,
    }));

  el("lob-fields-modal-title").textContent = `Edit Fields — ${lob.name}`;
  renderLobFieldsModal();
  openModal("lob-fields-modal");
}

function renderLobFieldsModal() {
  const body = el("lob-fields-modal-body");
  if (!body) return;

  if (!lobFieldsDraft.length) {
    body.innerHTML = `<div style="padding:14px;color:var(--muted);font-size:13px">No fields yet. Click “Add Field”.</div>`;
    return;
  }

  body.innerHTML = lobFieldsDraft
    .map((f, idx) => {
      return `<div class="lob-field-row" draggable="true"
        ondragstart="lobFieldDragStart(${idx})"
        ondragover="lobFieldDragOver(event)"
        ondrop="lobFieldDrop(${idx})"
        style="display:flex;gap:10px;align-items:center;padding:10px 14px;border-bottom:1px solid var(--border)">
        <div style="cursor:grab;opacity:.6">⠿</div>
        <input class="hf-input" style="flex:2" value="${esc(f.label)}" oninput="editLobField(${idx}, 'label', this.value)" />
        <input class="hf-input" style="flex:1" value="${esc(f.section)}" oninput="editLobField(${idx}, 'section', this.value)" />
        <button class="btn-sm btn-danger" style="padding:6px 10px" onclick="removeLobField(${idx})">🗑</button>
      </div>`;
    })
    .join("");
}

function lobFieldDragStart(idx) {
  lobFieldsDragIndex = idx;
}
function lobFieldDragOver(e) {
  e.preventDefault();
}
function lobFieldDrop(targetIdx) {
  const from = lobFieldsDragIndex;
  if (from == null || from === targetIdx) return;
  const item = lobFieldsDraft.splice(from, 1)[0];
  lobFieldsDraft.splice(targetIdx, 0, item);
  lobFieldsDragIndex = null;
  renderLobFieldsModal();
}

function editLobField(idx, key, val) {
  if (!lobFieldsDraft[idx]) return;
  lobFieldsDraft[idx][key] = val;
}

function removeLobField(idx) {
  lobFieldsDraft.splice(idx, 1);
  renderLobFieldsModal();
}

function addLobField(isHeader) {
  // We’ll treat “header” as a field that becomes a separate section label later (simple)
  // For now, we create a field with section name and label like “—”
  lobFieldsDraft.push({
    id: null,
    label: isHeader ? "Section Title" : "New Field",
    section: isHeader ? "Section" : "General",
    sort_order: lobFieldsDraft.length,
    is_header: !!isHeader,
  });
  renderLobFieldsModal();
}

async function saveLobFields() {
  if (!isAdmin()) return showToast("⛔ Admin only");
  if (!activeLobForFieldEdit) return;

  try {
    // Recompute sort_order
    const rows = lobFieldsDraft.map((f, i) => ({
      id: f.id || undefined,
      lob_id: activeLobForFieldEdit,
      label: String(f.label || "").trim(),
      section: String(f.section || "General").trim(),
      sort_order: i + 1,
      is_active: true,
    })).filter(r => r.label);

    // Soft-delete existing then insert fresh (simple reliable)
    await supabase.from("lob_fields").update({ is_active: false }).eq("lob_id", activeLobForFieldEdit);

    if (rows.length) {
      const { error } = await supabase.from("lob_fields").insert(rows);
      if (error) throw error;
    }

    closeModal("lob-fields-modal");
    showToast("✅ Fields saved");

    await loadLobFieldsFromDb();
    if (activeChecklistId) renderEditor();
    renderLobManagement();
  } catch (e) {
    console.error(e);
    showToast("❌ Save fields failed (check RLS)");
  }
}

// ══════════════════════════════════════════
// CREDENTIALS (optional/local only)
// ══════════════════════════════════════════

function saveCredentials() {
  const u = el("cred-username")?.value || "";
  const p = el("cred-password")?.value || "";
  localStorage.setItem("ss_admin_creds", JSON.stringify({ u, p }));
  showToast("✅ Credentials saved (local)");
}

// ══════════════════════════════════════════
// TOAST
// ══════════════════════════════════════════

let toastTimer;
function showToast(msg) {
  const t = el("toast");
  if (!t) return;
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove("show"), 3000);
}

// ══════════════════════════════════════════
// INIT (restore supabase session)
// ══════════════════════════════════════════

async function initAuth() {
  const { data } = await supabase.auth.getSession();
  const sessionUser = data?.session?.user;

  if (sessionUser) {
    currentUser = await buildCurrentUserFromSupabase(sessionUser);
    await initAppData();
    setupUI();
    goTo("dashboard");
  } else {
    goTo("login");
  }

  supabase.auth.onAuthStateChange(async (_event, session) => {
    if (session?.user) {
      currentUser = await buildCurrentUserFromSupabase(session.user);
      await initAppData();
      setupUI();
      goTo("dashboard");
    } else {
      currentUser = null;
      CHECKLISTS = [];
      goTo("login");
    }
  });
}

initAuth();

// Close modal if click overlay
document.querySelectorAll(".modal-overlay").forEach((overlay) => {
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) overlay.classList.remove("open");
  });
});

// Close dropdowns on outside click
document.addEventListener("click", (e) => {
  const inside = e.target.closest(".download-dropdown-wrap");
  if (!inside) document.querySelectorAll(".download-dropdown-wrap.open").forEach((w) => w.classList.remove("open"));
});

// Search input binding (keep existing HTML inline oninput too, but this helps)
el("search-input")?.addEventListener("input", (e) => renderChecklistGrid(e.target.value));

// LOB modal search binding
el("lob-modal-search")?.addEventListener("input", (e) => filterLobModal(e.target.value));

// ══════════════════════════════════════════
// --- Expose functions used by inline HTML handlers ---
// ══════════════════════════════════════════

window.doLogin = doLogin;
window.doLogout = doLogout;

window.showTab = showTab;
window.switchAdminTab = switchAdminTab;
window.switchEditorTab = switchEditorTab;

window.createChecklist = createChecklist;
window.applyNewLobSelection = applyNewLobSelection;
window.toggleNewLob = toggleNewLob;

window.openChecklist = openChecklist;
window.deleteChecklist = deleteChecklist;
window.filterChecklists = filterChecklists;
window.setFilter = setFilter;

window.updateEntry = updateEntry;
window.updateStatusAndRow = updateStatusAndRow;
window.toggleSection = toggleSection;

window.openModal = openModal;
window.closeModal = closeModal;
window.filterLobModal = filterLobModal;
window.toggleEditorLob = toggleEditorLob;
window.applyLobSelection = applyLobSelection;

window.markComplete = markComplete;
window.resetEditor = resetEditor;

window.addSnapshot = addSnapshot;
window.deleteSnapshot = deleteSnapshot;

window.toggleDropdown = toggleDropdown;
window.showPreview = showPreview;
window.downloadAs = downloadAs;
window.printChecklist = printChecklist;

window.addNewLOB = addNewLOB;
window.saveUser = saveUser;

window.saveCredentials = saveCredentials;

window.openLobFieldsEditor = openLobFieldsEditor;
window.addLobField = addLobField;
window.saveLobFields = saveLobFields;

// for drag & edit functions
window.lobFieldDragStart = lobFieldDragStart;
window.lobFieldDragOver = lobFieldDragOver;
window.lobFieldDrop = lobFieldDrop;
window.editLobField = editLobField;
window.removeLobField = removeLobField;
