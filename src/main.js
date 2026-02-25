import "./style.css";
import { supabase } from "./supabaseClient";

// quick env test
console.log("Supabase URL:", import.meta.env.VITE_SUPABASE_URL);

// ══════════════════════════════════════════
// DATA LAYER (still sessionStorage for now)
// ══════════════════════════════════════════

const KEYS = {
  auth: "ss_auth",
  users: "ss_users", // legacy (not used for login anymore)
  checklists: "ss_checklists",
  lobs: "ss_lobs",
  recent: "ss_recent",
  credentials: "ss_creds", // legacy
};

function store(key, val) {
  sessionStorage.setItem(key, JSON.stringify(val));
}
function load(key, def) {
  try {
    const v = sessionStorage.getItem(key);
    return v ? JSON.parse(v) : def;
  } catch (e) {
    return def;
  }
}

// LOBs (editable by admin in UI)
let ALL_LOBS = load(KEYS.lobs, [
  { id: "common-dec", name: "Common Declarations", code: "COM", locked: true },
  { id: "gl", name: "General Liability", code: "GL", locked: false },
  { id: "ca", name: "Commercial Auto", code: "CA", locked: false },
  { id: "wc", name: "Workers' Compensation", code: "WC", locked: false },
  { id: "cp", name: "Commercial Property", code: "CP", locked: false },
  { id: "umb", name: "Umbrella / Excess", code: "UMB", locked: false },
  { id: "eo", name: "Professional Liability / E&O", code: "EO", locked: false },
  { id: "cyber", name: "Cyber Liability", code: "CY", locked: false },
  { id: "do", name: "Directors & Officers (D&O)", code: "DO", locked: false },
  { id: "crime", name: "Crime / Fidelity", code: "CR", locked: false },
  { id: "epli", name: "Employment Practices Liability", code: "EPLI", locked: false },
  { id: "inland-marine", name: "Inland Marine", code: "IM", locked: false },
]);

// Coverage fields per LOB (admin can edit fields via modal)
const COVERAGE_FIELDS = {
  "Common Declarations": [
    { id: "cd-h1", label: "Named Insured & Address", isHeader: true },
    { id: "cd-1", label: "Named Insured" },
    { id: "cd-2", label: "Mailing Address" },
    { id: "cd-h2", label: "Policy Information", isHeader: true },
    { id: "cd-3", label: "Policy Number" },
    { id: "cd-4", label: "Policy Effective Date" },
    { id: "cd-5", label: "Policy Expiration Date" },
    { id: "cd-6", label: "Business Description" },
    { id: "cd-7", label: "Carrier / Insurance Company" },
    { id: "cd-8", label: "Total Policy Premium" },
  ],
  "General Liability": [
    { id: "gl-h1", label: "General Liability Declarations", isHeader: true },
    { id: "gl-1", label: "Occurrence Limit" },
    { id: "gl-2", label: "General Aggregate Limit" },
    { id: "gl-3", label: "Products-Completed Ops Aggregate" },
    { id: "gl-4", label: "Personal & Advertising Injury" },
    { id: "gl-5", label: "Damage to Premises Rented" },
    { id: "gl-h2", label: "Endorsements", isHeader: true },
    { id: "gl-6", label: "Additional Insureds" },
    { id: "gl-7", label: "Waiver of Subrogation" },
    { id: "gl-8", label: "Primary & Non-Contributory" },
    { id: "gl-9", label: "GL Premium" },
  ],
  "Commercial Auto": [
    { id: "ca-h1", label: "Auto Declarations", isHeader: true },
    { id: "ca-1", label: "Liability Limit (CSL)" },
    { id: "ca-2", label: "Medical Payments" },
    { id: "ca-3", label: "Comprehensive Deductible" },
    { id: "ca-4", label: "Collision Deductible" },
    { id: "ca-h2", label: "Schedule of Vehicles", isHeader: true },
    { id: "ca-5", label: "Year / Make / Model" },
    { id: "ca-6", label: "Garaging Address" },
    { id: "ca-7", label: "CA Premium" },
  ],
  "Workers' Compensation": [
    { id: "wc-h1", label: "Workers' Compensation Declarations", isHeader: true },
    { id: "wc-1", label: "State(s) of Coverage" },
    { id: "wc-2", label: "Employers Liability - Each Accident" },
    { id: "wc-3", label: "Employers Liability - Disease (Policy)" },
    { id: "wc-4", label: "Employers Liability - Disease (Each Emp)" },
    { id: "wc-5", label: "Experience Modification Factor" },
    { id: "wc-6", label: "Officers Included/Excluded" },
    { id: "wc-7", label: "WC Premium" },
  ],
  "Commercial Property": [
    { id: "cp-h1", label: "Property Declarations", isHeader: true },
    { id: "cp-1", label: "Location Address" },
    { id: "cp-2", label: "Building Limit" },
    { id: "cp-3", label: "Business Personal Property Limit" },
    { id: "cp-4", label: "Deductible" },
    { id: "cp-h2", label: "Business Income", isHeader: true },
    { id: "cp-5", label: "BI Limit" },
    { id: "cp-6", label: "BI Coinsurance" },
    { id: "cp-7", label: "CP Premium" },
  ],
  "Umbrella / Excess": [
    { id: "umb-h1", label: "Umbrella Declarations", isHeader: true },
    { id: "umb-1", label: "Each Occurrence Limit" },
    { id: "umb-2", label: "Aggregate Limit" },
    { id: "umb-3", label: "Retained Limit / SIR" },
    { id: "umb-4", label: "Umbrella Premium" },
  ],
  "Professional Liability / E&O": [
    { id: "eo-h1", label: "E&O Declarations", isHeader: true },
    { id: "eo-1", label: "Each Claim Limit" },
    { id: "eo-2", label: "Aggregate Limit" },
    { id: "eo-3", label: "Retroactive Date" },
    { id: "eo-4", label: "Deductible" },
    { id: "eo-5", label: "E&O Premium" },
  ],
  "Cyber Liability": [
    { id: "cy-h1", label: "Cyber Declarations", isHeader: true },
    { id: "cy-1", label: "First Party Coverage Limit" },
    { id: "cy-2", label: "Third Party Liability Limit" },
    { id: "cy-3", label: "Ransomware / Extortion Limit" },
    { id: "cy-4", label: "Deductible" },
    { id: "cy-5", label: "Retroactive Date" },
    { id: "cy-6", label: "Cyber Premium" },
  ],
  "Directors & Officers (D&O)": [
    { id: "do-h1", label: "D&O Declarations", isHeader: true },
    { id: "do-1", label: "Limit of Liability" },
    { id: "do-2", label: "Retention (Individual)" },
    { id: "do-3", label: "Retention (Corporate)" },
    { id: "do-4", label: "Retroactive Date" },
    { id: "do-5", label: "D&O Premium" },
  ],
  "Crime / Fidelity": [
    { id: "cr-h1", label: "Crime Declarations", isHeader: true },
    { id: "cr-1", label: "Employee Dishonesty Limit" },
    { id: "cr-2", label: "Computer Fraud Limit" },
    { id: "cr-3", label: "Funds Transfer Fraud Limit" },
    { id: "cr-4", label: "Deductible" },
    { id: "cr-5", label: "Crime Premium" },
  ],
  "Employment Practices Liability": [
    { id: "ep-h1", label: "EPLI Declarations", isHeader: true },
    { id: "ep-1", label: "Each Claim Limit" },
    { id: "ep-2", label: "Aggregate Limit" },
    { id: "ep-3", label: "Retention" },
    { id: "ep-4", label: "Retroactive Date" },
    { id: "ep-5", label: "EPLI Premium" },
  ],
  "Inland Marine": [
    { id: "im-h1", label: "Inland Marine Declarations", isHeader: true },
    { id: "im-1", label: "Coverage Type" },
    { id: "im-2", label: "Limit of Insurance" },
    { id: "im-3", label: "Deductible" },
    { id: "im-4", label: "IM Premium" },
  ],
};

// Sample checklist data
let CHECKLISTS = load(KEYS.checklists, [
  {
    id: 1,
    insured: "Sunrise Logistics LLC",
    policy: "GL-2024-00142",
    lobs: ["General Liability"],
    status: "draft",
    updated: new Date(Date.now() - 86400000 * 2).toISOString(),
    user: "demo",
    term: "01/01/2024 – 01/01/2025",
    checkedby: "Demo",
    am: "Sarah Kim",
    date: "2024-03-15",
    entries: {},
    notes: "",
  },
]);

// Recently completed (expire after 5 days)
// Format: { checklistId, userId, completedAt: ISO string }
let RECENT_COMPLETED = load(KEYS.recent, []);

// Current session
let currentUser = null;
let currentFilter = "all";
let activeChecklistId = null;
let snapshotCount = 1;
let lobModalSelected = [];

// ══════════════════════════════════════════
// AUTH (Supabase)
// ══════════════════════════════════════════

async function buildCurrentUserFromSupabase(user) {
  // Default role if profiles lookup fails
  let role = "user";

  try {
    const { data: profile, error: pErr } = await supabase
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .single();

    if (!pErr && profile?.role) role = profile.role;
  } catch (e) {
    console.warn("profiles lookup failed:", e);
  }

  return {
    id: user.id,
    email: user.email,
    username: user.email, // keeps existing code working
    fullname: (user.email || "User").split("@")[0],
    role,
    created: "Supabase",
  };
}

async function doLogin() {
  const email = document.getElementById("login-user").value.trim();
  const password = document.getElementById("login-pass").value;
  const err = document.getElementById("login-err");
  const btn = document.getElementById("login-btn");

  err.classList.remove("show");
  err.textContent = "";

  try {
    btn.disabled = true;

    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error || !data?.user) {
      err.textContent = "Invalid email or password";
      err.classList.add("show");
      btn.style.background = "linear-gradient(135deg,#dc2626,#b91c1c)";
      setTimeout(() => {
        err.classList.remove("show");
        btn.style.background = "";
      }, 2500);
      return;
    }

    currentUser = await buildCurrentUserFromSupabase(data.user);
    store(KEYS.auth, currentUser);

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
  currentUser = null;
  sessionStorage.removeItem(KEYS.auth);
  await supabase.auth.signOut();
  goTo("login");
}

document.addEventListener("keydown", (e) => {
  if (
    e.key === "Enter" &&
    document.getElementById("screen-login")?.classList.contains("active")
  ) {
    doLogin();
  }
});

function setupUI() {
  const isAdmin = currentUser?.role === "admin";

  document.getElementById("user-badge-name").textContent =
    currentUser.fullname || currentUser.username;

  document.getElementById("user-avatar").textContent = (
    currentUser.fullname || currentUser.username
  )[0].toUpperCase();

  document.getElementById("admin-chip").style.display = isAdmin ? "" : "none";
  document.getElementById("nav-admin").style.display = isAdmin ? "" : "none";

  const h = new Date().getHours();
  const greet =
    h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";

  document.getElementById("dash-greeting").textContent = `${greet}, ${
    (currentUser.fullname || currentUser.username).split(" ")[0]
  } 👋`;

  populateNewLobDropdown();
}

// ══════════════════════════════════════════
// NAVIGATION
// ══════════════════════════════════════════

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
    document.getElementById("new-checkedby").value =
      currentUser?.fullname || currentUser?.username || "";
  } else if (tab === "editor") {
    document.getElementById("tab-editor").style.display = "flex";
    document.getElementById("nav-dash").classList.add("active");
    renderEditor();
  } else if (tab === "admin") {
    if (currentUser?.role !== "admin") {
      showToast("⛔ Admin access only");
      return;
    }
    document.getElementById("tab-admin").style.display = "";
    document.getElementById("nav-admin").classList.add("active");
    renderAdmin();
  }
}

function switchEditorTab(tab) {
  document.getElementById("editor-panel-checklist").style.display =
    tab === "checklist" ? "" : "none";
  document.getElementById("editor-panel-snapshots").style.display =
    tab === "snapshots" ? "" : "none";
  document.getElementById("editor-tab-checklist").classList.toggle("active", tab === "checklist");
  document.getElementById("editor-tab-snapshots").classList.toggle("active", tab === "snapshots");
}

function switchAdminTab(tab) {
  ["stats", "users", "lobs"].forEach((t) => {
    const panel = document.getElementById("admin-panel-" + t);
    if (panel) panel.style.display = t === tab ? "" : "none";
    const btn = document.getElementById("admin-tab-" + t);
    if (btn) btn.classList.toggle("active", t === tab);
  });
  if (tab === "lobs") renderLobManagement();
  if (tab === "users") renderAdminUsers();
}

// ══════════════════════════════════════════
// DASHBOARD
// ══════════════════════════════════════════

function renderDashboard() {
  cleanExpiredRecent();
  renderRecentStrip();
  renderChecklistGrid("");
}

function cleanExpiredRecent() {
  const fiveDays = 5 * 24 * 60 * 60 * 1000;
  const now = Date.now();
  RECENT_COMPLETED = RECENT_COMPLETED.filter(
    (r) => now - new Date(r.completedAt).getTime() < fiveDays
  );
  store(KEYS.recent, RECENT_COMPLETED);
}

function renderRecentStrip() {
  const myRecent = RECENT_COMPLETED.filter((r) => r.userId === currentUser.username);
  const section = document.getElementById("recent-section");
  const strip = document.getElementById("recent-strip");

  if (myRecent.length === 0) {
    section.style.display = "none";
    return;
  }
  section.style.display = "";

  strip.innerHTML = myRecent
    .map((r) => {
      const cl = CHECKLISTS.find((c) => c.id === r.checklistId);
      if (!cl) return "";
      const daysLeft = Math.ceil(
        (5 * 86400000 - (Date.now() - new Date(r.completedAt).getTime())) / 86400000
      );
      return `<div class="recent-card" onclick="openChecklist(${cl.id})">
        <div class="recent-expire-badge">${daysLeft}d left</div>
        <div class="recent-card-insured">${cl.insured}</div>
        <div class="recent-card-policy">${cl.policy}</div>
        <div class="recent-card-meta">✅ Completed · ${cl.lobs.join(", ")}</div>
      </div>`;
    })
    .join("");
}

function renderChecklistGrid(searchVal) {
  const grid = document.getElementById("checklist-grid");
  let list = CHECKLISTS;

  // Admin sees all, users see only their own
  if (currentUser?.role !== "admin") {
    list = list.filter((c) => c.user === currentUser.username);
  }

  if (currentFilter !== "all") list = list.filter((c) => c.status === currentFilter);
  if (searchVal) {
    const s = searchVal.toLowerCase();
    list = list.filter(
      (c) => c.insured.toLowerCase().includes(s) || c.policy.toLowerCase().includes(s)
    );
  }

  if (list.length === 0) {
    grid.innerHTML = `<div class="empty-state" style="grid-column:1/-1"><div class="empty-state-icon">📋</div><p style="font-weight:700;font-size:16px">No checklists found</p><p style="margin-top:6px;font-size:13px">Create your first checklist to get started</p></div>`;
    return;
  }

  grid.innerHTML = list
    .map((cl) => {
      const lobDisplay =
        cl.lobs.slice(0, 2).join(", ") + (cl.lobs.length > 2 ? ` +${cl.lobs.length - 2}` : "");
      const date = new Date(cl.updated).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
      });
      return `<div class="cl-card" onclick="openChecklist(${cl.id})">
        <div class="cl-card-top">
          <div>
            <div class="cl-insured">${cl.insured}</div>
            <div class="cl-policy">${cl.policy}</div>
          </div>
          <span class="status-chip ${cl.status === "complete" ? "chip-complete" : "chip-draft"}">${
        cl.status
      }</span>
        </div>
        <div class="cl-meta">📅 ${date}</div>
        <div class="cl-meta">👤 ${cl.user}</div>
        <div class="cl-footer">
          <span class="cl-lob">${lobDisplay}</span>
          <button class="icon-btn" title="Delete" onclick="event.stopPropagation();deleteChecklist(${
            cl.id
          })">🗑</button>
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
  renderChecklistGrid(document.getElementById("search-input").value);
}

function openChecklist(id) {
  activeChecklistId = id;
  showTab("editor");
}

function deleteChecklist(id) {
  if (!confirm("Delete this checklist? This cannot be undone.")) return;
  CHECKLISTS = CHECKLISTS.filter((c) => c.id !== id);
  store(KEYS.checklists, CHECKLISTS);
  RECENT_COMPLETED = RECENT_COMPLETED.filter((r) => r.checklistId !== id);
  store(KEYS.recent, RECENT_COMPLETED);
  renderDashboard();
  showToast("Checklist deleted");
}

// ══════════════════════════════════════════
// NEW CHECKLIST
// ══════════════════════════════════════════

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
    o.value = l.id;
    o.textContent = l.name;
    sel.appendChild(o);
  });

  sel.addEventListener("change", () => {
    document.getElementById("new-lob-note").style.display = sel.value ? "" : "none";
  });
}

function createChecklist() {
  const insured = document.getElementById("new-insured").value.trim();
  const policy = document.getElementById("new-policy").value.trim();
  const term = document.getElementById("new-term").value.trim();
  const date = document.getElementById("new-date").value;
  const checkedby = document.getElementById("new-checkedby").value.trim();
  const am = document.getElementById("new-am").value.trim();
  const lobVal = document.getElementById("new-lob").value;

  if (!insured) {
    showToast("⚠ Insured Name is required");
    return;
  }
  if (!lobVal) {
    showToast("⚠ Please select a LOB");
    return;
  }

  let lobs = [];
  if (lobVal === "PKG") {
    openLobSelectionModal(() => {
      doCreateChecklist(
        insured,
        policy,
        term,
        date,
        checkedby,
        am,
        lobModalSelected.length ? lobModalSelected : ["General Liability"]
      );
    });
    return;
  } else {
    const lobObj = ALL_LOBS.find((l) => l.id === lobVal);
    lobs = [lobObj ? lobObj.name : lobVal];
  }

  doCreateChecklist(insured, policy, term, date, checkedby, am, lobs);
}

let _createCallback = null;

function openLobSelectionModal(cb) {
  _createCallback = cb;
  lobModalSelected = [];
  const list = document.getElementById("new-lob-modal-list");
  list.innerHTML = ALL_LOBS.filter((l) => !l.locked)
    .map(
      (l) => `
    <div class="modal-item" onclick="toggleNewLob('${l.id}',this,'${l.name}')">
      <span>${l.name}</span>
      <span class="modal-check" style="display:none">✓</span>
    </div>
  `
    )
    .join("");
  openModal("new-lob-modal");
}

function toggleNewLob(id, el, name) {
  const idx = lobModalSelected.indexOf(name);
  if (idx > -1) {
    lobModalSelected.splice(idx, 1);
    el.classList.remove("selected");
    el.querySelector(".modal-check").style.display = "none";
  } else {
    lobModalSelected.push(name);
    el.classList.add("selected");
    el.querySelector(".modal-check").style.display = "";
  }
}

function applyNewLobSelection() {
  closeModal("new-lob-modal");
  if (_createCallback) _createCallback();
}

function doCreateChecklist(insured, policy, term, date, checkedby, am, lobs) {
  const id = Date.now();
  const cl = {
    id,
    insured,
    policy,
    term,
    date,
    checkedby,
    am,
    lobs,
    status: "draft",
    updated: new Date().toISOString(),
    user: currentUser.username,
    entries: {},
    notes: "",
  };
  CHECKLISTS.unshift(cl);
  store(KEYS.checklists, CHECKLISTS);
  activeChecklistId = id;
  showTab("editor");
  showToast("✓ Checklist created");
}

// ══════════════════════════════════════════
// EDITOR
// ══════════════════════════════════════════

function renderEditor() {
  const cl = CHECKLISTS.find((c) => c.id === activeChecklistId);
  if (!cl) {
    showTab("dashboard");
    return;
  }

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
  document.getElementById("ed-lob-tags").innerHTML = cl.lobs
    .map((l) => `<span class="pkg-tag">${l}</span>`)
    .join("");

  renderCoverageSections(cl);
  renderSnapshots();
  updateProgress(cl);
}

function renderCoverageSections(cl) {
  if (!cl) cl = CHECKLISTS.find((c) => c.id === activeChecklistId);
  if (!cl) return;

  const allSections = ["Common Declarations", ...cl.lobs];
  const container = document.getElementById("coverage-sections");

  container.innerHTML = allSections
    .map((sName) => {
      const fields = COVERAGE_FIELDS[sName];
      if (!fields)
        return `<div class="section-wrap"><div class="section-header" style="background:linear-gradient(135deg,#374151,#4b5563)"><span class="section-name">${sName}</span><span style="color:rgba(255,255,255,.5);font-size:12px">No fields defined</span></div></div>`;

      const rows = fields
        .map((f) => {
          if (f.isHeader) return `<tr class="header-row"><td colspan="7">${f.label}</td></tr>`;
          const e = (cl.entries && cl.entries[f.id]) || {};
          const statusCls =
            { Match: "ss-match", "Not Match": "ss-notmatch", "Not Found": "ss-notfound", "N/A": "ss-na" }[
              e.status || "N/A"
            ] || "ss-na";
          const isLocked = e.status === "Match" || e.status === "N/A";
          const isNotMatch = e.status === "Not Match";
          const rowCls = isLocked ? "row-locked" : isNotMatch ? "row-notmatch" : "";
          const readonly = isLocked ? "readonly" : "";

          return `<tr class="${rowCls}" id="row-${f.id}">
            <td style="width:26%;font-size:12px;font-weight:500;padding:6px 10px">${f.label}</td>
            <td style="width:6%;text-align:center"><input class="cell-input cell-pg" value="${e.pg || ""}" oninput="updateEntry('${f.id}','pg',this.value)" placeholder="—"/></td>
            <td style="width:18%"><input class="cell-input" value="${e.pol || ""}" oninput="updateEntry('${f.id}','pol',this.value)" placeholder="Policy data" ${readonly}/></td>
            <td style="width:18%"><input class="cell-input" value="${e.nex || ""}" oninput="updateEntry('${f.id}','nex',this.value)" placeholder="Nexsure data" ${readonly}/></td>
            <td style="width:12%;text-align:center">
              <select class="status-select ${statusCls}" onchange="updateStatusAndRow('${f.id}',this)">
                <option ${e.status === "Match" ? "selected" : ""}>Match</option>
                <option ${e.status === "Not Match" ? "selected" : ""}>Not Match</option>
                <option ${e.status === "Not Found" ? "selected" : ""}>Not Found</option>
                <option ${(e.status === "N/A" || !e.status) ? "selected" : ""}>N/A</option>
              </select>
            </td>
            <td style="width:12%"><input class="cell-input" value="${e.skyComments || ""}" oninput="updateEntry('${f.id}','skyComments',this.value)" placeholder="Sky Source…"/></td>
            <td style="width:8%"><input class="cell-input" value="${e.amComments || ""}" oninput="updateEntry('${f.id}','amComments',this.value)" placeholder="AM…"/></td>
          </tr>`;
        })
        .join("");

      return `<div class="section-wrap">
        <div class="section-header" onclick="toggleSection(this)">
          <span class="section-name">${sName}${
        sName === "Common Declarations"
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

function updateEntry(fId, field, val) {
  const cl = CHECKLISTS.find((c) => c.id === activeChecklistId);
  if (!cl) return;
  if (!cl.entries) cl.entries = {};
  if (!cl.entries[fId]) cl.entries[fId] = {};
  cl.entries[fId][field] = val;
  cl.updated = new Date().toISOString();
  store(KEYS.checklists, CHECKLISTS);
  showSaved();
  updateProgress(cl);
}

function updateStatusAndRow(fId, sel) {
  const cl = CHECKLISTS.find((c) => c.id === activeChecklistId);
  if (!cl) return;
  if (!cl.entries) cl.entries = {};
  if (!cl.entries[fId]) cl.entries[fId] = {};

  cl.entries[fId].status = sel.value;

  const cls =
    { Match: "ss-match", "Not Match": "ss-notmatch", "Not Found": "ss-notfound", "N/A": "ss-na" }[
      sel.value
    ] || "ss-na";
  sel.className = "status-select " + cls;

  cl.updated = new Date().toISOString();
  store(KEYS.checklists, CHECKLISTS);
  showSaved();
  updateProgress(cl);

  const row = document.getElementById("row-" + fId);
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
  const allSections = ["Common Declarations", ...cl.lobs];
  let total = 0,
    filled = 0;

  allSections.forEach((sName) => {
    const fields = COVERAGE_FIELDS[sName] || [];
    fields
      .filter((f) => !f.isHeader)
      .forEach((f) => {
        total++;
        const e = cl.entries?.[f.id];
        if (e && (e.pol || e.nex || e.status !== "N/A")) filled++;
      });
  });

  const pct = total > 0 ? Math.round((filled / total) * 100) : 0;
  const fill = document.getElementById("progress-fill");
  const label = document.getElementById("progress-label");
  if (fill) fill.style.width = pct + "%";
  if (label) label.textContent = pct + "%";
}

function saveHeaderFields() {
  const cl = CHECKLISTS.find((c) => c.id === activeChecklistId);
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
  store(KEYS.checklists, CHECKLISTS);
}

["ed-insured", "ed-policy", "ed-term", "ed-date", "ed-checkedby", "ed-am", "checklist-notes"].forEach(
  (id) => {
    document.getElementById(id)?.addEventListener("input", saveHeaderFields);
  }
);

let saveTimer;
function showSaved() {
  const ind = document.getElementById("save-indicator");
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

function markComplete() {
  const cl = CHECKLISTS.find((c) => c.id === activeChecklistId);
  if (!cl) return;

  cl.status = "complete";
  cl.updated = new Date().toISOString();
  store(KEYS.checklists, CHECKLISTS);

  RECENT_COMPLETED = RECENT_COMPLETED.filter((r) => r.checklistId !== cl.id);
  RECENT_COMPLETED.unshift({
    checklistId: cl.id,
    userId: currentUser.username,
    completedAt: new Date().toISOString(),
  });
  store(KEYS.recent, RECENT_COMPLETED);

  document.getElementById("complete-banner").style.display = "";
  showToast("✅ Marked as complete! Added to recent completions for 5 days.");
}

function resetEditor() {
  if (!confirm("Reset all entries in this checklist?")) return;
  const cl = CHECKLISTS.find((c) => c.id === activeChecklistId);
  if (!cl) return;
  cl.entries = {};
  cl.notes = "";
  store(KEYS.checklists, CHECKLISTS);
  renderEditor();
  showToast("↺ Checklist reset");
}

// ══════════════════════════════════════════
// MODALS (LOB selection)
// ══════════════════════════════════════════

let editorLobSelected = [];

function openModal(id) {
  if (id === "lob-modal") {
    const cl = CHECKLISTS.find((c) => c.id === activeChecklistId);
    editorLobSelected = cl ? [...cl.lobs] : [];
    renderLobModalList("");
  }
  document.getElementById(id).classList.add("open");
}
function closeModal(id) {
  document.getElementById(id).classList.remove("open");
}

function renderLobModalList(search) {
  const list = document.getElementById("lob-modal-list");
  if (!list) return;
  const filtered = ALL_LOBS.filter(
    (l) => !l.locked && l.name.toLowerCase().includes(search.toLowerCase())
  );

  list.innerHTML = filtered
    .map((l) => {
      const sel = editorLobSelected.includes(l.name);
      return `<div class="modal-item ${sel ? "selected" : ""}" onclick="toggleEditorLob('${l.name}',this)">
        <span>${l.name}</span>
        <span class="modal-check" style="display:${sel ? "" : "none"}">✓</span>
      </div>`;
    })
    .join("");

  document.getElementById("lob-modal-apply").textContent = `Apply (${editorLobSelected.length} selected)`;
}

function filterLobModal(val) {
  renderLobModalList(val);
}

function toggleEditorLob(name, el) {
  const idx = editorLobSelected.indexOf(name);
  if (idx > -1) {
    editorLobSelected.splice(idx, 1);
    el.classList.remove("selected");
    el.querySelector(".modal-check").style.display = "none";
  } else {
    editorLobSelected.push(name);
    el.classList.add("selected");
    el.querySelector(".modal-check").style.display = "";
  }
  document.getElementById("lob-modal-apply").textContent = `Apply (${editorLobSelected.length} selected)`;
}

function applyLobSelection() {
  closeModal("lob-modal");
  if (editorLobSelected.length === 0) {
    showToast("⚠ Select at least one LOB");
    return;
  }
  const cl = CHECKLISTS.find((c) => c.id === activeChecklistId);
  if (!cl) return;
  cl.lobs = [...editorLobSelected];
  store(KEYS.checklists, CHECKLISTS);
  document.getElementById("ed-lob-display").textContent = cl.lobs.join(", ");
  document.getElementById("ed-lob-tags").innerHTML = cl.lobs
    .map((l) => `<span class="pkg-tag">${l}</span>`)
    .join("");
  renderCoverageSections(cl);
  showToast(`✓ LOBs updated: ${cl.lobs.join(", ")}`);
}

// ══════════════════════════════════════════
// SNAPSHOTS (same as your v3 behavior)
// ══════════════════════════════════════════

function renderSnapshots() {
  const container = document.getElementById("snapshots-container");
  if (snapshotCount === 0) {
    container.innerHTML = `<div class="snap-empty"><div style="font-size:40px;opacity:.2;margin-bottom:12px">🖼️</div><p style="font-weight:700;font-size:15px">No snapshots yet</p><p style="font-size:13px;margin-top:6px;color:var(--muted)">Add snapshots to compare policy documents with Nexsure data</p></div>`;
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
// ADMIN (for now: LOB mgmt works; user mgmt should be done in Supabase dashboard)
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

  document.getElementById("admin-stat-grid").innerHTML = `
    <div class="stat-card stat-1"><div class="stat-label">Total Checklists</div><div class="stat-value">${CHECKLISTS.length}</div><div class="stat-trend">↑ Active</div></div>
    <div class="stat-card stat-2"><div class="stat-label">Supabase Users</div><div class="stat-value">—</div><div class="stat-trend">Manage in Supabase</div></div>
    <div class="stat-card stat-3"><div class="stat-label">Completed</div><div class="stat-value">${completed}</div><div class="stat-trend">${CHECKLISTS.length - completed} drafts</div></div>
    <div class="stat-card stat-4"><div class="stat-label">LOBs Active</div><div class="stat-value">${totalLobs}</div><div class="stat-trend">+ 1 locked (COM)</div></div>
  `;

  const recent = [...CHECKLISTS]
    .sort((a, b) => new Date(b.updated) - new Date(a.updated))
    .slice(0, 5);

  document.getElementById("admin-recent-body").innerHTML = recent
    .map((cl) => {
      const date = new Date(cl.updated).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
      });
      return `<tr>
        <td><b>${cl.insured}</b><div style="font-size:11px;color:var(--vivid);font-family:monospace">${cl.policy}</div></td>
        <td>${cl.user}</td>
        <td><span class="pkg-tag">${cl.lobs.join(", ")}</span></td>
        <td><span class="status-chip ${cl.status === "complete" ? "chip-complete" : "chip-draft"}">${cl.status}</span></td>
        <td style="color:var(--muted);font-size:12px">${date}</td>
      </tr>`;
    })
    .join("");
}

function renderAdminUsers() {
  // IMPORTANT: Without a backend/service role key, you cannot create/manage Supabase users from the browser safely.
  // So we show a friendly message.
  const body = document.getElementById("admin-users-body");
  if (body) {
    body.innerHTML = `<tr><td colspan="6" style="padding:14px;color:var(--muted);font-size:13px">
      Manage users inside Supabase Dashboard → Authentication → Users.<br/>
      (Later we can add a secure admin API using Supabase Edge Functions.)
    </td></tr>`;
  }
}

function renderLobManagement() {
  const list = document.getElementById("lob-manage-list");
  list.innerHTML = ALL_LOBS
    .map(
      (l, i) => `
    <div class="lob-manage-card">
      <div style="font-size:18px">${l.locked ? "🔒" : "📋"}</div>
      <div class="lob-manage-name">${l.name}</div>
      <span class="pkg-tag" style="margin-right:8px">${l.code}</span>
      <div class="lob-manage-fields">${(COVERAGE_FIELDS[l.name] || []).filter((f) => !f.isHeader).length} fields</div>
      <button onclick="openLobFieldsEditor('${l.name.replace(/'/g, "\\'")}',${i})" class="lob-edit-btn">✏ Edit Fields</button>
      ${
        l.locked
          ? '<span class="lob-locked-badge">LOCKED</span>'
          : `<button onclick="deleteLOB(${i})" style="background:none;border:1.5px solid #fca5a5;border-radius:8px;color:#dc2626;padding:4px 10px;font-size:12px;cursor:pointer;font-family:inherit">Remove</button>`
      }
    </div>
  `
    )
    .join("");
}

function addNewLOB() {
  const name = document.getElementById("new-lob-name").value.trim();
  const code = document.getElementById("new-lob-code").value.trim().toUpperCase();
  if (!name || !code) {
    showToast("⚠ LOB name and code required");
    return;
  }
  if (ALL_LOBS.find((l) => l.name === name)) {
    showToast("⚠ LOB already exists");
    return;
  }
  const id = name.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "");
  ALL_LOBS.push({ id, name, code, locked: false });
  if (!COVERAGE_FIELDS[name]) COVERAGE_FIELDS[name] = [];
  store(KEYS.lobs, ALL_LOBS);
  closeModal("add-lob-modal");
  document.getElementById("new-lob-name").value = "";
  document.getElementById("new-lob-code").value = "";
  renderLobManagement();
  populateNewLobDropdown();
  showToast(`✓ LOB "${name}" added — add fields below`);
  setTimeout(() => openLobFieldsEditor(name, ALL_LOBS.length - 1), 300);
}

function deleteLOB(i) {
  if (ALL_LOBS[i].locked) {
    showToast("⚠ This LOB is locked");
    return;
  }
  if (!confirm(`Remove LOB "${ALL_LOBS[i].name}"?`)) return;
  ALL_LOBS.splice(i, 1);
  store(KEYS.lobs, ALL_LOBS);
  renderLobManagement();
  populateNewLobDropdown();
  showToast("LOB removed");
}

// ══════════════════════════════════════════
// LOB FIELDS EDITOR
// ══════════════════════════════════════════

let _editingLobName = "";

function openLobFieldsEditor(name) {
  _editingLobName = name;
  document.getElementById("lob-fields-modal-title").textContent = `Edit Fields — ${name}`;
  renderLobFieldsEditor();
  openModal("lob-fields-modal");
}

function renderLobFieldsEditor() {
  const fields = COVERAGE_FIELDS[_editingLobName] || [];
  const body = document.getElementById("lob-fields-modal-body");
  body.innerHTML =
    fields.length === 0
      ? `<div style="text-align:center;padding:24px;color:var(--muted);font-size:13px">No fields yet. Add fields below.</div>`
      : "";
  body.innerHTML += fields
    .map(
      (f, i) => `
    <div class="lob-field-row" id="lf-row-${i}">
      <span class="lob-field-type-tag ${f.isHeader ? "header-tag" : ""}">${
        f.isHeader ? "HEADER" : "FIELD"
      }</span>
      <input value="${f.label}" oninput="updateLobFieldLabel(${i},this.value)" placeholder="Field label"/>
      <button class="lob-field-del" onclick="deleteLobField(${i})">🗑</button>
    </div>
  `
    )
    .join("");
}

function updateLobFieldLabel(i, val) {
  if (!COVERAGE_FIELDS[_editingLobName]) return;
  COVERAGE_FIELDS[_editingLobName][i].label = val;
}

function deleteLobField(i) {
  if (!COVERAGE_FIELDS[_editingLobName]) return;
  COVERAGE_FIELDS[_editingLobName].splice(i, 1);
  renderLobFieldsEditor();
}

function addLobField(isHeader) {
  if (!COVERAGE_FIELDS[_editingLobName]) COVERAGE_FIELDS[_editingLobName] = [];
  const fields = COVERAGE_FIELDS[_editingLobName];
  const prefix = _editingLobName.toLowerCase().replace(/\s+/g, "-").slice(0, 4);
  const id = `${prefix}-${Date.now()}`;
  fields.push({
    id,
    label: isHeader ? "New Section Header" : "New Field",
    isHeader: !!isHeader,
  });
  renderLobFieldsEditor();
  setTimeout(() => {
    const rows = document.querySelectorAll(".lob-field-row");
    const last = rows[rows.length - 1];
    last?.querySelector("input")?.focus();
  }, 50);
}

function saveLobFields() {
  store(KEYS.lobs, ALL_LOBS);
  closeModal("lob-fields-modal");
  renderLobManagement();
  const cl = CHECKLISTS.find((c) => c.id === activeChecklistId);
  if (cl) renderCoverageSections(cl);
  showToast(`✓ Fields saved for ${_editingLobName}`);
}

// ══════════════════════════════════════════
// TOAST
// ══════════════════════════════════════════

let toastTimer;
function showToast(msg) {
  const t = document.getElementById("toast");
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
    store(KEYS.auth, currentUser);
    setupUI();
    goTo("dashboard");
  } else {
    goTo("login");
  }

  supabase.auth.onAuthStateChange(async (_event, session) => {
    if (session?.user) {
      currentUser = await buildCurrentUserFromSupabase(session.user);
      store(KEYS.auth, currentUser);
      setupUI();
      goTo("dashboard");
    } else {
      currentUser = null;
      sessionStorage.removeItem(KEYS.auth);
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

// --- Expose functions used by inline HTML handlers ---
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
window.deleteLOB = deleteLOB;
window.openLobFieldsEditor = openLobFieldsEditor;
window.addLobField = addLobField;
window.deleteLobField = deleteLobField;
window.updateLobFieldLabel = updateLobFieldLabel;
window.saveLobFields = saveLobFields;
