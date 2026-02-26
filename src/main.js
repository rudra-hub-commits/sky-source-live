import "./style.css";
import { supabase } from "./supabaseClient";

/** DEBUG */
window.supabase = supabase;
console.log("✅ SUPABASE BUILD ACTIVE");
console.log("✅ window.supabase set", supabase);

/* ──────────────────────────────────────────────
   Helpers
────────────────────────────────────────────── */
function esc(str = "") {
  return String(str).replace(/[&<>"']/g, (m) => {
    const map = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" };
    return map[m];
  });
}

function showToast(msg) {
  const t = document.getElementById("toast");
  if (!t) return;
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(showToast._timer);
  showToast._timer = setTimeout(() => t.classList.remove("show"), 3000);
}

/* Dropdown helper (Preview / Download) */
function toggleDropdown(id) {
  const wrap = document.getElementById(id);
  if (!wrap) return;
  wrap.classList.toggle("open");
}
function closeAllDropdowns() {
  document.querySelectorAll(".download-dropdown-wrap.open").forEach((el) => el.classList.remove("open"));
}
document.addEventListener("click", (e) => {
  // close dropdowns when click outside
  const inside = e.target.closest(".download-dropdown-wrap");
  if (!inside) closeAllDropdowns();
});

/* Modals */
function openModal(id) {
  if (id === "lob-modal") {
    const cl = getActiveChecklist();
    editorLobSelectedIds = cl ? [...(cl.lob_ids || [])] : [];
    renderLobModalList("");
  }
  document.getElementById(id)?.classList.add("open");
}
function closeModal(id) {
  document.getElementById(id)?.classList.remove("open");
}
document.querySelectorAll(".modal-overlay").forEach((overlay) => {
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) overlay.classList.remove("open");
  });
});

/* ──────────────────────────────────────────────
   Global State (DB-backed)
────────────────────────────────────────────── */
let currentUser = null;

let ALL_LOBS = []; // [{id,name,is_active,locked,code}]
let LOBS_BY_ID = new Map();
let COVERAGE_FIELDS = {}; // lobName -> [{id,label,isHeader}]
let CHECKLISTS = [];

let currentFilter = "all";
let activeChecklistId = null;
let snapshotCount = 1;

let lobModalSelectedIds = []; // new checklist (PKG) selection
let editorLobSelectedIds = []; // editor selection

/* ──────────────────────────────────────────────
   Supabase → Build currentUser
────────────────────────────────────────────── */
async function buildCurrentUserFromSupabase(user) {
  let role = "user";
  try {
    const { data: profile, error } = await supabase
      .from("profiles")
      .select("role, username, full_name")
      .eq("id", user.id)
      .maybeSingle();

    if (!error && profile?.role) role = profile.role;
    const fullname = profile?.full_name || (user.email || "User").split("@")[0];
    const username = profile?.username || user.email;

    return { id: user.id, email: user.email, username, fullname, role };
  } catch (e) {
    console.warn("profiles lookup failed:", e);
    return {
      id: user.id,
      email: user.email,
      username: user.email,
      fullname: (user.email || "User").split("@")[0],
      role,
    };
  }
}
function isAdmin() {
  return currentUser?.role === "admin";
}

/* ──────────────────────────────────────────────
   DB Loaders
────────────────────────────────────────────── */
function buildCoverageFieldsFromDb(lobsById, lobFieldsRows) {
  const byLobName = {};
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
      .filter(Boolean)
      .map((w) => w[0])
      .join("")
      .toUpperCase()
      .slice(0, 4),
  }));

  LOBS_BY_ID = new Map(ALL_LOBS.map((l) => [l.id, l]));
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
  if (!rows.length) {
    CHECKLISTS = [];
    return;
  }

  // PKG mapping (join table)
  const checklistIds = rows.map((r) => r.id);
  const { data: joinRows, error: joinErr } = await supabase
    .from("checklist_lobs")
    .select("checklist_id, lob_id")
    .in("checklist_id", checklistIds);

  if (joinErr) {
    console.warn("checklist_lobs missing or blocked by RLS:", joinErr);
  }

  const lobMapByChecklist = new Map();
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
    };
  });
}

async function initAppData() {
  await loadLobsFromDb();
  await loadLobFieldsFromDb();
  await loadChecklistsFromDb();
}

/* ──────────────────────────────────────────────
   DB Writers
────────────────────────────────────────────── */
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
    },
    updated_at: new Date().toISOString(),
  };

  const { data, error } = await supabase.from("checklists").upsert(payload).select("id").single();
  if (error) throw error;

  const checklistId = data.id;

  // Sync join table for LOBs (PKG)
  const lobIds = cl.lob_ids || [];
  if (lobIds.length) {
    await supabase.from("checklist_lobs").delete().eq("checklist_id", checklistId);
    const insertRows = lobIds.map((lobId) => ({ checklist_id: checklistId, lob_id: lobId }));
    const { error: jErr } = await supabase.from("checklist_lobs").insert(insertRows);
    if (jErr) throw jErr;
  }

  return checklistId;
}

async function deleteChecklistFromDb(id) {
  const { error } = await supabase.from("checklists").delete().eq("id", id);
  if (error) throw error;
}

/* ──────────────────────────────────────────────
   Auth
────────────────────────────────────────────── */
async function doLogin() {
  const login = document.getElementById("login-user").value.trim();
  const password = document.getElementById("login-pass").value;
  const err = document.getElementById("login-err");
  const btn = document.getElementById("login-btn");

  err.classList.remove("show");
  err.textContent = "";

  try {
    btn.disabled = true;

    let email = login;

    // username → resolve via API
    if (!login.includes("@")) {
      const r = await fetch("/api/auth/resolve-username", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ username: login }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j?.email) {
        err.textContent = "Invalid username or password";
        err.classList.add("show");
        return;
      }
      email = j.email;
    }

    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error || !data?.user) {
      err.textContent = "Invalid email/username or password";
      err.classList.add("show");
      return;
    }

    currentUser = await buildCurrentUserFromSupabase(data.user);
    await initAppData();
    setupUI();
    goTo("dashboard");
  } catch (e) {
    console.error(e);
    err.textContent = "Login failed. Try again.";
    err.classList.add("show");
  } finally {
    btn.disabled = false;
  }
}

async function doLogout() {
  try {
    await supabase.auth.signOut();
  } catch (e) {
    console.warn("signOut error:", e);
  } finally {
    currentUser = null;
    activeChecklistId = null;
    CHECKLISTS = [];
    goTo("login");
  }
}

document.addEventListener("keydown", (e) => {
  const loginScreen = document.getElementById("screen-login");
  if (e.key === "Enter" && loginScreen?.classList.contains("active")) doLogin();
});

/* ──────────────────────────────────────────────
   UI Setup + Navigation
────────────────────────────────────────────── */
function setupUI() {
  document.getElementById("user-badge-name").textContent = currentUser.fullname || currentUser.username;
  document.getElementById("user-avatar").textContent = (currentUser.fullname || currentUser.username)[0].toUpperCase();

  document.getElementById("admin-chip").style.display = isAdmin() ? "" : "none";
  document.getElementById("nav-admin").style.display = isAdmin() ? "" : "none";

  const h = new Date().getHours();
  const greet = h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
  document.getElementById("dash-greeting").textContent = `${greet}, ${(currentUser.fullname || currentUser.username).split(" ")[0]} 👋`;

  populateNewLobDropdown();
}

function goTo(screen) {
  document.querySelectorAll(".screen").forEach((s) => s.classList.remove("active"));
  if (screen === "login") {
    document.getElementById("screen-login").classList.add("active");
  } else {
    document.getElementById("screen-app").classList.add("active");
    if (screen === "dashboard") showTab("dashboard");
  }
}

function showTab(tab) {
  ["dashboard", "new-checklist", "editor", "admin"].forEach((p) => {
    const el = document.getElementById("tab-" + p);
    if (el) el.style.display = "none";
  });
  document.querySelectorAll(".nav-link").forEach((l) => l.classList.remove("active"));

  if (tab === "dashboard") {
    document.getElementById("tab-dashboard").style.display = "";
    document.getElementById("nav-dash").classList.add("active");
    renderDashboard();
  } else if (tab === "new-checklist") {
    document.getElementById("tab-new-checklist").style.display = "";
    document.getElementById("nav-new").classList.add("active");
    document.getElementById("new-date").value = new Date().toISOString().split("T")[0];
    document.getElementById("new-checkedby").value = currentUser?.fullname || currentUser?.username || "";
  } else if (tab === "editor") {
    document.getElementById("tab-editor").style.display = "flex";
    document.getElementById("nav-dash").classList.add("active");
    renderEditor();
  } else if (tab === "admin") {
    if (!isAdmin()) return showToast("⛔ Admin access only");
    document.getElementById("tab-admin").style.display = "";
    document.getElementById("nav-admin").classList.add("active");
    renderAdmin();
  }
}

function switchEditorTab(tab) {
  document.getElementById("editor-panel-checklist").style.display = tab === "checklist" ? "" : "none";
  document.getElementById("editor-panel-snapshots").style.display = tab === "snapshots" ? "" : "none";
  document.getElementById("editor-tab-checklist").classList.toggle("active", tab === "checklist");
  document.getElementById("editor-tab-snapshots").classList.toggle("active", tab === "snapshots");
}

function switchAdminTab(tab) {
  ["stats", "users", "lobs", "credentials"].forEach((t) => {
    const panel = document.getElementById("admin-panel-" + t);
    if (panel) panel.style.display = t === tab ? "" : "none";
    const btn = document.getElementById("admin-tab-" + t);
    if (btn) btn.classList.toggle("active", t === tab);
  });
  if (tab === "lobs") renderLobManagement();
  if (tab === "users") renderAdminUsers();
}

/* ──────────────────────────────────────────────
   Dashboard
────────────────────────────────────────────── */
function renderDashboard() {
  renderRecentStrip();
  renderChecklistGrid("");
}

function getRecentCompleted() {
  const fiveDaysMs = 5 * 24 * 60 * 60 * 1000;
  const now = Date.now();
  return CHECKLISTS.filter((c) => {
    if (c.status !== "complete") return false;
    const t = new Date(c.updated).getTime();
    return now - t < fiveDaysMs;
  }).filter((c) => (isAdmin() ? true : c.user === currentUser.username));
}

function renderRecentStrip() {
  const section = document.getElementById("recent-section");
  const strip = document.getElementById("recent-strip");
  const myRecent = getRecentCompleted();

  if (!myRecent.length) {
    section.style.display = "none";
    return;
  }
  section.style.display = "";

  strip.innerHTML = myRecent.slice(0, 12).map((cl) => {
    const daysLeft = Math.ceil((5 * 86400000 - (Date.now() - new Date(cl.updated).getTime())) / 86400000);
    return `<div class="recent-card" onclick="openChecklist('${esc(cl.id)}')">
      <div class="recent-expire-badge">${daysLeft}d left</div>
      <div class="recent-card-insured">${esc(cl.insured)}</div>
      <div class="recent-card-policy">${esc(cl.policy)}</div>
      <div class="recent-card-meta">✅ Completed · ${esc(cl.lobs.join(", "))}</div>
    </div>`;
  }).join("");
}

function renderChecklistGrid(searchVal) {
  const grid = document.getElementById("checklist-grid");
  let list = CHECKLISTS;

  if (!isAdmin()) list = list.filter((c) => c.user === currentUser.username);
  if (currentFilter !== "all") list = list.filter((c) => c.status === currentFilter);

  if (searchVal) {
    const s = searchVal.toLowerCase();
    list = list.filter((c) => (c.insured || "").toLowerCase().includes(s) || (c.policy || "").toLowerCase().includes(s));
  }

  if (!list.length) {
    grid.innerHTML = `<div class="empty-state" style="grid-column:1/-1">
      <div class="empty-state-icon">📋</div>
      <p style="font-weight:700;font-size:16px">No checklists found</p>
      <p style="margin-top:6px;font-size:13px">Create your first checklist to get started</p>
    </div>`;
    return;
  }

  grid.innerHTML = list.map((cl) => {
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
  }).join("");
}

function filterChecklists(val) { renderChecklistGrid(val); }
function setFilter(btn, filter) {
  currentFilter = filter;
  document.querySelectorAll(".cl-filter-btn").forEach((b) => b.classList.remove("active"));
  btn.classList.add("active");
  renderChecklistGrid(document.getElementById("search-input").value);
}
function openChecklist(id) { activeChecklistId = id; showTab("editor"); }

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

/* ──────────────────────────────────────────────
   New Checklist
────────────────────────────────────────────── */
function populateNewLobDropdown() {
  const sel = document.getElementById("new-lob");
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
    document.getElementById("new-lob-note").style.display = sel.value ? "" : "none";
  };
}

function createChecklist() {
  const insured = document.getElementById("new-insured").value.trim();
  const policy = document.getElementById("new-policy").value.trim();
  const term = document.getElementById("new-term").value.trim();
  const date = document.getElementById("new-date").value;
  const checkedby = document.getElementById("new-checkedby").value.trim();
  const am = document.getElementById("new-am").value.trim();
  const lobVal = document.getElementById("new-lob").value;

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
  const list = document.getElementById("new-lob-modal-list");

  list.innerHTML = ALL_LOBS.filter((l) => !l.locked).map((l) => `
    <div class="modal-item" onclick="toggleNewLob(${l.id},this)">
      <span>${esc(l.name)}</span>
      <span class="modal-check" style="display:none">✓</span>
    </div>
  `).join("");

  openModal("new-lob-modal");
}

function toggleNewLob(lobId, el) {
  const idx = lobModalSelectedIds.indexOf(lobId);
  if (idx > -1) {
    lobModalSelectedIds.splice(idx, 1);
    el.classList.remove("selected");
    el.querySelector(".modal-check").style.display = "none";
  } else {
    lobModalSelectedIds.push(lobId);
    el.classList.add("selected");
    el.querySelector(".modal-check").style.display = "";
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

/* ──────────────────────────────────────────────
   Editor
────────────────────────────────────────────── */
function getActiveChecklist() {
  return CHECKLISTS.find((c) => c.id === activeChecklistId);
}

function renderEditor() {
  const cl = getActiveChecklist();
  if (!cl) return showTab("dashboard");

  document.getElementById("editor-title-name").textContent = cl.insured || "Checklist";
  document.getElementById("editor-title-policy").textContent = cl.policy || "—";

  document.getElementById("ed-insured").value = cl.insured || "";
  document.getElementById("ed-policy").value = cl.policy || "";
  document.getElementById("ed-term").value = cl.term || "";
  document.getElementById("ed-date").value = cl.date || "";
  document.getElementById("ed-checkedby").value = cl.checkedby || "";
  document.getElementById("ed-am").value = cl.am || "";
  document.getElementById("checklist-notes").value = cl.notes || "";

  document.getElementById("complete-banner").style.display = cl.status === "complete" ? "" : "none";

  document.getElementById("ed-lob-display").textContent = cl.lobs.join(", ");
  document.getElementById("ed-lob-tags").innerHTML = cl.lobs.map((l) => `<span class="pkg-tag">${esc(l)}</span>`).join("");

  renderCoverageSections(cl);
  renderSnapshots();
  updateProgress(cl);
}

function renderCoverageSections(cl) {
  const sections = [];
  if (COVERAGE_FIELDS["Common Declarations"]) sections.push("Common Declarations");
  sections.push(...cl.lobs);

  const container = document.getElementById("coverage-sections");
  container.innerHTML = sections.map((lobName) => {
    const fields = COVERAGE_FIELDS[lobName];

    if (!fields) {
      return `<div class="section-wrap">
        <div class="section-header" style="background:linear-gradient(135deg,#374151,#4b5563)">
          <span class="section-name">${esc(lobName)}</span>
          <span style="color:rgba(255,255,255,.5);font-size:12px">No fields defined</span>
        </div>
      </div>`;
    }

    const rows = fields.map((f) => {
      if (f.isHeader) return `<tr class="header-row"><td colspan="7">${esc(f.label)}</td></tr>`;

      const e = (cl.entries && cl.entries[f.id]) || {};
      const statusCls =
        { Match: "ss-match", "Not Match": "ss-notmatch", "Not Found": "ss-notfound", "N/A": "ss-na" }[e.status || "N/A"] || "ss-na";

      const isLocked = e.status === "Match" || e.status === "N/A";
      const isNotMatch = e.status === "Not Match";
      const rowCls = isLocked ? "row-locked" : isNotMatch ? "row-notmatch" : "";
      const readonly = isLocked ? "readonly" : "";

      return `<tr class="${rowCls}" id="row-${esc(f.id)}">
        <td style="width:26%;font-size:12px;font-weight:500;padding:6px 10px">${esc(f.label)}</td>
        <td style="width:6%;text-align:center"><input class="cell-input cell-pg" value="${esc(e.pg || "")}"
          oninput="updateEntry('${esc(f.id)}','pg',this.value)" placeholder="—"/></td>
        <td style="width:18%"><input class="cell-input" value="${esc(e.pol || "")}"
          oninput="updateEntry('${esc(f.id)}','pol',this.value)" placeholder="Policy data" ${readonly}/></td>
        <td style="width:18%"><input class="cell-input" value="${esc(e.nex || "")}"
          oninput="updateEntry('${esc(f.id)}','nex',this.value)" placeholder="Nexsure data" ${readonly}/></td>
        <td style="width:12%;text-align:center">
          <select class="status-select ${statusCls}" onchange="updateStatusAndRow('${esc(f.id)}',this)">
            <option ${e.status === "Match" ? "selected" : ""}>Match</option>
            <option ${e.status === "Not Match" ? "selected" : ""}>Not Match</option>
            <option ${e.status === "Not Found" ? "selected" : ""}>Not Found</option>
            <option ${(e.status === "N/A" || !e.status) ? "selected" : ""}>N/A</option>
          </select>
        </td>
        <td style="width:12%"><input class="cell-input" value="${esc(e.skyComments || "")}"
          oninput="updateEntry('${esc(f.id)}','skyComments',this.value)" placeholder="Sky Source…"/></td>
        <td style="width:8%"><input class="cell-input" value="${esc(e.amComments || "")}"
          oninput="updateEntry('${esc(f.id)}','amComments',this.value)" placeholder="AM…"/></td>
      </tr>`;
    }).join("");

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
  }).join("");
}

function toggleSection(header) {
  const body = header.nextElementSibling;
  const chevron = header.querySelector(".section-chevron");
  if (!body) return;
  if (body.style.display === "none") { body.style.display = ""; chevron?.classList.add("open"); }
  else { body.style.display = "none"; chevron?.classList.remove("open"); }
}

let _debounce;
function showSaved() {
  const ind = document.getElementById("save-indicator");
  if (!ind) return;
  ind.innerHTML = "⟳ Saving…";
  ind.style.color = "#8b5cf6";
  clearTimeout(showSaved._t);
  showSaved._t = setTimeout(() => {
    ind.innerHTML = "✓ Saved";
    ind.style.color = "var(--match)";
  }, 700);
}

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
  cl.entries ||= {};
  cl.entries[fId] ||= {};
  cl.entries[fId][field] = val;
  cl.updated = new Date().toISOString();
  showSaved();
  updateProgress(cl);
  persistActiveChecklistDebounced();
}

function updateStatusAndRow(fId, sel) {
  const cl = getActiveChecklist();
  if (!cl) return;
  cl.entries ||= {};
  cl.entries[fId] ||= {};
  cl.entries[fId].status = sel.value;

  const cls =
    { Match: "ss-match", "Not Match": "ss-notmatch", "Not Found": "ss-notfound", "N/A": "ss-na" }[sel.value] || "ss-na";
  sel.className = "status-select " + cls;

  cl.updated = new Date().toISOString();
  showSaved();
  updateProgress(cl);
  persistActiveChecklistDebounced();

  const row = document.getElementById("row-" + fId);
  if (!row) return;

  row.classList.remove("row-locked", "row-notmatch");
  row.querySelectorAll(".cell-input").forEach((inp) => inp.removeAttribute("readonly"));

  if (sel.value === "Match" || sel.value === "N/A") {
    row.classList.add("row-locked");
    const tds = row.querySelectorAll("td");
    tds[2]?.querySelector(".cell-input")?.setAttribute("readonly", "");
    tds[3]?.querySelector(".cell-input")?.setAttribute("readonly", "");
  } else if (sel.value === "Not Match") {
    row.classList.add("row-notmatch");
  }
}

function updateProgress(cl) {
  const sections = [];
  if (COVERAGE_FIELDS["Common Declarations"]) sections.push("Common Declarations");
  sections.push(...cl.lobs);

  let total = 0, filled = 0;
  sections.forEach((lobName) => {
    const fields = COVERAGE_FIELDS[lobName] || [];
    fields.filter((f) => !f.isHeader).forEach((f) => {
      total++;
      const e = cl.entries?.[f.id];
      if (e && (e.pol || e.nex || e.status !== "N/A")) filled++;
    });
  });

  const pct = total ? Math.round((filled / total) * 100) : 0;
  const fill = document.getElementById("progress-fill");
  const label = document.getElementById("progress-label");
  if (fill) fill.style.width = pct + "%";
  if (label) label.textContent = pct + "%";
}

function saveHeaderFields() {
  const cl = getActiveChecklist();
  if (!cl) return;

  cl.insured = document.getElementById("ed-insured").value;
  cl.policy = document.getElementById("ed-policy").value;
  cl.term = document.getElementById("ed-term").value;
  cl.date = document.getElementById("ed-date").value;
  cl.checkedby = document.getElementById("ed-checkedby").value;
  cl.am = document.getElementById("ed-am").value;
  cl.notes = document.getElementById("checklist-notes").value;

  cl.updated = new Date().toISOString();
  document.getElementById("editor-title-name").textContent = cl.insured || "Checklist";
  document.getElementById("editor-title-policy").textContent = cl.policy || "—";

  showSaved();
  persistActiveChecklistDebounced();
}

["ed-insured","ed-policy","ed-term","ed-date","ed-checkedby","ed-am","checklist-notes"].forEach((id) => {
  document.getElementById(id)?.addEventListener("input", saveHeaderFields);
});

async function markComplete() {
  const cl = getActiveChecklist();
  if (!cl) return;
  cl.status = "complete";
  cl.updated = new Date().toISOString();
  document.getElementById("complete-banner").style.display = "";
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

/* ──────────────────────────────────────────────
   LOB Selection (Editor modal)
────────────────────────────────────────────── */
function renderLobModalList(search) {
  const list = document.getElementById("lob-modal-list");
  if (!list) return;

  const filtered = ALL_LOBS.filter((l) => !l.locked && l.name.toLowerCase().includes((search || "").toLowerCase()));
  list.innerHTML = filtered.map((l) => {
    const sel = editorLobSelectedIds.includes(l.id);
    return `<div class="modal-item ${sel ? "selected" : ""}" onclick="toggleEditorLob(${l.id},this)">
      <span>${esc(l.name)}</span>
      <span class="modal-check" style="display:${sel ? "" : "none"}">✓</span>
    </div>`;
  }).join("");

  const applyBtn = document.getElementById("lob-modal-apply");
  if (applyBtn) applyBtn.textContent = `Apply (${editorLobSelectedIds.length} selected)`;
}
function filterLobModal(val) { renderLobModalList(val); }

function toggleEditorLob(lobId, el) {
  const idx = editorLobSelectedIds.indexOf(lobId);
  if (idx > -1) {
    editorLobSelectedIds.splice(idx, 1);
    el.classList.remove("selected");
    el.querySelector(".modal-check").style.display = "none";
  } else {
    editorLobSelectedIds.push(lobId);
    el.classList.add("selected");
    el.querySelector(".modal-check").style.display = "";
  }
  const applyBtn = document.getElementById("lob-modal-apply");
  if (applyBtn) applyBtn.textContent = `Apply (${editorLobSelectedIds.length} selected)`;
}

async function applyLobSelection() {
  closeModal("lob-modal");
  if (!editorLobSelectedIds.length) return showToast("⚠ Select at least one LOB");

  const cl = getActiveChecklist();
  if (!cl) return;

  cl.lob_ids = [...editorLobSelectedIds];
  cl.lobs = cl.lob_ids.map((id) => LOBS_BY_ID.get(id)?.name).filter(Boolean);

  document.getElementById("ed-lob-display").textContent = cl.lobs.join(", ");
  document.getElementById("ed-lob-tags").innerHTML = cl.lobs.map((l) => `<span class="pkg-tag">${esc(l)}</span>`).join("");

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

/* ──────────────────────────────────────────────
   Snapshots (placeholder)
────────────────────────────────────────────── */
function renderSnapshots() {
  const container = document.getElementById("snapshots-container");
  if (!container) return;

  let html = "";
  for (let i = 1; i <= snapshotCount; i++) {
    html += `<div class="snapshot-card">
      <div class="snapshot-num">Snapshot ${i}
        <button onclick="deleteSnapshot()" style="background:none;border:none;color:#fca5a5;cursor:pointer;font-size:18px;padding:2px 8px;border-radius:8px">🗑</button>
      </div>
      <div class="snap-grid">
        <div><div class="snap-label">Policy Document</div>
          <div class="snap-upload-area"><div style="font-size:30px;opacity:.3">🖼️</div><div style="font-size:12px;font-weight:600">Drop image or click</div><div style="font-size:11px;opacity:.6">PNG, JPG up to 10MB</div></div>
        </div>
        <div><div class="snap-label">Nexsure Screenshot</div>
          <div class="snap-upload-area"><div style="font-size:30px;opacity:.3">🖼️</div><div style="font-size:12px;font-weight:600">Drop image or click</div><div style="font-size:11px;opacity:.6">PNG, JPG up to 10MB</div></div>
        </div>
      </div>
      <div><div class="snap-label">Notes</div>
        <textarea class="snap-notes" rows="2" placeholder="Comparison notes…"></textarea>
      </div>
    </div>`;
  }
  container.innerHTML = html;
}
function addSnapshot() { snapshotCount++; renderSnapshots(); showToast("Snapshot added"); }
function deleteSnapshot() {
  if (!confirm("Delete snapshot?")) return;
  snapshotCount = Math.max(1, snapshotCount - 1);
  renderSnapshots();
}

/* ──────────────────────────────────────────────
   Admin Panel (Add User + Add LOB)
────────────────────────────────────────────── */
async function apiAdminCreateUser(payload) {
  const { data: sess } = await supabase.auth.getSession();
  const token = sess?.session?.access_token;
  if (!token) throw new Error("No session token (login again)");

  const resp = await fetch("/api/admin/create-user", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify(payload),
  });

  const text = await resp.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* ignore */ }

  if (!resp.ok) throw new Error(json?.error || text || "Create user failed");
  return json;
}

async function saveUser() {
  // modal fields
  const username = document.getElementById("uf-username").value.trim();
  const full_name = document.getElementById("uf-fullname").value.trim();
  const email = document.getElementById("uf-email").value.trim();
  const password = document.getElementById("uf-password").value;
  const role = document.getElementById("uf-role").value;

  if (!email || !password || !username) return showToast("⚠ username, email, password required");
  if (!isAdmin()) return showToast("⛔ Admin only");

  try {
    const out = await apiAdminCreateUser({ email, password, username, full_name, role });
    closeModal("add-user-modal");
    showToast(`✅ User created: ${out.email}`);
  } catch (e) {
    console.error(e);
    showToast(`❌ ${e.message}`);
  }
}

async function addNewLOB() {
  if (!isAdmin()) return showToast("⛔ Admin only");

  const name = document.getElementById("new-lob-name")?.value?.trim();
  const code = document.getElementById("new-lob-code")?.value?.trim()?.toUpperCase();
  if (!name) return showToast("⚠ Enter LOB Name");

  try {
    const { error } = await supabase.from("lobs").insert([{ name, code: code || null, is_active: true }]);
    if (error) throw error;

    document.getElementById("new-lob-name").value = "";
    document.getElementById("new-lob-code").value = "";

    await loadLobsFromDb();
    populateNewLobDropdown();
    renderLobManagement();
    closeModal("add-lob-modal");
    showToast("✅ LOB added");
  } catch (e) {
    console.error(e);
    showToast("❌ " + (e.message || "LOB add failed"));
  }
}

function renderAdmin() {
  renderAdminStats();
  renderAdminUsers();
  renderLobManagement();
  switchAdminTab("stats");
}

function renderAdminStats() {
  const completed = CHECKLISTS.filter((c) => c.status === "complete").length;
  const totalLobs = ALL_LOBS.filter((l) => !l.locked).length;

  document.getElementById("admin-stat-grid").innerHTML = `
    <div class="stat-card stat-1"><div class="stat-label">Total Checklists</div><div class="stat-value">${CHECKLISTS.length}</div><div class="stat-trend">↑ Active</div></div>
    <div class="stat-card stat-2"><div class="stat-label">Supabase Users</div><div class="stat-value">—</div><div class="stat-trend">Use Admin → Users</div></div>
    <div class="stat-card stat-3"><div class="stat-label">Completed</div><div class="stat-value">${completed}</div><div class="stat-trend">${CHECKLISTS.length - completed} drafts</div></div>
    <div class="stat-card stat-4"><div class="stat-label">LOBs Active</div><div class="stat-value">${totalLobs}</div><div class="stat-trend">+ locked COM</div></div>
  `;

  const recent = [...CHECKLISTS].sort((a, b) => new Date(b.updated) - new Date(a.updated)).slice(0, 5);
  document.getElementById("admin-recent-body").innerHTML = recent.map((cl) => {
    const date = new Date(cl.updated).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
    return `<tr>
      <td><b>${esc(cl.insured)}</b><div style="font-size:11px;color:var(--vivid);font-family:monospace">${esc(cl.policy)}</div></td>
      <td>${esc(cl.user)}</td>
      <td><span class="pkg-tag">${esc(cl.lobs.join(", "))}</span></td>
      <td><span class="status-chip ${cl.status === "complete" ? "chip-complete" : "chip-draft"}">${esc(cl.status)}</span></td>
      <td style="color:var(--muted);font-size:12px">${esc(date)}</td>
    </tr>`;
  }).join("");
}

function renderAdminUsers() {
  const body = document.getElementById("admin-users-body");
  if (!body) return;
  body.innerHTML = `<tr><td colspan="6" style="padding:14px;color:var(--muted);font-size:13px">
    Use “＋ Add User” button (now connected to /api/admin/create-user).
  </td></tr>`;
}

function renderLobManagement() {
  const list = document.getElementById("lob-manage-list");
  if (!list) return;

  list.innerHTML = ALL_LOBS.map((l) => `
    <div class="lob-manage-card">
      <div style="font-size:18px">${l.locked ? "🔒" : "📋"}</div>
      <div class="lob-manage-name">${esc(l.name)}</div>
      <span class="pkg-tag" style="margin-right:8px">${esc(l.code)}</span>
      <div class="lob-manage-fields">${(COVERAGE_FIELDS[l.name] || []).filter((f) => !f.isHeader).length} fields</div>
      ${l.locked ? '<span class="lob-locked-badge">LOCKED</span>' : '<span style="color:var(--muted);font-size:12px">Active</span>'}
    </div>
  `).join("");
}

/* Credentials (safe stub so UI won’t crash) */
function saveCredentials() {
  const u = document.getElementById("cred-username")?.value || "";
  const p = document.getElementById("cred-password")?.value || "";
  localStorage.setItem("ss_admin_username", u);
  localStorage.setItem("ss_admin_password", p);
  showToast("✅ Credentials saved (local)");
}

/* Preview/Download stubs (so clicking doesn’t crash) */
function showPreview() { showToast("Preview: not wired yet"); }
function downloadAs() { showToast("Download: not wired yet"); }
function printChecklist() { window.print(); }

/* ──────────────────────────────────────────────
   Init Auth (restore session)
────────────────────────────────────────────── */
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

/* ──────────────────────────────────────────────
   Expose ONLY existing functions to HTML inline handlers
────────────────────────────────────────────── */
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

window.addNewLOB = addNewLOB;
window.saveUser = saveUser;

window.toggleDropdown = toggleDropdown;
window.saveCredentials = saveCredentials;

window.showPreview = showPreview;
window.downloadAs = downloadAs;
window.printChecklist = printChecklist;
