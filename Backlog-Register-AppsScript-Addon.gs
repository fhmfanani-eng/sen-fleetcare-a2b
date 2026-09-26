/**
 * ADDON UNTUK code.gs (Google Apps Script) — SEN-FleetCare
 * ---------------------------------------------------------
 * File ini BUKAN pengganti code.gs Anda yang sekarang. Ini adalah potongan
 * kode tambahan supaya sheet baru "Backlog Register" (dikirim dari tombol
 * "☁ Sync ke Sheet Backlog" di aplikasi web) bisa diterima dan otomatis
 * dibuatkan tab-nya di spreadsheet, persis seperti sheet "data",
 * "Record Service", "Historical Breakdown", dan "RCA" yang sudah berjalan.
 *
 * CARA PAKAI — pilih salah satu skenario di bawah sesuai kondisi code.gs Anda:
 *
 * SKENARIO A — code.gs Anda sudah GENERIK (satu fungsi menangani semua nama
 * sheet apa pun yang dikirim, tanpa if/switch per nama sheet).
 *   -> Tidak perlu perubahan apa pun. Sheet "Backlog Register" akan otomatis
 *      dibuat & terisi saat tombol sync pertama kali ditekan. Anda bisa
 *      berhenti di sini.
 *
 * SKENARIO B — code.gs Anda punya if/switch manual per nama sheet
 * (misal: if(sheet==='data'){...} else if(sheet==='Record Service'){...}
 * else if(sheet==='RCA'){...} dst).
 *   -> Tambahkan satu blok "else if" baru yang memanggil fungsi
 *      syncBacklogRegisterSheet_() di bawah ini, tepat sebelum fallback/else
 *      terakhir pada fungsi doPost(e) Anda. Contoh penempatan:
 *
 *      else if (sheetName === 'Backlog Register') {
 *        result = syncBacklogRegisterSheet_(ss, payload.records);
 *      }
 *
 *      (sesuaikan nama variabel ss / payload dengan punya Anda)
 *
 * Setelah menambahkan kode ini, klik Deploy > Manage deployments > Edit
 * (ikon pensil) > Version: New version > Deploy, supaya Web App URL yang
 * sama menjalankan kode terbaru.
 */

function syncBacklogRegisterSheet_(ss, records) {
  var SHEET_NAME = 'Backlog Register';
  var HEADERS = [
    'ID', 'Priority', 'Unit Code', 'Type Unit', 'Component',
    'Part Number', 'Qty', 'PR', 'Part Location', 'Description',
    'Source', 'Date', 'HM', 'Aging (Hari)', 'Status'
  ];
  // Urutan field di sini HARUS mengikuti urutan HEADERS di atas.
  var FIELD_KEYS = [
    'id', 'priority', 'unit_code', 'type_unit', 'component',
    'part_number', 'qty', 'pr', 'part_location', 'description',
    'source', 'date', 'hm', 'aging_days', 'status'
  ];

  var sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_NAME);
  }

  // Tulis/timpa header baris pertama supaya selalu konsisten.
  sheet.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]);
  sheet.setFrozenRows(1);

  // Bersihkan data lama (baris 2 ke bawah) sebelum menulis data terbaru —
  // sinkron "full replace" persis seperti sync sheet lain di aplikasi ini.
  var lastRow = sheet.getLastRow();
  if (lastRow > 1) {
    sheet.getRange(2, 1, lastRow - 1, sheet.getLastColumn()).clearContent();
  }

  var list = Array.isArray(records) ? records : [];
  if (list.length > 0) {
    var rows = list.map(function (r) {
      return FIELD_KEYS.map(function (key) {
        var v = r[key];
        return (v === undefined || v === null) ? '' : v;
      });
    });
    sheet.getRange(2, 1, rows.length, HEADERS.length).setValues(rows);
  }

  // Rapikan lebar kolom (opsional, boleh dihapus jika tidak diperlukan).
  sheet.autoResizeColumns(1, HEADERS.length);

  return { ok: true, written: list.length };
}

/**
 * Referensi lengkap: contoh doPost(e) generik yang menerima SEMUA nama sheet
 * (termasuk "Backlog Register") tanpa perlu if/switch manual per sheet.
 * Gunakan ini HANYA jika Anda ingin membangun ulang code.gs dari nol —
 * jangan ditempel begitu saja di atas code.gs yang sudah berjalan, karena
 * bisa menimpa logika khusus (mis. blok terpisah "monthly_kpi_achievement"
 * pada sheet "Dashboard") yang mungkin sudah Anda miliki.
 */
function doPost_REFERENCE_ONLY(e) {
  var payload = JSON.parse(e.postData.contents);
  var ss = SpreadsheetApp.openById(payload.spreadsheetId);
  var result;

  if (payload.action === 'sync' && payload.sheet === 'Backlog Register') {
    result = syncBacklogRegisterSheet_(ss, payload.records);
  } else {
    result = { ok: false, error: 'Sheet tidak dikenali: ' + payload.sheet };
  }

  return ContentService
    .createTextOutput(JSON.stringify(result))
    .setMimeType(ContentService.MimeType.JSON);
}
