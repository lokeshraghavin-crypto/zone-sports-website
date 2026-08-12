/* =====================================================================
   ZONE SPORTS & ATHLETIC MEET MANAGEMENT SYSTEM - app.js (Web Edition)
   Client-side engine: public live dashboard + login + 5 role dashboards.
   Talks to the Node/Express REST API in server.js via fetch().
===================================================================== */

// ---------------------------------------------------------------------
// 0. GLOBAL STATE + TRANSPORT LAYER
// ---------------------------------------------------------------------
var SESSION_TOKEN = null;
var CURRENT_USER = null;
var APP_ACTIVE_TAB = null;
var APP_STATE_CACHE = {};

function apiFetch(method, url, body, token) {
  var opts = { method: method, headers: {} };
  if (token) opts.headers['Authorization'] = 'Bearer ' + token;
  if (body !== undefined) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }
  return fetch(url, opts).then(function (res) {
    return res.json().catch(function () { return {}; }).then(function (data) {
      if (!res.ok) {
        var err = new Error(data.error || data.message || ('Request failed (' + res.status + ')'));
        return Promise.reject(err);
      }
      return data;
    });
  });
}

// Maps every server-side "action name" used throughout this file to the
// matching REST call. Keeping this indirection means every render/save
// function below reads exactly like the original single-file build.
var API_MAP = {
  validateSession: function (token) { return apiFetch('GET', '/api/auth/session', undefined, token); },
  loginUser: function (id, password) { return apiFetch('POST', '/api/auth/login', { id: id, password: password }); },
  logoutUser: function (token) { return apiFetch('POST', '/api/auth/logout', {}, token); },
  getMyInchargeStations: function (token) { return apiFetch('GET', '/api/my-incharge-stations', undefined, token); },
  getModuleData: function (token, moduleName) { return apiFetch('GET', '/api/module/' + encodeURIComponent(moduleName), undefined, token); },
  uploadPhoto: function (token, base64, filename, mimetype, folder) { return apiFetch('POST', '/api/upload-photo', { base64: base64, filename: filename, mimetype: mimetype, folder: folder }, token); },
  saveStudent: function (token, payload) { return apiFetch('POST', '/api/students', payload, token); },
  deleteStudent: function (token, studentId) { return apiFetch('DELETE', '/api/students/' + encodeURIComponent(studentId), undefined, token); },
  getEventEntries: function (token, eventId) { return apiFetch('GET', '/api/event-entries/' + encodeURIComponent(eventId), undefined, token); },
  saveEventEntries: function (token, eventId, studentIds) { return apiFetch('POST', '/api/event-entries', { eventId: eventId, studentIds: studentIds }, token); },
  getUpcomingEvents: function (token) { return apiFetch('GET', '/api/upcoming-events', undefined, token); },
  getEventVerificationBoard: function (token, eventId) { return apiFetch('GET', '/api/verification-board/' + encodeURIComponent(eventId), undefined, token); },
  verifyEventEntry: function (token, entryId, verified, remarks) { return apiFetch('POST', '/api/verify-entry', { entryId: entryId, verified: verified, remarks: remarks }, token); },
  getFinishLineBoard: function (token, eventId) { return apiFetch('GET', '/api/finish-board/' + encodeURIComponent(eventId), undefined, token); },
  saveEventResult: function (token, payload) { return apiFetch('POST', '/api/results', payload, token); },
  markDutyAttendance: function (token, dutyId, status) { return apiFetch('POST', '/api/duties/' + encodeURIComponent(dutyId) + '/attendance', { status: status }, token); },
  acknowledgeDuty: function (token, dutyId) { return apiFetch('POST', '/api/duties/' + encodeURIComponent(dutyId) + '/acknowledge', {}, token); },
  completeDuty: function (token, dutyId) { return apiFetch('POST', '/api/duties/' + encodeURIComponent(dutyId) + '/complete', {}, token); },
  generateDutyCertificate: function (token, dutyId) { return apiFetch('POST', '/api/certificates/duty/' + encodeURIComponent(dutyId), {}, token); },
  generateStudentCertificate: function (token, resultId) { return apiFetch('POST', '/api/certificates/student/' + encodeURIComponent(resultId), {}, token); },
  saveSchool: function (token, payload) { return apiFetch('POST', '/api/schools', payload, token); },
  deleteSchool: function (token, schoolId) { return apiFetch('DELETE', '/api/schools/' + encodeURIComponent(schoolId), undefined, token); },
  getTeachersForAdmin: function (token) { return apiFetch('GET', '/api/teachers', undefined, token); },
  saveTeacher: function (token, payload) { return apiFetch('POST', '/api/teachers', payload, token); },
  ensureTeacherLogin: function (token, teacherId) { return apiFetch('POST', '/api/teachers/' + encodeURIComponent(teacherId) + '/ensure-login', {}, token); },
  getEventSchedules: function (token) { return apiFetch('GET', '/api/schedules', undefined, token); },
  saveEvent: function (token, payload) { return apiFetch('POST', '/api/events', payload, token); },
  saveEventSchedule: function (token, payload) { return apiFetch('POST', '/api/schedules', payload, token); },
  finalizeEventAndGenerateCertificates: function (token, eventId) { return apiFetch('POST', '/api/events/' + encodeURIComponent(eventId) + '/finalize', {}, token); },
  assignDutyToTeacher: function (token, payload) { return apiFetch('POST', '/api/duties/assign', payload, token); },
  approveResult: function (token, resultId) { return apiFetch('POST', '/api/results/' + encodeURIComponent(resultId) + '/approve', {}, token); },
  approveCertificate: function (token, certId) { return apiFetch('POST', '/api/certificates/' + encodeURIComponent(certId) + '/approve', {}, token); },
  bulkImportSchools: function (token, rows) { return apiFetch('POST', '/api/bulk/schools', { rows: rows }, token); },
  bulkImportTeachers: function (token, rows) { return apiFetch('POST', '/api/bulk/teachers', { rows: rows }, token); },
  bulkImportEvents: function (token, rows) { return apiFetch('POST', '/api/bulk/events', { rows: rows }, token); }
};

function gsRun(fnName) {
  var args = Array.prototype.slice.call(arguments, 1);
  var handler = API_MAP[fnName];
  if (!handler) return Promise.reject({ message: 'Unknown operation: ' + fnName });
  return handler.apply(null, args);
}

function escapeHtml(str) {
  if (str === null || str === undefined) return "";
  return String(str)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#039;");
}

function fmtDate(v) {
  if (!v) return "-";
  var d = new Date(v);
  if (isNaN(d.getTime())) return String(v);
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

function showAppToast(msg, isError) {
  var t = document.getElementById('toast');
  var m = document.getElementById('toast-msg');
  if (!t || !m) return;
  if (isError) console.error('[Zone Sports Portal]', msg);
  m.innerText = msg;
  var box = t.querySelector('div');
  box.style.background = isError ? '#dc2626' : '#f59e0b';
  box.style.color = '#fff';
  box.style.cursor = 'pointer';
  box.onclick = function () { t.classList.replace('toast-enter', 'toast-exit'); };
  t.classList.replace('toast-exit', 'toast-enter');
  if (window.__toastTimer) clearTimeout(window.__toastTimer);
  window.__toastTimer = setTimeout(function () { t.classList.replace('toast-enter', 'toast-exit'); }, isError ? 15000 : 4000);
}

// Minimal RFC4180-style CSV parser (handles quoted fields, embedded
// commas/quotes, \r\n or \n line endings). Returns an array of row
// objects keyed by the header row.
function parseCSV(text) {
  text = String(text || "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  var rows = [];
  var row = [];
  var field = "";
  var inQuotes = false;
  for (var i = 0; i < text.length; i++) {
    var c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else { inQuotes = false; }
      } else { field += c; }
    } else {
      if (c === '"') inQuotes = true;
      else if (c === ',') { row.push(field); field = ""; }
      else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ""; }
      else { field += c; }
    }
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  rows = rows.filter(function (r) { return !(r.length === 1 && r[0].trim() === ""); });
  if (!rows.length) return [];

  var headers = rows[0].map(function (h) { return h.trim(); });
  return rows.slice(1).map(function (r) {
    var obj = {};
    headers.forEach(function (h, idx) { obj[h] = (r[idx] || "").trim(); });
    return obj;
  });
}

function openModal(titleHtml, bodyHtml, footerHtml) {
  var root = document.getElementById('app-modal-root');
  root.innerHTML =
    '<div class="modal-backdrop" id="genericModalBackdrop">' +
    '  <div class="navy-card rounded-2xl w-full max-w-lg p-5 md:p-6 relative border border-slate-700 shadow-2xl max-h-[92vh] overflow-y-auto custom-scrollbar">' +
    '    <button onclick="closeModal()" class="absolute top-4 right-4 text-slate-400 hover:text-white bg-slate-800 w-8 h-8 rounded-full flex items-center justify-center font-bold">&#10005;</button>' +
    '    <h3 class="text-lg font-black text-white uppercase mb-4 pr-8">' + titleHtml + '</h3>' +
    '    <div id="genericModalBody">' + bodyHtml + '</div>' +
    '    <div id="genericModalFooter" class="mt-5 flex gap-2 justify-end">' + (footerHtml || '') + '</div>' +
    '  </div>' +
    '</div>';
  document.getElementById('genericModalBackdrop').addEventListener('click', function (e) {
    if (e.target.id === 'genericModalBackdrop') closeModal();
  });
}

function closeModal() {
  document.getElementById('app-modal-root').innerHTML = '';
}

function fileToBase64(file) {
  return new Promise(function (resolve, reject) {
    var reader = new FileReader();
    reader.onload = function () { resolve(reader.result); };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function badge(text, kind) {
  var cls = kind === 'green' ? 'badge-green' : kind === 'red' ? 'badge-red' : kind === 'amber' ? 'badge-amber' : 'badge-slate';
  return '<span class="badge ' + cls + '">' + escapeHtml(text) + '</span>';
}

// ---------------------------------------------------------------------
// 1. VIEW SWITCHING
// ---------------------------------------------------------------------
function showPublicView() {
  document.getElementById('view-public').classList.remove('hidden');
  document.getElementById('view-login').classList.add('hidden');
  document.getElementById('view-app').classList.add('hidden');
  window.scrollTo(0, 0);
  renderHeaderAuthSlot();
}

function showLoginView() {
  document.getElementById('view-public').classList.add('hidden');
  document.getElementById('view-login').classList.remove('hidden');
  document.getElementById('view-app').classList.add('hidden');
  var idEl = document.getElementById('login-id');
  if (idEl) setTimeout(function () { idEl.focus(); }, 50);
}

function showAppView() {
  document.getElementById('view-public').classList.add('hidden');
  document.getElementById('view-login').classList.add('hidden');
  document.getElementById('view-app').classList.remove('hidden');
  renderAppShellForRole();
}

function renderHeaderAuthSlot() {
  var slot = document.getElementById('header-auth-slot');
  if (!slot) return;
  if (CURRENT_USER) {
    slot.innerHTML =
      '<button onclick="showAppView()" class="bg-amber-500 text-slate-950 px-3 py-1.5 rounded-full font-black text-[10px] uppercase shadow flex items-center gap-1"><i class="fa-solid fa-gauge"></i> My Dashboard</button>' +
      '<button onclick="doLogout()" class="bg-slate-800 border border-slate-700 text-slate-300 px-3 py-1.5 rounded-full font-black text-[10px] uppercase shadow"><i class="fa-solid fa-right-from-bracket"></i></button>';
  } else {
    slot.innerHTML = '';
  }
}

// ---------------------------------------------------------------------
// 2. AUTHENTICATION
// ---------------------------------------------------------------------
function restoreSession() {
  try {
    var token = sessionStorage.getItem('zsp_token');
    if (!token) return Promise.resolve(false);
    return gsRun('validateSession', token).then(function (res) {
      if (res && res.success) {
        SESSION_TOKEN = token;
        CURRENT_USER = res.user;
        renderHeaderAuthSlot();
        return true;
      }
      sessionStorage.removeItem('zsp_token');
      return false;
    }).catch(function () { return false; });
  } catch (e) {
    return Promise.resolve(false);
  }
}

function doLogin() {
  var idVal = document.getElementById('login-id').value.trim();
  var pwVal = document.getElementById('login-password').value;
  var errBox = document.getElementById('login-error');
  var btn = document.getElementById('login-btn');
  errBox.classList.add('hidden');

  if (!idVal || !pwVal) {
    errBox.innerText = 'Please enter both your User ID / Email and password.';
    errBox.classList.remove('hidden');
    return;
  }

  btn.disabled = true;
  btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Signing In...';

  gsRun('loginUser', idVal, pwVal).then(function (res) {
    btn.disabled = false;
    btn.innerHTML = '<i class="fa-solid fa-right-to-bracket"></i> Sign In';
    if (!res || !res.success) {
      errBox.innerText = (res && res.message) || 'Login failed. Please try again.';
      errBox.classList.remove('hidden');
      return;
    }
    SESSION_TOKEN = res.token;
    CURRENT_USER = res.user;
    sessionStorage.setItem('zsp_token', res.token);
    document.getElementById('login-id').value = '';
    document.getElementById('login-password').value = '';
    showAppToast('Welcome, ' + CURRENT_USER.name + '!');
    showAppView();
  }).catch(function (err) {
    btn.disabled = false;
    btn.innerHTML = '<i class="fa-solid fa-right-to-bracket"></i> Sign In';
    errBox.innerText = (err && err.message) || 'Could not reach the server. Please try again.';
    errBox.classList.remove('hidden');
  });
}

function doLogout() {
  var token = SESSION_TOKEN;
  SESSION_TOKEN = null;
  CURRENT_USER = null;
  sessionStorage.removeItem('zsp_token');
  APP_STATE_CACHE = {};
  if (token) gsRun('logoutUser', token).catch(function () {});
  showPublicView();
  showAppToast('You have been logged out.');
}

// ---------------------------------------------------------------------
// 3. ROLE DASHBOARD SHELL (sidebar + tab routing)
// ---------------------------------------------------------------------
var ROLE_META = {
  SUPER_ADMIN: {
    label: 'Super Admin / Zone Sports Secretary',
    tabs: [
      { id: 'overview', label: 'Overview', icon: 'fa-gauge-high', render: renderAdminOverview },
      { id: 'import', label: 'Bulk Import', icon: 'fa-file-import', render: renderAdminBulkImport },
      { id: 'schools', label: 'Schools', icon: 'fa-school', render: renderAdminSchools },
      { id: 'teachers', label: 'Teachers & Officials', icon: 'fa-users', render: renderAdminTeachers },
      { id: 'students', label: 'Athletes', icon: 'fa-child-reaching', render: renderAdminStudents },
      { id: 'events', label: 'Events & Schedule', icon: 'fa-calendar-days', render: renderAdminEvents },
      { id: 'entries', label: 'Event Entries', icon: 'fa-list-check', render: renderAdminEntries },
      { id: 'duties', label: 'Duty Assignment', icon: 'fa-clipboard-list', render: renderAdminDuties },
      { id: 'results', label: 'Results', icon: 'fa-stopwatch', render: renderAdminResults },
      { id: 'certificates', label: 'Certificates', icon: 'fa-award', render: renderAdminCertificates },
      { id: 'reports', label: 'Reports', icon: 'fa-chart-column', render: renderAdminReports }
    ]
  },
  SCHOOL_TEACHER: {
    label: 'School Teacher / Escort',
    tabs: [
      { id: 'students', label: 'My Students', icon: 'fa-child-reaching', render: renderTeacherStudents },
      { id: 'entries', label: 'Event Entries', icon: 'fa-list-check', render: renderTeacherEntries },
      { id: 'schedule', label: 'Schedule', icon: 'fa-calendar-days', render: renderTeacherSchedule },
      { id: 'duties', label: 'My Duties', icon: 'fa-clipboard-list', render: renderTeacherDuties },
      { id: 'certificates', label: 'Certificates', icon: 'fa-award', render: renderTeacherCertificates }
    ]
  },
  STARTER_OFFICIAL: {
    label: 'Starting Point Official',
    tabs: [
      { id: 'verify', label: 'Verification Queue', icon: 'fa-clipboard-check', render: renderStarterVerification },
      { id: 'duties', label: 'My Duties', icon: 'fa-clipboard-list', render: renderGenericDuties }
    ]
  },
  FINISH_JUDGE: {
    label: 'Finish Line Judge',
    tabs: [
      { id: 'finish', label: 'Finish Line Entry', icon: 'fa-flag-checkered', render: renderFinishLine },
      { id: 'duties', label: 'My Duties', icon: 'fa-clipboard-list', render: renderGenericDuties }
    ]
  },
  DUTY_OFFICIAL: {
    label: 'Duty Official',
    tabs: [
      { id: 'duties', label: 'My Duties', icon: 'fa-clipboard-list', render: renderGenericDuties }
    ]
  }
};

function renderAppShellForRole() {
  var role = String((CURRENT_USER && CURRENT_USER.role) || '').toUpperCase();
  var meta = ROLE_META[role];
  document.getElementById('app-role-label').innerText = meta ? meta.label : role;
  document.getElementById('app-role-label').style.color = '#fbbf24';
  document.getElementById('app-user-name').innerText = CURRENT_USER.name || '';
  document.getElementById('app-user-id').innerText = CURRENT_USER.userId || '';

  var sidebar = document.getElementById('app-sidebar');
  if (!meta) {
    sidebar.innerHTML = '';
    document.getElementById('app-content').innerHTML = '<div class="app-card text-center text-slate-400 py-10">No dashboard is configured for your role yet. Please contact the Zone Sports Admin.</div>';
    return;
  }

  sidebar.innerHTML = meta.tabs.map(function (t) {
    return '<button data-tab="' + t.id + '" onclick="selectAppTab(\'' + t.id + '\')" class="tab-btn flex items-center gap-2 w-full text-left">' +
      '<i class="fa-solid ' + t.icon + ' w-4 text-center"></i><span class="hidden md:inline">' + escapeHtml(t.label) + '</span></button>';
  }).join('');

  var initialTab = APP_ACTIVE_TAB && meta.tabs.some(function (t) { return t.id === APP_ACTIVE_TAB; }) ? APP_ACTIVE_TAB : meta.tabs[0].id;
  selectAppTab(initialTab);

  // Progressive enhancement: an Incharge can verify athletes at their
  // station even if their base portal role wouldn't normally include
  // a Verification tab (e.g. a Duty Official made Incharge of a jump).
  gsRun('getMyInchargeStations', SESSION_TOKEN).then(function (stations) {
    if (!stations.length) return;
    if (!meta.tabs.some(function (t) { return t.id === 'incharge-verify'; })) {
      meta.tabs.unshift({ id: 'incharge-verify', label: 'Verify (Incharge)', icon: 'fa-user-check', render: renderStarterVerification });
    }
    renderAppShellSidebar_(meta);
  }).catch(function () {});
}

function renderAppShellSidebar_(meta) {
  var sidebar = document.getElementById('app-sidebar');
  sidebar.innerHTML = meta.tabs.map(function (t) {
    return '<button data-tab="' + t.id + '" onclick="selectAppTab(\'' + t.id + '\')" class="tab-btn flex items-center gap-2 w-full text-left">' +
      '<i class="fa-solid ' + t.icon + ' w-4 text-center"></i><span class="hidden md:inline">' + escapeHtml(t.label) + '</span></button>';
  }).join('');
  Array.prototype.forEach.call(sidebar.querySelectorAll('.tab-btn'), function (btn) {
    btn.classList.toggle('active', btn.getAttribute('data-tab') === APP_ACTIVE_TAB);
  });
}

function selectAppTab(tabId) {
  var role = String((CURRENT_USER && CURRENT_USER.role) || '').toUpperCase();
  var meta = ROLE_META[role];
  if (!meta) return;
  APP_ACTIVE_TAB = tabId;

  Array.prototype.forEach.call(document.querySelectorAll('#app-sidebar .tab-btn'), function (btn) {
    btn.classList.toggle('active', btn.getAttribute('data-tab') === tabId);
  });

  var tab = meta.tabs.find(function (t) { return t.id === tabId; });
  var content = document.getElementById('app-content');
  content.innerHTML = '<div class="text-center py-16"><div class="loader border-4 border-amber-500 h-10 w-10 rounded-full mx-auto"></div></div>';
  if (tab && typeof tab.render === 'function') {
    Promise.resolve(tab.render(content)).catch(function (err) {
      content.innerHTML = '<div class="app-card text-red-400 text-sm font-bold">Error loading this section: ' + escapeHtml((err && err.message) || 'Unknown error') + '</div>';
    });
  }
}

function reloadActiveTab() { if (APP_ACTIVE_TAB) selectAppTab(APP_ACTIVE_TAB); }

// Small section header helper reused across every tab renderer.
function sectionHeader(icon, title, subtitle, actionsHtml) {
  return '<div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-5">' +
    '<div><h2 class="text-lg md:text-xl font-black text-white uppercase flex items-center gap-2"><i class="fa-solid ' + icon + ' text-amber-400"></i>' + escapeHtml(title) + '</h2>' +
    (subtitle ? '<p class="text-slate-500 text-xs font-bold mt-1">' + escapeHtml(subtitle) + '</p>' : '') + '</div>' +
    (actionsHtml ? '<div class="flex gap-2 shrink-0">' + actionsHtml + '</div>' : '') +
    '</div>';
}

// ---------------------------------------------------------------------
// 4. SCHOOL TEACHER DASHBOARD
// ---------------------------------------------------------------------
function renderTeacherStudents(root) {
  return gsRun('getModuleData', SESSION_TOKEN, 'students').then(function (students) {
    var rows = students.map(function (s) {
      var photo = s.PhotoURL ? '<img src="' + escapeHtml(s.PhotoURL) + '" class="avatar-sm">' : '<div class="avatar-sm flex items-center justify-center text-slate-500"><i class="fa-solid fa-user"></i></div>';
      return '<tr>' +
        '<td>' + photo + '</td>' +
        '<td><div class="font-black text-white">' + escapeHtml(s.Name) + '</div><div class="text-[10px] text-slate-500">' + escapeHtml(s.FatherName || '') + '</div></td>' +
        '<td>' + escapeHtml(s.Gender) + '</td>' +
        '<td>' + escapeHtml(s.Category) + '</td>' +
        '<td>' + fmtDate(s.DOB) + '</td>' +
        '<td>' + badge(s.Status || 'ACTIVE', String(s.Status).toUpperCase() === 'ACTIVE' ? 'green' : 'red') + '</td>' +
        '<td class="text-right whitespace-nowrap">' +
        '<button onclick="openStudentForm(' + JSON.stringify(s.StudentID) + ')" class="app-btn app-btn-secondary !px-2 !py-1 mr-1"><i class="fa-solid fa-pen"></i></button>' +
        '<button onclick="confirmDeleteStudent(' + JSON.stringify(s.StudentID) + ')" class="app-btn app-btn-danger !px-2 !py-1"><i class="fa-solid fa-trash"></i></button>' +
        '</td></tr>';
    }).join('');

    root.innerHTML = sectionHeader('fa-child-reaching', 'My Students', students.length + ' registered athlete(s)',
      '<button onclick="openStudentForm()" class="app-btn app-btn-primary"><i class="fa-solid fa-plus"></i> Add Student</button>') +
      '<div class="app-card p-0 overflow-x-auto"><table class="app-table"><thead><tr><th></th><th>Name</th><th>Gender</th><th>Category</th><th>DOB</th><th>Status</th><th></th></tr></thead><tbody>' +
      (rows || '<tr><td colspan="7" class="text-center text-slate-500 py-8">No students registered yet. Click "Add Student" to begin.</td></tr>') +
      '</tbody></table></div>';
  });
}

function openStudentForm(studentId) {
  var isAdmin = String((CURRENT_USER && CURRENT_USER.role) || '').toUpperCase() === 'SUPER_ADMIN';
  var existing = studentId ? (APP_STATE_CACHE.students || []).find(function (s) { return s.StudentID === studentId; }) : null;

  var loadStudent = existing ? Promise.resolve(existing) : gsRun('getModuleData', SESSION_TOKEN, 'students').then(function (list) {
    APP_STATE_CACHE.students = list;
    return studentId ? list.find(function (s) { return s.StudentID === studentId; }) : null;
  });
  var loadSchools = isAdmin
    ? (APP_STATE_CACHE.schools ? Promise.resolve(APP_STATE_CACHE.schools) : gsRun('getModuleData', SESSION_TOKEN, 'schools').then(function (list) { APP_STATE_CACHE.schools = list; return list; }))
    : Promise.resolve([]);

  Promise.all([loadStudent, loadSchools]).then(function (res) {
    var s = res[0] || {};
    var schools = res[1];

    var schoolField = isAdmin
      ? '<div><label class="app-label">School *</label><select id="stu-school" class="app-input">' +
        schools.map(function (sc) { return '<option value="' + sc.SchoolID + '" ' + (s.SchoolID === sc.SchoolID ? 'selected' : '') + '>' + escapeHtml(sc.SchoolName) + '</option>'; }).join('') +
        '</select></div>'
      : '';

    var body =
      '<div class="space-y-3">' +
      '<div class="flex items-center gap-3">' +
      '<img id="stu-photo-preview" src="' + (s.PhotoURL || '') + '" class="avatar-sm !w-16 !h-16 ' + (s.PhotoURL ? '' : 'hidden') + '">' +
      '<label class="app-btn app-btn-secondary cursor-pointer"><i class="fa-solid fa-camera"></i> Upload Photo<input type="file" accept="image/*" class="hidden" id="stu-photo-input" onchange="handleStudentPhotoSelect(event)"></label>' +
      (s.BibNo ? '<span class="badge badge-amber ml-auto">Bib: ' + escapeHtml(s.BibNo) + '</span>' : '') +
      '</div>' +
      schoolField +
      '<div><label class="app-label">Full Name *</label><input id="stu-name" class="app-input" value="' + escapeHtml(s.Name || '') + '"></div>' +
      '<div><label class="app-label">Father\'s Name</label><input id="stu-father" class="app-input" value="' + escapeHtml(s.FatherName || '') + '"></div>' +
      '<div class="grid grid-cols-2 gap-3">' +
      '<div><label class="app-label">Gender *</label><select id="stu-gender" class="app-input"><option ' + (s.Gender === 'Boy' ? 'selected' : '') + '>Boy</option><option ' + (s.Gender === 'Girl' ? 'selected' : '') + '>Girl</option></select></div>' +
      '<div><label class="app-label">Category *</label><select id="stu-category" class="app-input">' +
      ['Sub Junior (U-14)', 'Junior (U-17)', 'Senior (U-19)'].map(function (c) { return '<option ' + (s.Category === c ? 'selected' : '') + '>' + c + '</option>'; }).join('') +
      '</select></div></div>' +
      '<div><label class="app-label">Date of Birth</label><input type="date" id="stu-dob" class="app-input" value="' + (s.DOB ? String(s.DOB).substring(0, 10) : '') + '"></div>' +
      '<input type="hidden" id="stu-photo-url" value="' + escapeHtml(s.PhotoURL || '') + '">' +
      (!schools.length && isAdmin ? '<p class="text-red-400 text-[11px]">No schools found yet - add a school first (Schools tab or Bulk Import).</p>' : '') +
      '</div>';
    var footer = '<button onclick="closeModal()" class="app-btn app-btn-secondary">Cancel</button>' +
      '<button onclick="saveStudentForm(' + JSON.stringify(s.StudentID || '') + ')" class="app-btn app-btn-primary" id="stu-save-btn"><i class="fa-solid fa-check"></i> Save</button>';
    openModal(studentId ? 'Edit Student' : 'Add Student', body, footer);
  });
}

function handleStudentPhotoSelect(evt) {
  var file = evt.target.files[0];
  if (!file) return;
  fileToBase64(file).then(function (base64) {
    var btn = evt.target.closest('label');
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Uploading...';
    return gsRun('uploadPhoto', SESSION_TOKEN, base64, file.name, file.type, 'Athletes').then(function (res) {
      document.getElementById('stu-photo-url').value = res.url;
      var preview = document.getElementById('stu-photo-preview');
      preview.src = res.url;
      preview.classList.remove('hidden');
      btn.innerHTML = '<i class="fa-solid fa-camera"></i> Change Photo';
    });
  }).catch(function (err) { showAppToast('Photo upload failed: ' + (err.message || err), true); });
}

function saveStudentForm(studentId) {
  var schoolEl = document.getElementById('stu-school');
  var payload = {
    StudentID: studentId || '',
    Name: document.getElementById('stu-name').value.trim(),
    FatherName: document.getElementById('stu-father').value.trim(),
    Gender: document.getElementById('stu-gender').value,
    Category: document.getElementById('stu-category').value,
    DOB: document.getElementById('stu-dob').value,
    PhotoURL: document.getElementById('stu-photo-url').value
  };
  if (schoolEl) payload.SchoolID = schoolEl.value;
  if (!payload.Name) { showAppToast('Student name is required.', true); return; }
  if (schoolEl && !payload.SchoolID) { showAppToast('Select a school.', true); return; }

  var btn = document.getElementById('stu-save-btn');
  btn.disabled = true;
  gsRun('saveStudent', SESSION_TOKEN, payload).then(function () {
    closeModal();
    showAppToast('Student saved.');
    reloadActiveTab();
  }).catch(function (err) {
    btn.disabled = false;
    showAppToast(err.message || 'Save failed.', true);
  });
}

function confirmDeleteStudent(studentId) {
  openModal('Remove Student', '<p class="text-slate-300 text-sm">This will mark the student as inactive. This action can be reversed by an admin. Continue?</p>',
    '<button onclick="closeModal()" class="app-btn app-btn-secondary">Cancel</button>' +
    '<button onclick="doDeleteStudent(' + JSON.stringify(studentId) + ')" class="app-btn app-btn-danger">Remove</button>');
}
function doDeleteStudent(studentId) {
  gsRun('deleteStudent', SESSION_TOKEN, studentId).then(function () {
    closeModal(); showAppToast('Student removed.'); reloadActiveTab();
  }).catch(function (err) { showAppToast(err.message || 'Failed to remove.', true); });
}

function renderTeacherEntries(root) {
  return Promise.all([
    gsRun('getModuleData', SESSION_TOKEN, 'events'),
    gsRun('getModuleData', SESSION_TOKEN, 'students')
  ]).then(function (res) {
    var events = res[0], students = res[1];
    APP_STATE_CACHE.students = students;
    var options = events.map(function (e) { return '<option value="' + e.EventID + '">' + escapeHtml(e.EventName) + ' (' + escapeHtml(e.Gender) + ' / ' + escapeHtml(e.Category) + ')</option>'; }).join('');
    root.innerHTML = sectionHeader('fa-list-check', 'Event Entries', 'Enter your students into events') +
      '<div class="app-card mb-4">' +
      '<label class="app-label">Select Event</label>' +
      '<select id="entry-event-select" class="app-input" onchange="loadEntryBoard()"><option value="">-- choose an event --</option>' + options + '</select>' +
      '</div>' +
      '<div id="entry-board"></div>';
  });
}

function loadEntryBoard() {
  var eventId = document.getElementById('entry-event-select').value;
  var board = document.getElementById('entry-board');
  if (!eventId) { board.innerHTML = ''; return; }
  board.innerHTML = '<div class="text-center py-10"><div class="loader border-4 border-amber-500 h-8 w-8 rounded-full mx-auto"></div></div>';

  Promise.all([
    gsRun('getEventEntries', SESSION_TOKEN, eventId),
    Promise.resolve(APP_STATE_CACHE.students || [])
  ]).then(function (res) {
    var entries = res[0], students = res[1];
    var enteredIds = {};
    entries.forEach(function (e) { enteredIds[String(e.StudentID)] = e; });

    var rows = students.map(function (s) {
      var e = enteredIds[String(s.StudentID)];
      if (e) {
        return '<tr><td><input type="checkbox" checked disabled></td><td class="font-black text-white">' + escapeHtml(s.Name) + '</td>' +
          '<td>' + escapeHtml(s.Gender) + ' / ' + escapeHtml(s.Category) + '</td>' +
          '<td>' + badge(e.BibNo || '-', 'amber') + '</td>' +
          '<td>' + (String(e.Verified).toUpperCase() === 'YES' ? badge('Verified', 'green') : badge('Pending', 'slate')) + '</td></tr>';
      }
      return '<tr><td><input type="checkbox" class="entry-student-cb" value="' + s.StudentID + '"></td><td class="font-black text-white">' + escapeHtml(s.Name) + '</td>' +
        '<td>' + escapeHtml(s.Gender) + ' / ' + escapeHtml(s.Category) + '</td><td>-</td><td>' + badge('Not Entered', 'slate') + '</td></tr>';
    }).join('');

    board.innerHTML = '<div class="app-card p-0 overflow-x-auto">' +
      '<table class="app-table"><thead><tr><th></th><th>Student</th><th>Gender / Category</th><th>Bib No.</th><th>Status</th></tr></thead><tbody>' +
      (rows || '<tr><td colspan="5" class="text-center text-slate-500 py-8">No students found. Add students first.</td></tr>') +
      '</tbody></table></div>' +
      '<div class="mt-4 flex justify-end"><button onclick="submitEventEntries()" class="app-btn app-btn-primary"><i class="fa-solid fa-paper-plane"></i> Enter Selected Students</button></div>';
  });
}

function submitEventEntries() {
  var eventId = document.getElementById('entry-event-select').value;
  var ids = Array.prototype.map.call(document.querySelectorAll('.entry-student-cb:checked'), function (cb) { return cb.value; });
  if (!ids.length) { showAppToast('Select at least one student.', true); return; }
  gsRun('saveEventEntries', SESSION_TOKEN, eventId, ids).then(function (res) {
    showAppToast(res.created.length + ' student(s) entered with bib numbers assigned.');
    loadEntryBoard();
  }).catch(function (err) { showAppToast(err.message || 'Failed to save entries.', true); });
}

function renderTeacherSchedule(root) {
  return gsRun('getUpcomingEvents', SESSION_TOKEN).then(function (list) {
    var rows = list.map(function (s) {
      return '<tr><td class="font-black text-white">' + escapeHtml(s.EventName) + '</td><td>' + escapeHtml(s.Gender) + ' / ' + escapeHtml(s.Category) + '</td>' +
        '<td>' + fmtDate(s.EventDate) + '</td><td>' + escapeHtml(s.ReportingTime || '-') + '</td><td>' + escapeHtml(s.Venue || '-') + '</td>' +
        '<td>' + badge(s.Status || 'UPCOMING', 'amber') + '</td></tr>';
    }).join('');
    root.innerHTML = sectionHeader('fa-calendar-days', 'Upcoming Schedule', '') +
      '<div class="app-card p-0 overflow-x-auto"><table class="app-table"><thead><tr><th>Event</th><th>Gender/Cat.</th><th>Date</th><th>Reporting</th><th>Venue</th><th>Status</th></tr></thead><tbody>' +
      (rows || '<tr><td colspan="6" class="text-center text-slate-500 py-8">No upcoming events scheduled yet.</td></tr>') + '</tbody></table></div>';
  });
}

function renderTeacherCertificates(root) {
  return gsRun('getModuleData', SESSION_TOKEN, 'certificates').then(function (list) {
    var rows = list.map(function (c) {
      return '<tr><td>' + badge(c.CertificateType, 'amber') + '</td><td>' + escapeHtml(c.Position || '-') + '</td>' +
        '<td>' + badge(c.Status, c.Status === 'APPROVED' ? 'green' : 'slate') + '</td>' +
        '<td class="text-right"><a href="' + escapeHtml(c.CertificateURL) + '" target="_blank" class="app-btn app-btn-secondary !px-3 !py-1.5"><i class="fa-solid fa-download"></i> View</a></td></tr>';
    }).join('');
    root.innerHTML = sectionHeader('fa-award', 'Certificates', 'Generated for your students') +
      '<div class="app-card p-0 overflow-x-auto"><table class="app-table"><thead><tr><th>Type</th><th>Position</th><th>Status</th><th></th></tr></thead><tbody>' +
      (rows || '<tr><td colspan="4" class="text-center text-slate-500 py-8">No certificates generated yet.</td></tr>') + '</tbody></table></div>';
  });
}

function renderTeacherDuties(root) { return renderGenericDuties(root); }

// ---------------------------------------------------------------------
// 5. STARTING POINT OFFICIAL DASHBOARD
// ---------------------------------------------------------------------
function renderStarterVerification(root) {
  return gsRun('getModuleData', SESSION_TOKEN, 'events').then(function (events) {
    var options = events.map(function (e) { return '<option value="' + e.EventID + '">' + escapeHtml(e.EventName) + ' (' + escapeHtml(e.Gender) + ' / ' + escapeHtml(e.Category) + ')</option>'; }).join('');
    root.innerHTML = sectionHeader('fa-clipboard-check', 'Track-side Verification', 'Select an event to see its auto-bifurcated athlete list') +
      '<div class="app-card mb-4"><label class="app-label">Select Event</label>' +
      '<select id="verify-event-select" class="app-input" onchange="loadVerificationBoard()"><option value="">-- choose an event --</option>' + options + '</select></div>' +
      '<div id="verify-board"></div>';
  });
}

function loadVerificationBoard() {
  var eventId = document.getElementById('verify-event-select').value;
  var board = document.getElementById('verify-board');
  if (!eventId) { board.innerHTML = ''; return; }
  board.innerHTML = '<div class="text-center py-10"><div class="loader border-4 border-amber-500 h-8 w-8 rounded-full mx-auto"></div></div>';

  gsRun('getEventVerificationBoard', SESSION_TOKEN, eventId).then(function (list) {
    var rows = list.map(function (e) {
      var photo = e.PhotoURL ? '<img src="' + escapeHtml(e.PhotoURL) + '" class="avatar-sm">' : '<div class="avatar-sm flex items-center justify-center text-slate-500"><i class="fa-solid fa-user"></i></div>';
      var verified = String(e.Verified).toUpperCase() === 'YES';
      return '<tr><td>' + photo + '</td>' +
        '<td><div class="font-black text-white">' + escapeHtml(e.StudentName) + '</div><div class="text-[10px] text-slate-500">' + escapeHtml(e.SchoolName) + '</div></td>' +
        '<td>' + badge(e.BibNo || '-', 'amber') + '</td>' +
        '<td>' + escapeHtml(e.Gender) + ' / ' + escapeHtml(e.Category) + '</td>' +
        '<td>' + (verified ? badge('Verified', 'green') : badge('Pending', 'slate')) + '</td>' +
        '<td class="text-right">' +
        (verified
          ? '<button onclick="setVerification(' + JSON.stringify(e.EntryID) + ', false)" class="app-btn app-btn-secondary !px-3 !py-1.5"><i class="fa-solid fa-rotate-left"></i> Undo</button>'
          : '<button onclick="setVerification(' + JSON.stringify(e.EntryID) + ', true)" class="app-btn app-btn-primary !px-3 !py-1.5"><i class="fa-solid fa-check"></i> Verify</button>') +
        '</td></tr>';
    }).join('');
    board.innerHTML = '<div class="app-card p-0 overflow-x-auto"><table class="app-table"><thead><tr><th></th><th>Athlete</th><th>Bib</th><th>Category</th><th>Status</th><th></th></tr></thead><tbody>' +
      (rows || '<tr><td colspan="6" class="text-center text-slate-500 py-8">No entries found for this event yet.</td></tr>') + '</tbody></table></div>';
  });
}

function setVerification(entryId, verified) {
  gsRun('verifyEventEntry', SESSION_TOKEN, entryId, verified, '').then(function () {
    showAppToast(verified ? 'Athlete marked Verified/Ready.' : 'Verification undone.');
    loadVerificationBoard();
  }).catch(function (err) { showAppToast(err.message || 'Failed to update.', true); });
}

// ---------------------------------------------------------------------
// 6. FINISH LINE JUDGE DASHBOARD
// ---------------------------------------------------------------------
function renderFinishLine(root) {
  return gsRun('getModuleData', SESSION_TOKEN, 'events').then(function (events) {
    var options = events.map(function (e) { return '<option value="' + e.EventID + '">' + escapeHtml(e.EventName) + ' (' + escapeHtml(e.Gender) + ' / ' + escapeHtml(e.Category) + ')</option>'; }).join('');
    root.innerHTML = sectionHeader('fa-flag-checkered', 'Finish Line Entry', 'Only verified/ready athletes appear below. Gold = 5 pts, Silver = 3 pts, Bronze = 1 pt.') +
      '<div class="app-card mb-4"><label class="app-label">Select Event</label>' +
      '<select id="finish-event-select" class="app-input" onchange="loadFinishBoard()"><option value="">-- choose an event --</option>' + options + '</select></div>' +
      '<div id="finish-board"></div>';
  });
}

function loadFinishBoard() {
  var eventId = document.getElementById('finish-event-select').value;
  var board = document.getElementById('finish-board');
  if (!eventId) { board.innerHTML = ''; return; }
  board.innerHTML = '<div class="text-center py-10"><div class="loader border-4 border-amber-500 h-8 w-8 rounded-full mx-auto"></div></div>';

  gsRun('getFinishLineBoard', SESSION_TOKEN, eventId).then(function (list) {
    if (!list.length) {
      board.innerHTML = '<div class="app-card text-center text-slate-500 py-8">No verified athletes yet for this event. Ask the Starting Point official to verify entries first.</div>';
      return;
    }
    var posOptions = ['', '1st', '2nd', '3rd', '4th'];
    var rows = list.map(function (e) {
      var sel = posOptions.map(function (p) { return '<option value="' + p + '" ' + (String(e.Position || '').toLowerCase() === p ? 'selected' : '') + '>' + (p || 'Position') + '</option>'; }).join('');
      return '<tr>' +
        '<td><div class="font-black text-white">' + escapeHtml(e.StudentName) + '</div><div class="text-[10px] text-slate-500">' + escapeHtml(e.SchoolName) + '</div></td>' +
        '<td>' + badge(e.BibNo || '-', 'amber') + '</td>' +
        '<td><select class="app-input finish-pos" data-student="' + e.StudentID + '" data-school="' + (e.SchoolID || '') + '">' + sel + '</select></td>' +
        '<td><input class="app-input finish-time" data-student="' + e.StudentID + '" placeholder="e.g. 11.82s" value="' + escapeHtml(e.Timing || '') + '"></td>' +
        '<td class="text-right"><button onclick="saveFinishResult(' + JSON.stringify(eventId) + ', ' + JSON.stringify(e.StudentID) + ', ' + JSON.stringify(e.SchoolID || '') + ')" class="app-btn app-btn-primary !px-3 !py-1.5"><i class="fa-solid fa-floppy-disk"></i> Save</button></td>' +
        '</tr>';
    }).join('');
    board.innerHTML = '<div class="app-card p-0 overflow-x-auto"><table class="app-table"><thead><tr><th>Athlete</th><th>Bib</th><th>Position</th><th>Timing / Distance</th><th></th></tr></thead><tbody>' + rows + '</tbody></table></div>';
  });
}

function saveFinishResult(eventId, studentId, schoolId) {
  var row = document.querySelector('.finish-pos[data-student="' + studentId + '"]');
  var timeInput = document.querySelector('.finish-time[data-student="' + studentId + '"]');
  var position = row ? row.value : '';
  if (!position) { showAppToast('Choose a position before saving.', true); return; }

  gsRun('saveEventResult', SESSION_TOKEN, {
    EventID: eventId, StudentID: studentId, SchoolID: schoolId,
    Position: position, Timing: timeInput ? timeInput.value.trim() : ''
  }).then(function () {
    showAppToast('Result saved. Live scoreboard updated.');
    loadFinishBoard();
  }).catch(function (err) { showAppToast(err.message || 'Failed to save result.', true); });
}

// ---------------------------------------------------------------------
// 7. DUTIES (shared across Teacher / Starter / Finish Judge / Duty Official)
// ---------------------------------------------------------------------
function renderGenericDuties(root) {
  return Promise.all([
    gsRun('getModuleData', SESSION_TOKEN, 'duties'),
    gsRun('getMyInchargeStations', SESSION_TOKEN)
  ]).then(function (res) {
    var duties = res[0], inchargeStations = res[1];

    var rows = duties.map(function (d) {
      var ack = String(d.Acknowledged).toUpperCase() === 'YES';
      var done = String(d.Completed).toUpperCase() === 'YES';
      var incharge = String(d.IsIncharge).toUpperCase() === 'YES';
      return '<tr>' +
        '<td><div class="font-black text-white">' + escapeHtml(d.DutyRole) + (incharge ? ' ' + badge('Incharge', 'amber') : '') + '</div><div class="text-[10px] text-slate-500">' + escapeHtml(d.EventName || '') + '</div></td>' +
        '<td>' + escapeHtml(d.DutyLocation || d.Venue || '-') + '</td>' +
        '<td>' + fmtDate(d.EventDate) + '</td>' +
        '<td>' + (done ? badge('Completed', 'green') : ack ? badge('Acknowledged', 'amber') : badge('Assigned', 'slate')) + '</td>' +
        '<td class="text-right whitespace-nowrap">' +
        (!ack ? '<button onclick="doAcknowledgeDuty(' + JSON.stringify(d.DutyID) + ')" class="app-btn app-btn-secondary !px-2 !py-1 mr-1"><i class="fa-solid fa-thumbs-up"></i></button>' : '') +
        (ack && !done ? '<button onclick="doCompleteDuty(' + JSON.stringify(d.DutyID) + ')" class="app-btn app-btn-primary !px-2 !py-1 mr-1"><i class="fa-solid fa-check-double"></i></button>' : '') +
        (done ? '<button onclick="doGenerateDutyCert(' + JSON.stringify(d.DutyID) + ')" class="app-btn app-btn-secondary !px-2 !py-1"><i class="fa-solid fa-award"></i></button>' : '') +
        '</td></tr>';
    }).join('');

    var inchargeHtml = '';
    if (inchargeStations.length) {
      inchargeHtml = '<div class="app-card mb-5 !border-amber-500/40">' +
        '<h3 class="font-black text-amber-400 uppercase text-sm mb-1 flex items-center gap-2"><i class="fa-solid fa-star"></i> Your Team (You Are Incharge)</h3>' +
        '<p class="text-slate-500 text-[11px] mb-3">Mark who from your team has reported for duty at each station. You are also responsible for verifying athletes at these stations from the Verification tab.</p>' +
        inchargeStations.map(function (st) {
          var teamRows = st.teammates.length ? st.teammates.map(function (tm) {
            var present = tm.Attendance === 'PRESENT';
            var absent = tm.Attendance === 'ABSENT';
            return '<div class="flex items-center justify-between p-2 rounded-lg bg-slate-900/60 border border-slate-800 mb-1.5">' +
              '<div><div class="font-bold text-white text-xs">' + escapeHtml(tm.Name) + '</div><div class="text-[10px] text-slate-500">' + escapeHtml(tm.DutyRole) + '</div></div>' +
              '<div class="flex gap-1.5">' +
              '<button onclick="setDutyAttendance(' + JSON.stringify(tm.DutyID) + ', \'PRESENT\')" class="app-btn !px-2 !py-1 ' + (present ? 'app-btn-primary' : 'app-btn-secondary') + '"><i class="fa-solid fa-check"></i></button>' +
              '<button onclick="setDutyAttendance(' + JSON.stringify(tm.DutyID) + ', \'ABSENT\')" class="app-btn !px-2 !py-1 ' + (absent ? 'app-btn-danger' : 'app-btn-secondary') + '"><i class="fa-solid fa-xmark"></i></button>' +
              '</div></div>';
          }).join('') : '<div class="text-slate-500 text-[11px] py-2">No other teachers assigned at this station yet.</div>';
          return '<div class="mb-3"><div class="text-xs font-black text-white uppercase mb-2">' + escapeHtml(st.DutyLocation) + ' <span class="text-slate-500 font-normal">(' + escapeHtml(st.EventName || 'General') + ')</span></div>' + teamRows + '</div>';
        }).join('') +
        '</div>';
    }

    root.innerHTML = sectionHeader('fa-clipboard-list', 'My Duties', duties.length + ' assigned') +
      inchargeHtml +
      '<div class="app-card p-0 overflow-x-auto"><table class="app-table"><thead><tr><th>Duty</th><th>Location</th><th>Date</th><th>Status</th><th></th></tr></thead><tbody>' +
      (rows || '<tr><td colspan="5" class="text-center text-slate-500 py-8">No duties assigned to you yet.</td></tr>') + '</tbody></table></div>';
  });
}
function setDutyAttendance(dutyId, status) {
  gsRun('markDutyAttendance', SESSION_TOKEN, dutyId, status).then(function () {
    showAppToast('Attendance updated.');
    reloadActiveTab();
  }).catch(function (err) { showAppToast(err.message || 'Failed to update attendance.', true); });
}
function doAcknowledgeDuty(dutyId) {
  gsRun('acknowledgeDuty', SESSION_TOKEN, dutyId).then(function () { showAppToast('Duty acknowledged.'); reloadActiveTab(); })
    .catch(function (err) { showAppToast(err.message || 'Failed.', true); });
}
function doCompleteDuty(dutyId) {
  gsRun('completeDuty', SESSION_TOKEN, dutyId).then(function () { showAppToast('Duty marked completed.'); reloadActiveTab(); })
    .catch(function (err) { showAppToast(err.message || 'Failed.', true); });
}
function doGenerateDutyCert(dutyId) {
  gsRun('generateDutyCertificate', SESSION_TOKEN, dutyId).then(function (res) {
    showAppToast('Certificate generated.');
    window.open(res.url, '_blank');
  }).catch(function (err) { showAppToast(err.message || 'Failed to generate certificate.', true); });
}

// ---------------------------------------------------------------------
// 8. SUPER ADMIN DASHBOARD
// ---------------------------------------------------------------------
function renderAdminOverview(root) {
  return gsRun('getModuleData', SESSION_TOKEN, 'reports').then(function (r) {
    var cards = [
      ['fa-school', 'Schools', r.schools], ['fa-users', 'Teachers/Officials', r.teachers],
      ['fa-child-reaching', 'Athletes', r.students], ['fa-calendar-days', 'Events', r.events],
      ['fa-list-check', 'Entries', r.entries], ['fa-clipboard-check', 'Verified', r.verified],
      ['fa-stopwatch', 'Results', r.results], ['fa-award', 'Certificates', r.certificates],
      ['fa-clipboard-list', 'Duties Done', r.dutiesCompleted]
    ];
    root.innerHTML = sectionHeader('fa-gauge-high', 'Admin Overview', 'Live snapshot of the whole meet') +
      '<div class="grid grid-cols-2 md:grid-cols-3 gap-4">' +
      cards.map(function (c) {
        return '<div class="app-card text-center"><i class="fa-solid ' + c[0] + ' text-amber-400 text-xl mb-2"></i><div class="text-2xl font-black text-white">' + c[2] + '</div><div class="text-[10px] font-black uppercase text-slate-500 tracking-wide">' + c[1] + '</div></div>';
      }).join('') + '</div>';
  });
}

function genericCrudTable(root, opts) {
  // opts: {title, icon, subtitle, columns:[{key,label}], rows, actionsFn, addLabel, onAdd}
  var thead = opts.columns.map(function (c) { return '<th>' + escapeHtml(c.label) + '</th>'; }).join('') + '<th></th>';
  var rowsHtml = opts.rows.map(function (row) {
    var tds = opts.columns.map(function (c) { return '<td>' + (c.render ? c.render(row) : escapeHtml(row[c.key] || '-')) + '</td>'; }).join('');
    return '<tr>' + tds + '<td class="text-right whitespace-nowrap">' + opts.actionsFn(row) + '</td></tr>';
  }).join('');
  root.innerHTML = sectionHeader(opts.icon, opts.title, opts.subtitle,
    '<button onclick="' + opts.onAdd + '" class="app-btn app-btn-primary"><i class="fa-solid fa-plus"></i> ' + opts.addLabel + '</button>') +
    '<div class="app-card p-0 overflow-x-auto"><table class="app-table"><thead><tr>' + thead + '</tr></thead><tbody>' +
    (rowsHtml || '<tr><td colspan="' + (opts.columns.length + 1) + '" class="text-center text-slate-500 py-8">No records yet.</td></tr>') +
    '</tbody></table></div>';
}

function renderAdminSchools(root) {
  return gsRun('getModuleData', SESSION_TOKEN, 'schools').then(function (schools) {
    APP_STATE_CACHE.schools = schools;
    genericCrudTable(root, {
      title: 'Schools', icon: 'fa-school', subtitle: schools.length + ' participating school(s)', addLabel: 'Add School',
      onAdd: 'openSchoolForm()',
      columns: [
        { key: 'SchoolID', label: 'ID' }, { key: 'SchoolName', label: 'Name' },
        { key: 'BibRange', label: 'Bib Range', render: function (r) { return (r.BibRangeStart && r.BibRangeEnd) ? badge(r.BibRangeStart + '-' + r.BibRangeEnd, 'amber') : badge('Not set', 'slate'); } },
        { key: 'Phone', label: 'Phone' },
        { key: 'Status', label: 'Status', render: function (r) { return badge(r.Status || 'ACTIVE', String(r.Status).toUpperCase() === 'ACTIVE' ? 'green' : 'red'); } }
      ],
      rows: schools,
      actionsFn: function (r) {
        return '<button onclick="openSchoolForm(' + JSON.stringify(r.SchoolID) + ')" class="app-btn app-btn-secondary !px-2 !py-1 mr-1"><i class="fa-solid fa-pen"></i></button>' +
          '<button onclick="doDeleteSchool(' + JSON.stringify(r.SchoolID) + ')" class="app-btn app-btn-danger !px-2 !py-1"><i class="fa-solid fa-trash"></i></button>';
      }
    });
  });
}
function openSchoolForm(schoolId) {
  var s = schoolId ? (APP_STATE_CACHE.schools || []).find(function (x) { return x.SchoolID === schoolId; }) : {};
  s = s || {};
  var body = '<div class="space-y-3">' +
    '<div><label class="app-label">School Name *</label><input id="sch-name" class="app-input" value="' + escapeHtml(s.SchoolName || '') + '"></div>' +
    '<div class="grid grid-cols-2 gap-3">' +
    '<div><label class="app-label">School Code</label><input id="sch-code" class="app-input" value="' + escapeHtml(s.SchoolCode || '') + '"></div>' +
    '<div><label class="app-label">Phone</label><input id="sch-phone" class="app-input" value="' + escapeHtml(s.Phone || '') + '"></div></div>' +
    '<div><label class="app-label">Principal Name</label><input id="sch-principal" class="app-input" value="' + escapeHtml(s.PrincipalName || '') + '"></div>' +
    '<div><label class="app-label">Address</label><input id="sch-address" class="app-input" value="' + escapeHtml(s.Address || '') + '"></div>' +
    '<div><label class="app-label">Email</label><input id="sch-email" class="app-input" value="' + escapeHtml(s.Email || '') + '"></div>' +
    '<div class="grid grid-cols-2 gap-3">' +
    '<div><label class="app-label">Bib Range Start</label><input id="sch-bib-start" class="app-input" value="' + escapeHtml(s.BibRangeStart || '') + '" placeholder="e.g. 6001"></div>' +
    '<div><label class="app-label">Bib Range End</label><input id="sch-bib-end" class="app-input" value="' + escapeHtml(s.BibRangeEnd || '') + '" placeholder="e.g. 6025"></div>' +
    '</div>' +
    '<p class="text-slate-500 text-[11px]">Each athlete from this school automatically gets the next free bib number in this range when registered - one bib for the whole meet, reused across all their events.</p>' +
    '</div>';
  openModal(schoolId ? 'Edit School' : 'Add School', body,
    '<button onclick="closeModal()" class="app-btn app-btn-secondary">Cancel</button>' +
    '<button onclick="saveSchoolForm(' + JSON.stringify(schoolId || '') + ')" class="app-btn app-btn-primary"><i class="fa-solid fa-check"></i> Save</button>');
}
function saveSchoolForm(schoolId) {
  var payload = {
    SchoolID: schoolId || '', SchoolName: document.getElementById('sch-name').value.trim(),
    SchoolCode: document.getElementById('sch-code').value.trim(), Phone: document.getElementById('sch-phone').value.trim(),
    PrincipalName: document.getElementById('sch-principal').value.trim(), Address: document.getElementById('sch-address').value.trim(),
    Email: document.getElementById('sch-email').value.trim(),
    BibRangeStart: document.getElementById('sch-bib-start').value.trim(), BibRangeEnd: document.getElementById('sch-bib-end').value.trim()
  };
  if (!payload.SchoolName) { showAppToast('School name is required.', true); return; }
  gsRun('saveSchool', SESSION_TOKEN, payload).then(function () { closeModal(); showAppToast('School saved.'); reloadActiveTab(); })
    .catch(function (err) { showAppToast(err.message || 'Save failed.', true); });
}
function doDeleteSchool(schoolId) {
  gsRun('deleteSchool', SESSION_TOKEN, schoolId).then(function () { showAppToast('School deactivated.'); reloadActiveTab(); })
    .catch(function (err) { showAppToast(err.message || 'Failed.', true); });
}

function renderAdminTeachers(root) {
  return Promise.all([gsRun('getTeachersForAdmin', SESSION_TOKEN), gsRun('getModuleData', SESSION_TOKEN, 'schools')]).then(function (res) {
    var teachers = res[0]; APP_STATE_CACHE.teachers = teachers; APP_STATE_CACHE.schools = res[1];
    genericCrudTable(root, {
      title: 'Teachers & Officials', icon: 'fa-users', subtitle: teachers.length + ' registered', addLabel: 'Add Person',
      onAdd: 'openTeacherForm()',
      columns: [
        { key: 'Name', label: 'Name' }, { key: 'Designation', label: 'Designation' },
        { key: 'SchoolID', label: 'School ID' },
        { key: 'LoginRole', label: 'Portal Role', render: function (r) { return r.LoginRole ? badge(r.LoginRole, 'amber') : badge('No Login', 'slate'); } },
        { key: 'Phone', label: 'Phone' }
      ],
      rows: teachers,
      actionsFn: function (r) {
        return '<button onclick="openTeacherForm(' + JSON.stringify(r.TeacherID) + ')" class="app-btn app-btn-secondary !px-2 !py-1 mr-1"><i class="fa-solid fa-pen"></i></button>' +
          (!r.HasLogin ? '<button onclick="doEnsureLogin(' + JSON.stringify(r.TeacherID) + ')" class="app-btn app-btn-primary !px-2 !py-1"><i class="fa-solid fa-key"></i></button>' : '');
      }
    });
  });
}
function openTeacherForm(teacherId) {
  var t = teacherId ? (APP_STATE_CACHE.teachers || []).find(function (x) { return x.TeacherID === teacherId; }) : {};
  t = t || {};
  var schoolOptions = (APP_STATE_CACHE.schools || []).map(function (s) { return '<option value="' + s.SchoolID + '" ' + (t.SchoolID === s.SchoolID ? 'selected' : '') + '>' + escapeHtml(s.SchoolName) + '</option>'; }).join('');
  var roles = ['SCHOOL_TEACHER', 'STARTER_OFFICIAL', 'FINISH_JUDGE', 'DUTY_OFFICIAL', 'SUPER_ADMIN'];
  var body = '<div class="space-y-3">' +
    '<div><label class="app-label">Full Name *</label><input id="tch-name" class="app-input" value="' + escapeHtml(t.Name || '') + '"></div>' +
    '<div><label class="app-label">Designation</label><input id="tch-designation" class="app-input" value="' + escapeHtml(t.Designation || '') + '" placeholder="e.g. PET, Class Teacher"></div>' +
    '<div><label class="app-label">Portal Login Role *</label><select id="tch-role" class="app-input">' +
    roles.map(function (r) { return '<option value="' + r + '" ' + (t.LoginRole === r ? 'selected' : '') + '>' + r.replace(/_/g, ' ') + '</option>'; }).join('') + '</select></div>' +
    '<div><label class="app-label">School (leave blank for zone-level officials)</label><select id="tch-school" class="app-input"><option value="">-- Zone Level (no school) --</option>' + schoolOptions + '</select></div>' +
    '<div class="grid grid-cols-2 gap-3">' +
    '<div><label class="app-label">Email *</label><input id="tch-email" class="app-input" value="' + escapeHtml(t.Email || '') + '"></div>' +
    '<div><label class="app-label">Phone</label><input id="tch-phone" class="app-input" value="' + escapeHtml(t.Phone || '') + '"></div></div>' +
    '</div>';
  openModal(teacherId ? 'Edit Person' : 'Add Teacher / Official', body,
    '<button onclick="closeModal()" class="app-btn app-btn-secondary">Cancel</button>' +
    '<button onclick="saveTeacherForm(' + JSON.stringify(teacherId || '') + ')" class="app-btn app-btn-primary"><i class="fa-solid fa-check"></i> Save</button>');
  if (t.SchoolID) setTimeout(function () { document.getElementById('tch-school').value = t.SchoolID; }, 0);
}
function saveTeacherForm(teacherId) {
  var payload = {
    TeacherID: teacherId || '', Name: document.getElementById('tch-name').value.trim(),
    Designation: document.getElementById('tch-designation').value.trim(), LoginRole: document.getElementById('tch-role').value,
    SchoolID: document.getElementById('tch-school').value, Email: document.getElementById('tch-email').value.trim(),
    Phone: document.getElementById('tch-phone').value.trim()
  };
  if (!payload.Name || !payload.Email) { showAppToast('Name and email are required.', true); return; }
  gsRun('saveTeacher', SESSION_TOKEN, payload).then(function (res) {
    reloadActiveTab();
    if (res.loginCreated) {
      showCredentialsModal(res.userId, res.temporaryPassword, payload.Email);
    } else {
      closeModal();
      showAppToast('Saved.');
    }
  }).catch(function (err) { showAppToast(err.message || 'Save failed.', true); });
}
function doEnsureLogin(teacherId) {
  gsRun('ensureTeacherLogin', SESSION_TOKEN, teacherId).then(function (res) {
    reloadActiveTab();
    if (res.created) {
      showCredentialsModal(res.userId, res.temporaryPassword, '');
    } else {
      showAppToast('This person already has a login.');
    }
  }).catch(function (err) { showAppToast(err.message || 'Failed.', true); });
}

// Always show the generated login on screen (not just by email) - email
// delivery isn't configured in this build, so this is the only reliable
// way the admin can hand out credentials.
function showCredentialsModal(userId, tempPassword, email) {
  var body =
    '<p class="text-slate-300 text-sm mb-4">Saved successfully. Share these sign-in details with the person' + (email ? ' (' + escapeHtml(email) + ')' : '') + ':</p>' +
    '<div class="app-card space-y-3">' +
    '<div><div class="app-label">User ID</div><div class="font-black text-amber-400 text-lg select-all">' + escapeHtml(userId) + '</div></div>' +
    '<div><div class="app-label">Temporary Password</div><div class="font-black text-amber-400 text-lg select-all">' + escapeHtml(tempPassword) + '</div></div>' +
    '</div>' +
    '<p class="text-slate-500 text-[11px] mt-3">They can sign in at this same portal URL using "Portal Login" with either the User ID or their email address.</p>';
  openModal('Login Created', body, '<button onclick="closeModal()" class="app-btn app-btn-primary">Got it</button>');
}

function renderAdminStudents(root) {
  return Promise.all([gsRun('getModuleData', SESSION_TOKEN, 'students'), gsRun('getModuleData', SESSION_TOKEN, 'schools')]).then(function (res) {
    var students = res[0];
    APP_STATE_CACHE.students = students;
    APP_STATE_CACHE.schools = res[1];
    var schoolNameById = {};
    res[1].forEach(function (s) { schoolNameById[s.SchoolID] = s.SchoolName; });

    genericCrudTable(root, {
      title: 'Athletes', icon: 'fa-child-reaching', subtitle: students.length + ' registered athlete(s) across all schools - teachers can also add their own', addLabel: 'Add Student',
      onAdd: 'openStudentForm()',
      columns: [
        { key: 'BibNo', label: 'Bib', render: function (r) { return r.BibNo ? badge(r.BibNo, 'amber') : badge('-', 'slate'); } },
        { key: 'Name', label: 'Name' }, { key: 'Gender', label: 'Gender' }, { key: 'Category', label: 'Category' },
        { key: 'SchoolID', label: 'School', render: function (r) { return escapeHtml(schoolNameById[r.SchoolID] || r.SchoolID); } },
        { key: 'Status', label: 'Status', render: function (r) { return badge(r.Status || 'ACTIVE', String(r.Status).toUpperCase() === 'ACTIVE' ? 'green' : 'red'); } }
      ],
      rows: students,
      actionsFn: function (r) {
        return '<button onclick="openStudentForm(' + JSON.stringify(r.StudentID) + ')" class="app-btn app-btn-secondary !px-2 !py-1 mr-1"><i class="fa-solid fa-pen"></i></button>' +
          '<button onclick="confirmDeleteStudent(' + JSON.stringify(r.StudentID) + ')" class="app-btn app-btn-danger !px-2 !py-1"><i class="fa-solid fa-trash"></i></button>';
      }
    });
  });
}

// ---- Admin: Event Entries (assign ANY school's student to ANY event) ----
function renderAdminEntries(root) {
  return Promise.all([gsRun('getModuleData', SESSION_TOKEN, 'events'), gsRun('getModuleData', SESSION_TOKEN, 'schools')]).then(function (res) {
    var events = res[0], schools = res[1];
    APP_STATE_CACHE.schools = schools;
    var eventOptions = events.map(function (e) { return '<option value="' + e.EventID + '">' + escapeHtml(e.EventName) + ' (' + escapeHtml(e.Gender) + ' / ' + escapeHtml(e.Category) + ')</option>'; }).join('');
    var schoolOptions = schools.map(function (s) { return '<option value="' + s.SchoolID + '">' + escapeHtml(s.SchoolName) + '</option>'; }).join('');

    root.innerHTML = sectionHeader('fa-list-check', 'Event Entries', 'Admin can enter any school\'s athletes into any event directly') +
      '<div class="app-card mb-4 grid grid-cols-1 md:grid-cols-2 gap-3">' +
      '<div><label class="app-label">Event *</label><select id="admin-entry-event" class="app-input" onchange="loadAdminEntryBoard()"><option value="">-- choose event --</option>' + eventOptions + '</select></div>' +
      '<div><label class="app-label">School *</label><select id="admin-entry-school" class="app-input" onchange="loadAdminEntryBoard()"><option value="">-- choose school --</option>' + schoolOptions + '</select></div>' +
      '</div>' +
      '<div id="admin-entry-board"></div>';
  });
}

function loadAdminEntryBoard() {
  var eventId = document.getElementById('admin-entry-event').value;
  var schoolId = document.getElementById('admin-entry-school').value;
  var board = document.getElementById('admin-entry-board');
  if (!eventId || !schoolId) { board.innerHTML = ''; return; }
  board.innerHTML = '<div class="text-center py-10"><div class="loader border-4 border-amber-500 h-8 w-8 rounded-full mx-auto"></div></div>';

  Promise.all([gsRun('getEventEntries', SESSION_TOKEN, eventId), gsRun('getModuleData', SESSION_TOKEN, 'students')]).then(function (res) {
    var entries = res[0];
    var students = res[1].filter(function (s) { return String(s.SchoolID) === String(schoolId); });
    var enteredIds = {};
    entries.forEach(function (e) { enteredIds[String(e.StudentID)] = e; });

    var rows = students.map(function (s) {
      var e = enteredIds[String(s.StudentID)];
      if (e) {
        return '<tr><td><input type="checkbox" checked disabled></td><td class="font-black text-white">' + escapeHtml(s.Name) + '</td>' +
          '<td>' + escapeHtml(s.Gender) + ' / ' + escapeHtml(s.Category) + '</td>' +
          '<td>' + badge(e.BibNo || s.BibNo || '-', 'amber') + '</td>' +
          '<td>' + (String(e.Verified).toUpperCase() === 'YES' ? badge('Verified', 'green') : badge('Pending', 'slate')) + '</td></tr>';
      }
      return '<tr><td><input type="checkbox" class="admin-entry-student-cb" value="' + s.StudentID + '"></td><td class="font-black text-white">' + escapeHtml(s.Name) + '</td>' +
        '<td>' + escapeHtml(s.Gender) + ' / ' + escapeHtml(s.Category) + '</td><td>' + badge(s.BibNo || '-', 'amber') + '</td><td>' + badge('Not Entered', 'slate') + '</td></tr>';
    }).join('');

    board.innerHTML = '<div class="app-card p-0 overflow-x-auto">' +
      '<table class="app-table"><thead><tr><th></th><th>Student</th><th>Gender / Category</th><th>Bib No.</th><th>Status</th></tr></thead><tbody>' +
      (rows || '<tr><td colspan="5" class="text-center text-slate-500 py-8">No students found for this school. Add students first.</td></tr>') +
      '</tbody></table></div>' +
      '<div class="mt-4 flex justify-end"><button onclick="submitAdminEventEntries()" class="app-btn app-btn-primary"><i class="fa-solid fa-paper-plane"></i> Enter Selected Students</button></div>';
  });
}

function submitAdminEventEntries() {
  var eventId = document.getElementById('admin-entry-event').value;
  var ids = Array.prototype.map.call(document.querySelectorAll('.admin-entry-student-cb:checked'), function (cb) { return cb.value; });
  if (!ids.length) { showAppToast('Select at least one student.', true); return; }
  gsRun('saveEventEntries', SESSION_TOKEN, eventId, ids).then(function (res) {
    showAppToast(res.created.length + ' student(s) entered.');
    loadAdminEntryBoard();
  }).catch(function (err) { showAppToast(err.message || 'Failed to save entries.', true); });
}

function renderAdminEvents(root) {
  return Promise.all([gsRun('getModuleData', SESSION_TOKEN, 'events'), gsRun('getEventSchedules', SESSION_TOKEN)]).then(function (res) {
    var events = res[0], schedules = res[1];
    var schedMap = {}; schedules.forEach(function (s) { schedMap[s.EventID] = s; });
    genericCrudTable(root, {
      title: 'Events & Schedule', icon: 'fa-calendar-days', subtitle: events.length + ' event(s) configured', addLabel: 'Add Event',
      onAdd: 'openEventForm()',
      columns: [
        { key: 'EventName', label: 'Event' }, { key: 'Gender', label: 'Gender' }, { key: 'Category', label: 'Category' },
        { key: 'EventType', label: 'Type' },
        { key: 'Date', label: 'Date', render: function (r) { return fmtDate(schedMap[r.EventID] ? schedMap[r.EventID].EventDate : ''); } },
        { key: 'Status', label: 'Status', render: function (r) { return badge(r.Status || 'SCHEDULED', r.Status === 'COMPLETED' ? 'green' : 'amber'); } }
      ],
      rows: events,
      actionsFn: function (r) {
        return '<button onclick="openScheduleForm(' + JSON.stringify(r.EventID) + ')" class="app-btn app-btn-secondary !px-2 !py-1 mr-1" title="Schedule"><i class="fa-solid fa-clock"></i></button>' +
          (r.Status !== 'COMPLETED' ? '<button onclick="doFinalizeEvent(' + JSON.stringify(r.EventID) + ')" class="app-btn app-btn-primary !px-2 !py-1" title="Finalize & Generate Certificates"><i class="fa-solid fa-flag-checkered"></i></button>' : '');
      }
    });
  });
}
function openEventForm() {
  var body = '<div class="space-y-3">' +
    '<div><label class="app-label">Event Name *</label><input id="evt-name" class="app-input" placeholder="e.g. 100m Sprint"></div>' +
    '<div class="grid grid-cols-2 gap-3">' +
    '<div><label class="app-label">Gender *</label><select id="evt-gender" class="app-input"><option>Boys</option><option>Girls</option></select></div>' +
    '<div><label class="app-label">Category *</label><select id="evt-category" class="app-input">' +
    ['Sub Junior (U-14)', 'Junior (U-17)', 'Senior (U-19)'].map(function (c) { return '<option>' + c + '</option>'; }).join('') + '</select></div></div>' +
    '<div class="grid grid-cols-2 gap-3">' +
    '<div><label class="app-label">Sport</label><input id="evt-sport" class="app-input" value="Athletics"></div>' +
    '<div><label class="app-label">Type</label><select id="evt-type" class="app-input"><option value="TRACK">Track</option><option value="FIELD">Field</option><option value="TEAM">Team Game (Zonal Sports)</option></select></div></div>' +
    '<div><label class="app-label">Venue</label><input id="evt-venue" class="app-input"></div>' +
    '</div>';
  openModal('Add Event', body, '<button onclick="closeModal()" class="app-btn app-btn-secondary">Cancel</button>' +
    '<button onclick="saveEventForm()" class="app-btn app-btn-primary"><i class="fa-solid fa-check"></i> Save</button>');
}
function saveEventForm() {
  var payload = {
    EventName: document.getElementById('evt-name').value.trim(), Gender: document.getElementById('evt-gender').value,
    Category: document.getElementById('evt-category').value, Sport: document.getElementById('evt-sport').value.trim(),
    EventType: document.getElementById('evt-type').value, Venue: document.getElementById('evt-venue').value.trim()
  };
  if (!payload.EventName) { showAppToast('Event name is required.', true); return; }
  gsRun('saveEvent', SESSION_TOKEN, payload).then(function () { closeModal(); showAppToast('Event created.'); reloadActiveTab(); })
    .catch(function (err) { showAppToast(err.message || 'Save failed.', true); });
}
function openScheduleForm(eventId) {
  var body = '<div class="space-y-3">' +
    '<div><label class="app-label">Event Date</label><input type="date" id="sc-date" class="app-input"></div>' +
    '<div class="grid grid-cols-2 gap-3">' +
    '<div><label class="app-label">Start Time</label><input type="time" id="sc-start" class="app-input"></div>' +
    '<div><label class="app-label">Reporting Time</label><input type="time" id="sc-report" class="app-input"></div></div>' +
    '<div><label class="app-label">Venue</label><input id="sc-venue" class="app-input"></div>' +
    '</div>';
  openModal('Set Schedule', body, '<button onclick="closeModal()" class="app-btn app-btn-secondary">Cancel</button>' +
    '<button onclick="saveScheduleForm(' + JSON.stringify(eventId) + ')" class="app-btn app-btn-primary"><i class="fa-solid fa-check"></i> Save</button>');
}
function saveScheduleForm(eventId) {
  var payload = {
    EventID: eventId, EventDate: document.getElementById('sc-date').value, StartTime: document.getElementById('sc-start').value,
    ReportingTime: document.getElementById('sc-report').value, Venue: document.getElementById('sc-venue').value.trim()
  };
  gsRun('saveEventSchedule', SESSION_TOKEN, payload).then(function () { closeModal(); showAppToast('Schedule saved.'); reloadActiveTab(); })
    .catch(function (err) { showAppToast(err.message || 'Save failed.', true); });
}
function doFinalizeEvent(eventId) {
  openModal('Finalize Event', '<p class="text-slate-300 text-sm">This marks the event COMPLETED and auto-generates certificates for positions 1st-4th. Continue?</p>',
    '<button onclick="closeModal()" class="app-btn app-btn-secondary">Cancel</button>' +
    '<button onclick="confirmFinalizeEvent(' + JSON.stringify(eventId) + ')" class="app-btn app-btn-primary">Finalize</button>');
}
function confirmFinalizeEvent(eventId) {
  gsRun('finalizeEventAndGenerateCertificates', SESSION_TOKEN, eventId).then(function (res) {
    closeModal(); showAppToast('Event finalized. ' + res.certificatesGenerated + ' certificate(s) generated.'); reloadActiveTab();
  }).catch(function (err) { showAppToast(err.message || 'Failed to finalize.', true); });
}

function renderAdminDuties(root) {
  return Promise.all([gsRun('getTeachersForAdmin', SESSION_TOKEN), gsRun('getModuleData', SESSION_TOKEN, 'events'), gsRun('getModuleData', SESSION_TOKEN, 'duties')]).then(function (res) {
    var teachers = res[0], events = res[1], duties = res[2];
    var teacherOptions = teachers.map(function (t) { return '<option value="' + t.TeacherID + '">' + escapeHtml(t.Name) + ' (' + (t.LoginRole || 'no role') + ')</option>'; }).join('');
    var eventOptions = events.map(function (e) { return '<option value="' + e.EventID + '">' + escapeHtml(e.EventName) + '</option>'; }).join('');

    var rows = duties.map(function (d) {
      return '<tr><td class="font-black text-white">' + escapeHtml(d.DutyRole) + '</td><td>' + escapeHtml(d.EventName || '') + '</td>' +
        '<td>' + escapeHtml(d.DutyLocation || '-') + '</td>' +
        '<td>' + (String(d.IsIncharge).toUpperCase() === 'YES' ? badge('Incharge', 'amber') : '') + '</td>' +
        '<td>' + (String(d.Completed).toUpperCase() === 'YES' ? badge('Completed', 'green') : String(d.Acknowledged).toUpperCase() === 'YES' ? badge('Acknowledged', 'amber') : badge('Assigned', 'slate')) + '</td></tr>';
    }).join('');

    root.innerHTML = sectionHeader('fa-clipboard-list', 'Duty Assignment', 'Assign officials/teachers to duties for any event') +
      '<div class="app-card mb-5">' +
      '<div class="grid grid-cols-1 md:grid-cols-2 gap-3 mb-3">' +
      '<div><label class="app-label">Teacher / Official *</label><select id="duty-teacher" class="app-input">' + teacherOptions + '</select></div>' +
      '<div><label class="app-label">Event *</label><select id="duty-event" class="app-input">' + eventOptions + '</select></div>' +
      '</div>' +
      '<div class="grid grid-cols-1 md:grid-cols-3 gap-3 mb-3">' +
      '<div><label class="app-label">Duty Role</label><select id="duty-role" class="app-input">' +
      ['STARTER_OFFICIAL', 'FINISH_JUDGE', 'DUTY_OFFICIAL'].map(function (r) { return '<option value="' + r + '">' + r.replace(/_/g, ' ') + '</option>'; }).join('') + '</select></div>' +
      '<div><label class="app-label">Location / Activity *</label><input id="duty-location" class="app-input" placeholder="e.g. Start Line / 400m Track"></div>' +
      '<div><label class="app-label">Reporting Time</label><input type="time" id="duty-time" class="app-input"></div>' +
      '</div>' +
      '<label class="flex items-center gap-2 mb-3 cursor-pointer"><input type="checkbox" id="duty-incharge" class="w-4 h-4"> <span class="text-slate-300 text-xs font-bold">Make this person the <b class="text-amber-400">Incharge</b> for this location - they will verify athletes here and can mark attendance for every other teacher/official on duty at the same location.</span></label>' +
      '<button onclick="submitDutyAssignment()" class="app-btn app-btn-primary"><i class="fa-solid fa-paper-plane"></i> Assign Duty</button>' +
      '</div>' +
      '<div class="app-card p-0 overflow-x-auto"><table class="app-table"><thead><tr><th>Role</th><th>Event</th><th>Location</th><th>Incharge</th><th>Status</th></tr></thead><tbody>' +
      (rows || '<tr><td colspan="5" class="text-center text-slate-500 py-8">No duties assigned yet.</td></tr>') + '</tbody></table></div>';
  });
}
function submitDutyAssignment() {
  var payload = {
    TeacherID: document.getElementById('duty-teacher').value, EventID: document.getElementById('duty-event').value,
    DutyRole: document.getElementById('duty-role').value, DutyLocation: document.getElementById('duty-location').value.trim(),
    ReportingTime: document.getElementById('duty-time').value,
    IsIncharge: document.getElementById('duty-incharge').checked
  };
  if (!payload.TeacherID || !payload.EventID) { showAppToast('Choose a teacher/official and an event.', true); return; }
  if (!payload.DutyLocation) { showAppToast('Enter a duty location/activity name (used to group the team together).', true); return; }
  gsRun('assignDutyToTeacher', SESSION_TOKEN, payload).then(function () { showAppToast('Duty assigned.'); reloadActiveTab(); })
    .catch(function (err) { showAppToast(err.message || 'Failed to assign duty.', true); });
}

function renderAdminResults(root) {
  return gsRun('getModuleData', SESSION_TOKEN, 'results').then(function (results) {
    genericCrudTable(root, {
      title: 'Results', icon: 'fa-stopwatch', subtitle: results.length + ' result(s) recorded', addLabel: 'Finish judges enter results',
      onAdd: "showAppToast('Results are entered by Finish Line Judges.', false)",
      columns: [
        { key: 'EventName', label: 'Event' }, { key: 'StudentName', label: 'Athlete' },
        { key: 'Position', label: 'Position' }, { key: 'Timing', label: 'Timing' }, { key: 'Points', label: 'Points' },
        { key: 'ResultStatus', label: 'Status', render: function (r) { return badge(r.ResultStatus, r.ResultStatus === 'APPROVED' ? 'green' : 'amber'); } }
      ],
      rows: results,
      actionsFn: function (r) {
        return r.ResultStatus === 'APPROVED' ? '' :
          '<button onclick="doApproveResult(' + JSON.stringify(r.ResultID) + ')" class="app-btn app-btn-primary !px-2 !py-1"><i class="fa-solid fa-check"></i></button>';
      }
    });
  });
}
function doApproveResult(resultId) {
  gsRun('approveResult', SESSION_TOKEN, resultId).then(function () { showAppToast('Result approved.'); reloadActiveTab(); })
    .catch(function (err) { showAppToast(err.message || 'Failed.', true); });
}

function renderAdminCertificates(root) {
  return gsRun('getModuleData', SESSION_TOKEN, 'certificates').then(function (certs) {
    genericCrudTable(root, {
      title: 'Certificates', icon: 'fa-award', subtitle: certs.length + ' generated', addLabel: 'Auto-generated on finalize',
      onAdd: "showAppToast('Certificates auto-generate when an event is finalized.', false)",
      columns: [
        { key: 'CertificateType', label: 'Type' }, { key: 'Position', label: 'Position' },
        { key: 'Status', label: 'Status', render: function (r) { return badge(r.Status, r.Status === 'APPROVED' ? 'green' : 'amber'); } }
      ],
      rows: certs,
      actionsFn: function (r) {
        var view = '<a href="' + escapeHtml(r.CertificateURL) + '" target="_blank" class="app-btn app-btn-secondary !px-2 !py-1 mr-1"><i class="fa-solid fa-eye"></i></a>';
        var approve = r.Status !== 'APPROVED' ? '<button onclick="doApproveCert(' + JSON.stringify(r.CertificateID) + ')" class="app-btn app-btn-primary !px-2 !py-1"><i class="fa-solid fa-check"></i></button>' : '';
        return view + approve;
      }
    });
  });
}
function doApproveCert(certId) {
  gsRun('approveCertificate', SESSION_TOKEN, certId).then(function () { showAppToast('Certificate approved.'); reloadActiveTab(); })
    .catch(function (err) { showAppToast(err.message || 'Failed.', true); });
}

// ---------------------------------------------------------------------
// 8b. BULK IMPORT (CSV) - no more one-by-one form filling
// ---------------------------------------------------------------------
var BULK_IMPORT_SPECS = {
  schools: {
    title: 'Schools', fn: 'bulkImportSchools',
    columns: 'SchoolID, SchoolName, SchoolCode, Email, Phone, PrincipalName, Address, BibRangeStart, BibRangeEnd',
    example: 'SchoolID,SchoolName,SchoolCode,Email,Phone,PrincipalName,Address,BibRangeStart,BibRangeEnd\n1106001,"SBV, B-Block, Nand Nagari",1106001,1106001hos@gmail.com,,,,6001,6025'
  },
  teachers: {
    title: 'Teachers & Officials', fn: 'bulkImportTeachers',
    columns: 'Name, Designation, SchoolName (or SchoolID), Email, Phone, LoginRole (SCHOOL_TEACHER / STARTER_OFFICIAL / FINISH_JUDGE / DUTY_OFFICIAL / SUPER_ADMIN)',
    example: 'Name,Designation,SchoolName,SchoolID,Email,Phone,LoginRole\nAnil Kumar,Starting Point,SKV Janta Flats,,anil@example.com,,STARTER_OFFICIAL'
  },
  events: {
    title: 'Events & Schedule', fn: 'bulkImportEvents',
    columns: 'EventName, Gender, Category, EventType (TRACK/FIELD/TEAM), Sport, EventDate (YYYY-MM-DD), Venue',
    example: 'EventName,Gender,Category,EventType,Sport,EventDate,Venue\n100m,Boys,Senior (U-19),TRACK,Athletics,2026-08-07,'
  }
};

function renderAdminBulkImport(root) {
  var sections = Object.keys(BULK_IMPORT_SPECS).map(function (key) {
    var spec = BULK_IMPORT_SPECS[key];
    return '<div class="app-card mb-5">' +
      '<h3 class="font-black text-white uppercase text-sm mb-1">' + escapeHtml(spec.title) + '</h3>' +
      '<p class="text-slate-500 text-[11px] mb-3">Columns: <code class="text-amber-400">' + escapeHtml(spec.columns) + '</code></p>' +
      '<div class="flex flex-wrap items-center gap-2 mb-3">' +
      '<label class="app-btn app-btn-secondary cursor-pointer"><i class="fa-solid fa-upload"></i> Upload CSV File<input type="file" accept=".csv,text/csv" class="hidden" onchange="handleBulkFileSelect(event, \'' + key + '\')"></label>' +
      '<span class="text-slate-500 text-[11px]">or paste CSV text below</span>' +
      '</div>' +
      '<textarea id="bulk-text-' + key + '" rows="4" class="app-input font-mono text-[11px]" placeholder="' + escapeHtml(spec.example) + '"></textarea>' +
      '<div class="mt-3 flex justify-end">' +
      '<button onclick="runBulkImport(\'' + key + '\')" class="app-btn app-btn-primary"><i class="fa-solid fa-bolt"></i> Import ' + escapeHtml(spec.title) + '</button>' +
      '</div>' +
      '<div id="bulk-result-' + key + '" class="mt-3"></div>' +
      '</div>';
  }).join('');

  root.innerHTML = sectionHeader('fa-file-import', 'Bulk Import', 'Import an entire roster in one shot instead of adding records one by one. Import Schools first, then Teachers & Officials, then Events.') +
    sections;
}

function handleBulkFileSelect(evt, key) {
  var file = evt.target.files[0];
  if (!file) return;
  var reader = new FileReader();
  reader.onload = function () {
    document.getElementById('bulk-text-' + key).value = reader.result;
    showAppToast(file.name + ' loaded. Click "Import" to continue.');
  };
  reader.readAsText(file);
}

function runBulkImport(key) {
  var spec = BULK_IMPORT_SPECS[key];
  var text = document.getElementById('bulk-text-' + key).value.trim();
  var resultBox = document.getElementById('bulk-result-' + key);
  if (!text) { showAppToast('Paste CSV text or upload a file first.', true); return; }

  var rows = parseCSV(text);
  if (!rows.length) { showAppToast('No rows found in that CSV.', true); return; }

  resultBox.innerHTML = '<div class="text-center py-6"><div class="loader border-4 border-amber-500 h-8 w-8 rounded-full mx-auto"></div><div class="text-slate-500 text-xs mt-2">Importing ' + rows.length + ' row(s)...</div></div>';

  gsRun(spec.fn, SESSION_TOKEN, rows).then(function (res) {
    var summaryBits = [];
    if (res.created !== undefined) summaryBits.push(res.created + ' created');
    if (res.updated !== undefined) summaryBits.push(res.updated + ' updated');
    if (res.skipped !== undefined) summaryBits.push(res.skipped + ' skipped (already existed)');
    var realFailures = (res.failed || []).filter(function (f) { return !f.info; });
    var infoNotes = (res.failed || []).filter(function (f) { return f.info; });
    if (realFailures.length) summaryBits.push(realFailures.length + ' failed');

    var html = '<div class="' + (realFailures.length ? 'badge-red' : 'badge-green') + ' badge !inline-flex mb-2">' + summaryBits.join(' &bull; ') + '</div>';
    if (realFailures.length) {
      html += '<div class="app-card !bg-red-500/5 !border-red-500/30 max-h-48 overflow-y-auto custom-scrollbar text-[11px] space-y-1">' +
        realFailures.map(function (f) { return '<div><b class="text-red-300">Row ' + f.row + (f.name ? ' (' + escapeHtml(f.name) + ')' : '') + ':</b> <span class="text-slate-400">' + escapeHtml(f.error) + '</span></div>'; }).join('') +
        '</div>';
    }
    if (infoNotes.length) {
      html += '<div class="app-card !bg-amber-500/5 !border-amber-500/30 max-h-48 overflow-y-auto custom-scrollbar text-[11px] space-y-1 mt-2">' +
        infoNotes.map(function (f) { return '<div><b class="text-amber-300">' + escapeHtml(f.name) + ':</b> <span class="text-slate-400">' + escapeHtml(f.error.replace('INFO: ', '')) + '</span></div>'; }).join('') +
        '</div>';
    }
    resultBox.innerHTML = html;
    showAppToast('Import finished: ' + summaryBits.join(', ') + '.', realFailures.length > 0);
  }).catch(function (err) {
    resultBox.innerHTML = '<div class="text-red-400 text-xs font-bold">' + escapeHtml(err.message || 'Import failed.') + '</div>';
    showAppToast(err.message || 'Import failed.', true);
  });
}

function renderAdminReports(root) {
  return gsRun('getModuleData', SESSION_TOKEN, 'reports').then(function (r) {
    root.innerHTML = sectionHeader('fa-chart-column', 'Reports', 'Generated at ' + fmtDate(r.generatedAt)) +
      '<div class="app-card"><table class="app-table">' +
      Object.keys(r).filter(function (k) { return k !== 'generatedAt'; }).map(function (k) {
        return '<tr><td class="font-bold text-slate-400 uppercase text-xs">' + k.replace(/([A-Z])/g, ' $1') + '</td><td class="text-right font-black text-white">' + r[k] + '</td></tr>';
      }).join('') + '</table></div>';
  });
}

// ---------------------------------------------------------------------
// 9. PUBLIC LIVE DASHBOARD (backed by the /api/public/* REST endpoints)
// ---------------------------------------------------------------------
var currentMainTab = 'athletic';
var currentGenderTab = 'boys';
var currentOverallGenderTab = 'girls';
var overlayTimer = null;
var overlaySeconds = 20;
var sliderIndex = 0;

function initTugOverlayTimer() {
  const expiryDate = new Date("2026-08-17T23:59:59");
  const today = new Date();
  if (today > expiryDate) { dismissTugOverlay(); return; }

  overlaySeconds = 20;
  const countEl = document.getElementById('overlay-countdown');
  if (overlayTimer) clearInterval(overlayTimer);

  overlayTimer = setInterval(() => {
    overlaySeconds--;
    if (countEl) countEl.innerText = overlaySeconds;
    if (overlaySeconds <= 0) dismissTugOverlay();
  }, 1000);
}

function dismissTugOverlay() {
  if (overlayTimer) clearInterval(overlayTimer);
  const overlay = document.getElementById('tugofwar-overlay');
  if (overlay) {
    overlay.style.opacity = '0';
    overlay.style.pointerEvents = 'none';
    setTimeout(() => { overlay.style.display = 'none'; }, 700);
  }
}

function navigateSlider(direction) {
  var slides = document.querySelectorAll('.slide-item');
  if (!slides.length) return;
  var current = Array.from(slides).findIndex(s => s.classList.contains('active'));
  if (current < 0) current = 0;
  slides[current].classList.remove('active');
  sliderIndex = (current + direction + slides.length) % slides.length;
  slides[sliderIndex].classList.add('active');
}

function switchOverallGenderTab(genderTab) {
  currentOverallGenderTab = genderTab;
  const isGirls = genderTab === 'girls';
  document.getElementById('overall-tab-girls').className = isGirls ? "flex-1 bg-fuchsia-600 text-white py-1.5 rounded-lg text-xs font-black uppercase transition-all shadow" : "flex-1 bg-slate-800 text-slate-400 py-1.5 rounded-lg text-xs font-black uppercase transition-all hover:text-white";
  document.getElementById('overall-tab-boys').className = !isGirls ? "flex-1 bg-amber-500 text-slate-950 py-1.5 rounded-lg text-xs font-black uppercase transition-all shadow" : "flex-1 bg-slate-800 text-slate-400 py-1.5 rounded-lg text-xs font-black uppercase transition-all hover:text-white";
  document.getElementById('overall-leaders-girls-container').classList.toggle('hidden', !isGirls);
  document.getElementById('overall-leaders-boys-container').classList.toggle('hidden', isGirls);
}

function switchMainTab(mainTab) {
  currentMainTab = mainTab;
  document.getElementById('main-tab-athletic').className = mainTab === 'athletic' ? "bg-indigo-600 text-white py-2 px-1 rounded-xl text-[10px] md:text-xs font-black uppercase tracking-wider transition-all shadow-md" : "bg-slate-800 text-slate-400 py-2 px-1 rounded-xl text-[10px] md:text-xs font-black uppercase tracking-wider transition-all hover:text-white";
  document.getElementById('main-tab-zonal').className = mainTab === 'zonal' ? "bg-indigo-600 text-white py-2 px-1 rounded-xl text-[10px] md:text-xs font-black uppercase tracking-wider transition-all shadow-md" : "bg-slate-800 text-slate-400 py-2 px-1 rounded-xl text-[10px] md:text-xs font-black uppercase tracking-wider transition-all hover:text-white";
  updateLeaderboardView();
}

function switchGenderTab(genderTab) {
  currentGenderTab = genderTab;
  const isBoys = genderTab === 'boys';
  document.getElementById('gender-tab-boys').className = isBoys ? "flex-1 bg-amber-500 text-slate-950 py-1.5 rounded-lg text-xs font-black uppercase transition-all shadow" : "flex-1 bg-slate-800 text-slate-400 py-1.5 rounded-lg text-xs font-black uppercase transition-all";
  document.getElementById('gender-tab-girls').className = !isBoys ? "flex-1 bg-pink-600 text-white py-1.5 rounded-lg text-xs font-black uppercase transition-all shadow" : "flex-1 bg-slate-800 text-slate-400 py-1.5 rounded-lg text-xs font-black uppercase transition-all";
  updateLeaderboardView();
}

function updateLeaderboardView() {
  document.getElementById('lb-athletic-boys').classList.add('hidden');
  document.getElementById('lb-athletic-girls').classList.add('hidden');
  document.getElementById('lb-zonal-boys').classList.add('hidden');
  document.getElementById('lb-zonal-girls').classList.add('hidden');

  if (currentMainTab === 'athletic') {
    if (currentGenderTab === 'boys') document.getElementById('lb-athletic-boys').classList.remove('hidden');
    else document.getElementById('lb-athletic-girls').classList.remove('hidden');
  } else {
    if (currentGenderTab === 'boys') document.getElementById('lb-zonal-boys').classList.remove('hidden');
    else document.getElementById('lb-zonal-girls').classList.remove('hidden');
  }
}

function toggleMarchPastModal(show) { document.getElementById('marchPastModal').classList.toggle('hidden', !show); }
function toggleZonalSportsModal(show) { document.getElementById('zonalSportsModal').classList.toggle('hidden', !show); }
function toggleFeedbackModal(show) { document.getElementById('feedbackModal').classList.toggle('hidden', !show); }

function submitFeedbackToSheet() {
  const name = document.getElementById('fb-name').value.trim();
  const text = document.getElementById('fb-text').value.trim();
  if (!name) return alert("Please enter your name / कृपया अपना नाम दर्ज करें।");
  if (!text) return alert("Please type your suggestion / कृपया सुझाव लिखें।");

  const btn = document.getElementById('btn-submit-fb');
  btn.innerText = "Submitting... ⏳"; btn.disabled = true;

  apiFetch('POST', '/api/public/feedback', { name: name, text: text }).then(() => {
    btn.innerText = "Submit Feedback"; btn.disabled = false;
    document.getElementById('fb-name').value = "";
    document.getElementById('fb-text').value = "";
    toggleFeedbackModal(false);
    showAppToast("THANK YOU!");
    loadDashboardFeedbacks(true);
  }).catch(err => {
    btn.innerText = "Submit Feedback"; btn.disabled = false;
    alert("Error saving: " + (err.message || 'Unknown error'));
  });
}

function loadDashboardFeedbacks(isNewAdded) {
  apiFetch('GET', '/api/public/feedback').then(feedbacks => {
    const container = document.getElementById('dashboard-feedback-container');
    if (!container) return;
    if (!feedbacks || feedbacks.length === 0) {
      container.innerHTML = `<div class="text-slate-500 text-center text-xs py-6 col-span-full font-semibold">No feedbacks submitted yet.</div>`;
      return;
    }
    container.innerHTML = feedbacks.map((f, index) => {
      let cardClass = (isNewAdded && index === 0) ? "navy-card p-4 rounded-2xl flex flex-col justify-between shadow-lg highlight-feedback" : "navy-card p-4 rounded-2xl flex flex-col justify-between shadow-md";
      return `
        <div class="${cardClass}">
          <p class="text-slate-200 text-xs md:text-sm font-medium mb-3 leading-relaxed">"${escapeHtml(f.text)}"</p>
          <div class="flex justify-between items-center border-t border-slate-800/80 pt-2.5">
            <span class="text-xs font-bold text-emerald-400 uppercase tracking-wide">👤 ${escapeHtml(f.name)}</span>
            <span class="text-[10px] text-slate-500 font-semibold">${escapeHtml(f.time)}</span>
          </div>
        </div>
      `;
    }).join('');
  }).catch(() => {});
}

function initPublicDashboard() {
  initTugOverlayTimer();
  switchOverallGenderTab('girls');

  apiFetch('GET', '/api/public/visitor-count').then(c => {
    const el = document.getElementById('visitor-count');
    if (el) el.innerText = Number(c).toLocaleString();
  }).catch(() => {});

  loadDashboardFeedbacks(false);

  apiFetch('GET', '/api/public/glimpse-photos').then(urls => {
    const wrap = document.getElementById('headerSlider'); wrap.innerHTML = '';
    if (urls && urls.length) {
      urls.forEach((u, i) => { let img = document.createElement('img'); img.className = 'slide-item ' + (i === 0 ? 'active' : ''); img.src = u; wrap.appendChild(img); });
      setInterval(() => {
        if (document.getElementById('view-public').classList.contains('hidden')) return;
        navigateSlider(1);
      }, 2000);
    } else {
      wrap.innerHTML = '<div class="flex flex-col justify-center items-center h-full w-full text-slate-600"><span class="text-4xl mb-2">🏟️</span><span class="text-xs font-black uppercase tracking-widest">Event Glimpses Coming Soon</span></div>';
    }
  }).catch(() => {});

  refreshAllData(false);
  setInterval(() => { refreshAllData(true); }, 5000);
}

function isPublicViewActive() {
  var v = document.getElementById('view-public');
  return v && !v.classList.contains('hidden');
}

function refreshAllData(silent) {
  if (silent && !isPublicViewActive()) return;

  apiFetch('GET', '/api/public/dashboard-stats').then(updateKPIs).catch(() => {});
  apiFetch('GET', '/api/public/overall-leaders').then(updateOverallLeadersUI).catch(() => {});
  apiFetch('GET', '/api/public/top-schools?gender=Boys&type=athletic').then(updateAthleticBoysLeaderboard).catch(() => {});
  apiFetch('GET', '/api/public/top-schools?gender=Girls&type=athletic').then(updateAthleticGirlsLeaderboard).catch(() => {});
  apiFetch('GET', '/api/public/top-schools?gender=Boys&type=zonal').then(updateZonalBoysLeaderboard).catch(() => {});
  apiFetch('GET', '/api/public/top-schools?gender=Girls&type=zonal').then(updateZonalGirlsLeaderboard).catch(() => {});
  apiFetch('GET', '/api/public/all-results?type=zonal').then(updateZonalFullResults).catch(() => {});
  apiFetch('GET', '/api/public/best-athletes').then(updateBestAthletesUI).catch(() => {});
  apiFetch('GET', '/api/public/all-results').then(updateAllResultsTable).catch(() => {});
  loadDashboardFeedbacks(false);

  apiFetch('GET', '/api/public/filters').then(d => {
    const selGender = document.getElementById('sel-gender');
    const selCategory = document.getElementById('sel-category');
    const selEvent = document.getElementById('sel-event');
    if (!selGender || !selCategory || !selEvent) return;

    if (selGender.options.length === 0) {
      const makeOpts = arr => arr.map(i => `<option value="${i}">${i}</option>`).join('');
      selGender.innerHTML = makeOpts(d.genders);
      selCategory.innerHTML = makeOpts(d.categories);
      selEvent.innerHTML = makeOpts(d.events);

      if (d.latest) {
        if ([...selGender.options].some(o => o.value === d.latest.gender)) selGender.value = d.latest.gender;
        if ([...selCategory.options].some(o => o.value === d.latest.category)) selCategory.value = d.latest.category;
        if ([...selEvent.options].some(o => o.value === d.latest.event)) selEvent.value = d.latest.event;
      }
    }
    fetchResults(silent);
  }).catch(() => {});
}

function updateKPIs(d) {
  ['athletes', 'schools', 'events', 'golds', 'silvers', 'bronzes'].forEach(k => {
    const el = document.getElementById('kpi-' + k);
    if (el) el.innerText = (d[k] !== undefined && d[k] !== null) ? d[k] : '--';
  });
  const latest = document.getElementById('latest-update-text');
  if (latest) latest.innerText = d.latestEventStr || 'Awaiting Data...';
}

function updateOverallLeadersUI(data) {
  const bCont = document.getElementById('overall-leaders-boys');
  const gCont = document.getElementById('overall-leaders-girls');
  if (!data || !bCont || !gCont) return;

  function renderList(list, theme) {
    if (!list || !list.length) return `<div class="p-3 rounded-xl bg-slate-800/10 border border-slate-800/50 text-center"><span class="text-slate-600 text-xs font-bold uppercase">Awaiting Data</span></div>`;
    return list.map((sch, i) => {
      let isFirst = i === 0;
      let rIcon = isFirst ? '🏆' : (i === 1 ? '🥈' : (i === 2 ? '🥉' : `<span class="text-slate-500 text-sm font-black">#${i + 1}</span>`));
      let bgStyle = isFirst ? (theme === 'boys' ? 'bg-amber-500/20 border-amber-500/50' : 'bg-fuchsia-500/20 border-fuchsia-500/50') : 'bg-slate-800/30 border-slate-800 hover:bg-slate-800/60';
      let textStyle = isFirst ? (theme === 'boys' ? 'text-amber-400' : 'text-fuchsia-400') : 'text-white';
      return `
        <div class="flex justify-between items-center p-3 rounded-xl border ${bgStyle} transition-all">
          <div class="flex items-start gap-3 w-full">
            <div class="w-6 text-center text-lg flex-shrink-0 mt-0.5 font-black">${rIcon}</div>
            <div class="w-full">
              <div class="font-black text-white text-xs md:text-sm uppercase line-clamp-2 leading-tight pr-2">${escapeHtml(sch.name)}</div>
              <div class="text-[9px] md:text-[10px] text-slate-400 mt-0.5 font-bold uppercase">ID: ${escapeHtml(sch.id)}</div>
              <div class="text-[10px] md:text-xs mt-1 font-bold">
                <span class="${theme === 'boys' ? 'text-amber-500' : 'text-yellow-400'}">${sch.gold}G</span> •
                <span class="text-slate-300">${sch.silver}S</span> •
                <span class="${theme === 'boys' ? 'text-orange-700' : 'text-orange-500'}">${sch.bronze}B</span>
              </div>
            </div>
          </div>
          <div class="font-black text-lg md:text-xl ${textStyle} ml-2 whitespace-nowrap flex-shrink-0 self-center">${sch.points} <span class="text-[8px] md:text-[10px] text-slate-500 uppercase">PTS</span></div>
        </div>`;
    }).join('');
  }

  bCont.innerHTML = renderList(data.Boys, 'boys');
  gCont.innerHTML = renderList(data.Girls, 'girls');
}

function updateBestAthletesUI(data) {
  const boysContainer = document.getElementById('best-athletes-boys');
  const girlsContainer = document.getElementById('best-athletes-girls');
  if (!boysContainer || !girlsContainer) return;

  if (!data) {
    boysContainer.innerHTML = `<div class="text-slate-500 text-sm text-center py-4">Result Pending...</div>`;
    girlsContainer.innerHTML = `<div class="text-slate-500 text-sm text-center py-4">Result Pending...</div>`;
    return;
  }

  const categories = ['Sub Junior (U-14)', 'Junior (U-17)', 'Senior (U-19)'];
  let boysHtml = '';
  let girlsHtml = '';

  categories.forEach(cat => {
    let b = data['Boys'][cat];
    if (b) {
      boysHtml += `
        <div class="flex justify-between items-center p-3 rounded-xl border bg-slate-800/30 border-slate-800 relative overflow-hidden transition-all hover:bg-slate-800/60">
          <div class="absolute top-0 right-0 bg-amber-500/80 text-black text-[9px] font-black px-2 py-0.5 rounded-bl-lg">🏆 ${cat}</div>
          <div class="flex items-start gap-3 w-full mt-2">
            <div class="w-full pr-12">
              <div class="font-black text-white text-xs md:text-sm uppercase line-clamp-2 leading-tight">${escapeHtml(b.name)}</div>
              <div class="text-[9px] md:text-[10px] text-amber-400 font-bold uppercase mt-0.5">BIB: ${escapeHtml(b.bib)}</div>
              <div class="text-[9px] md:text-[10px] text-slate-300 font-bold uppercase mt-0.5 line-clamp-1">${escapeHtml(b.school)}</div>
              <div class="text-[9px] md:text-[10px] text-slate-500 font-bold uppercase mt-0.5">ID: ${escapeHtml(b.schoolId)}</div>
              <div class="text-[10px] md:text-xs mt-1 font-bold">
                <span class="text-amber-500">${b.gold}G</span> • <span class="text-slate-300">${b.silver}S</span> • <span class="text-orange-700">${b.bronze}B</span>
              </div>
            </div>
          </div>
          <div class="font-black text-lg md:text-xl text-amber-400 ml-2 whitespace-nowrap flex-shrink-0 self-end">${b.points} <span class="text-[8px] md:text-[10px] text-slate-500 uppercase">PTS</span></div>
        </div>`;
    } else {
      boysHtml += `<div class="p-3 rounded-xl bg-slate-800/10 border border-slate-800/50 text-center"><span class="text-slate-600 text-xs font-bold uppercase">Awaiting ${cat}</span></div>`;
    }

    let g = data['Girls'][cat];
    if (g) {
      girlsHtml += `
        <div class="flex justify-between items-center p-3 rounded-xl border bg-slate-800/30 border-slate-800 relative overflow-hidden transition-all hover:bg-slate-800/60">
          <div class="absolute top-0 right-0 bg-pink-600/80 text-white text-[9px] font-black px-2 py-0.5 rounded-bl-lg">🏆 ${cat}</div>
          <div class="flex items-start gap-3 w-full mt-2">
            <div class="w-full pr-12">
              <div class="font-black text-white text-xs md:text-sm uppercase line-clamp-2 leading-tight">${escapeHtml(g.name)}</div>
              <div class="text-[9px] md:text-[10px] text-pink-500 font-bold uppercase mt-0.5">BIB: ${escapeHtml(g.bib)}</div>
              <div class="text-[9px] md:text-[10px] text-slate-300 font-bold uppercase mt-0.5 line-clamp-1">${escapeHtml(g.school)}</div>
              <div class="text-[9px] md:text-[10px] text-slate-500 font-bold uppercase mt-0.5">ID: ${escapeHtml(g.schoolId)}</div>
              <div class="text-[10px] md:text-xs mt-1 font-bold">
                <span class="text-yellow-400">${g.gold}G</span> • <span class="text-slate-300">${g.silver}S</span> • <span class="text-orange-500">${g.bronze}B</span>
              </div>
            </div>
          </div>
          <div class="font-black text-lg md:text-xl text-pink-400 ml-2 whitespace-nowrap flex-shrink-0 self-end">${g.points} <span class="text-[8px] md:text-[10px] text-slate-500 uppercase">PTS</span></div>
        </div>`;
    } else {
      girlsHtml += `<div class="p-3 rounded-xl bg-slate-800/10 border border-slate-800/50 text-center"><span class="text-slate-600 text-xs font-bold uppercase">Awaiting ${cat}</span></div>`;
    }
  });

  boysContainer.innerHTML = boysHtml;
  girlsContainer.innerHTML = girlsHtml;
}

function fetchResults(silent) {
  const gEl = document.getElementById('sel-gender'), cEl = document.getElementById('sel-category'), eEl = document.getElementById('sel-event');
  if (!gEl || !cEl || !eEl) return;
  const g = gEl.value, c = cEl.value, e = eEl.value;
  if (!e) return;
  const subtitle = document.getElementById('results-subtitle');
  if (subtitle) subtitle.innerHTML = `<span class="bg-indigo-600 text-white px-2 py-0.5 rounded text-xs mr-2">${g}</span> ${c} • ${e}`;

  const qs = '?gender=' + encodeURIComponent(g) + '&category=' + encodeURIComponent(c) + '&event=' + encodeURIComponent(e);
  apiFetch('GET', '/api/public/live-results' + qs).then(res => {
    ['gold', 'silver', 'bronze'].forEach((m) => {
      let d = res[m];
      const card = document.getElementById(`card-${m}`);
      if (!card) return;
      card.innerHTML = d ? `
        <div class="text-xl font-black text-white truncate w-full mb-1">${escapeHtml(d.name)}</div>
        <div class="text-[10px] font-black text-indigo-400 mb-2">Bib: ${escapeHtml(d.bib)}</div>
        <div class="text-sm text-slate-400 truncate w-full">${escapeHtml(d.school)}</div>
        <div class="text-[10px] text-slate-500 mt-1">ID: ${escapeHtml(d.schoolId)}</div>
        <div class="mt-3 bg-[#020617] border border-slate-700 px-3 py-1 rounded-lg text-sm text-white font-black">${escapeHtml(d.performance)}</div>
      ` : `<div class="text-slate-600 font-black text-sm uppercase py-2">Pending</div>`;
    });
  }).catch(() => {});
}

function renderSchoolLeaderboard(containerId, s, theme) {
  const container = document.getElementById(containerId);
  if (!container) return;
  if (!s || !s.length) { container.innerHTML = `<div class="text-center text-slate-600 text-xs py-8">No points yet</div>`; return; }
  container.innerHTML = s.map((sch, i) => `
    <div class="flex justify-between items-center p-3 rounded-xl border ${i === 0 ? theme.firstBg : 'bg-slate-800/30 border-slate-800'} transition-all hover:bg-slate-800/60">
      <div class="flex items-start gap-3 w-full">
        <div class="w-6 text-center text-lg flex-shrink-0 mt-0.5 font-black ${i === 0 ? theme.firstText : 'text-slate-500'}">${i === 0 ? '🏆' : `#${i + 1}`}</div>
        <div class="w-full">
          <div class="font-black text-white text-xs md:text-sm uppercase line-clamp-2 leading-tight pr-2">${escapeHtml(sch.name)}</div>
          <div class="text-[9px] md:text-[10px] text-slate-400 font-bold mt-0.5 uppercase">ID: ${escapeHtml(sch.schoolId || '-')}</div>
          <div class="text-[10px] md:text-xs mt-1 font-bold">
            <span class="${theme.medalGold}">${sch.gold}G</span> • <span class="text-slate-300">${sch.silver}S</span> • <span class="text-orange-700">${sch.bronze}B</span>
          </div>
        </div>
      </div>
      <div class="font-black text-lg md:text-xl ${i === 0 ? theme.firstText : 'text-white'} ml-2 whitespace-nowrap flex-shrink-0 self-center">${sch.points} <span class="text-[8px] md:text-[10px] text-slate-500 uppercase">PTS</span></div>
    </div>`).join('');
}

function updateAthleticBoysLeaderboard(s) { renderSchoolLeaderboard('container-athletic-boys', s, { firstBg: 'bg-amber-500/10 border-amber-500/30', firstText: 'text-amber-400', medalGold: 'text-amber-500' }); }
function updateAthleticGirlsLeaderboard(s) { renderSchoolLeaderboard('container-athletic-girls', s, { firstBg: 'bg-amber-500/10 border-amber-500/30', firstText: 'text-amber-400', medalGold: 'text-amber-500' }); }
function updateZonalBoysLeaderboard(s) { renderSchoolLeaderboard('container-zonal-boys', s, { firstBg: 'bg-indigo-500/10 border-indigo-500/30', firstText: 'text-indigo-400', medalGold: 'text-indigo-400' }); }
function updateZonalGirlsLeaderboard(s) { renderSchoolLeaderboard('container-zonal-girls', s, { firstBg: 'bg-indigo-500/10 border-indigo-500/30', firstText: 'text-indigo-400', medalGold: 'text-indigo-400' }); }

function updateZonalFullResults(results) {
  const container = document.getElementById('tbl-zonal-full-results');
  if (!container) return;
  if (!results || results.length === 0) {
    container.innerHTML = `<tr><td colspan="6" class="p-8 text-center text-slate-500 font-bold uppercase text-sm">No zonal sports results declared yet</td></tr>`;
    return;
  }
  let html = '';
  results.forEach((r) => {
    let pos = r.position ? r.position.toString().toUpperCase().trim() : "";
    let medalBadge = `<span class="text-slate-400 font-bold text-xs">${escapeHtml(pos)}</span>`;
    if (pos.includes('1ST') || pos === '1' || pos === 'I' || pos === 'GOLD') medalBadge = '<span class="bg-amber-500/20 text-amber-400 border border-amber-500/50 px-2 py-1 rounded-full font-black text-[10px]">🥇 1ST</span>';
    else if (pos.includes('2ND') || pos === '2' || pos === 'II' || pos === 'SILVER') medalBadge = '<span class="bg-slate-400/20 text-slate-300 border border-slate-400/50 px-2 py-1 rounded-full font-black text-[10px]">🥈 2ND</span>';
    else if (pos.includes('3RD') || pos === '3' || pos === 'III' || pos === 'BRONZE') medalBadge = '<span class="bg-orange-700/20 text-orange-500 border border-orange-700/50 px-2 py-1 rounded-full font-black text-[10px]">🥉 3RD</span>';

    html += `
      <tr class="border-b border-slate-800/80 hover:bg-slate-800/30 transition">
        <td data-label="Event" class="p-3 font-bold text-white uppercase">${escapeHtml(r.event)}</td>
        <td data-label="Category" class="p-3 font-semibold text-indigo-400 uppercase">${escapeHtml(r.category)}</td>
        <td data-label="Gender" class="p-3 font-semibold text-slate-300 uppercase">${escapeHtml(r.gender)}</td>
        <td data-label="Position" class="p-3 text-center"><div>${medalBadge}</div></td>
        <td data-label="School Name" class="p-3 font-bold text-slate-200 uppercase">${escapeHtml(r.school)}</td>
        <td data-label="School ID" class="p-3 font-mono text-slate-400">${escapeHtml(r.schoolId)}</td>
      </tr>`;
  });
  container.innerHTML = html;
}

function updateAllResultsTable(results) {
  const container = document.getElementById('all-results-container');
  if (!container) return;
  if (!results || results.length === 0) {
    container.innerHTML = `<tr><td colspan="7" class="p-8 text-center text-slate-500 font-bold uppercase text-sm">No results declared yet</td></tr>`;
    return;
  }
  let html = '';
  results.forEach((r, index) => {
    let medalBadge = '';
    let pos = r.position ? r.position.toString().toUpperCase().trim() : "";
    if (pos == 'I' || pos == '1' || r.medal === 'Gold') medalBadge = '<span class="bg-amber-500/20 text-amber-400 border border-amber-500/50 px-2.5 py-1 rounded-full font-black text-xs">🥇 GOLD</span>';
    else if (pos == 'II' || pos == '2' || r.medal === 'Silver') medalBadge = '<span class="bg-slate-400/20 text-slate-300 border border-slate-400/50 px-2.5 py-1 rounded-full font-black text-xs">🥈 SILVER</span>';
    else if (pos == 'III' || pos == '3' || r.medal === 'Bronze') medalBadge = '<span class="bg-orange-700/20 text-orange-500 border border-orange-700/50 px-2.5 py-1 rounded-full font-black text-xs">🥉 BRONZE</span>';
    else medalBadge = `<span class="text-slate-400 font-bold text-xs">${escapeHtml(r.position || 'Part.')}</span>`;

    let rowClass = index === 0 ? "highlight-feedback transition" : "border-b border-slate-800/80 hover:bg-slate-800/30 transition";
    html += `
      <tr class="${rowClass}">
        <td data-label="Event Details" class="p-3.5 align-middle"><div class="font-bold text-white text-sm">${escapeHtml(r.event)}</div><div class="text-[10px] text-indigo-400 font-bold uppercase mt-0.5">${escapeHtml(r.category)} • ${escapeHtml(r.gender)}</div></td>
        <td data-label="Athlete" class="p-3.5 align-middle"><div class="font-bold text-slate-200 uppercase text-sm">${escapeHtml(r.name)}</div></td>
        <td data-label="Bib No." class="p-3.5 align-middle"><div class="text-slate-300 font-black text-sm">${escapeHtml(r.bib)}</div></td>
        <td data-label="School Name" class="p-3.5 align-middle"><div class="text-slate-300 font-semibold text-sm">${escapeHtml(r.school)}</div></td>
        <td data-label="School ID" class="p-3.5 align-middle"><div class="text-slate-400 font-bold text-xs uppercase">${escapeHtml(r.schoolId)}</div></td>
        <td data-label="Perf." class="p-3.5 align-middle"><div class="font-black text-white text-sm">${escapeHtml(r.performance)}</div></td>
        <td data-label="Medal" class="p-3.5 align-middle md:text-center"><div>${medalBadge}</div></td>
      </tr>`;
  });
  container.innerHTML = html;
}

// ---------------------------------------------------------------------
// 10. BOOTSTRAP
// ---------------------------------------------------------------------
window.onload = function () {
  initPublicDashboard();
  restoreSession();
};
