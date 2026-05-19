/**
 * ===== 一鍵初始化資料庫 Sheets =====
 *
 * 部署時，在 Apps Script 編輯器手動執行 `initializeDatabase` 一次即可。
 * 會自動建立 6 個工作表並填入初始資料（含「固定式起重機」的 7 項日檢、9 項月檢）。
 *
 * 重複執行時：已存在的工作表不會被覆蓋（只補欄位 / 補缺少的列）。
 */

function initializeDatabase() {
  if (!CONFIG.DB_SHEET_ID || CONFIG.DB_SHEET_ID.startsWith('REPLACE_')) {
    throw new Error('請先到 Config.gs 設定 DB_SHEET_ID');
  }
  const ss = SpreadsheetApp.openById(CONFIG.DB_SHEET_ID);

  setupSheet_(ss, '系統設定', ['鍵', '值', '備註'], [
    ['venueSheetId', CONFIG.VENUE_SHEET_ID_FALLBACK, '場地使用試算表 ID（每年新表只要改這裡）'],
    ['webAppUrl', '', 'Apps Script 部署後的 exec URL（部署完執行 setWebAppUrlFromCurrent 自動填）'],
    ['webFrontendUrl', '', 'GitHub Pages 前端網址（提醒信會帶這連結）例：https://<your-github-username>.github.io/auto-checklist'],
  ]);

  setupSheet_(ss, '節假日關鍵字', ['關鍵字', '備註'],
    CONFIG.HOLIDAY_KEYWORDS_DEFAULT.map(k => [k, '預設'])
  );

  setupSheet_(ss, '設備清單',
    ['設備代號', '設備名稱', '機械編號', '型式規格', '設備類別', '所在位置', '場地表分頁', '啟用'],
    [[
      CONFIG.DEFAULT_EQUIPMENT.equipmentId,
      CONFIG.DEFAULT_EQUIPMENT.equipmentName,
      CONFIG.DEFAULT_EQUIPMENT.machineSerial,
      CONFIG.DEFAULT_EQUIPMENT.machineType,
      CONFIG.DEFAULT_EQUIPMENT.category,
      CONFIG.DEFAULT_EQUIPMENT.location,
      CONFIG.DEFAULT_EQUIPMENT.venueSheetTab,
      true,
    ]]
  );

  // 檢查表模板：加 resultOptions / monthlySchema 兩欄支援多種機具格式
  // - resultOptions：結果代號（comma-separated），daily 各機具不同
  // - monthlySchema：crane_full = 7 欄（部份/方法/結果/風險/改善/檢討）
  //                  simple    = 4 欄（部份/方法/結果/改善）
  setupSheet_(ss, '檢查表模板',
    ['表單ID', '設備類別', '表單名稱', '週期', '法規依據', '填寫規則', 'resultOptions', 'monthlySchema', '啟用'],
    [
      ['F-CRANE-D', '固定式起重機', '固定式起重機每日作業前檢點表', '每日',
       '職業安全衛生管理辦法 §52', '良好「V」/ 無此項「/」/ 不良「X」（不良需於記事欄註明）',
       'V,/,X', '', true],
      ['F-CRANE-M', '固定式起重機', '固定式起重機每月定期檢查紀錄', '每月',
       '起重升降機具安全規則 §26', '勾選檢查方法、結果（正常/異常）、風險評估（V/?/—）、改善措施、定期檢討',
       '正常,異常', 'crane_full', true],
      ['F-FORK-D', '堆高機', '堆高機每日使用前檢點表', '每日',
       '職業安全衛生管理辦法 §50', '良好「○」/ 尚可「△」/ 不良待修「X」（由授課教師檢查）',
       '○,△,X', '', true],
      ['F-FORK-M', '堆高機', '堆高機每月定期檢查表', '每月',
       '起重升降機具安全規則 §128', '正常打「ˇ」/ 異常打「X」',
       'ˇ,X', 'simple', true],
    ]
  );

  // 日檢 7 項、月檢 9 項
  setupSheet_(ss, '檢查項目',
    ['表單ID', '項目順序', '項目名稱', '檢查方法', '啟用'],
    [
      ['F-CRANE-D', 1, '過捲預防裝置作動狀況', '目視+操作', true],
      ['F-CRANE-D', 2, '過負荷預防裝置作動狀況', '目視+操作', true],
      ['F-CRANE-D', 3, '制動器及離合器作動', '操作', true],
      ['F-CRANE-D', 4, '鋼索運行', '目視', true],
      ['F-CRANE-D', 5, '吊鉤機能', '目視+操作', true],
      ['F-CRANE-D', 6, '控制裝置性能', '操作', true],
      ['F-CRANE-D', 7, '直、橫行軌道', '目視', true],

      ['F-CRANE-M', 1, '過捲預防裝置、警報裝置、制動器、離合器及其他安全裝置是否正常', '目視+測試', true],
      ['F-CRANE-M', 2, '鋼索或吊鏈有無損傷', '目視+測試', true],
      ['F-CRANE-M', 3, '吊鉤抓斗等吊具有無損傷', '目視+測試', true],
      ['F-CRANE-M', 4, '配線、集電裝置、配電盤開關及控制裝置有無異常', '目視+測試', true],
      ['F-CRANE-M', 5, '捲揚機是否正常', '目視+測試', true],
      ['F-CRANE-M', 6, '現場是否標示額定荷重', '目視', true],
      ['F-CRANE-M', 7, '是否標示禁止人員進入吊運物下方及非有關人員不得進入工作區', '目視', true],
      ['F-CRANE-M', 8, '鋼索及剎車裝置有無異常', '目視+測試', true],
      ['F-CRANE-M', 9, '其它', '目視+測試', true],

      // ----- 堆高機日檢 11 項 -----
      ['F-FORK-D', 1, '水箱、副水箱水是否足夠', '', true],
      ['F-FORK-D', 2, '機油是否足夠', '', true],
      ['F-FORK-D', 3, '煞車油是否足夠', '', true],
      ['F-FORK-D', 4, '燃料油（高級柴油）是否足夠', '', true],
      ['F-FORK-D', 5, '儀表、燈光是否故障', '', true],
      ['F-FORK-D', 6, '煞車踏板間隙是否過大', '', true],
      ['F-FORK-D', 7, '輪胎螺絲是否鬆動', '', true],
      ['F-FORK-D', 8, '方向盤、喇叭功能是否正常', '', true],
      ['F-FORK-D', 9, '液壓油是否足夠（油量尺上下限）', '', true],
      ['F-FORK-D', 10, '油管是否漏油', '', true],
      ['F-FORK-D', 11, '電瓶水（上下限）', '', true],

      // ----- 堆高機月檢 7 項 -----
      ['F-FORK-M', 1, '頂蓬及桅桿有無損傷', '目視', true],
      ['F-FORK-M', 2, '積載裝置之性能', '測試', true],
      ['F-FORK-M', 3, '油壓設備之性能', '檢點', true],
      ['F-FORK-M', 4, '制動裝置、剎車之性能', '測試', true],
      ['F-FORK-M', 5, '離合器', '測試', true],
      ['F-FORK-M', 6, '方向盤', '檢點', true],
      ['F-FORK-M', 7, '其他各部份有無損傷', '檢點', true],
    ]
  );

  // 填報紀錄（只建欄位、不塞資料）
  // 加 clientSubmissionId（idempotency）+ 異常事件數（方便快速辨識哪天有異常）
  setupSheet_(ss, '填報紀錄',
    ['紀錄ID', '送出時間', '檢查日期', '表單類型', '設備代號', '設備名稱',
     '設備類別', '檢點人員', '異常事件數', '完整資料JSON', 'PDF連結', 'clientSubmissionId', '備註'],
    []
  );

  // 異常事件追蹤（Layer 1）
  // 每填一張表的每個「結果=bad」項目，自動寫一列到這
  setupSheet_(ss, '異常事件',
    ['事件ID', '通報日期', '通報時間', '設備代號', '設備名稱', '設備類別',
     '表單類型', '項次', '項目名稱', '結果代號', '異常說明', '照片數',
     'PDF連結', '紀錄ID',
     '狀態', '預計完成日', '實際完成日', '負責人', '備註'],
    []
  );
  // 對「狀態」欄加下拉資料驗證
  setupIncidentStatusValidation_(ss);

  // 套用欄寬與文字換行（讓 Sheet 視覺更舒適）
  try { applyColumnWidthsAndWrap_(); } catch (e) { Logger.log('套用欄寬失敗：' + e); }

  // 中文化 + 下拉驗證（把初始 seed 的 true/false 轉成 是/否、加各選項下拉）
  try { applyChineseSettingsAndDropdowns(); } catch (e) { Logger.log('套用下拉驗證失敗：' + e); }

  Logger.log('資料庫初始化完成。請接著到 Sheets 確認 → 回 Apps Script 執行 installDailyReminderTrigger');
}

/**
 * 建立或更新工作表（支援 schema migration）
 *
 * 行為：
 *   - 新表：寫全部 headers + 樣式 + 初始資料
 *   - 既存表：補上「缺少的 headers」到最後幾欄，不動既有資料
 *   - 用 header 名稱比對（不依賴順序），所以下次 initializeDatabase
 *     就能自動補 schema 變更（例如新增 clientSubmissionId 欄位）
 */
function setupSheet_(ss, sheetName, headers, initialRows) {
  let sheet = ss.getSheetByName(sheetName);
  if (!sheet) {
    sheet = ss.insertSheet(sheetName);
  }

  // 確保 max columns 足夠
  const currentMaxCol = sheet.getMaxColumns();
  if (currentMaxCol < headers.length) {
    sheet.insertColumnsAfter(currentMaxCol, headers.length - currentMaxCol);
  }

  // 讀現有 headers（trim、過濾空）
  const lastCol = Math.max(sheet.getLastColumn(), 1);
  const existingRow = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  const existingHeaders = existingRow.map(v => String(v || '').trim()).filter(Boolean);

  if (existingHeaders.length === 0) {
    // 完全新表
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    sheet.getRange(1, 1, 1, headers.length)
      .setBackground('#1a73e8').setFontColor('#ffffff').setFontWeight('bold');
    sheet.setFrozenRows(1);
  } else {
    // 既存表：補上缺少的 headers（在最後）
    const missing = headers.filter(h => existingHeaders.indexOf(h) < 0);
    if (missing.length > 0) {
      const startCol = existingHeaders.length + 1;
      // 確保欄數夠（可能 maxColumns 沒到 startCol + missing.length - 1）
      const needed = startCol + missing.length - 1;
      if (sheet.getMaxColumns() < needed) {
        sheet.insertColumnsAfter(sheet.getMaxColumns(), needed - sheet.getMaxColumns());
      }
      sheet.getRange(1, startCol, 1, missing.length).setValues([missing]);
      sheet.getRange(1, startCol, 1, missing.length)
        .setBackground('#1a73e8').setFontColor('#ffffff').setFontWeight('bold');
      Logger.log('Sheet「' + sheetName + '」補上欄位：' + missing.join(', '));
    }
  }

  // 寫初始資料（只在表空時，且 initialRows 依 headers 順序）
  if (initialRows.length > 0 && sheet.getLastRow() < 2) {
    sheet.getRange(2, 1, initialRows.length, headers.length).setValues(initialRows);
  }

  for (let c = 1; c <= Math.min(headers.length, 26); c++) {
    sheet.autoResizeColumn(c);
  }
}

/**
 * 把目前部署的 Web App URL 寫回 系統設定（部署完後手動執行一次）
 *
 * 注意：必須在 Apps Script 編輯器中執行此函數，並且該 Apps Script 已部署為 Web App
 */
function setWebAppUrlFromCurrent() {
  const url = ScriptApp.getService().getUrl();
  if (!url) throw new Error('尚未部署為 Web App');
  const ss = SpreadsheetApp.openById(CONFIG.DB_SHEET_ID);
  const sheet = ss.getSheetByName('系統設定');
  const data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (data[i][0] === 'webAppUrl') {
      sheet.getRange(i + 1, 2).setValue(url);
      Logger.log('已更新 webAppUrl = ' + url);
      return url;
    }
  }
  sheet.appendRow(['webAppUrl', url, '由 setWebAppUrlFromCurrent() 自動填入']);
  return url;
}

/**
 * 寫入 branding 設定（機構名稱、承辦 email）到 DB 系統設定
 *
 * 從 admin endpoint 呼叫，讓 source code 不用寫死具體機構資訊
 */
/**
 * 觸發所有所需 OAuth scope 的 consent dialog
 *
 * 何時跑：appsscript.json 新增 oauthScope 後，使用者要手動在編輯器
 * 執行此函數一次，跳出新的 consent dialog 同意（含 Google Docs 權限）。
 * Web App 的部署不會自動 prompt 使用者授權新 scope，必須由編輯器觸發。
 */
function triggerScopesConsent() {
  // 逐一呼叫各 API 觸發 scope check
  SpreadsheetApp.openById(CONFIG.DB_SHEET_ID).getName();
  DriveApp.getRootFolder().getName();
  MailApp.getRemainingDailyQuota();
  const doc = DocumentApp.create('_temp_oauth_trigger_' + new Date().getTime());
  DriveApp.getFileById(doc.getId()).setTrashed(true);
  Logger.log('所有 OAuth scope 已授權成功');
}

/**
 * 清掉指定日期的所有測試 / 紀錄資料
 *
 * 用途：清掉某天的測試資料，含填報紀錄 / 異常事件 / Drive PDF
 *
 * 參數：dateStr = 'YYYY-MM-DD'（西元年月日）
 * 回傳：summary 字串（人類可讀的執行報告）
 *
 * ⚠ 一旦執行不可逆（PDF setTrashed 可救回 30 天，sheet row 刪掉就沒了）
 *   只應由 admin endpoint 觸發 + 帶 token
 */
function cleanupTestDataForDate_(dateStr, opts) {
  opts = opts || {};
  const dryRun = !!opts.dryRun;
  if (!dateStr || !/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    throw new Error('dateStr 必須為 YYYY-MM-DD');
  }
  const ss = SpreadsheetApp.openById(CONFIG.DB_SHEET_ID);
  const report = [];
  let trashedPdfs = 0;
  let pdfErrors = 0;

  // === 1. 清填報紀錄 ===
  const recSheet = ss.getSheetByName('填報紀錄');
  let recRowsToDelete = [];
  let recPdfsToTrash = [];
  if (recSheet && recSheet.getLastRow() >= 2) {
    const data = recSheet.getDataRange().getValues();
    const headers = data[0];
    const idxDate = headers.indexOf('檢查日期');
    const idxPdf = headers.indexOf('PDF連結');
    for (let i = 1; i < data.length; i++) {
      const cellDate = data[i][idxDate];
      let iso = '';
      if (cellDate instanceof Date) {
        iso = Utilities.formatDate(cellDate, tz_(), 'yyyy-MM-dd');
      } else {
        iso = String(cellDate).trim();
      }
      if (iso === dateStr) {
        recRowsToDelete.push(i + 1);
        const url = String(data[i][idxPdf] || '');
        const m = url.match(/\/d\/([A-Za-z0-9_-]+)/);
        if (m) recPdfsToTrash.push(m[1]);
      }
    }
    if (!dryRun) {
      // PDF 先 trash（trash 失敗也繼續，至少 sheet 刪掉）
      recPdfsToTrash.forEach(fid => {
        try { DriveApp.getFileById(fid).setTrashed(true); trashedPdfs++; }
        catch (e) { pdfErrors++; Logger.log(`Trash PDF 失敗 (${fid}): ${e}`); }
      });
      // 由下往上刪 row（避免 index 變動）
      for (let r = recRowsToDelete.length - 1; r >= 0; r--) {
        recSheet.deleteRow(recRowsToDelete[r]);
      }
    }
    report.push(`${dryRun ? '[DRY-RUN]' : '✓'} 填報紀錄：${dryRun ? '會刪' : '刪除'} ${recRowsToDelete.length} 列、${dryRun ? '會 trash' : 'trashed'} ${dryRun ? recPdfsToTrash.length : trashedPdfs} PDF${pdfErrors ? `（失敗 ${pdfErrors}）` : ''}`);
  }

  // === 2. 清異常事件 ===
  const incSheet = ss.getSheetByName('異常事件');
  let incRowsToDelete = [];
  if (incSheet && incSheet.getLastRow() >= 2) {
    const data = incSheet.getDataRange().getValues();
    const headers = data[0];
    const idxDate = headers.indexOf('通報日期');
    for (let i = 1; i < data.length; i++) {
      const cellDate = data[i][idxDate];
      let iso = '';
      if (cellDate instanceof Date) {
        iso = Utilities.formatDate(cellDate, tz_(), 'yyyy-MM-dd');
      } else {
        iso = String(cellDate).trim();
      }
      if (iso === dateStr) incRowsToDelete.push(i + 1);
    }
    if (!dryRun) {
      for (let r = incRowsToDelete.length - 1; r >= 0; r--) {
        incSheet.deleteRow(incRowsToDelete[r]);
      }
    }
    report.push(`${dryRun ? '[DRY-RUN]' : '✓'} 異常事件：${dryRun ? '會刪' : '刪除'} ${incRowsToDelete.length} 列`);
  }

  const summary = report.join('\n');
  Logger.log(summary);
  return summary;
}

/**
 * 列出「待處理 / 處理中 / 待重檢」異常事件
 * （讓承辦人 / 主管能從外部 API 查目前累積未完成的事件）
 */
function listOpenIncidents_() {
  const ss = SpreadsheetApp.openById(CONFIG.DB_SHEET_ID);
  const sheet = ss.getSheetByName('異常事件');
  if (!sheet || sheet.getLastRow() < 2) return { count: 0, incidents: [] };
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  const data = sheet.getRange(2, 1, sheet.getLastRow() - 1, headers.length).getValues();
  const idx = n => headers.indexOf(n);
  const closedStates = new Set(['已完成', '不處理']);
  const incidents = [];

  // 日期欄正規化：Sheets 自動把「2026-05-19」字串辨識成 Date 物件
  // 讀出來時要轉回 ISO 字串，否則 API 回傳會是 "Tue May 19 2026..." 之類
  const toISO = v => {
    if (v instanceof Date) return formatISODate_(v);
    return String(v || '');
  };

  for (let i = 0; i < data.length; i++) {
    const status = String(data[i][idx('狀態')] || '待處理');
    if (closedStates.has(status)) continue;
    incidents.push({
      incidentId: data[i][idx('事件ID')],
      reportDate: toISO(data[i][idx('通報日期')]),
      equipmentId: data[i][idx('設備代號')],
      equipmentName: data[i][idx('設備名稱')],
      category: data[i][idx('設備類別')],
      formType: data[i][idx('表單類型')],
      order: data[i][idx('項次')],
      itemName: data[i][idx('項目名稱')],
      result: data[i][idx('結果代號')],
      description: data[i][idx('異常說明')],
      photoCount: data[i][idx('照片數')],
      status,
      dueDate: toISO(data[i][idx('預計完成日')]),
      assignee: data[i][idx('負責人')],
    });
  }
  // 依通報日期降冪（最新在前）— ISO 字串排序正確對應時間
  incidents.sort((a, b) => (b.reportDate || '').localeCompare(a.reportDate || ''));
  return { count: incidents.length, incidents };
}

/**
 * 套用各工作表的「欄寬」與「文字換行」設定
 *
 * 每張表依 header 名稱動態定位欄位（不依賴順序）。
 * 找不到的 header 略過（保持舊版相容性）。
 */
function applyColumnWidthsAndWrap_() {
  const ss = SpreadsheetApp.openById(CONFIG.DB_SHEET_ID);
  // 欄寬 profile（pixel）
  const profiles = {
    '異常事件': {
      '事件ID': 90, '通報日期': 100, '通報時間': 80,
      '設備代號': 110, '設備名稱': 140, '設備類別': 90,
      '表單類型': 80, '項次': 55, '項目名稱': 240, '結果代號': 80,
      '異常說明': 260, '照片數': 60, 'PDF連結': 140, '紀錄ID': 90,
      '狀態': 100, '預計完成日': 110, '實際完成日': 110, '負責人': 90, '備註': 200,
    },
    '填報紀錄': {
      '紀錄ID': 90, '送出時間': 140, '檢查日期': 100, '表單類型': 80,
      '設備代號': 110, '設備名稱': 140, '設備類別': 90, '檢點人員': 100,
      '異常事件數': 90, '完整資料JSON': 200, 'PDF連結': 140,
      'clientSubmissionId': 100, '備註': 150,
    },
    '檢查表模板': {
      '表單ID': 100, '設備類別': 100, '表單名稱': 240, '週期': 70,
      '法規依據': 180, '填寫規則': 280, 'resultOptions': 100, 'monthlySchema': 110, '啟用': 60,
    },
    '檢查項目': {
      '表單ID': 100, '項目順序': 80, '項目名稱': 320, '檢查方法': 110, '啟用': 60,
    },
    '設備清單': {
      '設備代號': 110, '設備名稱': 140, '機械編號': 130, '型式規格': 180,
      '設備類別': 100, '所在位置': 100, '場地表分頁': 280, '啟用': 60,
    },
    '系統設定': { '鍵': 140, '值': 320, '備註': 280 },
    '節假日關鍵字': { '關鍵字': 120, '備註': 200 },
  };
  // 這些欄位文字較長，要開「自動換行」
  const wrapCols = ['項目名稱', '表單名稱', '異常說明', '填寫規則', '法規依據',
                    '完整資料JSON', '備註', '型式規格', '場地表分頁', '值'];

  Object.keys(profiles).forEach(sheetName => {
    const sheet = ss.getSheetByName(sheetName);
    if (!sheet) return;
    const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];

    Object.keys(profiles[sheetName]).forEach(col => {
      const i = headers.indexOf(col) + 1;
      if (i > 0) sheet.setColumnWidth(i, profiles[sheetName][col]);
    });

    wrapCols.forEach(col => {
      const i = headers.indexOf(col) + 1;
      if (i > 0) sheet.getRange(1, i, Math.max(sheet.getMaxRows(), 100), 1).setWrap(true);
    });

    // 凍結第 1 列已在 setupSheet_ 設過（freezeRows: 1）
    // 列高自動依內容（Sheets 預設行為，無需 setRowHeight）
  });

  Logger.log('column widths + wrap applied to ' + Object.keys(profiles).length + ' sheets');
}

/**
 * 對「異常事件」表的「狀態」欄加下拉資料驗證
 * 5 個值：待處理 / 處理中 / 已完成 / 待重檢 / 不處理
 */
function setupIncidentStatusValidation_(ss) {
  const sheet = ss.getSheetByName('異常事件');
  if (!sheet) return;
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  const statusCol = headers.indexOf('狀態') + 1;
  if (statusCol < 1) return;
  // 整欄從第 2 列起加 validation
  const range = sheet.getRange(2, statusCol, sheet.getMaxRows() - 1, 1);
  const rule = SpreadsheetApp.newDataValidation()
    .requireValueInList(['待處理', '處理中', '已完成', '待重檢', '不處理'], true)
    .setAllowInvalid(false)
    .setHelpText('請從下拉選單選擇狀態')
    .build();
  range.setDataValidation(rule);
  Logger.log('「異常事件」狀態欄已加下拉驗證');
}

/**
 * 對所有設定表的選項欄位加下拉驗證 + 把 TRUE/FALSE 遷移為「是/否」
 *
 * 影響欄位：
 *   - 設備清單.啟用 / 設備類別
 *   - 檢查表模板.啟用 / 週期 / 設備類別 / monthlySchema
 *   - 檢查項目.啟用 / 表單ID
 *
 * 何時跑：DB 從早期 TRUE/FALSE 版本升級時 / 想統一管理選項時
 * 安全性：idempotent（重複跑無害），不會誤刪資料
 */
function applyChineseSettingsAndDropdowns() {
  const ss = SpreadsheetApp.openById(CONFIG.DB_SHEET_ID);
  const report = [];

  // ===== 1. 收集動態下拉清單來源 =====
  const tplSheet = ss.getSheetByName('檢查表模板');
  const tplData = tplSheet ? tplSheet.getDataRange().getValues() : [[]];
  const tplHeaders = tplData[0];
  const catIdx = tplHeaders.indexOf('設備類別');
  const idIdx = tplHeaders.indexOf('表單ID');
  const categories = catIdx >= 0
    ? [...new Set(tplData.slice(1).map(r => r[catIdx]).filter(v => v && String(v).trim()))]
    : [];
  const templateIds = idIdx >= 0
    ? [...new Set(tplData.slice(1).map(r => r[idIdx]).filter(v => v && String(v).trim()))]
    : [];

  // 加進「設備清單.設備類別」可能有的設備類別（避免新類別還沒在模板就被擋）
  const eqSheet = ss.getSheetByName('設備清單');
  if (eqSheet) {
    const eqData = eqSheet.getDataRange().getValues();
    const eqHeaders = eqData[0];
    const eqCatIdx = eqHeaders.indexOf('設備類別');
    if (eqCatIdx >= 0) {
      eqData.slice(1).map(r => r[eqCatIdx]).filter(v => v && String(v).trim())
        .forEach(c => { if (!categories.includes(c)) categories.push(c); });
    }
  }
  report.push(`收集到設備類別：${categories.join(', ')}`);
  report.push(`收集到表單ID：${templateIds.join(', ')}`);

  // ===== 2. 套用各表 dropdown + 中文化 =====
  const SHEET_PROFILES = {
    '設備清單': [
      { col: '啟用',     options: ['是', '否'],       migrate: { TRUE: '是', FALSE: '否' } },
      { col: '設備類別', options: categories,         strict: false },
    ],
    '檢查表模板': [
      { col: '啟用',     options: ['是', '否'],       migrate: { TRUE: '是', FALSE: '否' } },
      { col: '週期',     options: ['每日', '每月'],   strict: true },
      { col: '設備類別', options: categories,         strict: false },
      { col: 'monthlySchema', options: ['', 'simple', 'crane_full'], strict: false },
    ],
    '檢查項目': [
      { col: '啟用',     options: ['是', '否'],       migrate: { TRUE: '是', FALSE: '否' } },
      { col: '表單ID',   options: templateIds,        strict: false },
    ],
  };

  Object.keys(SHEET_PROFILES).forEach(sheetName => {
    const sheet = ss.getSheetByName(sheetName);
    if (!sheet) { report.push(`⚠ 工作表「${sheetName}」不存在，略過`); return; }

    const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
    const lastRow = sheet.getLastRow();

    SHEET_PROFILES[sheetName].forEach(({ col, options, migrate, strict }) => {
      const colIdx = headers.indexOf(col) + 1;  // 1-based
      if (colIdx < 1) { report.push(`⚠ 「${sheetName}」找不到欄位「${col}」，略過`); return; }
      if (!options || options.length === 0) {
        report.push(`⚠ 「${sheetName}.${col}」沒有可用選項，略過`); return;
      }

      // 2a. 遷移既有資料（TRUE → 是 等）
      let migratedCount = 0;
      if (migrate && lastRow >= 2) {
        const range = sheet.getRange(2, colIdx, lastRow - 1, 1);
        const vals = range.getValues();
        for (let i = 0; i < vals.length; i++) {
          const v = vals[i][0];
          const key = v === true ? 'TRUE' : v === false ? 'FALSE' : String(v).toUpperCase();
          if (migrate[key]) {
            vals[i][0] = migrate[key];
            migratedCount++;
          }
        }
        if (migratedCount > 0) range.setValues(vals);
      }

      // 2b. 加 data validation（從第 2 列到 maxRows，含未來新增的列）
      const validationRange = sheet.getRange(2, colIdx, Math.max(sheet.getMaxRows() - 1, 100), 1);
      const rule = SpreadsheetApp.newDataValidation()
        .requireValueInList(options, true)
        .setAllowInvalid(strict === false)   // strict=true 時禁止無效值
        .setHelpText('從下拉選單選擇')
        .build();
      validationRange.setDataValidation(rule);

      report.push(`✓ 「${sheetName}.${col}」加下拉（${options.length} 個選項）${migratedCount > 0 ? ` + 遷移 ${migratedCount} 列` : ''}`);
    });
  });

  // ===== 3. 異常事件.狀態（沿用既有設定） =====
  setupIncidentStatusValidation_(ss);
  report.push('✓ 「異常事件.狀態」下拉已套用');

  const summary = report.join('\n');
  Logger.log(summary);
  return summary;
}

/**
 * 加堆高機檢查表模板 + 18 項檢查項目（既有 DB upsert）
 *
 * 何時跑：第一次加堆高機（或新機具）時，從 source code 把模板與項目寫到 DB。
 * setupSheet_ 對既有 data 不會追加，所以 initializeDatabase 不會新增這些列。
 * 此函數做「表單ID」唯一性檢查，已存在就略過。
 */
function addForkliftTemplatesAndItems() {
  const ss = SpreadsheetApp.openById(CONFIG.DB_SHEET_ID);
  const out = { templates: 0, items: 0 };

  // 1. 檢查表模板
  const tplSheet = ss.getSheetByName('檢查表模板');
  const tplHeaders = tplSheet.getRange(1, 1, 1, tplSheet.getLastColumn()).getValues()[0];
  const tplIdx = n => tplHeaders.indexOf(n);
  const tplLastRow = tplSheet.getLastRow();
  const existingTplIds = new Set();
  if (tplLastRow > 1) {
    tplSheet.getRange(2, tplIdx('表單ID') + 1, tplLastRow - 1, 1).getValues()
      .forEach(r => existingTplIds.add(String(r[0])));
  }

  const newTemplates = [
    ['F-FORK-D', '堆高機', '堆高機每日使用前檢點表', '每日',
     '職業安全衛生管理辦法 §50', '良好「○」/ 尚可「△」/ 不良待修「X」（由授課教師檢查）',
     '○,△,X', '', true],
    ['F-FORK-M', '堆高機', '堆高機每月定期檢查表', '每月',
     '起重升降機具安全規則 §128', '正常打「ˇ」/ 異常打「X」',
     'ˇ,X', 'simple', true],
  ];
  const tplColMap = ['表單ID', '設備類別', '表單名稱', '週期', '法規依據', '填寫規則', 'resultOptions', 'monthlySchema', '啟用'];
  newTemplates.forEach(tplRow => {
    const id = tplRow[0];
    if (existingTplIds.has(id)) { Logger.log('模板已存在：' + id); return; }
    const row = new Array(tplHeaders.length).fill('');
    tplColMap.forEach((col, i) => {
      const ci = tplIdx(col);
      if (ci >= 0) row[ci] = tplRow[i];
    });
    tplSheet.appendRow(row);
    out.templates++;
  });

  // 2. 檢查項目
  const itemSheet = ss.getSheetByName('檢查項目');
  const itemHeaders = itemSheet.getRange(1, 1, 1, itemSheet.getLastColumn()).getValues()[0];
  const itemIdx = n => itemHeaders.indexOf(n);
  const itemLastRow = itemSheet.getLastRow();
  const existingItems = new Set();
  if (itemLastRow > 1) {
    const data = itemSheet.getRange(2, 1, itemLastRow - 1, itemHeaders.length).getValues();
    data.forEach(r => {
      existingItems.add(r[itemIdx('表單ID')] + '|' + r[itemIdx('項目順序')]);
    });
  }

  const newItems = [
    // 堆高機日檢 11 項
    ['F-FORK-D', 1, '水箱、副水箱水是否足夠', '', true],
    ['F-FORK-D', 2, '機油是否足夠', '', true],
    ['F-FORK-D', 3, '煞車油是否足夠', '', true],
    ['F-FORK-D', 4, '燃料油（高級柴油）是否足夠', '', true],
    ['F-FORK-D', 5, '儀表、燈光是否故障', '', true],
    ['F-FORK-D', 6, '煞車踏板間隙是否過大', '', true],
    ['F-FORK-D', 7, '輪胎螺絲是否鬆動', '', true],
    ['F-FORK-D', 8, '方向盤、喇叭功能是否正常', '', true],
    ['F-FORK-D', 9, '液壓油是否足夠(油量尺上下限)', '', true],
    ['F-FORK-D', 10, '油管是否漏油', '', true],
    ['F-FORK-D', 11, '電瓶水（上下限）', '', true],
    // 堆高機月檢 7 項
    ['F-FORK-M', 1, '頂蓬及桅桿有無損傷', '目視', true],
    ['F-FORK-M', 2, '積載裝置之性能', '測試', true],
    ['F-FORK-M', 3, '油壓設備之性能', '檢點', true],
    ['F-FORK-M', 4, '制動裝置、剎車之性能', '測試', true],
    ['F-FORK-M', 5, '離合器', '測試', true],
    ['F-FORK-M', 6, '方向盤', '檢點', true],
    ['F-FORK-M', 7, '其他各部份有無損傷', '檢點', true],
  ];
  const itemColMap = ['表單ID', '項目順序', '項目名稱', '檢查方法', '啟用'];
  const rowsToAppend = [];
  newItems.forEach(item => {
    const key = item[0] + '|' + item[1];
    if (existingItems.has(key)) return;
    const row = new Array(itemHeaders.length).fill('');
    itemColMap.forEach((col, i) => {
      const ci = itemIdx(col);
      if (ci >= 0) row[ci] = item[i];
    });
    rowsToAppend.push(row);
  });
  if (rowsToAppend.length > 0) {
    itemSheet.getRange(itemSheet.getLastRow() + 1, 1, rowsToAppend.length, itemHeaders.length).setValues(rowsToAppend);
    out.items = rowsToAppend.length;
  }

  Logger.log('addForkliftTemplatesAndItems 完成：' + JSON.stringify(out));
  return out;
}

/**
 * 加入堆高機 6 台 A-F 到「設備清單」
 *
 * 用法：在 Apps Script 編輯器選此函數 → 執行（一次即可，重複跑會略過已存在的）
 * 場地表分頁名稱：「內外場-堆高機、移動式、危運、吊籠、一壓」
 */
function addForkliftEquipments() {
  const ss = SpreadsheetApp.openById(CONFIG.DB_SHEET_ID);
  const sheet = ss.getSheetByName('設備清單');
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  const idx = n => headers.indexOf(n);

  // 現有的設備代號集合
  const lastRow = sheet.getLastRow();
  const existing = new Set();
  if (lastRow > 1) {
    sheet.getRange(2, idx('設備代號') + 1, lastRow - 1, 1).getValues()
      .forEach(r => existing.add(String(r[0])));
  }

  // 部署時可改：codePrefix / locationName / venueTab
  const codePrefix = 'FORK-LJ-';
  const locationName = '<位置>';
  const venueTab = '<場地表分頁名稱>';
  const letters = ['A', 'B', 'C', 'D', 'E', 'F'];
  const newRows = [];
  letters.forEach(l => {
    const code = codePrefix + l;
    if (existing.has(code)) return;
    const row = new Array(headers.length).fill('');
    const setCol = (name, v) => { const i = idx(name); if (i >= 0) row[i] = v; };
    setCol('設備代號', code);
    setCol('設備名稱', '堆高機 ' + l + ' 號');
    setCol('機械編號', 'FORK-' + l);
    setCol('型式規格', '');
    setCol('設備類別', '堆高機');
    setCol('所在位置', locationName);
    setCol('場地表分頁', venueTab);
    setCol('啟用', '是');
    newRows.push(row);
  });

  if (newRows.length === 0) {
    Logger.log('堆高機設備已存在，無需新增');
    return { added: 0 };
  }
  sheet.getRange(sheet.getLastRow() + 1, 1, newRows.length, headers.length).setValues(newRows);
  Logger.log('新增 ' + newRows.length + ' 台堆高機：' + letters.slice(0, newRows.length).join(', '));
  return { added: newRows.length };
}

function setBrandingSettings_(settings) {
  const ss = SpreadsheetApp.openById(CONFIG.DB_SHEET_ID);
  const sheet = ss.getSheetByName('系統設定');
  const data = sheet.getDataRange().getValues();
  const written = {};

  function upsert(key, value, note) {
    if (!value) return;
    for (let i = 1; i < data.length; i++) {
      if (data[i][0] === key) {
        sheet.getRange(i + 1, 2).setValue(value);
        written[key] = '更新';
        return;
      }
    }
    sheet.appendRow([key, value, note || '']);
    data.push([key, value, note || '']);
    written[key] = '新增';
  }

  upsert('organizationName', settings.organizationName, '機構抬頭（PDF / 提醒信顯示）');
  upsert('reminderEmailTo', settings.reminderEmailTo, '提醒信收件人 email');

  return written;
}

/**
 * 系統狀態快照（不含敏感資訊，可供外部診斷）
 *
 * 回傳：所有設定鍵值、trigger 數量、紀錄筆數、Drive URL 等
 */
function getSystemStatus_() {
  const ss = SpreadsheetApp.openById(CONFIG.DB_SHEET_ID);

  // 1. 系統設定
  const settingsSheet = ss.getSheetByName('系統設定');
  const settings = {};
  if (settingsSheet && settingsSheet.getLastRow() > 1) {
    const data = settingsSheet.getRange(2, 1, settingsSheet.getLastRow() - 1, 2).getValues();
    data.forEach(r => { if (r[0]) settings[String(r[0])] = String(r[1] || ''); });
  }

  // 2. 觸發器
  const triggers = ScriptApp.getProjectTriggers().map(t => ({
    handler: t.getHandlerFunction(),
    type: String(t.getEventType()),
  }));

  // 3. 各表筆數
  const counts = {};
  ['設備清單', '檢查表模板', '檢查項目', '填報紀錄', '節假日關鍵字'].forEach(name => {
    const s = ss.getSheetByName(name);
    counts[name] = s ? Math.max(0, s.getLastRow() - 1) : -1;
  });

  // 4. Drive 資源檢查
  let archiveOk = false;
  try {
    DriveApp.getFolderById(CONFIG.ARCHIVE_ROOT_FOLDER_ID);
    archiveOk = true;
  } catch (e) { /* ignore */ }

  let venueOk = false;
  let venueTitle = '';
  try {
    const venueId = getVenueSheetId_();
    const venueSs = SpreadsheetApp.openById(venueId);
    venueOk = true;
    venueTitle = venueSs.getName();
  } catch (e) { /* ignore */ }

  return {
    timeZone: tz_(),
    deploymentUrl: ScriptApp.getService().getUrl() || '',
    dbSheetUrl: 'https://docs.google.com/spreadsheets/d/' + CONFIG.DB_SHEET_ID + '/edit',
    settings,
    triggers,
    counts,
    archive: { ok: archiveOk, folderId: CONFIG.ARCHIVE_ROOT_FOLDER_ID },
    venue: { ok: venueOk, title: venueTitle, sheetId: getVenueSheetId_() },
    holidayKeywordsCount: getHolidayKeywords_().length,
  };
}
