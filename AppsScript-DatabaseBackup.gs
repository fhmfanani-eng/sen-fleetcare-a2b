/**
 * ================= SEN-FleetCare — DATABASE BACKUP (Apps Script) v3.2 =================
 * Deploy script ini KHUSUS di spreadsheet backup:
 *   https://docs.google.com/spreadsheets/d/1ADSaUT1u1veuMCFhoMzxhWsmz0XBRJV1xjz-JD6iS0Q
 *
 * Fungsinya: menerima 1 payload besar dari tombol "☁ Sync Semua Database ke Spreadsheet"
 * (menu Database Akun di web SEN-FleetCare), berisi:
 *   - tables    : data semua modul  → 1 tab per modul (tabel rapi, header + isi)
 *   - native    : data tampilan web -> ditulis sebagai TABEL + CHART NATIVE Google Sheets:
 *                 "Dashboard", "Dashboard Service", "Dashboard Quarter", "Mechanic Activity Report"
 *   - snapshots : (tidak dipakai lagi oleh web v56; tetap didukung untuk kompatibilitas)
 *
 * SHEET NATIVE (v3.1):
 *   Mechanic Activity Report : 4 chart (Total Job per Mechanic, Job Category Composition,
 *                              Job Status Composition, Mechanic Activity Trend) + tabel Historical Report
 *   Dashboard Service        : chart Stacked by Unit + % Close per Type Service + tabel Service Achievement
 *   Dashboard Quarter        : chart Grafik Quarter + tabel KPI Summary Quarter
 *   Data chart ada di tab tersembunyi "_Chart ..." (jangan dihapus).
 *
 * DASHBOARD (v3.0) — TIDAK LAGI SNAPSHOT GAMBAR:
 *   Sheet "Dashboard" ditulis sebagai TABEL NATIVE + CHART NATIVE Google Sheets, tampilannya
 *   sama dengan sheet Dashboard di spreadsheet SEN-Maintenance:
 *     - Tabel "Breakdown Category" per bulan (+ Average, Total, baris TOTAL) berwarna
 *     - Chart kolom "Breakdown Category per Month"
 *     - Tabel "Monthly KPI Achievement" + chart garis
 *   Tab lama hasil snapshot ("Dashboard - Breakdown Category", "Dashboard - Service",
 *   "Dashboard - KPI Maintenance", "Dashboard - Monthly KPI Achievement",
 *   "Dashboard - Trend & Comparison", "Dashboard - Quarter Summary") DIHAPUS otomatis.
 *   Data chart disimpan di tab tersembunyi "_Chart Data" (jangan dihapus).
 *
 * TAB YANG DIKECUALIKAN (tidak ditulis & dihapus jika sudah ada):
 *   P2H | Pre Inspection | Pre Inspection Plans | Breakdown report / Breakdown Reports
 *   KPI Performance | KPI Performance History | CBM Target Life Overrides
 *   RCA | Lainnya - Damage Photo Records | HM Telemetry
 *
 * GRAFIK & CHART:
 *   Dashboard = chart native (bisa diklik/diedit di Sheets). Mechanic Activity Report masih
 *   memakai gambar PNG dari web (writeSnapshotSheet).
 *
 * LAYOUT TERKUNCI (lihat konstanta LAYOUT di bawah):
 *   - Lebar kolom dihitung dari isi terpanjang (min–maks), tidak ada teks terpotong
 *   - Teks panjang otomatis di-wrap, tinggi baris otomatis menyesuaikan isi
 *   - Layout diterapkan ulang tiap sync, dan sheet diberi proteksi mode-peringatan
 *     supaya tidak terubah tak sengaja (script tetap bisa menulis ulang)
 *
 * ---------------- CARA DEPLOY ----------------
 * 1. Buka spreadsheet backup di atas.
 * 2. Menu Extensions/Ekstensi → Apps Script.
 * 3. Hapus isi Code.gs bawaan, tempel SELURUH isi file ini.
 * 4. Klik Deploy → New deployment (Web app, Execute as: Me, Who has access: Anyone).
 *    SUDAH PERNAH DEPLOY? → Deploy → Manage deployments → ikon pensil → Version: New version → Deploy.
 *    (Web App URL tetap sama.)
 * 5. Salin Web App URL (diakhiri /exec) — kalau sudah pernah dipakai di web, tidak perlu diganti.
 * ------------------------------------------------
 */

var LAYOUT = {
  MIN_COL_PX: 60,        // lebar kolom minimum
  MAX_COL_PX: 380,       // lebar kolom maksimum (lebih dari ini → teks di-wrap ke baris berikutnya)
  CHAR_PX: 7,            // perkiraan lebar 1 karakter (font 10pt)
  PAD_PX: 18,            // ruang kiri-kanan sel
  LOCK_SHEETS: true,     // proteksi mode-peringatan (set false untuk mematikan)
  BORDER: '#2b3440'
};

/**
 * Tab yang TIDAK boleh ada di spreadsheet backup.
 * Di-skip saat write, dan dihapus jika sudah ada (nama di-normalize: case-insensitive, spasi fleksibel).
 * - P2H, Pre Inspection, Pre Inspection Plans, Breakdown Reports
 * - KPI Performance, KPI Performance History, CBM Target Life Overrides
 */
var EXCLUDED_SHEETS = [
  'P2H',
  'Pre Inspection',
  'Pre Inspection Plans',
  'Breakdown report',
  'Breakdown Reports',
  'KPI Performance',
  'KPI Performance History',
  'CBM Target Life Overrides',
  'RCA',
  'Lainnya - Damage Photo Records',
  'Damage Photo Records',
  'HM Telemetry'
];

/** Konfigurasi tampilan sheet "Dashboard" (meniru sheet Dashboard di SEN-Maintenance). */
var DASH = {
  SHEET: 'Dashboard',
  CHART_SHEET: '_Chart Data',
  HEADER_BG: '#1F4E79',
  HEADER_FG: '#FFFFFF',
  TOTAL_BG: '#DCE6F1',
  GRID: '#B7B7B7',
  COL_A_PX: 150,
  COL_PX: 105,
  CHART_H: 420,
  ROW_PX: 21,
  CAT_COLORS: { 'breakdown': '#E06666', 'daily maintenance': '#A4C2F4', 'periodical': '#FFD966' },
  SERIES_COLORS: ['#E5484D', '#4A90D9', '#FFC72C'],
  KPI_COLORS: ['#4A90D9', '#2FBF71', '#FFC72C', '#E5484D', '#9B6DFF', '#26C6DA', '#7F8C8D']
};

/** Nama tab dari payload / hasil snapshot lama yang dipetakan ke sheet "Dashboard" native. */
var DASH_TABLE_BREAKDOWN = 'dashboard - breakdown category';
var DASH_TABLE_KPI = 'dashboard - monthly kpi achievement';

/** Tab hasil snapshot lama — dihapus otomatis, digantikan sheet "Dashboard" native. */
var LEGACY_DASHBOARD_SHEETS = [
  'Dashboard - Breakdown Category',
  'Dashboard - Service',
  'Dashboard - KPI Maintenance',
  'Dashboard - Monthly KPI Achievement',
  'Dashboard - Trend & Comparison',
  'Dashboard - Quarter Summary'
];

function normalizeSheetKey(name) {
  return String(name || '').toLowerCase().replace(/\s+/g, ' ').trim();
}

function isExcludedSheet(name) {
  var key = normalizeSheetKey(name);
  for (var i = 0; i < EXCLUDED_SHEETS.length; i++) {
    if (normalizeSheetKey(EXCLUDED_SHEETS[i]) === key) return true;
  }
  return false;
}

/** Hapus sheet yang masuk daftar exclude (proteksi di-remove dulu supaya bisa dihapus). */
function deleteExcludedSheets(ss) {
  var deleted = [];
  var sheets = ss.getSheets();
  for (var i = 0; i < sheets.length; i++) {
    var sh = sheets[i];
    var nm = sh.getName();
    if (!isExcludedSheet(nm)) continue;
    try {
      try { sh.getProtections(SpreadsheetApp.ProtectionType.SHEET).forEach(function (p) { p.remove(); }); } catch (_e) {}
      // Google Sheets wajib punya minimal 1 sheet — jangan hapus kalau itu satu-satunya
      if (ss.getSheets().length <= 1) {
        sh.clear();
        sh.setName('_empty');
        deleted.push(nm + ' (cleared)');
      } else {
        ss.deleteSheet(sh);
        deleted.push(nm);
      }
    } catch (err) {
      deleted.push(nm + ' (gagal: ' + String(err) + ')');
    }
  }
  return deleted;
}

function doPost(e) {
  try {
    var payload = JSON.parse(e.postData.contents);
    var action = payload.action || 'sync';
    var ss = openTargetSpreadsheet(payload.spreadsheetId);

    if (action === 'fullBackup') return handleFullBackup(ss, payload);
    if (action === 'sync') return handleSingleSync(ss, payload);
    return jsonResponse({ ok: false, error: 'Unknown action: ' + action });
  } catch (err) {
    return jsonResponse({ ok: false, error: String(err) });
  }
}

function doGet(e) {
  return jsonResponse({ ok: true, message: 'SEN-FleetCare Database Backup endpoint aktif (v3.2 — native views).' });
}

function openTargetSpreadsheet(spreadsheetId) {
  var active = SpreadsheetApp.getActiveSpreadsheet();
  if (!spreadsheetId || (active && active.getId() === spreadsheetId)) {
    return active || SpreadsheetApp.openById(spreadsheetId);
  }
  return SpreadsheetApp.openById(spreadsheetId);
}

/** action:"fullBackup" — payload.tables = { "Nama Tab": [records] }, payload.snapshots = { "Nama Tab": snapshot }
 *  Snapshot berisi layout tampilan web (Dashboard, Mechanic Activity Report) termasuk grafik/chart
 *  sebagai gambar PNG base64 — ditulis lewat writeSnapshotSheet (insertImage).
 */
function handleFullBackup(ss, payload) {
  var tables = payload.tables || {};
  var snapshots = payload.snapshots || {};
  var results = {};
  var errors = {};
  var skipped = [];
  var totalWritten = 0;

  // Hapus dulu tab yang tidak diinginkan (kalau sudah ada dari sync sebelumnya)
  var deleted = deleteExcludedSheets(ss);
  // Hapus tab Dashboard hasil snapshot lama (digantikan sheet "Dashboard" native)
  deleted = deleted.concat(deleteLegacyDashboardSheets(ss));

  var dashBreakdown = null, dashKpi = null;
  var nat = payload.native || {};

  Object.keys(tables).forEach(function (sheetName) {
    if (isExcludedSheet(sheetName)) {
      skipped.push(sheetName);
      return;
    }
    // Data Dashboard → ditulis sebagai tabel + chart native (lihat writeDashboardNative)
    var dashKey = normalizeSheetKey(sheetName);
    if (dashKey === DASH_TABLE_BREAKDOWN) { dashBreakdown = tables[sheetName] || []; return; }
    if (dashKey === DASH_TABLE_KPI) { dashKpi = tables[sheetName] || []; return; }
    if (dashKey === 'mechanic activity report' && nat.mechanic) return;
    try {
      var written = writeRecordsToSheet(ss, sheetName, tables[sheetName] || []);
      results[sheetName] = written;
      totalWritten += written;
    } catch (err) { errors[sheetName] = String(err); }
  });

  // Snapshot tampilan web (termasuk grafik/chart sebagai PNG) — selalu ditulis
  Object.keys(snapshots).forEach(function (sheetName) {
    if (isExcludedSheet(sheetName)) {
      skipped.push(sheetName + ' (snapshot)');
      return;
    }
    // Mechanic Activity Report sekarang native (tabel + chart) -> snapshot gambar diabaikan
    if (nat.mechanic && normalizeSheetKey(sheetName) === 'mechanic activity report') {
      skipped.push(sheetName + ' (snapshot diganti native)');
      return;
    }
    // Snapshot gambar untuk Dashboard sudah tidak dipakai (diganti tabel + chart native)
    if (/^dashboard\s*-/i.test(sheetName)) {
      skipped.push(sheetName + ' (snapshot dashboard dinonaktifkan)');
      return;
    }
    try {
      var written = writeSnapshotSheet(ss, sheetName, snapshots[sheetName]);
      results[sheetName] = written;
      totalWritten += written;
    } catch (err) { errors[sheetName] = String(err); }
  });

  // Sheet "Dashboard" native (tabel berwarna + chart) — hanya ditulis ulang bila datanya berubah
  if (dashBreakdown && dashBreakdown.length) {
    try {
      var force = String(payload.reason || '') === 'manual';
      var dr = writeDashboardNative(ss, dashBreakdown, dashKpi || [], force);
      results[DASH.SHEET] = dr.rows;
      totalWritten += dr.rows;
      if (dr.unchanged) skipped.push('Dashboard (tidak berubah)');
    } catch (err) { errors[DASH.SHEET] = String(err); }
  }

  // Sheet native lain (Service, Quarter, Mechanic Report)
  var force2 = String(payload.reason || '') === 'manual';
  [
    ['service', writeServiceNative, 2],
    ['quarter', writeQuarterNative, 3],
    ['mechanic', writeMechanicNative, 0]
  ].forEach(function (job) {
    var data = nat[job[0]];
    if (!data) return;
    try {
      var r2 = job[1](ss, data, force2, job[2]);
      results[data.sheet] = r2.rows;
      totalWritten += r2.rows;
      if (r2.unchanged) skipped.push(data.sheet + ' (tidak berubah)');
    } catch (err) { errors[data.sheet || job[0]] = String(err); }
  });

  writeMetaSheet(ss, payload, results);

  var out = {
    ok: true,
    written: totalWritten,
    tabs: results,
    syncedAt: payload.syncedAt || new Date().toISOString()
  };
  if (Object.keys(errors).length) out.tabErrors = errors;
  if (skipped.length) out.skippedExcluded = skipped;
  if (deleted.length) out.deletedExcluded = deleted;
  return jsonResponse(out);
}

function handleSingleSync(ss, payload) {
  var sheetName = payload.sheet || 'data';
  if (isExcludedSheet(sheetName)) {
    return jsonResponse({ ok: true, written: 0, sheet: sheetName, skipped: true, reason: 'excluded' });
  }
  // Sheet "Dashboard" hanya boleh ditulis lewat fullBackup (tabel + chart native)
  if (normalizeSheetKey(sheetName) === normalizeSheetKey(DASH.SHEET)) {
    return jsonResponse({ ok: true, written: 0, sheet: sheetName, skipped: true, reason: 'dashboard-native-only' });
  }
  var written = writeRecordsToSheet(ss, sheetName, payload.records || []);
  return jsonResponse({ ok: true, written: written, sheet: sheetName });
}

/** Google Sheets tidak boleh nama tab pakai [ ] * ? / \ : atau lebih dari 100 karakter. */
function sanitizeSheetName(rawName) {
  var name = String(rawName || 'Sheet').replace(/[\[\]\*\?\/\\:]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!name) name = 'Sheet';
  if (name.length > 95) name = name.substring(0, 95);
  return name;
}

/** Ambil sheet (buat kalau belum ada), lalu bersihkan TOTAL: isi, format, merge, gambar, proteksi, aturan warna. */
function getFreshSheet(ss, name) {
  var sheet = ss.getSheetByName(name);
  if (!sheet) return ss.insertSheet(name);
  try { sheet.getProtections(SpreadsheetApp.ProtectionType.SHEET).forEach(function (p) { p.remove(); }); } catch (_e) {}
  try { sheet.getImages().forEach(function (im) { im.remove(); }); } catch (_e) {}
  try { sheet.getCharts().forEach(function (ch) { sheet.removeChart(ch); }); } catch (_e) {}
  try { sheet.getRange(1, 1, sheet.getMaxRows(), sheet.getMaxColumns()).breakApart(); } catch (_e) {}
  sheet.clear();
  try { sheet.setConditionalFormatRules([]); } catch (_e) {}
  try { sheet.setFrozenRows(0); } catch (_e) {}
  try { sheet.setHiddenGridlines(false); } catch (_e) {}                      // sisa snapshot lama menyembunyikan gridline
  try { sheet.setRowHeights(1, sheet.getMaxRows(), DASH.ROW_PX); } catch (_e) {} // reset tinggi baris (posisi chart konsisten)
  return sheet;
}

function ensureSize(sheet, rows, cols) {
  if (sheet.getMaxRows() < rows) sheet.insertRowsAfter(sheet.getMaxRows(), rows - sheet.getMaxRows());
  if (sheet.getMaxColumns() < cols) sheet.insertColumnsAfter(sheet.getMaxColumns(), cols - sheet.getMaxColumns());
}

function lockSheet(sheet) {
  if (!LAYOUT.LOCK_SHEETS) return;
  try {
    sheet.protect().setDescription('Layout otomatis SEN-FleetCare — ditulis ulang tiap sync').setWarningOnly(true);
  } catch (_e) {}
}

function clampPx(px) { return Math.max(LAYOUT.MIN_COL_PX, Math.min(LAYOUT.MAX_COL_PX, Math.round(px))); }

/** Tinggi baris otomatis mengikuti isi (teks yang di-wrap tidak akan terpotong). */
function autoFitRows(sheet, numRows) {
  try { SpreadsheetApp.flush(); sheet.autoResizeRows(1, numRows); } catch (_e) {}
}

/* ============================ TAB DATA (tabel) ============================ */

function collectHeaders(records) {
  var seen = {}, headers = [];
  records.forEach(function (rec) {
    Object.keys(rec || {}).forEach(function (k) { if (!seen[k]) { seen[k] = true; headers.push(k); } });
  });
  return headers;
}

function measureColWidths(headers, rows) {
  return headers.map(function (h, ci) {
    var maxLen = String(h).length + 2;
    for (var r = 0; r < rows.length; r++) {
      var v = rows[r][ci];
      if (v === '' || v === null || v === undefined) continue;
      var parts = String(v).split('\n');
      for (var i = 0; i < parts.length; i++) if (parts[i].length > maxLen) maxLen = parts[i].length;
    }
    return clampPx(maxLen * LAYOUT.CHAR_PX + LAYOUT.PAD_PX);
  });
}

function writeRecordsToSheet(ss, sheetName, records) {
  sheetName = sanitizeSheetName(sheetName);
  var sheet = getFreshSheet(ss, sheetName);
  if (!records || !records.length) { lockSheet(sheet); return 0; }

  var headers = collectHeaders(records);
  var rows = records.map(function (rec) {
    return headers.map(function (h) {
      var v = rec[h];
      return (v === undefined || v === null) ? '' : v;
    });
  });
  var nCols = headers.length, nRows = rows.length;
  ensureSize(sheet, nRows + 2, nCols);

  sheet.getRange(1, 1, 1, nCols).setValues([headers]);
  sheet.getRange(2, 1, nRows, nCols).setValues(rows);
  sheet.setFrozenRows(1);
  styleSheetLikeWeb(sheet, headers, rows);

  var widths = measureColWidths(headers, rows);
  widths.forEach(function (w, i) { sheet.setColumnWidth(i + 1, w); });
  autoFitRows(sheet, nRows + 1);
  lockSheet(sheet);
  return nRows;
}

/** Tampilan tab data mirip tema web: header gelap + teks gold, zebra, baris TOTAL kuning, badge Status/Priority. */
function styleSheetLikeWeb(sheet, headers, rows) {
  var numCols = headers.length, rowCount = rows.length;
  if (!numCols) return;

  sheet.getRange(1, 1, 1, numCols)
    .setBackground('#1b1e23').setFontColor('#FFC72C').setFontWeight('bold')
    .setHorizontalAlignment('center').setVerticalAlignment('middle')
    .setWrapStrategy(SpreadsheetApp.WrapStrategy.WRAP);

  if (rowCount > 0) {
    var bgs = [], weights = [];
    for (var r = 0; r < rowCount; r++) {
      var first = String(rows[r][0] === null || rows[r][0] === undefined ? '' : rows[r][0]).trim();
      var isTotal = /^(total|average|grand total)$/i.test(first);
      var bg = isTotal ? '#fff3cd' : (r % 2 === 1 ? '#f4f6f8' : '#ffffff');
      var bgRow = [], wRow = [];
      for (var c = 0; c < numCols; c++) { bgRow.push(bg); wRow.push(isTotal ? 'bold' : 'normal'); }
      bgs.push(bgRow); weights.push(wRow);
    }
    sheet.getRange(2, 1, rowCount, numCols)
      .setBackgrounds(bgs).setFontWeights(weights).setFontColor('#20242c')
      .setVerticalAlignment('middle').setWrapStrategy(SpreadsheetApp.WrapStrategy.WRAP);
  }
  sheet.getRange(1, 1, rowCount + 1, numCols)
    .setBorder(true, true, true, true, true, true, LAYOUT.BORDER, SpreadsheetApp.BorderStyle.SOLID);
  if (rowCount <= 0) return;

  var rules = [];
  headers.forEach(function (h, idx) {
    var col = idx + 1, hLower = String(h).toLowerCase();
    var range = sheet.getRange(2, col, rowCount, 1);
    function rule(kind, text, bg, fg) {
      var b = SpreadsheetApp.newConditionalFormatRule();
      b = kind === 'eq' ? b.whenTextEqualTo(text) : b.whenTextContains(text);
      rules.push(b.setBackground(bg).setFontColor(fg).setBold(true).setRanges([range]).build());
    }
    if (hLower.indexOf('status') !== -1) {
      ['Close', 'Done', 'Approved'].forEach(function (t) { rule('eq', t, '#d7f3e3', '#1c6b43'); });
      ['Open', 'Rejected'].forEach(function (t) { rule('eq', t, '#fbdcdc', '#a02020'); });
      ['Progress', 'Pending'].forEach(function (t) { rule('has', t, '#fdf1d0', '#8a6100'); });
    }
    if (hLower === 'priority') {
      rule('eq', 'High', '#fbdcdc', '#a02020');
      rule('eq', 'Medium', '#fdf1d0', '#8a6100');
      rule('eq', 'Low', '#d7f3e3', '#1c6b43');
    }
  });
  if (rules.length) sheet.setConditionalFormatRules(rules);
}

/* ================= TAB SNAPSHOT (salinan tampilan web) =================
 * snap = { bg, fg, styles:[{bg,fg,b,fs,ff,al}], cells:[[r,c,colspan,rowspan,text,styleIdx,overflow]],
 *          tables:[[r,c,nRows,nCols]], images:[{r,c,w,h,data(base64 png)}], colW:[px], nRows }
 */
function writeSnapshotSheet(ss, sheetName, snap) {
  sheetName = sanitizeSheetName(sheetName);
  var sheet = getFreshSheet(ss, sheetName);
  var cells = snap.cells || [], styles = snap.styles || [], images = snap.images || [], tables = snap.tables || [];
  var pageBg = snap.bg || '#0a0e14', pageFg = snap.fg || '#f0f3f7';

  var maxR = 0, maxC = (snap.colW || []).length;
  cells.forEach(function (c) { maxR = Math.max(maxR, c[0] + c[3]); maxC = Math.max(maxC, c[1] + c[2]); });
  images.forEach(function (im) { maxR = Math.max(maxR, im.r + Math.ceil(im.h / 21) + 1); maxC = Math.max(maxC, Math.ceil(im.w / 90)); });
  if (!maxR || !maxC) { lockSheet(sheet); return 0; }
  ensureSize(sheet, maxR + 5, maxC + 2);

  // Latar seluruh sheet = warna halaman web (gelap), tanpa garis grid
  sheet.getRange(1, 1, sheet.getMaxRows(), sheet.getMaxColumns())
    .setBackground(pageBg).setFontColor(pageFg).setFontFamily('Arial').setFontSize(10)
    .setVerticalAlignment('middle');
  try { sheet.setHiddenGridlines(true); } catch (_e) {}

  var WRAP = SpreadsheetApp.WrapStrategy.WRAP, OVER = SpreadsheetApp.WrapStrategy.OVERFLOW;
  var vals = [], bgs = [], fgs = [], wts = [], szs = [], fms = [], als = [], wrs = [];
  for (var r = 0; r < maxR; r++) {
    var v = [], b = [], f = [], w = [], s = [], m = [], a = [], p = [];
    for (var c = 0; c < maxC; c++) { v.push(''); b.push(pageBg); f.push(pageFg); w.push('normal'); s.push(10); m.push('Arial'); a.push('left'); p.push(OVER); }
    vals.push(v); bgs.push(b); fgs.push(f); wts.push(w); szs.push(s); fms.push(m); als.push(a); wrs.push(p);
  }
  var merges = [];
  cells.forEach(function (cell) {
    var r0 = cell[0], c0 = cell[1], cs = cell[2], rs = cell[3], text = cell[4], st = styles[cell[5]] || {}, ov = cell[6];
    if (r0 >= maxR || c0 >= maxC) return;
    vals[r0][c0] = text;
    for (var rr = r0; rr < Math.min(maxR, r0 + rs); rr++) {
      for (var cc = c0; cc < Math.min(maxC, c0 + cs); cc++) {
        if (st.bg) bgs[rr][cc] = st.bg;
        if (st.fg) fgs[rr][cc] = st.fg;
      }
    }
    wts[r0][c0] = st.b ? 'bold' : 'normal';
    szs[r0][c0] = st.fs || 10;
    fms[r0][c0] = st.ff || 'Arial';
    als[r0][c0] = st.al || 'left';
    wrs[r0][c0] = ov ? OVER : WRAP;
    if (cs > 1 || rs > 1) merges.push([r0 + 1, c0 + 1, rs, cs]);
  });

  var area = sheet.getRange(1, 1, maxR, maxC);
  area.setNumberFormat('@');            // semua sebagai teks: "3/10" atau "80%" tidak berubah jadi tanggal/persen
  area.setValues(vals);
  area.setBackgrounds(bgs).setFontColors(fgs).setFontWeights(wts).setFontSizes(szs)
      .setFontFamilies(fms).setHorizontalAlignments(als).setWrapStrategies(wrs);
  merges.forEach(function (mg) { try { sheet.getRange(mg[0], mg[1], mg[2], mg[3]).merge(); } catch (_e) {} });
  tables.forEach(function (t) {
    sheet.getRange(t[0] + 1, t[1] + 1, t[2], t[3])
      .setBorder(true, true, true, true, true, true, LAYOUT.BORDER, SpreadsheetApp.BorderStyle.SOLID);
  });

  // Lebar kolom: dari isi terpanjang (dihitung di web), dikunci antara MIN–MAX
  for (var col = 0; col < maxC; col++) {
    var px = (snap.colW || [])[col];
    sheet.setColumnWidth(col + 1, clampPx(px || 90));
  }
  autoFitRows(sheet, maxR);

  // Grafik = gambar PNG dari tampilan web (hanya chart, tanpa filter period)
  images.forEach(function (im, i) {
    var row = Math.max(1, ((im && im.r) | 0) + 1);
    try {
      if (!im || !im.data) return;
      var b64 = String(im.data);
      var comma = b64.indexOf(',');
      if (comma >= 0) b64 = b64.substring(comma + 1);
      b64 = b64.replace(/\s+/g, '');
      if (b64.length < 64) return;

      var bytes = Utilities.base64Decode(b64);
      // Validasi signature PNG (89 50 4E 47) atau JPEG (FF D8)
      var b0 = bytes[0] < 0 ? bytes[0] + 256 : bytes[0];
      var b1 = bytes[1] < 0 ? bytes[1] + 256 : bytes[1];
      var b2 = bytes[2] < 0 ? bytes[2] + 256 : bytes[2];
      var b3 = bytes[3] < 0 ? bytes[3] + 256 : bytes[3];
      var isPng = (b0 === 137 && b1 === 80 && b2 === 78 && b3 === 71);
      var isJpg = (b0 === 255 && b1 === 216);
      if (!isPng && !isJpg) {
        sheet.getRange(row, 1).setValue('[Chart #' + (i + 1) + ' bukan PNG/JPEG valid]').setFontColor('#E5484D');
        return;
      }
      if (bytes.length < 200) {
        sheet.getRange(row, 1).setValue('[Chart #' + (i + 1) + ' terlalu kecil]').setFontColor('#E5484D');
        return;
      }

      var col = Math.max(1, (im.c | 0) + 1);
      var needRows = row + Math.max(10, Math.ceil((im.h || 220) / 21) + 3);
      var needCols = Math.max(col + 6, Math.ceil((im.w || 480) / 90) + 2);
      ensureSize(sheet, needRows, needCols);

      var mime = isJpg ? 'image/jpeg' : 'image/png';
      var ext = isJpg ? '.jpg' : '.png';
      var blob = Utilities.newBlob(bytes, mime, 'chart' + (i + 1) + ext);

      var img = null;
      try {
        img = sheet.insertImage(blob, col, row);
      } catch (e1) {
        // fallback: sisipkan di kolom A baris yang sama
        img = sheet.insertImage(blob, 1, row);
      }
      var iw = Math.max(60, Math.min(960, Number(im.w) || 480));
      var ih = Math.max(40, Math.min(640, Number(im.h) || 240));
      try { img.setWidth(iw); } catch (_w) {}
      try { img.setHeight(ih); } catch (_h) {}
    } catch (err) {
      try {
        sheet.getRange(row, 1)
          .setValue('[Chart #' + (i + 1) + ' gagal: ' + String(err).substring(0, 120) + ']')
          .setFontColor('#E5484D');
      } catch (_e2) {}
    }
  });

  try { sheet.setTabColor('#FFC72C'); } catch (_e) {}
  lockSheet(sheet);
  return snap.nRows || cells.length;
}


/* ============================ SHEET "DASHBOARD" (native) ============================
 * Meniru sheet Dashboard di SEN-Maintenance:
 *   Baris 1-5   : tabel Breakdown Category (header biru tua, baris Breakdown merah / Daily Maintenance
 *                 biru muda / Periodical kuning, kolom Average & Total, baris TOTAL biru muda)
 *   Di bawahnya : chart kolom "Breakdown Category per Month" (chart native Google Sheets)
 *   Berikutnya  : tabel "Monthly KPI Achievement" + chart garis
 * Data untuk chart ditaruh di tab tersembunyi "_Chart Data" (susunan bulan = baris, seri = kolom).
 */
function md5Hex(str) {
  var bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, str, Utilities.Charset.UTF_8);
  return bytes.map(function (b) { var v = (b < 0 ? b + 256 : b).toString(16); return v.length < 2 ? '0' + v : v; }).join('');
}

function getStateProps() {
  try { var p = PropertiesService.getDocumentProperties(); if (p) return p; } catch (_e) {}
  return PropertiesService.getScriptProperties();
}

/** Hapus tab Dashboard hasil snapshot lama. */
function deleteLegacyDashboardSheets(ss) {
  var deleted = [];
  LEGACY_DASHBOARD_SHEETS.forEach(function (name) {
    var sh = ss.getSheetByName(name);
    if (!sh) return;
    try {
      try { sh.getProtections(SpreadsheetApp.ProtectionType.SHEET).forEach(function (p) { p.remove(); }); } catch (_e) {}
      if (ss.getSheets().length <= 1) return;
      ss.deleteSheet(sh);
      deleted.push(name + ' (snapshot lama)');
    } catch (err) {
      deleted.push(name + ' (gagal: ' + String(err) + ')');
    }
  });
  return deleted;
}

function isTotalLabel(v) { return /^(total|grand total)$/i.test(String(v === null || v === undefined ? '' : v).trim()); }
function isAverageLabel(v) { return /^average$/i.test(String(v === null || v === undefined ? '' : v).trim()); }

function styleDashTable(sheet, row, nRows, nCols, opts) {
  opts = opts || {};
  // header
  sheet.getRange(row, 1, 1, nCols)
    .setBackground(DASH.HEADER_BG).setFontColor(DASH.HEADER_FG).setFontWeight('bold')
    .setHorizontalAlignment('center').setVerticalAlignment('middle')
    .setWrapStrategy(SpreadsheetApp.WrapStrategy.WRAP);
  sheet.setRowHeight(row, 32);
  // badan
  if (nRows > 0) {
    sheet.getRange(row + 1, 1, nRows, nCols)
      .setBackground('#FFFFFF').setFontColor('#000000').setFontWeight('normal')
      .setHorizontalAlignment('center').setVerticalAlignment('middle');
  }
  sheet.getRange(row, 1, nRows + 1, nCols)
    .setBorder(true, true, true, true, true, true, DASH.GRID, SpreadsheetApp.BorderStyle.SOLID);
}

/** Tulis blok tabel (header + baris) mulai di `row`. Kolom pertama & header diperlakukan sebagai TEKS
 *  (supaya "Jan 2026" / "Mar 2026" tidak diubah Sheets jadi tanggal). Mengembalikan {headers, rows, nCols}. */
function writeDashTable(sheet, row, records) {
  var headers = collectHeaders(records);
  var nCols = headers.length, nRows = records.length;
  var rows = records.map(function (rec) {
    return headers.map(function (h) {
      var v = rec[h];
      return (v === undefined || v === null) ? '' : v;
    });
  });
  sheet.getRange(row, 1, 1, nCols).setNumberFormat('@').setValues([headers]);
  // Kolom yang berisi teks diformat sebagai teks (mencegah "3/4", "Jan 2026", "12-09" jadi tanggal)
  for (var ci = 0; ci < nCols; ci++) {
    var hasText = false;
    for (var ri = 0; ri < nRows; ri++) { if (typeof rows[ri][ci] === 'string' && rows[ri][ci] !== '') { hasText = true; break; } }
    if (ci === 0 || hasText) sheet.getRange(row + 1, ci + 1, nRows, 1).setNumberFormat('@');
  }
  sheet.getRange(row + 1, 1, nRows, nCols).setValues(rows);
  return { headers: headers, rows: rows, nCols: nCols, nRows: nRows };
}

/** Blok data chart: kolom A = label bulan (teks), kolom berikutnya = 1 seri per baris tabel. */
function writeChartBlock(chartSheet, col, monthLabels, seriesNames, seriesValues) {
  var nM = monthLabels.length, nS = seriesNames.length;
  var head = ['Bulan'].concat(seriesNames);
  chartSheet.getRange(1, col, 1, head.length).setNumberFormat('@').setValues([head]);
  chartSheet.getRange(2, col, nM, 1).setNumberFormat('@');
  var body = [];
  for (var i = 0; i < nM; i++) {
    var r = [monthLabels[i]];
    for (var s = 0; s < nS; s++) r.push(Number(seriesValues[s][i]) || 0);
    body.push(r);
  }
  chartSheet.getRange(2, col, nM, head.length).setValues(body);
  return { rows: nM + 1, cols: head.length };
}

function writeDashboardNative(ss, bcRecords, kpiRecords, force) {
  var props = getStateProps();
  var hash = md5Hex(JSON.stringify([bcRecords, kpiRecords]));
  var existing = ss.getSheetByName(DASH.SHEET);
  if (!force && existing && props.getProperty('DASH_HASH') === hash) {
    try { if (existing.getCharts().length > 0) return { rows: 0, unchanged: true }; } catch (_e) {}
  }

  var sheet = getFreshSheet(ss, DASH.SHEET);
  var cs = getFreshSheet(ss, DASH.CHART_SHEET);
  var totalRows = 0;

  /* ---------- Blok 1: Breakdown Category ---------- */
  var t1 = writeDashTable(sheet, 1, bcRecords);
  var nCols1 = t1.nCols;
  ensureSize(sheet, 80, Math.max(nCols1 + 1, 14));
  styleDashTable(sheet, 1, t1.nRows, nCols1);
  var avgCol = t1.headers.indexOf('Average') + 1, totCol = t1.headers.indexOf('Total') + 1;
  var monthIdx = [];                       // index kolom (0-based) yang merupakan bulan
  t1.headers.forEach(function (h, i) { if (i > 0 && h !== 'Average' && h !== 'Total') monthIdx.push(i); });
  var monthLabels = monthIdx.map(function (i) { return t1.headers[i]; });

  var seriesNames = [], seriesVals = [], seriesColors = [];
  for (var r = 0; r < t1.nRows; r++) {
    var label = String(t1.rows[r][0]);
    var isTot = isTotalLabel(label);
    var rowRange = sheet.getRange(2 + r, 1, 1, nCols1);
    if (isTot) {
      rowRange.setBackground(DASH.TOTAL_BG).setFontWeight('bold');
    } else {
      var color = DASH.CAT_COLORS[normalizeSheetKey(label)] || '#EEEEEE';
      sheet.getRange(2 + r, 1).setBackground(color);
      var ci = seriesNames.length;
      seriesNames.push(label);
      seriesColors.push(DASH.SERIES_COLORS[ci % DASH.SERIES_COLORS.length]);
      seriesVals.push(monthIdx.map(function (i) { return t1.rows[r][i]; }));
    }
  }
  if (t1.nRows > 0) {
    if (monthIdx.length) sheet.getRange(2, 2, t1.nRows, nCols1 - 1).setNumberFormat('0');
    if (avgCol) sheet.getRange(2, avgCol, t1.nRows, 1).setNumberFormat('0.0');
    if (avgCol) sheet.getRange(1, avgCol).setNumberFormat('@');
    if (totCol) sheet.getRange(1, totCol).setNumberFormat('@');
  }
  sheet.getRange(2, 1, t1.nRows, 1).setFontWeight('bold');
  totalRows += t1.nRows;

  var chartW = Math.max(720, Math.min(1400, 140 + monthLabels.length * 95));
  var chartRow1 = t1.nRows + 3;            // 1 baris kosong setelah tabel
  var chartRowsSpan = Math.ceil(DASH.CHART_H / DASH.ROW_PX);

  if (monthLabels.length && seriesNames.length) {
    var blk1 = writeChartBlock(cs, 1, monthLabels, seriesNames, seriesVals);
    var chart1 = sheet.newChart()
      .setChartType(Charts.ChartType.COLUMN)
      .addRange(cs.getRange(1, 1, blk1.rows, blk1.cols))
      .setNumHeaders(1)
      .setPosition(chartRow1, 1, 0, 0)
      .setOption('title', 'Breakdown Category per Month')
      .setOption('width', chartW)
      .setOption('height', DASH.CHART_H)
      .setOption('legend', { position: 'top' })
      .setOption('colors', seriesColors)
      .setOption('vAxis', { title: 'Jumlah Job', minValue: 0 })
      .setOption('hAxis', { slantedText: false })
      .setOption('backgroundColor', '#FFFFFF')
      .build();
    sheet.insertChart(chart1);
  }

  /* ---------- Blok 2: Monthly KPI Achievement ---------- */
  if (kpiRecords && kpiRecords.length) {
    var titleRow = chartRow1 + chartRowsSpan + 2;
    sheet.getRange(titleRow, 1).setValue('Monthly KPI Achievement')
      .setFontWeight('bold').setFontSize(12).setFontColor(DASH.HEADER_BG);
    var tblRow = titleRow + 1;
    var t2 = writeDashTable(sheet, tblRow, kpiRecords);
    ensureSize(sheet, tblRow + t2.nRows + chartRowsSpan + 6, Math.max(t2.nCols + 1, nCols1 + 1));
    styleDashTable(sheet, tblRow, t2.nRows, t2.nCols);
    if (t2.nCols > 1) sheet.getRange(tblRow + 1, 2, t2.nRows, t2.nCols - 1).setNumberFormat('0"%"');
    sheet.getRange(tblRow + 1, 1, t2.nRows, 1).setFontWeight('bold');
    var kMonths = t2.headers.slice(1);
    var kNames = [], kVals = [], kColors = [];
    for (var k = 0; k < t2.nRows; k++) {
      var kl = String(t2.rows[k][0]);
      if (isAverageLabel(kl)) {
        sheet.getRange(tblRow + 1 + k, 1, 1, t2.nCols).setBackground(DASH.TOTAL_BG).setFontWeight('bold');
      }
      var idx = kNames.length;
      kNames.push(kl);
      kColors.push(isAverageLabel(kl) ? '#7F8C8D' : DASH.KPI_COLORS[idx % DASH.KPI_COLORS.length]);
      kVals.push(t2.rows[k].slice(1));
    }
    totalRows += t2.nRows;

    if (kMonths.length && kNames.length) {
      var blk2 = writeChartBlock(cs, 9, kMonths, kNames, kVals);
      var chartRow2 = tblRow + t2.nRows + 2;
      var chart2 = sheet.newChart()
        .setChartType(Charts.ChartType.LINE)
        .addRange(cs.getRange(1, 9, blk2.rows, blk2.cols))
        .setNumHeaders(1)
        .setPosition(chartRow2, 1, 0, 0)
        .setOption('title', 'Monthly KPI Achievement')
        .setOption('width', Math.max(720, Math.min(1400, 140 + kMonths.length * 95)))
        .setOption('height', DASH.CHART_H)
        .setOption('legend', { position: 'top' })
        .setOption('colors', kColors)
        .setOption('pointSize', 5)
        .setOption('vAxis', { title: 'Pencapaian (%)', minValue: 0 })
        .setOption('backgroundColor', '#FFFFFF')
        .build();
      sheet.insertChart(chart2);
    }
  }

  /* ---------- Lebar kolom & finishing ---------- */
  sheet.setColumnWidth(1, DASH.COL_A_PX);
  var lastCol = Math.max(nCols1, 2);
  for (var c = 2; c <= lastCol; c++) sheet.setColumnWidth(c, DASH.COL_PX);
  try { sheet.setTabColor(DASH.HEADER_BG); } catch (_e) {}
  try { cs.setTabColor('#999999'); cs.hideSheet(); } catch (_e) {}
  try { ss.setActiveSheet(sheet); ss.moveActiveSheet(1); } catch (_e) {}
  lockSheet(sheet);

  props.setProperty('DASH_HASH', hash);
  return { rows: totalRows, unchanged: false };
}


/* ============== SHEET NATIVE: Mechanic Report, Dashboard Service, Dashboard Quarter ============== */

function skipUnchanged(ss, sheetName, hash, force) {
  if (force) return false;
  var sh = ss.getSheetByName(sheetName);
  if (!sh) return false;
  if (getStateProps().getProperty('HASH_' + sheetName) !== hash) return false;
  try { return sh.getCharts().length > 0; } catch (_e) { return false; }
}
function markWritten(sheetName, hash) { getStateProps().setProperty('HASH_' + sheetName, hash); }

/** Tulis blok data chart (kolom pertama = label teks, sisanya angka). */
function writeRecordBlock(cs, col, records) {
  var headers = collectHeaders(records);
  var nR = records.length, nC = headers.length;
  cs.getRange(1, col, 1, nC).setNumberFormat('@').setValues([headers]);
  cs.getRange(2, col, nR, 1).setNumberFormat('@');
  var body = records.map(function (rec) {
    return headers.map(function (h, i) {
      var v = rec[h];
      if (i === 0) return (v === undefined || v === null) ? '' : String(v);
      return Number(v) || 0;
    });
  });
  cs.getRange(2, col, nR, nC).setValues(body);
  return { rows: nR + 1, cols: nC };
}

/** Sisipkan 1 chart native. o: {type,title,row,col,offsetX,width,height,colors,stacked,legend,options}
 *  v3.2: builder generik newChart() TIDAK punya setStacked() -> pakai opsi 'isStacked'.
 *  Error 1 chart tidak lagi menghentikan penulisan tabel/chart lain (pesan error ditulis di sheet). */
function placeChart(sheet, cs, dataCol, records, o) {
  if (!records || !records.length) return false;
  try {
    var blk = writeRecordBlock(cs, dataCol, records);
    var b = sheet.newChart()
      .setChartType(o.type)
      .addRange(cs.getRange(1, dataCol, blk.rows, blk.cols))
      .setNumHeaders(1)
      .setPosition(o.row, o.col || 1, o.offsetX || 0, o.offsetY || 0)
      .setOption('title', o.title)
      .setOption('width', o.width)
      .setOption('height', o.height)
      .setOption('legend', { position: o.legend || 'top' })
      .setOption('backgroundColor', '#FFFFFF');
    if (o.colors) b.setOption('colors', o.colors);
    if (o.stacked) b.setOption('isStacked', true);
    var extra = o.options || {};
    Object.keys(extra).forEach(function (k) { b.setOption(k, extra[k]); });
    sheet.insertChart(b.build());
    return true;
  } catch (err) {
    try {
      sheet.getRange(o.row, o.col || 1)
        .setValue('[Chart "' + o.title + '" gagal: ' + String(err).substring(0, 160) + ']')
        .setFontColor('#E5484D');
    } catch (_e) {}
    return false;
  }
}

function chartRowsSpan(h) { return Math.ceil(h / DASH.ROW_PX); }

function sumField(records, field) {
  var t = 0;
  (records || []).forEach(function (r) { t += Number(r[field]) || 0; });
  return t;
}

function textRule(range, kind, text, bg, fg) {
  var b = SpreadsheetApp.newConditionalFormatRule();
  b = kind === 'eq' ? b.whenTextEqualTo(text) : b.whenTextContains(text);
  return b.setBackground(bg).setFontColor(fg).setBold(true).setRanges([range]).build();
}

function finishNativeSheet(ss, sheet, cs, tabColor, position) {
  try { sheet.setTabColor(tabColor); } catch (_e) {}
  try { cs.setTabColor('#999999'); cs.hideSheet(); } catch (_e) {}
  if (position) { try { ss.setActiveSheet(sheet); ss.moveActiveSheet(position); } catch (_e) {} }
  lockSheet(sheet);
}

/* ---------------- Mechanic Activity Report: chart + Historical Report ---------------- */
function writeMechanicNative(ss, m, force) {
  var name = sanitizeSheetName(m.sheet || 'Mechanic Activity Report');
  var hash = md5Hex(JSON.stringify(m));
  if (skipUnchanged(ss, name, hash, force)) return { rows: 0, unchanged: true };

  var sheet = getFreshSheet(ss, name);
  var cs = getFreshSheet(ss, '_Chart Mechanic');
  var ch = m.charts || {};
  var mSuffix = m.month ? (' — ' + m.month) : '';
  var nMech = (ch.jobs || []).length;
  var H1 = Math.max(340, Math.min(720, 110 + nMech * 34));
  var H2 = 340, W1 = 620, W2 = 420, GAP = 20;

  // Baris 1: Total Job per Mechanic (bar bertumpuk) + Job Category Composition (donut)
  placeChart(sheet, cs, 1, ch.jobs, {
    type: Charts.ChartType.BAR, stacked: true, title: 'Total Job per Mechanic' + mSuffix,
    row: 1, offsetX: 0, width: W1, height: H1,
    colors: ['#E5484D', '#4A90D9', '#FFC72C'], options: { hAxis: { minValue: 0 } }
  });
  if (sumField(ch.category, 'Jumlah') > 0) placeChart(sheet, cs, 6, ch.category, {
    type: Charts.ChartType.PIE, title: 'Job Category Composition' + mSuffix,
    row: 1, offsetX: W1 + GAP, width: W2, height: H1, legend: 'right',
    colors: ['#E5484D', '#4A90D9', '#FFC72C'], options: { pieHole: 0.5, pieSliceText: 'value' }
  });

  // Baris 2: Mechanic Activity Trend (area) + Job Status Composition (donut)
  var row2 = 1 + chartRowsSpan(H1) + 1;
  placeChart(sheet, cs, 11, ch.trend, {
    type: Charts.ChartType.AREA, title: 'Mechanic Activity Trend — Monthly',
    row: row2, offsetX: 0, width: W1, height: H2, legend: 'none',
    colors: ['#FFC72C'], options: { pointSize: 5, vAxis: { title: 'Total Job', minValue: 0 } }
  });
  if (sumField(ch.status, 'Jumlah') > 0) placeChart(sheet, cs, 16, ch.status, {
    type: Charts.ChartType.PIE, title: 'Job Status Composition' + mSuffix,
    row: row2, offsetX: W1 + GAP, width: W2, height: H2, legend: 'right',
    colors: ['#4CAF6D', '#FFC72C', '#E5484D'], options: { pieHole: 0.5, pieSliceText: 'value' }
  });

  // Historical Report (tabel)
  var recs = m.historical || [];
  var titleRow = row2 + chartRowsSpan(H2) + 2;
  var tblRow = titleRow + 1;
  ensureSize(sheet, tblRow + recs.length + 5, Math.max(14, collectHeaders(recs).length + 1));
  sheet.getRange(titleRow, 1).setValue('Historical Report')
    .setFontWeight('bold').setFontSize(12).setFontColor(DASH.HEADER_BG);
  var written = 0;
  if (recs.length) {
    var t = writeDashTable(sheet, tblRow, recs);
    styleDashTable(sheet, tblRow, t.nRows, t.nCols);
    var widths = measureColWidths(t.headers, t.rows);
    widths.forEach(function (w, i) { sheet.setColumnWidth(i + 1, w); });
    sheet.getRange(tblRow + 1, 1, t.nRows, t.nCols).setWrapStrategy(SpreadsheetApp.WrapStrategy.WRAP);
    var jd = t.headers.indexOf('Job Desc');
    if (jd >= 0) sheet.getRange(tblRow + 1, jd + 1, t.nRows, 1).setHorizontalAlignment('left');
    var rules = [];
    var iCat = t.headers.indexOf('Kategori') + 1, iSt = t.headers.indexOf('Status') + 1, iAp = t.headers.indexOf('Approval') + 1;
    if (iCat > 0) {
      var rc = sheet.getRange(tblRow + 1, iCat, t.nRows, 1);
      rules.push(textRule(rc, 'eq', 'Breakdown', '#F4CCCC', '#A02020'));
      rules.push(textRule(rc, 'has', 'Daily', '#CFE2F3', '#1F4E79'));
      rules.push(textRule(rc, 'eq', 'Periodical', '#FFF2CC', '#8A6100'));
    }
    if (iSt > 0) {
      var rs = sheet.getRange(tblRow + 1, iSt, t.nRows, 1);
      rules.push(textRule(rs, 'eq', 'Close', '#D9EAD3', '#1C6B43'));
      rules.push(textRule(rs, 'eq', 'Open', '#F4CCCC', '#A02020'));
      rules.push(textRule(rs, 'has', 'Progress', '#FFF2CC', '#8A6100'));
    }
    if (iAp > 0) {
      var ra = sheet.getRange(tblRow + 1, iAp, t.nRows, 1);
      rules.push(textRule(ra, 'eq', 'Approved', '#D9EAD3', '#1C6B43'));
      rules.push(textRule(ra, 'eq', 'Rejected', '#F4CCCC', '#A02020'));
      rules.push(textRule(ra, 'has', 'Pending', '#FFF2CC', '#8A6100'));
    }
    if (rules.length) sheet.setConditionalFormatRules(rules);
    try { SpreadsheetApp.flush(); sheet.autoResizeRows(tblRow + 1, t.nRows); } catch (_e) {}
    written = t.nRows;
  } else {
    sheet.getRange(tblRow, 1).setValue('Belum ada data Historical Report.');
  }
  finishNativeSheet(ss, sheet, cs, '#FFC72C', 0);
  markWritten(name, hash);
  return { rows: written, unchanged: false };
}

/* ---------------- Dashboard Service: chart + tabel Service Achievement ---------------- */
function writeServiceNative(ss, sv, force, position) {
  var name = sanitizeSheetName(sv.sheet || 'Dashboard Service');
  var hash = md5Hex(JSON.stringify(sv));
  if (skipUnchanged(ss, name, hash, force)) return { rows: 0, unchanged: true };

  var sheet = getFreshSheet(ss, name);
  var cs = getFreshSheet(ss, '_Chart Service');
  var nUnit = (sv.unitChart || []).length;
  var H = Math.max(340, Math.min(800, 110 + nUnit * 26));
  var W1 = 680, W2 = 460, GAP = 20;

  placeChart(sheet, cs, 1, sv.unitChart, {
    type: Charts.ChartType.BAR, stacked: true, title: 'Dashboard Service — Stacked by Unit (Close / Open / Overdue)',
    row: 1, offsetX: 0, width: W1, height: H,
    colors: ['#4CAF6D', '#4A90D9', '#E5484D'], options: { hAxis: { minValue: 0 } }
  });
  placeChart(sheet, cs, 6, sv.typeChart, {
    type: Charts.ChartType.COLUMN, title: '% Close per Type Service',
    row: 1, offsetX: W1 + GAP, width: W2, height: Math.min(H, 380), legend: 'none',
    colors: ['#FFC72C'], options: { vAxis: { minValue: 0, maxValue: 100, title: '% Close' } }
  });

  var recs = sv.table || [];
  var titleRow = 1 + chartRowsSpan(H) + 2, tblRow = titleRow + 1;
  ensureSize(sheet, tblRow + recs.length + 5, Math.max(14, collectHeaders(recs).length + 1));
  sheet.getRange(titleRow, 1).setValue('Service Achievement')
    .setFontWeight('bold').setFontSize(12).setFontColor(DASH.HEADER_BG);
  var written = 0;
  if (recs.length) {
    var t = writeDashTable(sheet, tblRow, recs);
    styleDashTable(sheet, tblRow, t.nRows, t.nCols);
    sheet.getRange(tblRow + 1, 1, t.nRows, 1).setFontWeight('bold');
    var iAch = t.headers.indexOf('% Ach') + 1;
    if (iAch > 0) {
      var rg = sheet.getRange(tblRow + 1, iAch, t.nRows, 1);
      rg.setNumberFormat('0"%"').setFontWeight('bold');
      sheet.setConditionalFormatRules([
        SpreadsheetApp.newConditionalFormatRule().whenNumberGreaterThanOrEqualTo(80).setBackground('#D9EAD3').setFontColor('#1C6B43').setRanges([rg]).build(),
        SpreadsheetApp.newConditionalFormatRule().whenNumberBetween(50, 79.999).setBackground('#FFF2CC').setFontColor('#8A6100').setRanges([rg]).build(),
        SpreadsheetApp.newConditionalFormatRule().whenNumberLessThan(50).setBackground('#F4CCCC').setFontColor('#A02020').setRanges([rg]).build()
      ]);
    }
    sheet.setColumnWidth(1, DASH.COL_A_PX);
    for (var c = 2; c <= t.nCols; c++) sheet.setColumnWidth(c, c <= 6 ? 80 : 110);
    written = t.nRows;
  }
  finishNativeSheet(ss, sheet, cs, '#4CAF6D', position || 2);
  markWritten(name, hash);
  return { rows: written, unchanged: false };
}

/* ---------------- Dashboard Quarter: Grafik Quarter + KPI Summary Quarter ---------------- */
function writeQuarterNative(ss, qd, force, position) {
  var name = sanitizeSheetName(qd.sheet || 'Dashboard Quarter');
  var hash = md5Hex(JSON.stringify(qd));
  if (skipUnchanged(ss, name, hash, force)) return { rows: 0, unchanged: true };

  var sheet = getFreshSheet(ss, name);
  var cs = getFreshSheet(ss, '_Chart Quarter');
  var H = 380, W = Math.max(640, Math.min(1200, 200 + (qd.chart || []).length * 130));

  placeChart(sheet, cs, 1, qd.chart, {
    type: Charts.ChartType.COMBO, title: 'Grafik Quarter — Avg % Achievement KPI per Triwulan',
    row: 1, offsetX: 0, width: W, height: H,
    colors: ['#4A90D9', '#E5484D'],
    options: {
      seriesType: 'bars',
      series: { 1: { type: 'line', pointSize: 4, lineDashStyle: [6, 4] } },
      vAxis: { title: '% Achievement', minValue: 0 }
    }
  });

  var recs = qd.table || [];
  var titleRow = 1 + chartRowsSpan(H) + 2, tblRow = titleRow + 1;
  ensureSize(sheet, tblRow + recs.length + 5, Math.max(14, collectHeaders(recs).length + 1));
  sheet.getRange(titleRow, 1).setValue('KPI Summary Quarter')
    .setFontWeight('bold').setFontSize(12).setFontColor(DASH.HEADER_BG);
  var written = 0;
  if (recs.length) {
    var t = writeDashTable(sheet, tblRow, recs);
    styleDashTable(sheet, tblRow, t.nRows, t.nCols);
    sheet.getRange(tblRow + 1, 1, t.nRows, 1).setFontWeight('bold');
    for (var r = 0; r < t.nRows; r++) {
      if (isAverageLabel(t.rows[r][0])) {
        sheet.getRange(tblRow + 1 + r, 1, 1, t.nCols).setBackground(DASH.TOTAL_BG).setFontWeight('bold');
      }
    }
    var iSt = t.headers.indexOf('Status') + 1;
    if (iSt > 0) {
      var rg = sheet.getRange(tblRow + 1, iSt, t.nRows, 1);
      sheet.setConditionalFormatRules([
        textRule(rg, 'has', 'ACHIEVED', '#D9EAD3', '#1C6B43'),
        textRule(rg, 'has', 'ON TRACK', '#FFF2CC', '#8A6100'),
        textRule(rg, 'has', 'BELOW', '#F4CCCC', '#A02020')
      ]);
    }
    sheet.setColumnWidth(1, DASH.COL_A_PX);
    for (var c = 2; c <= t.nCols; c++) sheet.setColumnWidth(c, c === t.nCols ? 150 : 105);
    written = t.nRows;
  }
  finishNativeSheet(ss, sheet, cs, '#4A90D9', position || 3);
  markWritten(name, hash);
  return { rows: written, unchanged: false };
}

/** Tab "_Backup Log" — riwayat tiap full backup (waktu sync + jumlah baris per tab). */
function writeMetaSheet(ss, payload, results) {
  var sheetName = '_Backup Log';
  var sheet = ss.getSheetByName(sheetName);
  if (!sheet) {
    sheet = ss.insertSheet(sheetName);
    sheet.appendRow(['Waktu Sync', 'Modul', 'Jumlah Baris']);
    sheet.setFrozenRows(1);
    sheet.setColumnWidth(1, 200); sheet.setColumnWidth(2, 300); sheet.setColumnWidth(3, 110);
  }
  var syncedAt = payload.syncedAt || new Date().toISOString();
  Object.keys(results).forEach(function (name) { sheet.appendRow([syncedAt, name, results[name]]); });
}

function jsonResponse(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
