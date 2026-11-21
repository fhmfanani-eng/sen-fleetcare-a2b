/**
 * =====================================================================================
 *  CODE.GS — Sync KPI Performance dari Web Panel (Mechanic Maintenance A2B)
 *            ke Google Sheet tab "Maintenance"
 * =====================================================================================
 *
 *  Cara kerja singkat:
 *  - Web panel (index.html) menghitung MA, PA, MTBS, MTTR, PMR, SA per periode
 *    (mingguan / bulanan) memakai rumus & tier score yang SAMA persis dengan yang
 *    sudah ada di panel (kpiTierScore / kpiWeightedScore).
 *  - Panel mengirim hasilnya lewat POST (action = "syncMaintenanceKPI") ke Web App
 *    Apps Script ini.
 *  - Script ini mencari sendiri kolom Minggu (W1/W2/W3/W4) & bulan (AGUSTUS/
 *    SEPTEMBER/…) yang cocok di sheet "Maintenance" — TIDAK hardcode huruf kolom —
 *    supaya tetap jalan walau sheet di-insert/reorder kolom.
 *  - Nilai ditulis ke pasangan kolom "Acv." & "Score" milik minggu tsb, pada baris
 *    KPI yang cocok dengan nomor "No" di kolom KPI (2=MA, 3=PA, 4=MTBS, 5=MTTR,
 *    6=PMR, 7=SA — No.1 "Site Unit Budget Spending" TIDAK disync, itu input manual).
 *
 *  DEPLOY:
 *  1. Buka spreadsheet → Extensions → Apps Script.
 *  2. Ganti/scriptkan file ini sebagai Code.gs.
 *  3. Deploy → New deployment → Web app.
 *       - Execute as: Me
 *       - Who has access: Anyone
 *  4. Copy URL /exec, tempel ke BACKEND_CONFIG.sheetsWebAppUrl di index.html
 *     (bisa memakai URL yang sama dengan action=getPerformance yang sudah ada,
 *     asal action=syncMaintenanceKPI ikut ditambahkan di deployment itu).
 *
 *  CONTOH PAYLOAD (dikirim dari panel via fetch POST, Content-Type: text/plain):
 *  {
 *    "action": "syncMaintenanceKPI",
 *    "month": "AGUSTUS",          // harus cocok dengan teks header bulan di sheet
 *    "week": "W1",                // "W1".."W4", atau "TOTAL" untuk kolom rekap bulan
 *    "kpis": [
 *      { "key": "ma",   "acu": 92.4, "score": 15   },
 *      { "key": "pa",   "acu": 88.1, "score": 12   },
 *      { "key": "mtbs", "acu": 76,   "score": 8    },
 *      { "key": "mttr", "acu": 40,   "score": 8    },
 *      { "key": "pmr",  "acu": 91.2, "score": 10   },
 *      { "key": "sa",   "acu": 95.0, "score": 10   }
 *    ]
 *  }
 *
 *  "acu" adalah nilai capaian aktual (dalam % atau jam sesuai KPI-nya).
 *  "score" adalah bobot yang didapat, dalam satuan POIN PERSEN (mis. 15 untuk MA
 *  yang berbobot 15% dan tier 100%) — BUKAN pecahan 0-1. Script ini yang akan
 *  mengubahnya ke format sel (persen atau angka biasa) sesuai format sel tujuan.
 * =====================================================================================
 */

/* ------------------------------- KONFIGURASI ---------------------------------- */

const CONFIG = {
  SHEET_NAME: 'Maintenance',

  // Section KPI operasional yang disync ada di antara dua label ini.
  SECTION_START_LABEL: 'OPERATIONAL',
  SECTION_END_LABEL: 'REPORT & HSE',

  // Label kolom "No" dipakai untuk menemukan baris tiap KPI.
  NO_HEADER_LABEL: 'No',
  ACU_LABEL: 'Acv.',
  SCORE_LABEL: 'Score',

  // Nomor "No" di sheet -> key KPI yang dihitung web panel.
  // No.1 (Site Unit Budget Spending) sengaja tidak dipetakan -> tidak disync otomatis.
  KPI_NO_MAP: {
    2: 'ma',    // Unit Mechanical Availability
    3: 'pa',    // Unit Physical Availability
    4: 'mtbs',  // MTBS - Average
    5: 'mttr',  // MTTR - Average
    6: 'pmr',   // Planned Maintenance Ratio
    7: 'sa'     // Serviced Accuracy
  },

  // Berapa baris ke bawah & ke kanan yang dianggap wajar saat mencari header,
  // supaya pencarian tidak berjalan ke seluruh sheet kalau sheet sangat besar.
  MAX_HEADER_ROWS: 10,
  MAX_SEARCH_ROWS_AFTER_SECTION: 60,
  MAX_SEARCH_COLS: 400,

  // true  -> tulis nilai sebagai pecahan (0.924) supaya format % bawaan sel tampil "92%"
  // false -> tulis apa adanya (92.4)
  WRITE_AS_FRACTION_WHEN_PERCENT_FORMATTED: true,

  // Jangan menimpa sel yang sudah berisi formula (mis. kolom "Aug" total kalau memang
  // dihitung otomatis dari W1..W4 lewat formula SUM/AVERAGE di sheet).
  SKIP_CELLS_WITH_FORMULA: true
};

/* ------------------------------ ENTRY POINTS ----------------------------------- */

function doGet(e) {
  const action = (e && e.parameter && e.parameter.action) || 'ping';
  return handleAction(action, e && e.parameter);
}

function doPost(e) {
  let body = {};
  try {
    body = JSON.parse(e.postData.contents);
  } catch (err) {
    return jsonOutput({ ok: false, error: 'Body bukan JSON valid: ' + err });
  }
  const action = body.action || 'ping';
  return handleAction(action, body);
}

function handleAction(action, payload) {
  try {
    switch (action) {
      case 'ping':
        return jsonOutput({ ok: true, message: 'SEN FleetCare Apps Script aktif (KPI + data + performance + HM).', now: new Date().toISOString() });

      case 'syncMaintenanceKPI':
        return jsonOutput(syncMaintenanceKPI(payload));

      case 'inspectMaintenanceStructure':
        return jsonOutput(inspectMaintenanceStructure(payload));

      case 'getMaintenancePeriods':
        return jsonOutput(getMaintenancePeriods(payload));

      case 'getPerformance':
        return jsonOutput(getPerformance());

      // ---- JANGAN DIHAPUS: dipakai panel untuk sheet "data" & "Record Service" ----
      case 'sync':
        return jsonOutput(syncSheetRecords(payload));

      // ---- JANGAN DIHAPUS: baseline HM untuk Plan Service (HM Sekarang) ----
      case 'getHM':
      case 'getHourMeter':
      case 'getMonitoringHM':
        return jsonOutput(getHM());

      default:
        return jsonOutput({ ok: false, error: 'Action tidak dikenal: ' + action });
    }
  } catch (err) {
    return jsonOutput({ ok: false, error: String(err && err.message ? err.message : err) });
  }
}

function jsonOutput(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

/* ------------------------------ MAIN SYNC LOGIC --------------------------------- */

/**
 * payload: { month, week, kpis: [{key, acu, score}], spreadsheetId? }
 */
function syncMaintenanceKPI(payload) {
  if (!payload || !payload.month || !payload.week || !Array.isArray(payload.kpis)) {
    return { ok: false, error: 'Payload harus berisi month, week, dan kpis[].' };
  }

  const ss = payload.spreadsheetId
    ? SpreadsheetApp.openById(payload.spreadsheetId)
    : SpreadsheetApp.getActiveSpreadsheet();

  const sheet = ss.getSheetByName(CONFIG.SHEET_NAME);
  if (!sheet) {
    return { ok: false, error: 'Sheet "' + CONFIG.SHEET_NAME + '" tidak ditemukan.' };
  }

  // 1) Batas baris section OPERATIONAL.
  const section = findSectionBounds(sheet, CONFIG.SECTION_START_LABEL, CONFIG.SECTION_END_LABEL);
  if (!section.startRow) {
    return { ok: false, error: 'Label section "' + CONFIG.SECTION_START_LABEL + '" tidak ditemukan.' };
  }

  // 2) Kolom Acv./Score milik bulan+minggu yang diminta.
  const cols = findWeekColumns(sheet, payload.month, payload.week);
  if (!cols) {
    return {
      ok: false,
      error: 'Kolom untuk bulan "' + payload.month + '" minggu "' + payload.week + '" tidak ditemukan. ' +
             'Pastikan teks header di sheet cocok (mis. "AGUSTUS" dan "W1 (1-10 Agts)"), atau gunakan week:"TOTAL" untuk kolom rekap bulan.'
    };
  }

  // 3) Kolom "No" (untuk mencari baris tiap KPI).
  const noCol = findColumnByHeader(sheet, CONFIG.NO_HEADER_LABEL, section.startRow, section.headerRow);
  if (!noCol) {
    return { ok: false, error: 'Kolom header "' + CONFIG.NO_HEADER_LABEL + '" tidak ditemukan di section OPERATIONAL.' };
  }

  const results = [];
  const skipped = [];

  payload.kpis.forEach(function (item) {
    const kpiNo = kpiNoFromKey(item.key);
    if (!kpiNo) {
      skipped.push({ key: item.key, reason: 'Key KPI tidak dikenal (pakai: ma, pa, mtbs, mttr, pmr, sa).' });
      return;
    }

    const row = findKpiRow(sheet, noCol, section.startRow, section.endRow, kpiNo);
    if (!row) {
      skipped.push({ key: item.key, no: kpiNo, reason: 'Baris dengan No=' + kpiNo + ' tidak ditemukan.' });
      return;
    }

    const acuCell = resolveTopLeft(sheet, row, cols.acuCol);
    const scoreCell = resolveTopLeft(sheet, row, cols.scoreCol);

    const acuWritten = writeKpiValue(acuCell, item.acu);
    const scoreWritten = writeKpiValue(scoreCell, item.score);

    results.push({
      key: item.key,
      no: kpiNo,
      row: row,
      acu: { value: item.acu, written: acuWritten, cell: acuCell.getA1Notation() },
      score: { value: item.score, written: scoreWritten, cell: scoreCell.getA1Notation() }
    });
  });

  return {
    ok: true,
    sheet: CONFIG.SHEET_NAME,
    month: payload.month,
    week: payload.week,
    updated: results,
    skipped: skipped,
    syncedAt: new Date().toISOString()
  };
}

function kpiNoFromKey(key) {
  const map = CONFIG.KPI_NO_MAP;
  for (const no in map) {
    if (map[no] === key) return Number(no);
  }
  return null;
}

/**
 * Tulis nilai ke sebuah cell, kecuali cell itu berisi formula (dan
 * CONFIG.SKIP_CELLS_WITH_FORMULA true) — supaya tidak menimpa kolom rekap otomatis.
 * Mengembalikan true kalau benar-benar ditulis, false kalau dilewati.
 */
function writeKpiValue(cell, rawValue) {
  if (rawValue === undefined || rawValue === null || rawValue === '') return false;

  if (CONFIG.SKIP_CELLS_WITH_FORMULA && cell.getFormula()) {
    return false;
  }

  const numFormat = cell.getNumberFormat() || '';
  const isPercentFormatted = numFormat.indexOf('%') !== -1;
  let value = Number(rawValue);
  if (isNaN(value)) return false;

  if (isPercentFormatted && CONFIG.WRITE_AS_FRACTION_WHEN_PERCENT_FORMATTED) {
    // Nilai dikirim dalam skala 0-100 (mis. 92.4 atau 15) -> ubah ke pecahan 0-1
    // supaya sel berformat % menampilkan angka yang benar (92%, 15%, dst).
    value = value / 100;
  }

  cell.setValue(value);
  return true;
}

/* ------------------------------ PENCARI STRUKTUR SHEET --------------------------- */

/** Cari baris "OPERATIONAL" (mulai) dan baris tepat sebelum "REPORT & HSE" (selesai). */
function findSectionBounds(sheet, startLabel, endLabel) {
  const lastRow = sheet.getLastRow();
  const colA = sheet.getRange(1, 1, lastRow, 3).getValues(); // cek kolom A-C, section label biasanya di salah satu

  let startRow = null;
  let endRow = null;
  let headerRow = null;

  for (let i = 0; i < colA.length; i++) {
    const rowText = colA[i].map(function (v) { return String(v || '').trim().toUpperCase(); }).join(' ');
    if (!startRow && rowText.indexOf(startLabel.toUpperCase()) !== -1) {
      startRow = i + 1;
      headerRow = startRow + 1; // baris "No / KPI / Measurement / Weight / Target / Acv. / Score" biasanya tepat di bawah label section
      continue;
    }
    if (startRow && !endRow && rowText.indexOf(endLabel.toUpperCase()) !== -1) {
      endRow = i; // baris sebelum "REPORT & HSE"
      break;
    }
  }

  if (startRow && !endRow) endRow = Math.min(lastRow, startRow + CONFIG.MAX_SEARCH_ROWS_AFTER_SECTION);

  return { startRow: startRow, endRow: endRow, headerRow: headerRow };
}

/** Cari kolom yang headernya (di antara searchStartRow..searchEndRow) cocok dengan label. */
function findColumnByHeader(sheet, label, searchStartRow, searchEndRow) {
  const startRow = Math.max(1, searchStartRow - 3); // header biasanya di atas section, kasih margin
  const endRow = searchEndRow || (startRow + CONFIG.MAX_HEADER_ROWS);
  const lastCol = Math.min(sheet.getLastColumn(), CONFIG.MAX_SEARCH_COLS);

  const values = sheet.getRange(startRow, 1, endRow - startRow + 1, lastCol).getValues();
  for (let r = 0; r < values.length; r++) {
    for (let c = 0; c < values[r].length; c++) {
      if (String(values[r][c] || '').trim().toLowerCase() === label.trim().toLowerCase()) {
        return c + 1;
      }
    }
  }
  return null;
}

/**
 * Cari pasangan kolom (Acv., Score) milik bulan+minggu tertentu.
 * Strategi:
 *  1) Cari sel berisi nama bulan (mis. "AGUSTUS") di baris-baris header atas -> dapat rentang kolom bulan itu
 *     (lewat merged range, kalau tidak merged pakai heuristik "sampai bulan berikutnya ditemukan").
 *  2) Di dalam rentang kolom itu, cari sel yang teksnya MENGANDUNG kode minggu (mis. "W1") — atau kalau
 *     week === "TOTAL", cari singkatan bulan tanpa awalan "W" (mis. "Aug").
 *  3) Dari kolom yang ketemu di langkah 2 (dan kolom di sebelah kanannya), cari baris "Acv." / "Score".
 */
function findWeekColumns(sheet, month, week) {
  const lastCol = Math.min(sheet.getLastColumn(), CONFIG.MAX_SEARCH_COLS);
  const headerRows = sheet.getRange(1, 1, CONFIG.MAX_HEADER_ROWS, lastCol).getValues();

  // 1) Baris & kolom awal nama bulan.
  let monthRow = -1, monthColStart = -1, monthColEnd = -1;
  for (let r = 0; r < headerRows.length; r++) {
    for (let c = 0; c < headerRows[r].length; c++) {
      const text = String(headerRows[r][c] || '').trim().toUpperCase();
      if (text === month.trim().toUpperCase()) {
        monthRow = r + 1;
        monthColStart = c + 1;
        break;
      }
    }
    if (monthRow !== -1) break;
  }
  if (monthRow === -1) return null;

  // Lebar rentang bulan: pakai merged range kalau ada, kalau tidak cari kolom non-kosong berikutnya
  // di baris yang sama sampai ketemu teks lain (nama bulan lain) atau kolom kosong berturut-turut.
  const monthCell = sheet.getRange(monthRow, monthColStart);
  const merged = monthCell.getMergedRanges();
  if (merged.length) {
    monthColEnd = merged[0].getLastColumn();
  } else {
    monthColEnd = monthColStart;
    for (let c = monthColStart + 1; c <= lastCol; c++) {
      const v = String(headerRows[monthRow - 1][c - 1] || '').trim();
      if (v && v.toUpperCase() !== month.trim().toUpperCase()) break; // ketemu label bulan lain
      monthColEnd = c;
      // heuristik: batasi maksimal 10 kolom per blok bulan (4 minggu x 2 + total x 2)
      if (monthColEnd - monthColStart > 12) break;
    }
  }

  // 2) Cari kolom minggu (atau TOTAL) di baris di bawah nama bulan, dalam rentang kolom bulan.
  const weekSearchRowsCount = 3; // baris nama bulan + beberapa baris di bawahnya
  const weekArea = sheet.getRange(monthRow, monthColStart, weekSearchRowsCount, monthColEnd - monthColStart + 1).getValues();

  let weekCol = -1;
  const isTotal = String(week).trim().toUpperCase() === 'TOTAL';
  for (let r = 0; r < weekArea.length; r++) {
    for (let c = 0; c < weekArea[r].length; c++) {
      const text = String(weekArea[r][c] || '').trim().toUpperCase();
      if (!text) continue;
      if (isTotal) {
        // Kolom total bulan biasanya berlabel singkat tanpa "W", mis. "AUG", "SEP", "OKT".
        if (text.indexOf('W' + '') === 0 && /^W\d/.test(text)) continue; // skip kolom minggu
        if (text.indexOf(month.trim().toUpperCase().slice(0, 3)) === 0) {
          weekCol = monthColStart + c;
          break;
        }
      } else {
        if (text.indexOf(week.trim().toUpperCase()) === 0) {
          weekCol = monthColStart + c;
          break;
        }
      }
    }
    if (weekCol !== -1) break;
  }
  if (weekCol === -1) return null;

  // Lebar kolom minggu (biasanya merge 2 kolom: Acv. + Score).
  const weekCell = sheet.getRange(monthRow, weekCol);
  // baris tempat teks minggu ketemu ada di weekArea; cari row aktualnya di sheet:
  let weekRowActual = monthRow;
  for (let r = 0; r < weekArea.length; r++) {
    for (let c = 0; c < weekArea[r].length; c++) {
      if (monthColStart + c === weekCol && String(weekArea[r][c] || '').trim()) { weekRowActual = monthRow + r; }
    }
  }
  const weekCellActual = sheet.getRange(weekRowActual, weekCol);
  const weekMerged = weekCellActual.getMergedRanges();
  const acuColGuess = weekCol;
  const scoreColGuess = weekMerged.length ? weekMerged[0].getLastColumn() : weekCol + 1;

  // 3) Verifikasi & kunci kolom Acv./Score lewat baris label di bawahnya.
  //    Terima variasi: "Acv.", "Acv", "Acu.", "Acu", "ACV", "Achievement", dll.
  const labelSearchRows = sheet.getRange(weekRowActual, acuColGuess, 4, Math.max(2, scoreColGuess - acuColGuess + 1)).getValues();
  let acuCol = acuColGuess, scoreCol = scoreColGuess;
  function isAcvLabel_(text) {
    const t = String(text || '').trim().toLowerCase().replace(/\s+/g, '');
    if (!t) return false;
    if (t === 'acv.' || t === 'acv' || t === 'acu.' || t === 'acu') return true;
    if (t.indexOf('acv') === 0 || t.indexOf('acu') === 0) return true;
    if (t === 'achievement' || t === 'actual' || t === 'capaian') return true;
    return false;
  }
  function isScoreLabel_(text) {
    const t = String(text || '').trim().toLowerCase().replace(/\s+/g, '');
    if (!t) return false;
    if (t === 'score' || t === 'skor' || t === 'bobot') return true;
    if (t.indexOf('score') === 0 || t.indexOf('skor') === 0) return true;
    return false;
  }
  for (let r = 0; r < labelSearchRows.length; r++) {
    for (let c = 0; c < labelSearchRows[r].length; c++) {
      const text = labelSearchRows[r][c];
      if (isAcvLabel_(text)) acuCol = acuColGuess + c;
      if (isScoreLabel_(text)) scoreCol = acuColGuess + c;
    }
  }

  return { acuCol: acuCol, scoreCol: scoreCol, monthColStart: monthColStart, monthColEnd: monthColEnd };
}

/** Cari baris dengan nilai "No" == kpiNo, di dalam batas section. Kembalikan baris teratas kalau bagian dari merge vertikal. */
function findKpiRow(sheet, noCol, startRow, endRow, kpiNo) {
  const values = sheet.getRange(startRow, noCol, endRow - startRow + 1, 1).getValues();
  for (let i = 0; i < values.length; i++) {
    const v = values[i][0];
    if (Number(v) === Number(kpiNo)) {
      return startRow + i;
    }
  }
  return null;
}

/** Kalau (row,col) bagian dari merged range, kembalikan cell top-left dari merge itu. */
function resolveTopLeft(sheet, row, col) {
  const cell = sheet.getRange(row, col);
  const merged = cell.getMergedRanges();
  if (merged.length) {
    return sheet.getRange(merged[0].getRow(), merged[0].getColumn());
  }
  return cell;
}

/* --------------------------- PERFORMANCE SHEET READER ---------------------------- */

/**
 * Membaca tab "performance" secara fleksibel.
 * Mendukung header Unit / Waktu Operasi (W) / Standby (S) /
 * Breakdown (R) / Total Jam Kerja (T), tanpa bergantung pada huruf kolom.
 * Periode dicoba dibaca dari sel-sel atas; fallback ke bulan berjalan.
 */
function getPerformance() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName('performance');
  if (!sheet) return { ok:false, error:'Sheet "performance" tidak ditemukan.', rows:[] };

  const lastRow = sheet.getLastRow();
  const lastCol = sheet.getLastColumn();
  if (!lastRow || !lastCol) return { ok:false, error:'Sheet "performance" kosong.', rows:[] };

  const values = sheet.getDataRange().getValues();
  const display = sheet.getDataRange().getDisplayValues();
  const maxHeaderRows = Math.min(12, values.length);

  function norm(v) {
    return String(v == null ? '' : v).trim().toLowerCase()
      .replace(/[\n\r]+/g,' ')
      .replace(/\s+/g,' ');
  }
  function findHeader(aliases) {
    for (let r=0; r<maxHeaderRows; r++) {
      for (let c=0; c<lastCol; c++) {
        const h=norm(display[r][c]);
        if (!h) continue;
        for (let i=0;i<aliases.length;i++) {
          if (h === aliases[i] || h.indexOf(aliases[i]) !== -1) return {row:r,col:c};
        }
      }
    }
    return null;
  }

  const unitH=findHeader(['unit','unit code','kode unit','equipment','equipment code','kode alat']);
  const wH=findHeader(['waktu operasi','working hours','operating hours','jam operasi','operation hours']);
  const sH=findHeader(['standby','stand by','jam standby']);
  const rH=findHeader(['breakdown','repair','jam breakdown','jam repair']);
  const tH=findHeader(['total jam kerja','total working hours','total hours','total jam']);

  if (!unitH || !wH || !sH || !rH) {
    return { ok:false, error:'Kolom pada sheet performance tidak lengkap. Diperlukan Unit, Waktu Operasi, Standby, dan Breakdown/Repair.', rows:[] };
  }

  // Ambil periode dari bagian atas sheet. Format yang didukung: tanggal asli,
  // dd/mm/yyyy, yyyy-mm-dd, atau teks yang memuat dua tanggal.
  function toIso(v) {
    if (Object.prototype.toString.call(v)==='[object Date]' && !isNaN(v.getTime())) {
      return Utilities.formatDate(v, Session.getScriptTimeZone(), 'yyyy-MM-dd');
    }
    const text=String(v==null?'':v).trim();
    if (!text) return '';
    let m=text.match(/(20\d{2})[-\/.](\d{1,2})[-\/.](\d{1,2})/);
    if (m) return m[1]+'-'+String(m[2]).padStart(2,'0')+'-'+String(m[3]).padStart(2,'0');
    m=text.match(/(\d{1,2})[-\/.](\d{1,2})[-\/.](20\d{2})/);
    if (m) return m[3]+'-'+String(m[2]).padStart(2,'0')+'-'+String(m[1]).padStart(2,'0');
    return '';
  }
  const dates=[];
  for(let r=0;r<Math.min(8,values.length);r++){
    for(let c=0;c<lastCol;c++){
      const iso=toIso(values[r][c]) || toIso(display[r][c]);
      if(iso) dates.push(iso);
      const txt=String(display[r][c]||'');
      const ms=txt.match(/(\d{1,2}[\/.\-]\d{1,2}[\/.]\d{4})/g)||[];
      ms.forEach(x=>{const q=toIso(x); if(q) dates.push(q);});
    }
  }
  dates.sort();
  const periodStart=dates[0] || Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-01');
  const periodEnd=dates[dates.length-1] || Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');

  const dataStart=Math.max(unitH.row,wH.row,sH.row,rH.row,tH ? tH.row : 0)+1;
  const rows=[];
  for(let r=dataStart;r<values.length;r++){
    const unit=String(values[r][unitH.col]==null?'':values[r][unitH.col]).trim();
    if(!unit || /^(total|jumlah|grand total)$/i.test(unit)) continue;
    const num=(idx)=> idx==null ? NaN : Number(String(values[r][idx]==null?'':values[r][idx]).replace(/,/g,''));
    const w=num(wH.col), s=num(sH.col), rv=num(rH.col);
    if([w,s,rv].every(x=>isNaN(x)) && !tH) continue;
    let t=tH ? num(tH.col) : NaN;
    if(isNaN(t) || t<=0) t=(isNaN(w)?0:w)+(isNaN(s)?0:s)+(isNaN(rv)?0:rv);
    rows.push({
      unit:unit,
      workingHours:isNaN(w)?0:w,
      w:isNaN(w)?0:w,
      s:isNaN(s)?0:s,
      r:isNaN(rv)?0:rv,
      totalWorkingHours:t,
      t:t
    });
  }
  if(!rows.length) return { ok:false, error:'Tidak ada data unit yang dapat dibaca dari sheet performance.', rows:[] };

  return {
    ok:true,
    sheet:'performance',
    rows:rows,
    periodStart:periodStart,
    periodEnd:periodEnd,
    label:'performance-sheet ('+periodStart+' s/d '+periodEnd+')',
    syncedAt:new Date().toISOString()
  };
}

/* ------------------------- MAINTENANCE PERIOD DISCOVERY -------------------------- */

/**
 * Membaca periode langsung dari header tab Maintenance.
 *
 * Output contoh:
 * { month:"AGUSTUS", week:"W1", label:"W1 (1-10 Agts)",
 *   start:"2026-08-01", end:"2026-08-10" }
 *
 * Dengan ini web panel tidak perlu mengetahui pembagian minggu secara hardcode.
 * Jika user mengubah format kolom menjadi W1 (1-12), W2 (13-20), dst.,
 * mapping sync ikut berubah otomatis.
 */
function getMaintenancePeriods(payload) {
  // Baca periode dari spreadsheet yang SAMA dengan tujuan sync KPI (spreadsheetId dikirim web), bukan sekadar spreadsheet aktif.
  const ss = (payload && payload.spreadsheetId)
    ? SpreadsheetApp.openById(payload.spreadsheetId)
    : SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(CONFIG.SHEET_NAME);
  if (!sheet) return { ok:false, error:'Sheet "' + CONFIG.SHEET_NAME + '" tidak ditemukan.', periods:[] };

  const lastCol = Math.min(sheet.getLastColumn(), CONFIG.MAX_SEARCH_COLS);
  const headerRows = sheet.getRange(1, 1, CONFIG.MAX_HEADER_ROWS, lastCol).getDisplayValues();
  const months = [
    'JANUARI','FEBRUARI','MARET','APRIL','MEI','JUNI',
    'JULI','AGUSTUS','SEPTEMBER','OKTOBER','NOVEMBER','DESEMBER'
  ];
  const monthNo = {};
  months.forEach(function(m, i){ monthNo[m] = i + 1; });

  // Cari tahun pada header. Fallback ke tahun sekarang bila sheet tidak menuliskannya.
  let year = new Date().getFullYear();
  outerYear:
  for (let r=0; r<headerRows.length; r++) {
    for (let c=0; c<headerRows[r].length; c++) {
      const text = String(headerRows[r][c] || '');
      const m = text.match(/\b(20\d{2})\b/);
      if (m) { year = Number(m[1]); break outerYear; }
    }
  }

  const periods = [];
  const seen = {};

  function monthRange(monthRow, monthColStart) {
    const cell = sheet.getRange(monthRow, monthColStart);
    const merged = cell.getMergedRanges();
    if (merged.length) return { start:merged[0].getColumn(), end:merged[0].getLastColumn() };

    let end = monthColStart;
    for (let c=monthColStart+1; c<=lastCol; c++) {
      const v = String(headerRows[monthRow-1][c-1] || '').trim().toUpperCase();
      if (v && months.indexOf(v) !== -1) break;
      end = c;
      if (end-monthColStart > 16) break;
    }
    return { start:monthColStart, end:end };
  }

  function parseDayRange(text, month) {
    const t = String(text || '').trim();
    // Ambil pola 1-10, 11–17, 25 s/d 31, dll. Tanggal pertama dan kedua.
    let m = t.match(/(\d{1,2})\s*(?:-|–|—|s\/d|sd|sampai)\s*(\d{1,2})/i);
    if (m) return { start:Number(m[1]), end:Number(m[2]) };

    // Jika hanya ada satu angka setelah W1/W2, gunakan satu hari.
    m = t.match(/\bW\d\b[^0-9]*(\d{1,2})/i);
    if (m) return { start:Number(m[1]), end:Number(m[1]) };

    // Fallback hanya jika header minggu tidak mencantumkan range tanggal.
    const wk = t.match(/\bW([1-4])\b/i);
    if (wk) {
      const defaults = {
        1:[1,10], 2:[11,17], 3:[18,24], 4:[25,31]
      };
      return { start:defaults[Number(wk[1])][0], end:defaults[Number(wk[1])][1] };
    }
    return null;
  }

  for (let r=0; r<headerRows.length; r++) {
    for (let c=0; c<headerRows[r].length; c++) {
      const month = String(headerRows[r][c] || '').trim().toUpperCase();
      if (!monthNo[month]) continue;

      const range = monthRange(r+1, c+1);
      const areaRows = Math.min(5, CONFIG.MAX_HEADER_ROWS-r);
      const area = sheet.getRange(r+1, range.start, areaRows, range.end-range.start+1).getDisplayValues();
      const monthNum = monthNo[month];

      for (let ar=0; ar<area.length; ar++) {
        for (let ac=0; ac<area[ar].length; ac++) {
          const label = String(area[ar][ac] || '').trim();
          if (!label) continue;
          const upper = label.toUpperCase();
          const wkMatch = upper.match(/\bW([1-4])\b/);
          let week = wkMatch ? 'W'+wkMatch[1] : null;
          const isTotal = !week && (
            upper === month.substring(0,3) ||
            upper.indexOf(month.substring(0,3)) === 0 && /TOTAL|REKAP|SUMMARY|MONTH/i.test(upper)
          );
          if (!week && !isTotal) continue;
          if (isTotal) week='TOTAL';

          const key = month+'|'+week;
          if (seen[key]) continue;

          let startDay, endDay;
          if (week === 'TOTAL') {
            startDay = 1;
            endDay = new Date(year, monthNum, 0).getDate();
          } else {
            const dr = parseDayRange(label, month);
            if (!dr) continue;
            startDay = Math.max(1, dr.start);
            endDay = Math.min(new Date(year, monthNum, 0).getDate(), dr.end);
          }
          if (startDay > endDay) continue;

          periods.push({
            month:month,
            monthNumber:monthNum,
            year:year,
            week:week,
            label:label,
            start:year+'-'+pad2_(monthNum)+'-'+pad2_(startDay),
            end:year+'-'+pad2_(monthNum)+'-'+pad2_(endDay)
          });
          seen[key] = true;
        }
      }
    }
  }

  periods.sort(function(a,b){ return String(a.start).localeCompare(String(b.start)); });
  return { ok:true, sheet:CONFIG.SHEET_NAME, year:year, periods:periods };
}

function pad2_(n) {
  return String(n).padStart(2, '0');
}

/* ------------------------------ DEBUG / SETUP HELPER ----------------------------- */

/**
 * Panggil action=inspectMaintenanceStructure untuk melihat apa yang berhasil
 * dideteksi script ini di sheet "Maintenance" — dipakai saat setup / troubleshooting,
 * sebelum sync sungguhan dijalankan dari web panel.
 */
function inspectMaintenanceStructure(payload) {
  const ss = (payload && payload.spreadsheetId)
    ? SpreadsheetApp.openById(payload.spreadsheetId)
    : SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(CONFIG.SHEET_NAME);
  if (!sheet) return { ok: false, error: 'Sheet "' + CONFIG.SHEET_NAME + '" tidak ditemukan.' };

  const section = findSectionBounds(sheet, CONFIG.SECTION_START_LABEL, CONFIG.SECTION_END_LABEL);
  const noCol = section.startRow
    ? findColumnByHeader(sheet, CONFIG.NO_HEADER_LABEL, section.startRow, section.headerRow)
    : null;

  const sampleMonths = ['AGUSTUS', 'SEPTEMBER', 'OKTOBER'];
  const monthChecks = {};
  sampleMonths.forEach(function (m) {
    monthChecks[m] = {
      W1: !!findWeekColumns(sheet, m, 'W1'),
      W2: !!findWeekColumns(sheet, m, 'W2'),
      W3: !!findWeekColumns(sheet, m, 'W3'),
      W4: !!findWeekColumns(sheet, m, 'W4'),
      TOTAL: !!findWeekColumns(sheet, m, 'TOTAL')
    };
  });

  return {
    ok: true,
    sheet: CONFIG.SHEET_NAME,
    section: section,
    noColumn: noCol,
    kpiRowMap: section.startRow
      ? Object.keys(CONFIG.KPI_NO_MAP).reduce(function (acc, no) {
          acc[no] = { key: CONFIG.KPI_NO_MAP[no], row: findKpiRow(sheet, noCol, section.startRow, section.endRow, Number(no)) };
          return acc;
        }, {})
      : {},
    monthWeekDetected: monthChecks
  };
}


/* ===================== SYNC sheet "data" / "Record Service" =====================
 * Dipakai web panel:
 *   action:"sync", sheet:"data"           → Daily Maintenance records
 *   action:"sync", sheet:"Record Service" → Plan Service yang Close
 * TIDAK mengubah sheet "performance" dan TIDAK mengubah logika HM Plan Service.
 * Hanya menulis ulang isi tab target dari payload.records.
 * ============================================================================= */

function syncSheetRecords(payload) {
  payload = payload || {};
  const sheetName = String(payload.sheet || 'data').trim() || 'data';
  const records = Array.isArray(payload.records) ? payload.records : [];

  const ss = payload.spreadsheetId
    ? SpreadsheetApp.openById(payload.spreadsheetId)
    : SpreadsheetApp.getActiveSpreadsheet();

  let sheet = ss.getSheetByName(sheetName);
  if (!sheet) {
    // Buat sheet baru. Untuk "Record Service", sisipkan tepat setelah tab performance bila ada.
    const perf = ss.getSheetByName('performance');
    if (sheetName === 'Record Service' && perf) {
      sheet = ss.insertSheet(sheetName, perf.getIndex());
    } else {
      sheet = ss.insertSheet(sheetName);
    }
  }

  if (!records.length) {
    return { ok: true, sheet: sheetName, written: 0, message: 'Tidak ada record untuk ditulis.' };
  }

  // Kumpulkan semua key kolom dari record (urutan stabil).
  const keySet = {};
  const keys = [];
  records.forEach(function (r) {
    Object.keys(r || {}).forEach(function (k) {
      if (!keySet[k]) { keySet[k] = true; keys.push(k); }
    });
  });

  // Prefer urutan kolom yang sudah ada di baris header sheet (jika ada).
  const existingLastCol = sheet.getLastColumn();
  let header = keys.slice();
  if (existingLastCol > 0 && sheet.getLastRow() > 0) {
    const existingHeader = sheet.getRange(1, 1, 1, existingLastCol).getDisplayValues()[0]
      .map(function (h) { return String(h || '').trim(); })
      .filter(Boolean);
    if (existingHeader.length) {
      const ordered = [];
      const seen = {};
      existingHeader.forEach(function (h) {
        // cocokkan case-insensitive ke key payload
        const found = keys.find(function (k) { return k.toLowerCase() === h.toLowerCase(); });
        if (found && !seen[found]) { ordered.push(found); seen[found] = true; }
        else if (!seen[h]) { ordered.push(h); seen[h] = true; }
      });
      keys.forEach(function (k) { if (!seen[k]) { ordered.push(k); seen[k] = true; } });
      header = ordered;
    }
  }

  const values = [header];
  records.forEach(function (r) {
    values.push(header.map(function (k) {
      const v = r[k];
      if (v === null || v === undefined) return '';
      if (typeof v === 'object') return JSON.stringify(v);
      return v;
    }));
  });

  sheet.clearContents();
  sheet.getRange(1, 1, values.length, header.length).setValues(values);

  return {
    ok: true,
    sheet: sheetName,
    written: records.length,
    columns: header.length,
    syncedAt: new Date().toISOString()
  };
}

/* ===================== getHM — Monitoring HM =====================
 * Membaca sheet monitoring HM (nama fleksibel) untuk baseline HM Akhir per unit.
 * Hasil dipakai panel menghitung "HM Sekarang" di Plan Service:
 *   HM Sekarang = HM Akhir terakhir + (hari × WH/hari dari sheet performance)
 * Action ini HANYA MEMBACA — tidak menulis / mengubah Plan Service.
 * ================================================================= */

function getHM() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const candidates = [
    'View-SEN-HM', 'View SEN HM', 'Monitoring HM', 'monitoring hm',
    'HM', 'Hour Meter', 'hour meter', 'SEN-HM'
  ];
  let sheet = null;
  for (let i = 0; i < candidates.length; i++) {
    sheet = ss.getSheetByName(candidates[i]);
    if (sheet) break;
  }
  // fallback: cari sheet yang namanya mengandung "HM"
  if (!sheet) {
    const all = ss.getSheets();
    for (let i = 0; i < all.length; i++) {
      const n = String(all[i].getName() || '');
      if (/hm|hour\s*meter|monitoring/i.test(n) && !/performance|maintenance|dashboard|data|record/i.test(n)) {
        sheet = all[i];
        break;
      }
    }
  }
  if (!sheet) {
    return { ok: false, error: 'Sheet Monitoring HM tidak ditemukan (coba nama: View-SEN-HM / Monitoring HM).', rows: [] };
  }

  const range = sheet.getDataRange();
  const values = range.getValues();
  const display = range.getDisplayValues();
  if (!values.length) return { ok: false, error: 'Sheet HM kosong.', rows: [] };

  const lastCol = values[0].length;
  const maxHeaderRows = Math.min(8, values.length);

  function norm(v) {
    return String(v == null ? '' : v).trim().toLowerCase().replace(/[\n\r]+/g, ' ').replace(/\s+/g, ' ');
  }
  function findHeader(aliases) {
    for (let r = 0; r < maxHeaderRows; r++) {
      for (let c = 0; c < lastCol; c++) {
        const h = norm(display[r][c]);
        if (!h) continue;
        for (let i = 0; i < aliases.length; i++) {
          if (h === aliases[i] || h.indexOf(aliases[i]) !== -1) return { row: r, col: c };
        }
      }
    }
    return null;
  }

  const tanggalH = findHeader(['tanggal', 'date', 'tgl']);
  const unitH = findHeader(['kode unit', 'unit code', 'unit', 'equipment', 'kode alat']);
  const hmAkhirH = findHeader(['hm akhir', 'hm_akhir', 'hm end', 'ending hm', 'hmakhir']);
  const hmAwalH = findHeader(['hm awal', 'hm_awal', 'hm start', 'starting hm', 'hmawal']);
  const hmTotalH = findHeader(['hm total', 'hm_total', 'total hm', 'hmtotal']);
  const shiftH = findHeader(['shift']);
  const userH = findHeader(['user', 'operator', 'pic']);
  const namaH = findHeader(['nama', 'name', 'mechanic']);
  const catH = findHeader(['category', 'kategori']);
  const jobH = findHeader(['pekerjaan', 'job', 'activity']);
  const fuelH = findHeader(['fuel', 'bbm']);
  const ketH = findHeader(['keterangan', 'remark', 'notes', 'note']);

  if (!tanggalH || !unitH || !hmAkhirH) {
    return {
      ok: false,
      error: 'Kolom wajib tidak lengkap di sheet HM. Diperlukan: Tanggal, Kode Unit, HM Akhir.',
      rows: [],
      sheet: sheet.getName()
    };
  }

  function toIso(v, disp) {
    if (Object.prototype.toString.call(v) === '[object Date]' && !isNaN(v.getTime())) {
      return Utilities.formatDate(v, Session.getScriptTimeZone(), 'yyyy-MM-dd');
    }
    const text = String(disp != null ? disp : (v == null ? '' : v)).trim();
    if (!text) return '';
    let m = text.match(/(20\d{2})[-\/.](\d{1,2})[-\/.](\d{1,2})/);
    if (m) return m[1] + '-' + String(m[2]).padStart(2, '0') + '-' + String(m[3]).padStart(2, '0');
    m = text.match(/(\d{1,2})[-\/.](\d{1,2})[-\/.](20\d{2})/);
    if (m) return m[3] + '-' + String(m[2]).padStart(2, '0') + '-' + String(m[1]).padStart(2, '0');
    // serial Excel
    const n = Number(v);
    if (!isNaN(n) && n > 20000 && n < 80000) {
      const epoch = new Date(Date.UTC(1899, 11, 30));
      const d = new Date(epoch.getTime() + n * 86400000);
      if (!isNaN(d.getTime())) return Utilities.formatDate(d, 'UTC', 'yyyy-MM-dd');
    }
    return '';
  }

  const dataStart = Math.max(tanggalH.row, unitH.row, hmAkhirH.row) + 1;
  const rows = [];
  for (let r = dataStart; r < values.length; r++) {
    const unit = String(values[r][unitH.col] == null ? '' : values[r][unitH.col]).trim();
    if (!unit || /^(total|jumlah|grand total)$/i.test(unit)) continue;
    const tanggal = toIso(values[r][tanggalH.col], display[r][tanggalH.col]);
    const hmAkhir = Number(String(values[r][hmAkhirH.col] == null ? '' : values[r][hmAkhirH.col]).replace(/,/g, ''));
    if (!tanggal || isNaN(hmAkhir) || hmAkhir <= 0) continue;

    function num(h) {
      if (!h) return null;
      const n = Number(String(values[r][h.col] == null ? '' : values[r][h.col]).replace(/,/g, ''));
      return isNaN(n) ? null : n;
    }
    function str(h) {
      if (!h) return '';
      return String(values[r][h.col] == null ? '' : values[r][h.col]).trim();
    }

    rows.push({
      tanggal: tanggal,
      unit: unit,
      unitCode: unit,
      hmAkhir: hmAkhir,
      hmAwal: num(hmAwalH),
      hmTotal: num(hmTotalH),
      shift: str(shiftH),
      user: str(userH),
      nama: str(namaH),
      category: str(catH),
      pekerjaan: str(jobH),
      fuel: num(fuelH) || 0,
      keterangan: str(ketH)
    });
  }

  if (!rows.length) {
    return { ok: false, error: 'Tidak ada baris HM yang bisa dibaca.', rows: [], sheet: sheet.getName() };
  }

  return {
    ok: true,
    sheet: sheet.getName(),
    rows: rows,
    syncedAt: new Date().toISOString()
  };
}
