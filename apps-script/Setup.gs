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

  setupSheet_(ss, '檢查表模板',
    ['表單ID', '設備類別', '表單名稱', '週期', '法規依據', '填寫規則', '啟用'],
    [
      ['F-CRANE-D', '固定式起重機', '固定式起重機每日作業前檢點表', '每日',
       '職業安全衛生管理辦法 §52', '良好「V」/ 無此項「/」/ 不良「X」（不良需於記事欄註明）', true],
      ['F-CRANE-M', '固定式起重機', '固定式起重機每月定期檢查紀錄', '每月',
       '起重升降機具安全規則 §26', '勾選檢查方法、結果（正常/異常）、風險評估（V/?/—）、改善措施、定期檢討', true],
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
    ]
  );

  // 填報紀錄（只建欄位、不塞資料）
  setupSheet_(ss, '填報紀錄',
    ['紀錄ID', '送出時間', '檢查日期', '表單類型', '設備代號', '設備名稱',
     '設備類別', '檢點人員', '完整資料JSON', 'PDF連結', '備註'],
    []
  );

  Logger.log('資料庫初始化完成。請接著到 Sheets 確認 → 回 Apps Script 執行 installDailyReminderTrigger');
}

/**
 * 建立或更新工作表（已存在則不覆蓋資料、只補欄位）
 *
 * 修法重點：
 *   - 新建表預設只有 26 欄；若 headers.length > 26 要 insertColumns
 *   - 既存表的欄數可能 < headers.length，setValues 前先確保欄夠
 */
function setupSheet_(ss, sheetName, headers, initialRows) {
  let sheet = ss.getSheetByName(sheetName);
  if (!sheet) {
    sheet = ss.insertSheet(sheetName);
  }

  // 確保欄數足夠
  const currentMaxCol = sheet.getMaxColumns();
  if (currentMaxCol < headers.length) {
    sheet.insertColumnsAfter(currentMaxCol, headers.length - currentMaxCol);
  }

  // 判斷第一列是否為空（沒寫過 header）
  const firstRow = sheet.getRange(1, 1, 1, headers.length).getValues()[0];
  const firstRowEmpty = firstRow.every(v => v === '' || v === null);

  if (firstRowEmpty) {
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    sheet.getRange(1, 1, 1, headers.length)
      .setBackground('#1a73e8').setFontColor('#ffffff').setFontWeight('bold');
    sheet.setFrozenRows(1);
  }

  // 寫入初始資料（如果只有標題列、沒有任何資料列）
  if (initialRows.length > 0 && sheet.getLastRow() < 2) {
    sheet.getRange(2, 1, initialRows.length, headers.length).setValues(initialRows);
  }

  // 自動調整欄寬
  for (let c = 1; c <= headers.length; c++) {
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
