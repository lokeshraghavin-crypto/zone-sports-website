// =====================================================================
// Zone Sports & Athletic Meet Management System - server.js
// Node.js + Express + SQLite (better-sqlite3). Single-file backend.
// =====================================================================
const express = require('express');
const crypto = require('crypto');
const path = require('path');
const db = require('./db');

const app = express();
app.use(express.json({ limit: '15mb' })); // generous limit: base64 photo uploads
app.use(express.static(path.join(__dirname, 'public')));

const PORT = process.env.PORT || 3000;
const SESSION_MS = 6 * 60 * 60 * 1000; // 6 hours

const ROLES = {
  SUPER_ADMIN: 'SUPER_ADMIN',
  SCHOOL_TEACHER: 'SCHOOL_TEACHER',
  STARTER_OFFICIAL: 'STARTER_OFFICIAL',
  FINISH_JUDGE: 'FINISH_JUDGE',
  DUTY_OFFICIAL: 'DUTY_OFFICIAL'
};
const POSITION_POINTS = { '1st': 5, '2nd': 3, '3rd': 1, '4th': 0 };

// ---------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------
function genId(prefix) {
  return prefix + '-' + crypto.randomBytes(6).toString('hex').toUpperCase();
}
function nowISO() { return new Date().toISOString(); }

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(String(password), salt, 64).toString('hex');
  return salt + ':' + hash;
}
function verifyPassword(password, stored) {
  if (!stored || stored.indexOf(':') < 0) return false;
  const [salt, hash] = stored.split(':');
  const check = crypto.scryptSync(String(password), salt, 64).toString('hex');
  try {
    return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(check, 'hex'));
  } catch (e) { return false; }
}
function randomTempPassword() {
  return 'Zonal@' + Math.floor(100000 + Math.random() * 900000);
}
function normalizeText(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}
function formatCategory(cat) {
  const c = String(cat || '').toLowerCase();
  if (c.includes('sub') || c.includes('u-14') || c.includes('u14')) return 'Sub Junior (U-14)';
  if ((c.includes('junior') && !c.includes('sub')) || c.includes('u-17') || c.includes('u17')) return 'Junior (U-17)';
  if (c.includes('senior') || c.includes('u-19') || c.includes('u19')) return 'Senior (U-19)';
  return String(cat || '').trim();
}
function normalizePosition(raw) {
  const p = String(raw || '').toLowerCase().trim();
  if (p.includes('1st') || p === 'i' || p === '1' || p.includes('gold')) return '1st';
  if (p.includes('2nd') || p === 'ii' || p === '2' || p.includes('silver')) return '2nd';
  if (p.includes('3rd') || p === 'iii' || p === '3' || p.includes('bronze')) return '3rd';
  if (p.includes('4th') || p === 'iv' || p === '4') return '4th';
  return '';
}
function writeAudit(userId, action, module, recordId, details) {
  db.prepare(`INSERT INTO audit_log (id,user_id,action,module,record_id,details,created_at) VALUES (?,?,?,?,?,?,?)`)
    .run(genId('LOG'), userId || '', action, module, String(recordId || ''), String(details || ''), nowISO());
}

// ---- row -> API JSON mappers (field names kept close to the original
// spreadsheet-based system so the frontend logic is easy to follow) ----
function mapSchool(r) {
  if (!r) return null;
  return {
    SchoolID: r.id, SchoolName: r.name, SchoolCode: r.code, Address: r.address,
    PrincipalName: r.principal_name, Phone: r.phone, Email: r.email, Status: r.status,
    BibRangeStart: r.bib_start || '', BibRangeEnd: r.bib_end || '', CreatedAt: r.created_at
  };
}
function mapTeacher(r) {
  if (!r) return null;
  return {
    TeacherID: r.id, Name: r.name, Designation: r.designation, SchoolID: r.school_id,
    Email: r.email, Phone: r.phone, PhotoURL: r.photo_url, Status: r.status, CreatedAt: r.created_at
  };
}
function mapStudent(r) {
  if (!r) return null;
  return {
    StudentID: r.id, Name: r.name, FatherName: r.father_name, DOB: r.dob, Gender: r.gender,
    Category: r.category, SchoolID: r.school_id, PhotoURL: r.photo_url, Status: r.status,
    BibNo: r.bib_no || '', CreatedAt: r.created_at
  };
}
function mapEvent(r) {
  if (!r) return null;
  return {
    EventID: r.id, EventName: r.name, Sport: r.sport, Gender: r.gender, Category: r.category,
    EventType: r.event_type, Venue: r.venue, Status: r.status, CreatedAt: r.created_at
  };
}
function mapSchedule(r) {
  if (!r) return null;
  return {
    ScheduleID: r.id, EventID: r.event_id, EventDate: r.event_date, StartTime: r.start_time,
    ReportingTime: r.reporting_time, Venue: r.venue, Status: r.status, CreatedAt: r.created_at
  };
}
function mapEntry(r) {
  if (!r) return null;
  return {
    EntryID: r.id, EventID: r.event_id, StudentID: r.student_id, SchoolID: r.school_id,
    BibNo: r.bib_no, EntryStatus: r.entry_status, Verified: r.verified,
    VerifiedBy: r.verified_by, VerifiedAt: r.verified_at, CreatedAt: r.created_at
  };
}
function mapDuty(r) {
  if (!r) return null;
  return {
    DutyID: r.id, ScheduleID: r.schedule_id, OfficialID: r.official_id, DutyRole: r.duty_role,
    DutyLocation: r.duty_location, Status: r.status, Acknowledged: r.acknowledged,
    Completed: r.completed, ApprovedBy: r.approved_by, ApprovedAt: r.approved_at,
    IsIncharge: r.is_incharge, Attendance: r.attendance, CreatedAt: r.created_at
  };
}
function mapResult(r) {
  if (!r) return null;
  return {
    ResultID: r.id, EventID: r.event_id, StudentID: r.student_id, SchoolID: r.school_id,
    Position: r.position, Timing: r.timing, Points: r.points, ResultStatus: r.status,
    RecordedBy: r.recorded_by, RecordedAt: r.recorded_at, ApprovedBy: r.approved_by, ApprovedAt: r.approved_at
  };
}
function mapCertificate(r) {
  if (!r) return null;
  return {
    CertificateID: r.id, CertificateType: r.type, RecipientID: r.recipient_id, EventID: r.event_id,
    Position: r.position, CertificateURL: '/certificate/' + r.id, VerificationCode: r.verification_code,
    Status: r.status, GeneratedAt: r.generated_at, ApprovedBy: r.approved_by
  };
}
function mapOfficial(r) {
  if (!r) return null;
  return { OfficialID: r.id, TeacherID: r.teacher_id, Role: r.role, Status: r.status, CreatedAt: r.created_at };
}

// ---------------------------------------------------------------------
// Auth / session middleware
// ---------------------------------------------------------------------
function createSession(userId) {
  const token = crypto.randomBytes(32).toString('hex');
  db.prepare(`INSERT INTO sessions (token,user_id,expires_at) VALUES (?,?,?)`).run(token, userId, Date.now() + SESSION_MS);
  return token;
}
function getSessionUser(token) {
  if (!token) return null;
  const row = db.prepare(`SELECT * FROM sessions WHERE token = ?`).get(token);
  if (!row) return null;
  if (row.expires_at < Date.now()) { db.prepare(`DELETE FROM sessions WHERE token = ?`).run(token); return null; }
  const user = db.prepare(`SELECT * FROM users WHERE id = ?`).get(row.user_id);
  if (!user || String(user.status).toUpperCase() !== 'ACTIVE') return null;
  return {
    userId: user.id, name: user.name, email: user.email, role: user.role,
    schoolId: user.school_id || '', photoUrl: user.photo_url || ''
  };
}
function authToken(req) {
  const header = req.headers.authorization || '';
  if (header.startsWith('Bearer ')) return header.slice(7);
  return req.body && req.body.token ? req.body.token : (req.query.token || '');
}
function requireAuth(allowedRoles) {
  return function (req, res, next) {
    const token = authToken(req);
    const user = getSessionUser(token);
    if (!user) return res.status(401).json({ error: 'Session expired. Please log in again.' });
    if (allowedRoles && allowedRoles.length && allowedRoles.indexOf(user.role) === -1) {
      return res.status(403).json({ error: 'You do not have permission for this module.' });
    }
    req.user = user;
    next();
  };
}
function handle(fn) {
  return function (req, res) {
    try {
      const result = fn(req, res);
      if (result !== undefined) res.json(result);
    } catch (e) {
      res.status(400).json({ error: e.message || 'Something went wrong.' });
    }
  };
}

function resolveCurrentTeacherId(user) {
  if (!user.email) return '';
  const t = db.prepare(`SELECT id FROM teachers WHERE lower(email) = lower(?)`).get(user.email);
  return t ? t.id : '';
}
function resolveCurrentOfficialIds(user) {
  const teacherId = resolveCurrentTeacherId(user);
  if (!teacherId) return [];
  return db.prepare(`SELECT id FROM officials WHERE teacher_id = ?`).all(teacherId).map(function (o) { return o.id; });
}
function isUserInchargeAnywhere(user) {
  const ids = resolveCurrentOfficialIds(user);
  if (!ids.length) return false;
  const placeholders = ids.map(function () { return '?'; }).join(',');
  const row = db.prepare(`SELECT COUNT(*) c FROM duties WHERE is_incharge='YES' AND official_id IN (${placeholders})`).get(...ids);
  return row.c > 0;
}

// ---------------------------------------------------------------------
// Bib number allocation
// ---------------------------------------------------------------------
function assignStudentBib(schoolId) {
  const school = db.prepare(`SELECT * FROM schools WHERE id = ?`).get(schoolId);
  if (!school || school.bib_start == null || school.bib_end == null) return '';
  const used = db.prepare(`SELECT bib_no FROM students WHERE school_id = ? AND bib_no IS NOT NULL`).all(schoolId)
    .map(function (r) { return r.bib_no; });
  let next = school.bib_start;
  if (used.length) next = Math.max.apply(null, used) + 1;
  if (next > school.bib_end) {
    throw new Error('Bib number range (' + school.bib_start + '-' + school.bib_end + ') for this school is used up. Ask the Zone Admin to extend it.');
  }
  return next;
}

// =====================================================================
// AUTH ROUTES
// =====================================================================
app.post('/api/auth/login', handle(function (req) {
  const idOrEmail = String((req.body && req.body.id) || '').trim();
  const password = String((req.body && req.body.password) || '');
  if (!idOrEmail || !password) return { success: false, message: 'User ID / Email and password are required.' };

  const user = db.prepare(`SELECT * FROM users WHERE id = ? OR lower(email) = lower(?)`).get(idOrEmail, idOrEmail);
  if (!user) return { success: false, message: 'Invalid User ID / Email or password.' };
  if (String(user.status).toUpperCase() !== 'ACTIVE') return { success: false, message: 'This account is not active.' };
  if (!verifyPassword(password, user.password_hash)) return { success: false, message: 'Invalid User ID / Email or password.' };

  const token = createSession(user.id);
  writeAudit(user.id, 'LOGIN', 'AUTH', user.id, 'Successful login');
  return {
    success: true, token: token,
    user: { userId: user.id, name: user.name, email: user.email, role: user.role, schoolId: user.school_id || '', photoUrl: user.photo_url || '' }
  };
}));

app.post('/api/auth/logout', handle(function (req) {
  const token = authToken(req);
  if (token) db.prepare(`DELETE FROM sessions WHERE token = ?`).run(token);
  return { success: true };
}));

app.get('/api/auth/session', handle(function (req) {
  const user = getSessionUser(authToken(req));
  if (!user) return { success: false };
  return { success: true, user: user };
}));

// =====================================================================
// PUBLIC LIVE DASHBOARD (no login required)
// =====================================================================
app.get('/api/public/visitor-count', handle(function () {
  const row = db.prepare(`SELECT value FROM meta WHERE key='visitor_count'`).get();
  const count = (row ? parseInt(row.value, 10) : 1500) + 1;
  db.prepare(`INSERT INTO meta (key,value) VALUES ('visitor_count',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`).run(String(count));
  return count;
}));

app.post('/api/public/feedback', handle(function (req) {
  const name = String((req.body && req.body.name) || '').trim();
  const text = String((req.body && req.body.text) || '').trim();
  if (!name || !text) throw new Error('Name and feedback text are required.');
  db.prepare(`INSERT INTO feedback (id,name,text,created_at) VALUES (?,?,?,?)`).run(genId('FB'), name, text, nowISO());
  return { success: true };
}));

app.get('/api/public/feedback', handle(function () {
  return db.prepare(`SELECT * FROM feedback ORDER BY created_at DESC LIMIT 100`).all().map(function (f) {
    return { name: f.name, text: f.text, time: new Date(f.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) };
  });
}));

app.get('/api/public/dashboard-stats', handle(function () {
  const athletes = db.prepare(`SELECT COUNT(*) c FROM students WHERE status='ACTIVE'`).get().c;
  const schools = db.prepare(`SELECT COUNT(*) c FROM schools WHERE status='ACTIVE'`).get().c;
  const results = db.prepare(`SELECT r.*, e.name event_name, e.category, e.gender FROM results r JOIN events e ON e.id = r.event_id`).all();
  let golds = 0, silvers = 0, bronzes = 0;
  const uniqueEvents = new Set();
  let latestStr = 'Awaiting Results...';
  let latestTime = '';
  results.forEach(function (r) {
    uniqueEvents.add(r.event_id);
    if (r.position === '1st') golds++;
    else if (r.position === '2nd') silvers++;
    else if (r.position === '3rd') bronzes++;
    if (!latestTime || r.recorded_at > latestTime) {
      latestTime = r.recorded_at;
      latestStr = r.event_name + ' - ' + formatCategory(r.category) + ' ' + r.gender;
    }
  });
  return {
    athletes: athletes || '1500+', schools: schools || '115', events: uniqueEvents.size,
    golds: golds, silvers: silvers, bronzes: bronzes, latestEventStr: latestStr, totalResults: results.length
  };
}));

app.get('/api/public/overall-leaders', handle(function () {
  const rows = db.prepare(`
    SELECT r.*, e.gender, s.name school_name, s.id school_id
    FROM results r JOIN events e ON e.id = r.event_id JOIN schools s ON s.id = r.school_id
  `).all();
  const boards = { Boys: {}, Girls: {} };
  rows.forEach(function (r) {
    const g = /girl/i.test(r.gender) ? 'Girls' : 'Boys';
    const map = boards[g];
    if (!map[r.school_id]) map[r.school_id] = { name: r.school_name, id: r.school_id, points: 0, gold: 0, silver: 0, bronze: 0 };
    const pts = POSITION_POINTS[r.position] || 0;
    map[r.school_id].points += pts;
    if (r.position === '1st') map[r.school_id].gold++;
    else if (r.position === '2nd') map[r.school_id].silver++;
    else if (r.position === '3rd') map[r.school_id].bronze++;
  });
  function topTen(map) {
    return Object.values(map).sort(function (a, b) { return b.points - a.points || b.gold - a.gold || b.silver - a.silver; }).slice(0, 10);
  }
  return { Boys: topTen(boards.Boys), Girls: topTen(boards.Girls) };
}));

app.get('/api/public/top-schools', handle(function (req) {
  const gender = req.query.gender || '';
  const type = req.query.type || 'athletic'; // 'athletic' = Track/Field events, 'zonal' = Team games
  const rows = db.prepare(`
    SELECT r.*, e.gender, e.category, e.event_type, s.name school_name FROM results r
    JOIN events e ON e.id = r.event_id JOIN schools s ON s.id = r.school_id
  `).all().filter(function (r) {
    var genderOk = !gender || gender === 'All' || (gender === 'Boys' ? !/girl/i.test(r.gender) : /girl/i.test(r.gender));
    var typeOk = type === 'all' || (type === 'zonal' ? r.event_type === 'TEAM' : r.event_type !== 'TEAM');
    return genderOk && typeOk;
  });

  const map = {};
  rows.forEach(function (r) {
    if (!map[r.school_id]) map[r.school_id] = { name: r.school_name, schoolId: r.school_id, gold: 0, silver: 0, bronze: 0, points: 0 };
    const pts = POSITION_POINTS[r.position] || 0;
    map[r.school_id].points += pts;
    if (r.position === '1st') map[r.school_id].gold++;
    else if (r.position === '2nd') map[r.school_id].silver++;
    else if (r.position === '3rd') map[r.school_id].bronze++;
  });
  return Object.values(map).sort(function (a, b) { return b.points - a.points; }).slice(0, 10);
}));

app.get('/api/public/best-athletes', handle(function () {
  const rows = db.prepare(`
    SELECT r.*, e.gender, e.category, e.name event_name, st.name student_name, st.bib_no, s.name school_name
    FROM results r JOIN events e ON e.id = r.event_id JOIN students st ON st.id = r.student_id JOIN schools s ON s.id = r.school_id
  `).all();
  const athletes = {};
  rows.forEach(function (r) {
    const gender = /girl/i.test(r.gender) ? 'Girls' : 'Boys';
    const category = formatCategory(r.category);
    const key = gender + '|' + category + '|' + r.student_id;
    if (!athletes[key]) athletes[key] = { name: r.student_name, school: r.school_name, schoolId: r.school_id, bib: r.bib_no || '-', gender: gender, category: category, gold: 0, silver: 0, bronze: 0, points: 0 };
    const pts = POSITION_POINTS[r.position] || 0;
    athletes[key].points += pts;
    if (r.position === '1st') athletes[key].gold++;
    else if (r.position === '2nd') athletes[key].silver++;
    else if (r.position === '3rd') athletes[key].bronze++;
  });
  const list = Object.values(athletes);
  const cats = ['Sub Junior (U-14)', 'Junior (U-17)', 'Senior (U-19)'];
  const best = { Boys: {}, Girls: {} };
  ['Boys', 'Girls'].forEach(function (g) {
    cats.forEach(function (c) {
      const filtered = list.filter(function (a) { return a.gender === g && a.category === c; })
        .sort(function (a, b) { return b.points - a.points || b.gold - a.gold; });
      best[g][c] = filtered[0] || null;
    });
  });
  return best;
}));

app.get('/api/public/all-results', handle(function (req) {
  const type = req.query.type || 'all'; // 'athletic', 'zonal', or 'all'
  let rows = db.prepare(`
    SELECT r.*, e.name event_name, e.category, e.gender, e.event_type, st.name student_name, st.bib_no, s.name school_name
    FROM results r JOIN events e ON e.id = r.event_id JOIN students st ON st.id = r.student_id JOIN schools s ON s.id = r.school_id
    ORDER BY r.recorded_at DESC
  `).all();
  if (type !== 'all') rows = rows.filter(function (r) { return type === 'zonal' ? r.event_type === 'TEAM' : r.event_type !== 'TEAM'; });
  return rows.map(function (r) {
    const medal = r.position === '1st' ? 'Gold' : r.position === '2nd' ? 'Silver' : r.position === '3rd' ? 'Bronze' : 'Participant';
    return {
      event: r.event_name, category: formatCategory(r.category), gender: /girl/i.test(r.gender) ? 'Girls' : 'Boys',
      position: r.position.toUpperCase(), name: r.student_name, school: r.school_name, schoolId: r.school_id,
      bib: r.bib_no || '-', performance: r.timing || 'Recorded', medal: medal
    };
  });
}));

app.get('/api/public/glimpse-photos', handle(function () {
  const row = db.prepare(`SELECT value FROM meta WHERE key='glimpse_photos'`).get();
  if (!row) return [];
  try { return JSON.parse(row.value); } catch (e) { return []; }
}));

app.get('/api/public/filters', handle(function () {
  const events = db.prepare(`SELECT DISTINCT name FROM events`).all().map(function (e) { return e.name; });
  const latest = db.prepare(`
    SELECT e.name event_name, e.category, e.gender FROM results r JOIN events e ON e.id = r.event_id
    ORDER BY r.recorded_at DESC LIMIT 1
  `).get();
  return {
    genders: ['Boys', 'Girls'], categories: ['Sub Junior (U-14)', 'Junior (U-17)', 'Senior (U-19)'], events: events,
    latest: latest ? { event: latest.event_name, category: formatCategory(latest.category), gender: /girl/i.test(latest.gender) ? 'Girls' : 'Boys' } : { gender: 'Boys', category: 'Sub Junior (U-14)', event: '' }
  };
}));

app.get('/api/public/live-results', handle(function (req) {
  const gender = req.query.gender || '', category = req.query.category || '', eventName = req.query.event || '';
  const rows = db.prepare(`
    SELECT r.*, e.name event_name, e.category, e.gender, st.name student_name, st.bib_no, s.name school_name
    FROM results r JOIN events e ON e.id = r.event_id JOIN students st ON st.id = r.student_id JOIN schools s ON s.id = r.school_id
    WHERE e.name = ? AND e.category = ?
  `).all(eventName, category);
  const result = { gold: null, silver: null, bronze: null };
  rows.forEach(function (r) {
    const g = /girl/i.test(r.gender) ? 'Girls' : 'Boys';
    if (g !== gender) return;
    const athlete = { name: r.student_name, school: r.school_name, schoolId: r.school_id, bib: r.bib_no || 'N/A', performance: r.timing || 'Recorded' };
    if (r.position === '1st') result.gold = athlete;
    else if (r.position === '2nd') result.silver = athlete;
    else if (r.position === '3rd') result.bronze = athlete;
  });
  return result;
}));

// =====================================================================
// GENERIC MODULE DATA (role-aware)
// =====================================================================
app.get('/api/module/:name', requireAuth(), handle(function (req) {
  return getModuleData(req.user, req.params.name);
}));

function getStudentsForUser(user) {
  if (user.role === ROLES.SUPER_ADMIN) return db.prepare(`SELECT * FROM students`).all().map(mapStudent);
  return db.prepare(`SELECT * FROM students WHERE school_id = ?`).all(user.schoolId).map(mapStudent);
}
function getEventsForUser(user) {
  const all = db.prepare(`SELECT * FROM events`).all().map(mapEvent);
  if ([ROLES.SUPER_ADMIN, ROLES.STARTER_OFFICIAL, ROLES.FINISH_JUDGE].indexOf(user.role) >= 0) return all;
  const myEventIds = new Set(db.prepare(`SELECT DISTINCT event_id FROM event_entries WHERE school_id = ?`).all(user.schoolId).map(function (r) { return r.event_id; }));
  return all.filter(function (e) { return myEventIds.has(e.EventID) || e.Status === 'SCHEDULED'; });
}
function getSchedulesJoined() {
  return db.prepare(`SELECT * FROM event_schedule`).all().map(function (s) {
    const ev = db.prepare(`SELECT * FROM events WHERE id = ?`).get(s.event_id);
    return Object.assign(mapSchedule(s), { EventName: ev ? ev.name : '', Sport: ev ? ev.sport : '', Gender: ev ? ev.gender : '', Category: ev ? ev.category : '' });
  });
}
function getDutiesForUser(user) {
  let rows = db.prepare(`SELECT * FROM duties`).all();
  if (user.role !== ROLES.SUPER_ADMIN) {
    const ids = resolveCurrentOfficialIds(user);
    rows = rows.filter(function (d) { return ids.indexOf(d.official_id) >= 0; });
  }
  return rows.map(function (d) {
    const sc = db.prepare(`SELECT * FROM event_schedule WHERE id = ?`).get(d.schedule_id);
    const ev = sc ? db.prepare(`SELECT * FROM events WHERE id = ?`).get(sc.event_id) : null;
    return Object.assign(mapDuty(d), {
      EventName: ev ? ev.name : '', EventDate: sc ? sc.event_date : '', StartTime: sc ? sc.start_time : '',
      ReportingTime: sc ? sc.reporting_time : '', Venue: sc ? sc.venue : d.duty_location
    });
  });
}
function getManagementResults(user) {
  let rows = db.prepare(`SELECT * FROM results`).all();
  return rows.map(function (r) {
    const st = db.prepare(`SELECT * FROM students WHERE id = ?`).get(r.student_id);
    const ev = db.prepare(`SELECT * FROM events WHERE id = ?`).get(r.event_id);
    return Object.assign(mapResult(r), {
      StudentName: st ? st.name : '', FatherName: st ? st.father_name : '', PhotoURL: st ? st.photo_url : '',
      Category: st ? st.category : '', Gender: st ? st.gender : '', EventName: ev ? ev.name : ''
    });
  }).filter(function (r) {
    return user.role === ROLES.SUPER_ADMIN || (function () {
      const st = db.prepare(`SELECT school_id FROM students WHERE id = ?`).get(r.StudentID);
      return st && st.school_id === user.schoolId;
    })();
  });
}
function getCertificatesForUser(user) {
  const certs = db.prepare(`SELECT * FROM certificates`).all().map(mapCertificate);
  if (user.role === ROLES.SUPER_ADMIN) return certs;
  const studentIds = new Set(db.prepare(`SELECT id FROM students WHERE school_id = ?`).all(user.schoolId).map(function (s) { return s.id; }));
  const teacherIds = new Set(db.prepare(`SELECT id FROM teachers WHERE school_id = ?`).all(user.schoolId).map(function (t) { return t.id; }));
  return certs.filter(function (c) { return studentIds.has(c.RecipientID) || teacherIds.has(c.RecipientID); });
}
function getVerificationQueue(user) {
  let rows = db.prepare(`SELECT * FROM event_entries WHERE verified != 'YES'`).all();
  if (user.role === ROLES.SCHOOL_TEACHER) rows = rows.filter(function (e) { return e.school_id === user.schoolId; });
  return rows.map(function (e) {
    const ev = db.prepare(`SELECT * FROM events WHERE id = ?`).get(e.event_id);
    const st = db.prepare(`SELECT * FROM students WHERE id = ?`).get(e.student_id);
    return Object.assign(mapEntry(e), { EventName: ev ? ev.name : '', StudentName: st ? st.name : '', PhotoURL: st ? st.photo_url : '' });
  });
}
function getTeachersForAdmin() {
  return db.prepare(`SELECT * FROM teachers`).all().map(function (t) {
    const u = t.email ? db.prepare(`SELECT * FROM users WHERE lower(email) = lower(?)`).get(t.email) : null;
    return Object.assign(mapTeacher(t), { LoginRole: u ? u.role : '', HasLogin: !!u });
  });
}
function getAdminReport() {
  return {
    generatedAt: nowISO(),
    schools: db.prepare(`SELECT COUNT(*) c FROM schools WHERE status != 'INACTIVE'`).get().c,
    teachers: db.prepare(`SELECT COUNT(*) c FROM teachers WHERE status != 'INACTIVE'`).get().c,
    students: db.prepare(`SELECT COUNT(*) c FROM students WHERE status != 'INACTIVE'`).get().c,
    events: db.prepare(`SELECT COUNT(*) c FROM events`).get().c,
    entries: db.prepare(`SELECT COUNT(*) c FROM event_entries`).get().c,
    verified: db.prepare(`SELECT COUNT(*) c FROM event_entries WHERE verified='YES'`).get().c,
    results: db.prepare(`SELECT COUNT(*) c FROM results`).get().c,
    certificates: db.prepare(`SELECT COUNT(*) c FROM certificates`).get().c,
    dutiesCompleted: db.prepare(`SELECT COUNT(*) c FROM duties WHERE completed='YES'`).get().c
  };
}

function getModuleData(user, moduleName) {
  const m = String(moduleName || '').toLowerCase();
  if (user.role === ROLES.SUPER_ADMIN) {
    if (m === 'schools') return db.prepare(`SELECT * FROM schools`).all().map(mapSchool);
    if (m === 'teachers') return getTeachersForAdmin();
    if (m === 'students') return db.prepare(`SELECT * FROM students`).all().map(mapStudent);
    if (m === 'events') return db.prepare(`SELECT * FROM events`).all().map(mapEvent);
    if (m === 'schedules') return getSchedulesJoined();
    if (m === 'duties') return getDutiesForUser(user);
    if (m === 'results') return getManagementResults(user);
    if (m === 'certificates') return db.prepare(`SELECT * FROM certificates`).all().map(mapCertificate);
    if (m === 'reports') return getAdminReport();
  }
  if (m === 'students') return getStudentsForUser(user);
  if (m === 'events') return getEventsForUser(user);
  if (m === 'schedules') return getSchedulesJoined();
  if (m === 'duties') return getDutiesForUser(user);
  if (m === 'verification') return getVerificationQueue(user);
  if (m === 'results') return getManagementResults(user);
  if (m === 'certificates') return getCertificatesForUser(user);
  throw new Error('Unknown or unauthorized module: ' + moduleName);
}

// =====================================================================
// SCHOOLS
// =====================================================================
app.post('/api/schools', requireAuth([ROLES.SUPER_ADMIN]), handle(function (req) {
  const d = req.body || {};
  if (!d.SchoolName) throw new Error('School name is required.');
  const start = d.BibRangeStart ? parseInt(d.BibRangeStart, 10) : null;
  const end = d.BibRangeEnd ? parseInt(d.BibRangeEnd, 10) : null;
  if (start != null && end != null && start > end) throw new Error('Bib range start must be less than or equal to the end.');

  const id = d.SchoolID || genId('SCH');
  const existing = db.prepare(`SELECT id FROM schools WHERE id = ?`).get(id);
  if (existing) {
    db.prepare(`UPDATE schools SET name=?,code=?,address=?,principal_name=?,phone=?,email=?,status=?,bib_start=?,bib_end=? WHERE id=?`)
      .run(d.SchoolName, d.SchoolCode || '', d.Address || '', d.PrincipalName || '', d.Phone || '', d.Email || '', (d.Status || 'ACTIVE').toUpperCase(), start, end, id);
  } else {
    db.prepare(`INSERT INTO schools (id,name,code,address,principal_name,phone,email,status,bib_start,bib_end,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)`)
      .run(id, d.SchoolName, d.SchoolCode || '', d.Address || '', d.PrincipalName || '', d.Phone || '', d.Email || '', 'ACTIVE', start, end, nowISO());
  }
  writeAudit(req.user.userId, existing ? 'UPDATE' : 'CREATE', 'SCHOOLS', id, d.SchoolName);
  return { success: true, schoolId: id };
}));

app.delete('/api/schools/:id', requireAuth([ROLES.SUPER_ADMIN]), handle(function (req) {
  db.prepare(`UPDATE schools SET status='INACTIVE' WHERE id=?`).run(req.params.id);
  writeAudit(req.user.userId, 'DEACTIVATE', 'SCHOOLS', req.params.id, 'School marked inactive');
  return { success: true };
}));

// =====================================================================
// TEACHERS / OFFICIALS
// =====================================================================
function ensureLoginForTeacher(teacher, loginRole) {
  if (!teacher.email) return { loginCreated: false };
  const existingUser = db.prepare(`SELECT * FROM users WHERE lower(email) = lower(?)`).get(teacher.email);
  if (existingUser) return { loginCreated: false, userId: existingUser.id };
  const password = randomTempPassword();
  const userId = genId('USR');
  db.prepare(`INSERT INTO users (id,name,email,phone,role,school_id,photo_url,password_hash,status,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)`)
    .run(userId, teacher.name, teacher.email, teacher.phone || '', loginRole, teacher.school_id || '', teacher.photo_url || '', hashPassword(password), 'ACTIVE', nowISO());
  return { loginCreated: true, userId: userId, temporaryPassword: password };
}

app.post('/api/teachers', requireAuth([ROLES.SUPER_ADMIN]), handle(function (req) {
  const d = req.body || {};
  if (!d.Name) throw new Error('Name is required.');
  const loginRole = String(d.LoginRole || ROLES.SCHOOL_TEACHER).toUpperCase();
  const schoolId = String(d.SchoolID || '').trim() || (loginRole === ROLES.SCHOOL_TEACHER ? '' : 'ZONE');
  if (loginRole === ROLES.SCHOOL_TEACHER && !schoolId) throw new Error('School is required for a School Teacher.');

  const id = d.TeacherID || genId('TCH');
  const existing = db.prepare(`SELECT id FROM teachers WHERE id = ?`).get(id);
  if (existing) {
    db.prepare(`UPDATE teachers SET name=?,designation=?,school_id=?,email=?,phone=?,photo_url=?,status=? WHERE id=?`)
      .run(d.Name, d.Designation || '', schoolId, d.Email || '', d.Phone || '', d.PhotoURL || '', (d.Status || 'ACTIVE').toUpperCase(), id);
  } else {
    db.prepare(`INSERT INTO teachers (id,name,designation,school_id,email,phone,photo_url,status,created_at) VALUES (?,?,?,?,?,?,?,?,?)`)
      .run(id, d.Name, d.Designation || '', schoolId, d.Email || '', d.Phone || '', d.PhotoURL || '', 'ACTIVE', nowISO());
  }

  const teacher = db.prepare(`SELECT * FROM teachers WHERE id = ?`).get(id);
  const loginResult = ensureLoginForTeacher(teacher, loginRole);

  if (loginRole !== ROLES.SCHOOL_TEACHER) {
    const officialExisting = db.prepare(`SELECT id FROM officials WHERE teacher_id = ?`).get(id);
    if (!officialExisting) {
      db.prepare(`INSERT INTO officials (id,teacher_id,role,status,created_at) VALUES (?,?,?,?,?)`)
        .run(genId('OFF'), id, loginRole, 'ACTIVE', nowISO());
    }
  }

  writeAudit(req.user.userId, existing ? 'UPDATE' : 'CREATE', 'TEACHERS', id, d.Name);
  return Object.assign({ success: true, teacherId: id }, loginResult);
}));

app.get('/api/teachers', requireAuth([ROLES.SUPER_ADMIN]), handle(function () {
  return getTeachersForAdmin();
}));

app.post('/api/teachers/:id/ensure-login', requireAuth([ROLES.SUPER_ADMIN]), handle(function (req) {
  const teacher = db.prepare(`SELECT * FROM teachers WHERE id = ?`).get(req.params.id);
  if (!teacher) throw new Error('Teacher not found.');
  if (!teacher.email) throw new Error('Teacher email is required.');
  const result = ensureLoginForTeacher(teacher, ROLES.SCHOOL_TEACHER);
  writeAudit(req.user.userId, 'CREATE', 'USERS', result.userId || '', 'Login ensured for ' + teacher.name);
  return Object.assign({ success: true, created: !!result.loginCreated }, result);
}));

// =====================================================================
// STUDENTS + PHOTO UPLOAD
// =====================================================================
app.post('/api/upload-photo', requireAuth(), handle(function (req) {
  const data = req.body || {};
  if (!data.base64) throw new Error('No image data received.');
  // Photos are stored as data: URLs directly (portable across any host,
  // no filesystem/object-storage configuration required).
  return { success: true, url: data.base64 };
}));

app.post('/api/students', requireAuth([ROLES.SUPER_ADMIN, ROLES.SCHOOL_TEACHER]), handle(function (req) {
  const d = req.body || {};
  if (req.user.role === ROLES.SCHOOL_TEACHER) d.SchoolID = req.user.schoolId;
  const schoolId = String(d.SchoolID || '').trim();
  if (!d.Name || !schoolId) throw new Error('Student name and School are required.');

  const id = d.StudentID || genId('STD');
  const existing = db.prepare(`SELECT * FROM students WHERE id = ?`).get(id);

  let bibNo = d.BibNo ? parseInt(d.BibNo, 10) : null;
  if (!bibNo && existing && existing.bib_no) bibNo = existing.bib_no;
  if (!bibNo) bibNo = assignStudentBib(schoolId) || null;

  if (existing) {
    db.prepare(`UPDATE students SET name=?,father_name=?,dob=?,gender=?,category=?,school_id=?,photo_url=?,status=?,bib_no=? WHERE id=?`)
      .run(d.Name, d.FatherName || '', d.DOB || '', d.Gender || '', d.Category || '', schoolId, d.PhotoURL || '', (d.Status || 'ACTIVE').toUpperCase(), bibNo, id);
  } else {
    db.prepare(`INSERT INTO students (id,name,father_name,dob,gender,category,school_id,photo_url,status,bib_no,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)`)
      .run(id, d.Name, d.FatherName || '', d.DOB || '', d.Gender || '', d.Category || '', schoolId, d.PhotoURL || '', 'ACTIVE', bibNo, nowISO());
  }
  writeAudit(req.user.userId, existing ? 'UPDATE' : 'CREATE', 'STUDENTS', id, d.Name);
  return { success: true, studentId: id, bibNo: bibNo || '' };
}));

app.delete('/api/students/:id', requireAuth([ROLES.SUPER_ADMIN, ROLES.SCHOOL_TEACHER]), handle(function (req) {
  const student = db.prepare(`SELECT * FROM students WHERE id = ?`).get(req.params.id);
  if (!student) throw new Error('Student not found.');
  if (req.user.role === ROLES.SCHOOL_TEACHER && student.school_id !== req.user.schoolId) throw new Error('You can only manage students from your school.');
  db.prepare(`UPDATE students SET status='INACTIVE' WHERE id=?`).run(req.params.id);
  writeAudit(req.user.userId, 'DEACTIVATE', 'STUDENTS', req.params.id, 'Student marked inactive');
  return { success: true };
}));

// =====================================================================
// EVENTS + SCHEDULE
// =====================================================================
app.post('/api/events', requireAuth([ROLES.SUPER_ADMIN]), handle(function (req) {
  const d = req.body || {};
  if (!d.EventName) throw new Error('Event name is required.');
  const id = d.EventID || genId('EVT');
  const existing = db.prepare(`SELECT id FROM events WHERE id = ?`).get(id);
  if (existing) {
    db.prepare(`UPDATE events SET name=?,sport=?,gender=?,category=?,event_type=?,venue=?,status=? WHERE id=?`)
      .run(d.EventName, d.Sport || 'Athletics', d.Gender || 'Open', d.Category || 'Open', d.EventType || 'TRACK', d.Venue || '', (d.Status || 'SCHEDULED').toUpperCase(), id);
  } else {
    db.prepare(`INSERT INTO events (id,name,sport,gender,category,event_type,venue,status,created_at) VALUES (?,?,?,?,?,?,?,?,?)`)
      .run(id, d.EventName, d.Sport || 'Athletics', d.Gender || 'Open', d.Category || 'Open', d.EventType || 'TRACK', d.Venue || '', 'SCHEDULED', nowISO());
  }
  writeAudit(req.user.userId, existing ? 'UPDATE' : 'CREATE', 'EVENTS', id, d.EventName);
  return { success: true, eventId: id };
}));

app.post('/api/schedules', requireAuth([ROLES.SUPER_ADMIN]), handle(function (req) {
  const d = req.body || {};
  if (!d.EventID) throw new Error('Event ID is required.');
  let row = db.prepare(`SELECT * FROM event_schedule WHERE event_id = ?`).get(d.EventID);
  if (d.ScheduleID) row = db.prepare(`SELECT * FROM event_schedule WHERE id = ?`).get(d.ScheduleID);
  const id = (row && row.id) || genId('SCHD');
  if (row) {
    db.prepare(`UPDATE event_schedule SET event_date=?,start_time=?,reporting_time=?,venue=?,status=? WHERE id=?`)
      .run(d.EventDate || '', d.StartTime || '', d.ReportingTime || '', d.Venue || '', (d.Status || 'UPCOMING').toUpperCase(), id);
  } else {
    db.prepare(`INSERT INTO event_schedule (id,event_id,event_date,start_time,reporting_time,venue,status,created_at) VALUES (?,?,?,?,?,?,?,?)`)
      .run(id, d.EventID, d.EventDate || '', d.StartTime || '', d.ReportingTime || '', d.Venue || '', 'UPCOMING', nowISO());
  }
  writeAudit(req.user.userId, row ? 'UPDATE' : 'CREATE', 'EVENT_SCHEDULE', id, d.EventID);
  return { success: true, scheduleId: id };
}));

app.get('/api/schedules', requireAuth(), handle(function () { return getSchedulesJoined(); }));

app.get('/api/upcoming-events', requireAuth(), handle(function () {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  return getSchedulesJoined().filter(function (s) {
    if (['COMPLETED', 'CANCELLED'].indexOf(s.Status) >= 0) return false;
    if (!s.EventDate) return true;
    const d = new Date(s.EventDate);
    return isNaN(d.getTime()) || d >= today;
  });
}));

app.post('/api/events/:id/finalize', requireAuth([ROLES.SUPER_ADMIN]), handle(function (req) {
  const eventId = req.params.id;
  const event = db.prepare(`SELECT * FROM events WHERE id = ?`).get(eventId);
  if (!event) throw new Error('Event not found.');
  db.prepare(`UPDATE events SET status='COMPLETED' WHERE id=?`).run(eventId);

  const results = db.prepare(`SELECT * FROM results WHERE event_id = ? AND position IN ('1st','2nd','3rd','4th')`).all(eventId);
  let generated = 0;
  results.forEach(function (r) {
    const exists = db.prepare(`SELECT id FROM certificates WHERE type='STUDENT' AND recipient_id=? AND event_id=? AND position=?`).get(r.student_id, eventId, r.position);
    if (exists) return;
    const code = 'CERT-' + crypto.randomBytes(5).toString('hex').toUpperCase();
    db.prepare(`INSERT INTO certificates (id,type,recipient_id,event_id,position,verification_code,status,generated_at,approved_by) VALUES (?,?,?,?,?,?,?,?,?)`)
      .run(genId('CERT'), 'STUDENT', r.student_id, eventId, r.position, code, 'GENERATED', nowISO(), '');
    generated++;
  });
  writeAudit(req.user.userId, 'FINALIZE', 'EVENTS', eventId, 'Certificates generated: ' + generated);
  return { success: true, certificatesGenerated: generated };
}));

// =====================================================================
// EVENT ENTRIES
// =====================================================================
app.get('/api/students-for-entry', requireAuth([ROLES.SUPER_ADMIN, ROLES.SCHOOL_TEACHER]), handle(function (req) {
  return getStudentsForUser(req.user);
}));

app.post('/api/event-entries', requireAuth([ROLES.SUPER_ADMIN, ROLES.SCHOOL_TEACHER]), handle(function (req) {
  const d = req.body || {};
  const eventId = d.eventId;
  const studentIds = Array.isArray(d.studentIds) ? d.studentIds : [];
  if (!eventId) throw new Error('Event ID is required.');
  const event = db.prepare(`SELECT id FROM events WHERE id = ?`).get(eventId);
  if (!event) throw new Error('Event not found.');

  const allowed = {};
  getStudentsForUser(req.user).forEach(function (s) { allowed[s.StudentID] = s; });
  const created = [];

  studentIds.forEach(function (sid) {
    const student = allowed[sid];
    if (!student) return;
    const already = db.prepare(`SELECT id FROM event_entries WHERE event_id=? AND student_id=? AND entry_status != 'CANCELLED'`).get(eventId, sid);
    if (already) return;

    let bib = student.BibNo || '';
    if (!bib) {
      try { bib = assignStudentBib(student.SchoolID); db.prepare(`UPDATE students SET bib_no=? WHERE id=?`).run(bib, sid); } catch (e) { /* range exhausted */ }
    }
    if (!bib) bib = 'TBD';

    const entryId = genId('ENT');
    db.prepare(`INSERT INTO event_entries (id,event_id,student_id,school_id,bib_no,entry_status,verified,verified_by,verified_at,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)`)
      .run(entryId, eventId, sid, student.SchoolID, String(bib), 'ENTERED', 'NO', '', '', nowISO());
    created.push({ EntryID: entryId, StudentID: sid, BibNo: bib });
  });

  writeAudit(req.user.userId, 'CREATE', 'EVENT_ENTRIES', eventId, 'Entries added: ' + created.length);
  return { success: true, created: created };
}));

app.get('/api/event-entries/:eventId', requireAuth(), handle(function (req) {
  const rows = db.prepare(`SELECT * FROM event_entries WHERE event_id = ?`).all(req.params.eventId);
  return rows.map(function (e) {
    const st = db.prepare(`SELECT * FROM students WHERE id = ?`).get(e.student_id);
    const sch = st ? db.prepare(`SELECT * FROM schools WHERE id = ?`).get(st.school_id) : null;
    return Object.assign(mapEntry(e), {
      StudentName: st ? st.name : '', FatherName: st ? st.father_name : '', Gender: st ? st.gender : '',
      Category: st ? st.category : '', SchoolName: sch ? sch.name : '', PhotoURL: st ? st.photo_url : ''
    });
  });
}));

app.get('/api/verification-board/:eventId', requireAuth([ROLES.SUPER_ADMIN, ROLES.STARTER_OFFICIAL, ROLES.FINISH_JUDGE, ROLES.SCHOOL_TEACHER]), handle(function (req) {
  let rows = db.prepare(`SELECT * FROM event_entries WHERE event_id = ?`).all(req.params.eventId);
  if (req.user.role === ROLES.SCHOOL_TEACHER) rows = rows.filter(function (e) { return e.school_id === req.user.schoolId; });
  return rows.map(function (e) {
    const st = db.prepare(`SELECT * FROM students WHERE id = ?`).get(e.student_id);
    const sch = st ? db.prepare(`SELECT * FROM schools WHERE id = ?`).get(st.school_id) : null;
    return Object.assign(mapEntry(e), {
      StudentName: st ? st.name : '', FatherName: st ? st.father_name : '', Gender: st ? st.gender : '',
      Category: st ? st.category : '', SchoolName: sch ? sch.name : '', PhotoURL: st ? st.photo_url : ''
    });
  });
}));

app.get('/api/finish-board/:eventId', requireAuth([ROLES.SUPER_ADMIN, ROLES.FINISH_JUDGE]), handle(function (req) {
  const rows = db.prepare(`SELECT * FROM event_entries WHERE event_id = ? AND verified='YES'`).all(req.params.eventId);
  return rows.map(function (e) {
    const st = db.prepare(`SELECT * FROM students WHERE id = ?`).get(e.student_id);
    const sch = st ? db.prepare(`SELECT * FROM schools WHERE id = ?`).get(st.school_id) : null;
    const result = db.prepare(`SELECT * FROM results WHERE event_id=? AND student_id=?`).get(req.params.eventId, e.student_id);
    return Object.assign(mapEntry(e), {
      StudentName: st ? st.name : '', SchoolName: sch ? sch.name : '', PhotoURL: st ? st.photo_url : '',
      ResultID: result ? result.id : '', Position: result ? result.position : '', Timing: result ? result.timing : ''
    });
  });
}));

// =====================================================================
// VERIFICATION (Starting Point + Incharge)
// =====================================================================
app.post('/api/verify-entry', requireAuth(), handle(function (req) {
  const user = req.user;
  const baseAllowed = [ROLES.SUPER_ADMIN, ROLES.STARTER_OFFICIAL, ROLES.SCHOOL_TEACHER].indexOf(user.role) >= 0;
  if (!baseAllowed && !isUserInchargeAnywhere(user)) throw new Error('You do not have permission for this module.');

  const d = req.body || {};
  const entry = db.prepare(`SELECT * FROM event_entries WHERE id = ?`).get(d.entryId);
  if (!entry) throw new Error('Entry not found.');
  if (user.role === ROLES.SCHOOL_TEACHER && entry.school_id !== user.schoolId) throw new Error('You can only verify students from your school.');

  db.prepare(`UPDATE event_entries SET verified=?,verified_by=?,verified_at=? WHERE id=?`)
    .run(d.verified ? 'YES' : 'NO', user.userId, nowISO(), d.entryId);
  db.prepare(`INSERT INTO verification_log (id,entry_id,event_id,student_id,verified,verified_by,remarks,created_at) VALUES (?,?,?,?,?,?,?,?)`)
    .run(genId('VER'), entry.id, entry.event_id, entry.student_id, d.verified ? 'YES' : 'NO', user.userId, d.remarks || '', nowISO());

  writeAudit(user.userId, 'VERIFY', 'EVENT_ENTRIES', d.entryId, d.remarks || '');
  return { success: true };
}));

// =====================================================================
// DUTIES + INCHARGE / ATTENDANCE
// =====================================================================
app.post('/api/duties/assign', requireAuth([ROLES.SUPER_ADMIN]), handle(function (req) {
  const d = req.body || {};
  const teacherId = d.TeacherID, eventId = d.EventID;
  if (!teacherId || !eventId) throw new Error('Teacher/Official and Event are required.');
  const teacher = db.prepare(`SELECT * FROM teachers WHERE id = ?`).get(teacherId);
  if (!teacher) throw new Error('Teacher/Official not found.');
  const event = db.prepare(`SELECT * FROM events WHERE id = ?`).get(eventId);
  if (!event) throw new Error('Event not found.');
  if (!String(d.DutyLocation || '').trim()) throw new Error('Duty location/activity is required.');

  const dutyRole = String(d.DutyRole || ROLES.DUTY_OFFICIAL).toUpperCase();

  let official = db.prepare(`SELECT * FROM officials WHERE teacher_id = ?`).get(teacherId);
  if (!official) {
    const officialId = genId('OFF');
    db.prepare(`INSERT INTO officials (id,teacher_id,role,status,created_at) VALUES (?,?,?,?,?)`).run(officialId, teacherId, dutyRole, 'ACTIVE', nowISO());
    official = { id: officialId };
  }

  let schedule = db.prepare(`SELECT * FROM event_schedule WHERE event_id = ?`).get(eventId);
  if (!schedule) {
    const scheduleId = genId('SCHD');
    db.prepare(`INSERT INTO event_schedule (id,event_id,event_date,start_time,reporting_time,venue,status,created_at) VALUES (?,?,?,?,?,?,?,?)`)
      .run(scheduleId, eventId, d.EventDate || '', d.StartTime || '', d.ReportingTime || '', d.DutyLocation || event.venue || '', 'UPCOMING', nowISO());
    schedule = { id: scheduleId };
  }

  const isIncharge = d.IsIncharge ? 'YES' : 'NO';
  const dutyId = genId('DUTY');
  db.prepare(`INSERT INTO duties (id,schedule_id,official_id,duty_role,duty_location,status,acknowledged,completed,is_incharge,attendance,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)`)
    .run(dutyId, schedule.id, official.id, dutyRole, d.DutyLocation || event.venue || '', 'ASSIGNED', 'NO', 'NO', isIncharge, 'PENDING', nowISO());

  // Ensure a login exists so the person can reach their dashboard.
  if (teacher.email) ensureLoginForTeacher(teacher, dutyRole);

  writeAudit(req.user.userId, 'ASSIGN', 'DUTIES', dutyId, teacher.name + ' / ' + event.name);
  return { success: true, dutyId: dutyId };
}));

app.post('/api/duties/:id/acknowledge', requireAuth(), handle(function (req) {
  db.prepare(`UPDATE duties SET acknowledged='YES' WHERE id=?`).run(req.params.id);
  writeAudit(req.user.userId, 'ACKNOWLEDGE', 'DUTIES', req.params.id, '');
  return { success: true };
}));
app.post('/api/duties/:id/complete', requireAuth(), handle(function (req) {
  db.prepare(`UPDATE duties SET completed='YES' WHERE id=?`).run(req.params.id);
  writeAudit(req.user.userId, 'COMPLETE', 'DUTIES', req.params.id, '');
  return { success: true };
}));
app.post('/api/duties/:id/approve', requireAuth([ROLES.SUPER_ADMIN]), handle(function (req) {
  db.prepare(`UPDATE duties SET status='APPROVED',approved_by=?,approved_at=? WHERE id=?`).run(req.user.userId, nowISO(), req.params.id);
  writeAudit(req.user.userId, 'APPROVE', 'DUTIES', req.params.id, '');
  return { success: true };
}));

app.get('/api/my-incharge-stations', requireAuth(), handle(function (req) {
  const user = req.user;
  const myOfficialIds = resolveCurrentOfficialIds(user);
  if (!myOfficialIds.length) return [];
  const placeholders = myOfficialIds.map(function () { return '?'; }).join(',');
  const myDuties = db.prepare(`SELECT * FROM duties WHERE is_incharge='YES' AND official_id IN (${placeholders})`).all(...myOfficialIds);

  return myDuties.map(function (d) {
    const teammates = db.prepare(`SELECT * FROM duties WHERE schedule_id=? AND duty_location=? AND id != ?`).all(d.schedule_id, d.duty_location, d.id)
      .map(function (x) {
        const off = db.prepare(`SELECT * FROM officials WHERE id = ?`).get(x.official_id);
        const t = off ? db.prepare(`SELECT * FROM teachers WHERE id = ?`).get(off.teacher_id) : null;
        return { DutyID: x.id, Name: t ? t.name : '', DutyRole: x.duty_role, Attendance: x.attendance || 'PENDING', PhotoURL: t ? t.photo_url : '' };
      });
    const sc = db.prepare(`SELECT * FROM event_schedule WHERE id = ?`).get(d.schedule_id);
    const ev = sc ? db.prepare(`SELECT * FROM events WHERE id = ?`).get(sc.event_id) : null;
    return { DutyID: d.id, ScheduleID: d.schedule_id, DutyLocation: d.duty_location, EventName: ev ? ev.name : '', EventDate: sc ? sc.event_date : '', teammates: teammates };
  });
}));

app.post('/api/duties/:id/attendance', requireAuth(), handle(function (req) {
  const user = req.user;
  const target = db.prepare(`SELECT * FROM duties WHERE id = ?`).get(req.params.id);
  if (!target) throw new Error('Duty not found.');

  if (user.role !== ROLES.SUPER_ADMIN) {
    const myOfficialIds = resolveCurrentOfficialIds(user);
    const isIncharge = db.prepare(`SELECT COUNT(*) c FROM duties WHERE is_incharge='YES' AND schedule_id=? AND duty_location=? AND official_id IN (${myOfficialIds.map(function () { return '?'; }).join(',') || "''"})`)
      .get(target.schedule_id, target.duty_location, ...myOfficialIds).c;
    if (!isIncharge) throw new Error('Only the designated Incharge for this duty station can mark attendance.');
  }

  db.prepare(`UPDATE duties SET attendance=? WHERE id=?`).run(String((req.body && req.body.status) || 'PENDING').toUpperCase(), req.params.id);
  writeAudit(user.userId, 'ATTENDANCE', 'DUTIES', req.params.id, (req.body && req.body.status) || '');
  return { success: true };
}));

// =====================================================================
// RESULTS (Finish Line)
// =====================================================================
app.post('/api/results', requireAuth([ROLES.SUPER_ADMIN, ROLES.FINISH_JUDGE]), handle(function (req) {
  const d = req.body || {};
  const position = normalizePosition(d.Position);
  if (!d.EventID || !d.StudentID || !position) throw new Error('Event, student and a valid position (1st-4th) are required.');

  const event = db.prepare(`SELECT * FROM events WHERE id = ?`).get(d.EventID);
  if (!event) throw new Error('Event not found.');
  const student = db.prepare(`SELECT * FROM students WHERE id = ?`).get(d.StudentID);
  if (!student) throw new Error('Student not found.');
  const schoolId = d.SchoolID || student.school_id;
  const points = POSITION_POINTS[position] || 0;

  const existing = db.prepare(`SELECT * FROM results WHERE event_id=? AND student_id=?`).get(d.EventID, d.StudentID);
  if (existing) {
    db.prepare(`UPDATE results SET school_id=?,position=?,timing=?,points=?,recorded_by=?,recorded_at=? WHERE id=?`)
      .run(schoolId, position, d.Timing || '', points, req.user.userId, nowISO(), existing.id);
  } else {
    db.prepare(`INSERT INTO results (id,event_id,student_id,school_id,position,timing,points,status,recorded_by,recorded_at,approved_by,approved_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(genId('RES'), d.EventID, d.StudentID, schoolId, position, d.Timing || '', points, 'RECORDED', req.user.userId, nowISO(), '', '');
  }
  writeAudit(req.user.userId, existing ? 'UPDATE' : 'CREATE', 'RESULTS', d.EventID, position + ' / ' + (d.Timing || ''));
  return { success: true };
}));

app.post('/api/results/:id/approve', requireAuth([ROLES.SUPER_ADMIN]), handle(function (req) {
  db.prepare(`UPDATE results SET status='APPROVED',approved_by=?,approved_at=? WHERE id=?`).run(req.user.userId, nowISO(), req.params.id);
  writeAudit(req.user.userId, 'APPROVE', 'RESULTS', req.params.id, '');
  return { success: true };
}));

// =====================================================================
// CERTIFICATES
// =====================================================================
app.post('/api/certificates/student/:resultId', requireAuth([ROLES.SUPER_ADMIN, ROLES.SCHOOL_TEACHER, ROLES.FINISH_JUDGE]), handle(function (req) {
  const r = db.prepare(`SELECT * FROM results WHERE id = ?`).get(req.params.resultId);
  if (!r) throw new Error('Result not found.');
  const student = db.prepare(`SELECT * FROM students WHERE id = ?`).get(r.student_id);
  if (!student) throw new Error('Student not found.');
  if (req.user.role === ROLES.SCHOOL_TEACHER && student.school_id !== req.user.schoolId) throw new Error('You can only generate certificates for your school.');

  const code = 'CERT-' + crypto.randomBytes(5).toString('hex').toUpperCase();
  const id = genId('CERT');
  db.prepare(`INSERT INTO certificates (id,type,recipient_id,event_id,position,verification_code,status,generated_at,approved_by) VALUES (?,?,?,?,?,?,?,?,?)`)
    .run(id, 'STUDENT', student.id, r.event_id, r.position, code, 'GENERATED', nowISO(), '');
  writeAudit(req.user.userId, 'GENERATE', 'CERTIFICATES', id, student.name);
  return { success: true, certificateId: id, url: '/certificate/' + id };
}));

app.post('/api/certificates/duty/:dutyId', requireAuth(), handle(function (req) {
  const duty = db.prepare(`SELECT * FROM duties WHERE id = ?`).get(req.params.dutyId);
  if (!duty) throw new Error('Duty not found.');
  if (duty.completed !== 'YES' && req.user.role !== ROLES.SUPER_ADMIN) throw new Error('Duty must be marked completed before generating the certificate.');
  const official = db.prepare(`SELECT * FROM officials WHERE id = ?`).get(duty.official_id);
  const teacher = official ? db.prepare(`SELECT * FROM teachers WHERE id = ?`).get(official.teacher_id) : null;
  if (!teacher) throw new Error('Teacher/official not found.');

  const code = 'CERT-' + crypto.randomBytes(5).toString('hex').toUpperCase();
  const id = genId('CERT');
  db.prepare(`INSERT INTO certificates (id,type,recipient_id,event_id,position,verification_code,status,generated_at,approved_by) VALUES (?,?,?,?,?,?,?,?,?)`)
    .run(id, 'TEACHER', teacher.id, '', duty.duty_role, code, 'GENERATED', nowISO(), '');
  writeAudit(req.user.userId, 'GENERATE', 'CERTIFICATES', id, teacher.name);
  return { success: true, certificateId: id, url: '/certificate/' + id };
}));

app.post('/api/certificates/:id/approve', requireAuth([ROLES.SUPER_ADMIN]), handle(function (req) {
  db.prepare(`UPDATE certificates SET status='APPROVED',approved_by=? WHERE id=?`).run(req.user.userId, req.params.id);
  writeAudit(req.user.userId, 'APPROVE', 'CERTIFICATES', req.params.id, '');
  return { success: true };
}));

app.get('/certificate/:id', function (req, res) {
  const cert = db.prepare(`SELECT * FROM certificates WHERE id = ?`).get(req.params.id);
  if (!cert) return res.status(404).send('Certificate not found.');
  let recipientName = 'Participant', photoUrl = '', eventName = 'Zone Sports Meet';
  if (cert.type === 'STUDENT') {
    const s = db.prepare(`SELECT * FROM students WHERE id = ?`).get(cert.recipient_id);
    if (s) { recipientName = s.name; photoUrl = s.photo_url || ''; }
    const ev = db.prepare(`SELECT * FROM events WHERE id = ?`).get(cert.event_id);
    if (ev) eventName = ev.name;
  } else {
    const t = db.prepare(`SELECT * FROM teachers WHERE id = ?`).get(cert.recipient_id);
    if (t) { recipientName = t.name; photoUrl = t.photo_url || ''; }
  }
  res.send(`<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Certificate - ${recipientName}</title>
  <style>
    body{font-family:Georgia,serif;text-align:center;padding:45px;background:#fff;color:#111827}
    .border{border:12px double #111827;padding:35px;min-height:650px;max-width:900px;margin:0 auto}
    h1{font-size:38px;margin:5px;color:#111827}.gold{color:#b45309}
    .name{font-size:32px;font-weight:bold;margin:25px 0}.small{font-size:12px;color:#6b7280}
    img.photo{width:110px;height:140px;object-fit:cover;border:3px solid #111827;border-radius:8px;margin:15px auto;display:block}
    @media print { .noprint { display:none; } }
  </style></head><body>
  <div class="border">
    <h1>ZONE SPORTS MEET</h1><div class="gold">OFFICIAL CERTIFICATE</div>
    <p>This certificate is proudly presented to</p>
    ${photoUrl ? `<img class="photo" src="${photoUrl}">` : ''}
    <div class="name">${recipientName}</div>
    <p>${cert.type === 'STUDENT' ? 'for outstanding participation and achievement' : 'for valuable official duty and service'}</p>
    <h2>${eventName}</h2>
    ${cert.position ? `<h2 class="gold">Position: ${cert.position}</h2>` : ''}
    <p>Certificate Type: ${cert.type}</p>
    <p class="small">Verification Code: ${cert.verification_code}</p>
    <p class="small">Generated: ${new Date(cert.generated_at).toLocaleString()}</p>
  </div>
  <div class="noprint" style="margin-top:20px;"><button onclick="window.print()">Print / Save as PDF</button></div>
  </body></html>`);
});

// =====================================================================
// BULK IMPORT (CSV rows parsed client-side, posted as JSON)
// =====================================================================
app.post('/api/bulk/schools', requireAuth([ROLES.SUPER_ADMIN]), handle(function (req) {
  const rows = Array.isArray(req.body && req.body.rows) ? req.body.rows : [];
  let created = 0, updated = 0; const failed = [];
  rows.forEach(function (row, idx) {
    try {
      const id = String(row.SchoolID || '').trim();
      const existing = id ? db.prepare(`SELECT id FROM schools WHERE id=?`).get(id) : null;
      const start = row.BibRangeStart ? parseInt(row.BibRangeStart, 10) : null;
      const end = row.BibRangeEnd ? parseInt(row.BibRangeEnd, 10) : null;
      const finalId = id || genId('SCH');
      if (existing) {
        db.prepare(`UPDATE schools SET name=?,code=?,email=?,phone=?,principal_name=?,address=?,bib_start=?,bib_end=? WHERE id=?`)
          .run(row.SchoolName || row.Name || '', row.SchoolCode || finalId, row.Email || '', row.Phone || '', row.PrincipalName || '', row.Address || '', start, end, finalId);
        updated++;
      } else {
        db.prepare(`INSERT INTO schools (id,name,code,address,principal_name,phone,email,status,bib_start,bib_end,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)`)
          .run(finalId, row.SchoolName || row.Name || '', row.SchoolCode || finalId, row.Address || '', row.PrincipalName || '', row.Phone || '', row.Email || '', 'ACTIVE', start, end, nowISO());
        created++;
      }
    } catch (e) { failed.push({ row: idx + 2, name: row.SchoolName || '', error: e.message }); }
  });
  writeAudit(req.user.userId, 'BULK_IMPORT', 'SCHOOLS', '', created + ' created, ' + updated + ' updated');
  return { success: true, created: created, updated: updated, failed: failed };
}));

app.post('/api/bulk/teachers', requireAuth([ROLES.SUPER_ADMIN]), handle(function (req) {
  const rows = Array.isArray(req.body && req.body.rows) ? req.body.rows : [];
  const schools = db.prepare(`SELECT * FROM schools`).all();
  const byName = {}; schools.forEach(function (s) { byName[normalizeText(s.name)] = s.id; });
  function resolveSchoolId(row) {
    const direct = String(row.SchoolID || '').trim();
    if (direct) return direct;
    const name = String(row.SchoolName || '').trim();
    if (!name) return '';
    const norm = normalizeText(name);
    if (byName[norm]) return byName[norm];
    const match = schools.find(function (s) { const sn = normalizeText(s.name); return sn.indexOf(norm) >= 0 || norm.indexOf(sn) >= 0; });
    return match ? match.id : '';
  }

  let created = 0, updated = 0; const failed = [];
  rows.forEach(function (row, idx) {
    try {
      const loginRole = String(row.LoginRole || ROLES.SCHOOL_TEACHER).toUpperCase();
      const id = String(row.TeacherID || '').trim() || genId('TCH');
      const existing = db.prepare(`SELECT id FROM teachers WHERE id=?`).get(id);
      const schoolId = resolveSchoolId(row);
      if (existing) {
        db.prepare(`UPDATE teachers SET name=?,designation=?,school_id=?,email=?,phone=? WHERE id=?`)
          .run(row.Name || '', row.Designation || '', schoolId, row.Email || '', row.Phone || '', id);
        updated++;
      } else {
        db.prepare(`INSERT INTO teachers (id,name,designation,school_id,email,phone,photo_url,status,created_at) VALUES (?,?,?,?,?,?,?,?,?)`)
          .run(id, row.Name || '', row.Designation || '', schoolId, row.Email || '', row.Phone || '', '', 'ACTIVE', nowISO());
        created++;
      }
      const teacher = db.prepare(`SELECT * FROM teachers WHERE id = ?`).get(id);
      const loginResult = ensureLoginForTeacher(teacher, loginRole);
      if (loginRole !== ROLES.SCHOOL_TEACHER) {
        const off = db.prepare(`SELECT id FROM officials WHERE teacher_id=?`).get(id);
        if (!off) db.prepare(`INSERT INTO officials (id,teacher_id,role,status,created_at) VALUES (?,?,?,?,?)`).run(genId('OFF'), id, loginRole, 'ACTIVE', nowISO());
      }
      if (loginResult.loginCreated) {
        failed.push({ row: idx + 2, name: row.Name || '', error: 'INFO: login created (' + loginResult.userId + ' / ' + loginResult.temporaryPassword + ')', info: true });
      }
    } catch (e) { failed.push({ row: idx + 2, name: row.Name || '', error: e.message }); }
  });
  writeAudit(req.user.userId, 'BULK_IMPORT', 'TEACHERS', '', created + ' created, ' + updated + ' updated');
  return { success: true, created: created, updated: updated, failed: failed };
}));

app.post('/api/bulk/events', requireAuth([ROLES.SUPER_ADMIN]), handle(function (req) {
  const rows = Array.isArray(req.body && req.body.rows) ? req.body.rows : [];
  let created = 0, skipped = 0; const failed = [];
  rows.forEach(function (row, idx) {
    try {
      const name = row.EventName || row.Name || '';
      if (!name) throw new Error('Event name is required.');
      const gender = row.Gender || '', category = row.Category || '';
      let event = db.prepare(`SELECT * FROM events WHERE lower(name)=lower(?) AND lower(gender)=lower(?) AND category=?`).get(name, gender, formatCategory(category));
      if (event) {
        skipped++;
      } else {
        const id = genId('EVT');
        db.prepare(`INSERT INTO events (id,name,sport,gender,category,event_type,venue,status,created_at) VALUES (?,?,?,?,?,?,?,?,?)`)
          .run(id, name, row.Sport || 'Athletics', gender, formatCategory(category), row.EventType || 'TRACK', row.Venue || '', 'SCHEDULED', nowISO());
        event = { id: id };
        created++;
      }
      if (row.EventDate) {
        const existingSchedule = db.prepare(`SELECT * FROM event_schedule WHERE event_id=?`).get(event.id);
        if (existingSchedule) {
          db.prepare(`UPDATE event_schedule SET event_date=?,venue=? WHERE id=?`).run(row.EventDate, row.Venue || '', existingSchedule.id);
        } else {
          db.prepare(`INSERT INTO event_schedule (id,event_id,event_date,start_time,reporting_time,venue,status,created_at) VALUES (?,?,?,?,?,?,?,?)`)
            .run(genId('SCHD'), event.id, row.EventDate, '', '', row.Venue || '', 'UPCOMING', nowISO());
        }
      }
    } catch (e) { failed.push({ row: idx + 2, name: row.EventName || '', error: e.message }); }
  });
  writeAudit(req.user.userId, 'BULK_IMPORT', 'EVENTS', '', created + ' created, ' + skipped + ' skipped');
  return { success: true, created: created, skipped: skipped, failed: failed };
}));

// =====================================================================
// Fallback -> SPA
// =====================================================================
app.get('*', function (req, res) {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, function () {
  console.log('Zone Sports Portal running on http://localhost:' + PORT);
});
