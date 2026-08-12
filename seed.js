// =====================================================================
// seed.js - creates the first Super Admin login and (optionally) imports
// the real school list (with allocated bib-number ranges) from a CSV.
//
// Run once after `npm install`:   npm run seed
// =====================================================================
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const db = require('./db');

function genId(prefix) { return prefix + '-' + crypto.randomBytes(6).toString('hex').toUpperCase(); }
function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(String(password), salt, 64).toString('hex');
  return salt + ':' + hash;
}
function nowISO() { return new Date().toISOString(); }

// ---- 1. First Super Admin -------------------------------------------------
const ADMIN_NAME = 'Zone Sports Admin';
const ADMIN_EMAIL = 'lokeshraghav.in@gmail.com';
const ADMIN_PHONE = '9456921190';
const ADMIN_PASSWORD = 'Lokesh@123';

const existingAdmin = db.prepare(`SELECT id FROM users WHERE lower(email) = lower(?)`).get(ADMIN_EMAIL);
if (existingAdmin) {
  console.log('Super Admin already exists (' + ADMIN_EMAIL + ') - skipping creation.');
} else {
  const id = genId('USR');
  db.prepare(`INSERT INTO users (id,name,email,phone,role,school_id,photo_url,password_hash,status,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)`)
    .run(id, ADMIN_NAME, ADMIN_EMAIL, ADMIN_PHONE, 'SUPER_ADMIN', '', '', hashPassword(ADMIN_PASSWORD), 'ACTIVE', nowISO());
  console.log('Super Admin created.');
  console.log('  Login ID : ' + id + '  (or use the email below)');
  console.log('  Email    : ' + ADMIN_EMAIL);
  console.log('  Password : ' + ADMIN_PASSWORD);
  console.log('  >> Change this password after your first login.');
}

// ---- 2. Optional: import schools_import.csv (with real bib ranges) -------
// Looks for the CSV either right next to this script or one folder up
// (where the Cowork session originally generated it).
const csvCandidates = [
  path.join(__dirname, 'schools_import.csv'),
  path.join(__dirname, '..', 'schools_import.csv')
];
const csvPath = csvCandidates.find(function (p) { return fs.existsSync(p); });

if (!csvPath) {
  console.log('No schools_import.csv found - skipping school import (this is optional).');
} else {
  const raw = fs.readFileSync(csvPath, 'utf8');
  const rows = parseCSV(raw);
  const header = rows[0];
  const idx = {};
  header.forEach(function (h, i) { idx[h.trim()] = i; });

  let created = 0, updated = 0;
  rows.slice(1).forEach(function (row) {
    if (!row.length || !row[idx.SchoolName]) return;
    const id = (row[idx.SchoolID] || '').trim() || genId('SCH');
    const start = row[idx.BibRangeStart] ? parseInt(row[idx.BibRangeStart], 10) : null;
    const end = row[idx.BibRangeEnd] ? parseInt(row[idx.BibRangeEnd], 10) : null;
    const existing = db.prepare(`SELECT id FROM schools WHERE id = ?`).get(id);
    if (existing) {
      db.prepare(`UPDATE schools SET name=?,code=?,email=?,phone=?,principal_name=?,address=?,bib_start=?,bib_end=? WHERE id=?`)
        .run(row[idx.SchoolName] || '', row[idx.SchoolCode] || id, row[idx.Email] || '', row[idx.Phone] || '', row[idx.PrincipalName] || '', row[idx.Address] || '', start, end, id);
      updated++;
    } else {
      db.prepare(`INSERT INTO schools (id,name,code,address,principal_name,phone,email,status,bib_start,bib_end,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)`)
        .run(id, row[idx.SchoolName] || '', row[idx.SchoolCode] || id, row[idx.Address] || '', row[idx.PrincipalName] || '', row[idx.Phone] || '', row[idx.Email] || '', 'ACTIVE', start, end, nowISO());
      created++;
    }
  });
  console.log('Schools imported from ' + csvPath + ': ' + created + ' created, ' + updated + ' updated.');
}

console.log('Seed complete.');

// Minimal quoted-field-aware CSV parser (handles commas inside quotes).
function parseCSV(text) {
  const rows = [];
  let row = [], field = '', inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i], next = text[i + 1];
    if (inQuotes) {
      if (c === '"' && next === '"') { field += '"'; i++; }
      else if (c === '"') { inQuotes = false; }
      else { field += c; }
    } else {
      if (c === '"') inQuotes = true;
      else if (c === ',') { row.push(field); field = ''; }
      else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
      else if (c === '\r') { /* skip */ }
      else { field += c; }
    }
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows.filter(function (r) { return r.length && r.some(function (c) { return String(c).trim() !== ''; }); });
}
