/**
 * ===== 一鍵初始化資料庫 Sheets =====
 *
 * 部署時，在 Apps Script 編輯器手動執行 `initializeDatabase` 一次即可。
 * 會自動建立 6 個工作表並填入初始資料（含「固定式起重機」的 7 項日檢、9 項月檢）。
 *
 * 重複執行時：已存在的工作表不會被覆蓋（只補欄位 / 補缺少的列）。
 */

/**
 * 一次性設定安全相關 Script Properties（由 codex 2026-05-26 安全分層觸發）
 *
 * 從 Apps Script 編輯器執行此函式 → Logger 會印出隨機產的 token 給你
 * 你需要：
 *   1. 跑這個函式
 *   2. 從 Logger 抄 ADMIN_TOKEN（admin endpoint 用）跟 LINE_WEBHOOK_QUERY_TOKEN（LINE webhook 用）
 *   3. 把 LINE_WEBHOOK_QUERY_TOKEN 接到 LINE Developers Console 的 Webhook URL 後面：
 *      原本：https://script.google.com/macros/s/AKfycb.../exec
 *      改成：https://script.google.com/macros/s/AKfycb.../exec?lineWebhookToken=<那個 token>
 *   4. 若要從 HTTP 跑 cleanupAll / cleanupDate，再手動設 ALLOW_DESTRUCTIVE_HTTP=YES（預設禁止）
 *
 * 不會覆蓋已存在的值（idempotent，重複跑安全）。
 */
function setupSecurityProperties() {
  const props = PropertiesService.getScriptProperties();
  const report = [];

  const adminToken = props.getProperty('ADMIN_TOKEN');
  if (!adminToken) {
    const newToken = Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '').substring(0, 16);
    props.setProperty('ADMIN_TOKEN', newToken);
    report.push('✓ ADMIN_TOKEN 已產生：' + newToken);
  } else {
    report.push('• ADMIN_TOKEN 已存在（不覆蓋）');
  }

  const webhookToken = props.getProperty('LINE_WEBHOOK_QUERY_TOKEN');
  if (!webhookToken) {
    const newToken = Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '').substring(0, 16);
    props.setProperty('LINE_WEBHOOK_QUERY_TOKEN', newToken);
    report.push('✓ LINE_WEBHOOK_QUERY_TOKEN 已產生：' + newToken);
    report.push('  ⚠ 需到 LINE Developers Console 把 Webhook URL 改成 exec_url?lineWebhookToken=' + newToken);
  } else {
    report.push('• LINE_WEBHOOK_QUERY_TOKEN 已存在（不覆蓋）');
  }

  // ALLOW_DESTRUCTIVE_HTTP 預設不設 — 需手動加才能從 HTTP 跑 cleanupAll
  const destructive = props.getProperty('ALLOW_DESTRUCTIVE_HTTP');
  if (!destructive) {
    report.push('• ALLOW_DESTRUCTIVE_HTTP 未設（HTTP cleanupAll/cleanupDate 將被拒絕，須在編輯器手動執行 cleanupAllSubmissionsAndIncidents_）');
  } else {
    report.push(`• ALLOW_DESTRUCTIVE_HTTP = ${destructive}`);
  }

  const msg = report.join('\n');
  Logger.log(msg);
  return msg;
}

/**
 * 由專案擁有者透過 Apps Script Execution API 輪替 ADMIN_TOKEN。
 *
 * 此函式不回傳 token 本身，避免密鑰出現在執行紀錄。executionApi 在
 * appsscript.json 設為 MYSELF，不能由匿名 Web App 訪客呼叫。
 */
function rotateOfficialDocumentAdminTokenForCloudRun(candidate, confirmation) {
  const token = String(candidate || '').trim();
  if (confirmation !== 'ROTATE_OFFICIAL_DOC_ADMIN_TOKEN') {
    throw new Error('確認碼錯誤');
  }
  if (token.length < 48) {
    throw new Error('ADMIN_TOKEN 至少需要 48 個字元');
  }
  if (token === CONFIG.API_TOKEN) {
    throw new Error('ADMIN_TOKEN 不可與 API_TOKEN 相同');
  }

  PropertiesService.getScriptProperties().setProperty('ADMIN_TOKEN', token);
  return {
    ok: true,
    tokenLength: token.length,
    rotatedAt: new Date().toISOString(),
  };
}

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
  ensureSystemSettingDefaults_(ss, [
    ['monthlyCheckWindowStart', '1', '月檢應檢期起始日（教室/堆高機/固定式起重機狀態顯示用）'],
    ['monthlyCheckWindowEnd', '5', '月檢應檢期結束日（教室/堆高機/固定式起重機狀態顯示用）'],
    ['monthlyReminderStartDay', '25', '月檢補填提醒起始日（教室/堆高機/固定式起重機）'],
    ['dailyWorkCheckEnabled', '否', '是否啟用舊版每日作業檢核；目前改由公文待發文雲端檢核試行，預設停用'],
    ['dailyPpeAssignmentEnabled', '是', '是否啟用每日場地防護具未填提醒；場地有使用且 17:00 後尚未填防護具日檢時，提醒指定窗口人工催填'],
    ['dailyPpeAssignmentTriggerHour', '17', '每日場地防護具未填提醒觸發時段（24 小時制）；預設 17 點'],
    ['dailyPpeAssignmentNearMinute', '15', '每日場地防護具未填提醒約略分鐘；Apps Script 會在此分鐘前後約 15 分鐘內觸發，15 約等於 17:00-17:30'],
    ['dailyPpeReminderRecipientNames', '卓小媛,張家豪', '每日場地防護具未填提醒收件窗口；以逗號、頓號或換行分隔，需在訂閱者清單內且是否訂閱=是'],
    ['dailyPpeAssignmentCandidateNames', '', '舊版每日場地防護具候選名單設定；目前已停用，保留空值供相容舊資料'],
    ['dailyPpeStatusLookbackDays', '14', '舊版 LINE「狀態」每日防護具待確認顯示天數；目前已停用，保留設定供相容舊資料'],
    ['dailyPpeResendMinAgeDays', '1', '舊版主管一鍵補發每日防護具待確認門檻；目前已停用，保留設定供相容舊資料'],
    ['lineRichMenuImageUrl', 'https://isha-taichung.github.io/auto-checklist/assets/line-rich-menu-main.png', 'LINE 圖文選單圖片網址（2500x1686 PNG）'],
    ['venueUsageRequiredKeywords', '堆高機=堆;高空工作車=高', '共用場地分頁的使用判定必要關鍵字；格式：設備類別=關鍵字1,關鍵字2；例：高空工作車內容需含「高」才算高空工作車有使用'],
  ]);
  if (typeof ensureDailyIncidentSettings_ === 'function') {
    ensureDailyIncidentSettings_(ss);
  }

  setupSupervisorSheet_(ss);
  if (typeof setupDailyWorkCheckSheets_ === 'function') {
    setupDailyWorkCheckSheets_(ss);
  }
  if (typeof setupOfficialDocumentMonitorSheets_ === 'function') {
    setupOfficialDocumentMonitorSheets_(ss);
  }
  if (typeof setupDailyPpeAssignmentSheet_ === 'function') {
    setupDailyPpeAssignmentSheet_(ss);
  }

  setupSheet_(ss, '節假日關鍵字', ['關鍵字', '備註'],
    CONFIG.HOLIDAY_KEYWORDS_DEFAULT.map(k => [k, '預設'])
  );

  setupSheet_(ss, '設備清單',
    ['設備代號', '設備名稱', '機械編號', '型式規格', '設備類別', '所在位置', '場地表分頁', '日檢表單ID', '啟用'],
    [[
      CONFIG.DEFAULT_EQUIPMENT.equipmentId,
      CONFIG.DEFAULT_EQUIPMENT.equipmentName,
      CONFIG.DEFAULT_EQUIPMENT.machineSerial,
      CONFIG.DEFAULT_EQUIPMENT.machineType,
      CONFIG.DEFAULT_EQUIPMENT.category,
      CONFIG.DEFAULT_EQUIPMENT.location,
      CONFIG.DEFAULT_EQUIPMENT.venueSheetTab,
      '',
      true,
    ]]
  );

  // 檢查表模板：加 resultOptions / monthlySchema 兩欄支援多種機具格式
  // - resultOptions：結果代號（comma-separated），daily 各機具不同
  // - monthlySchema：crane_full = 7 欄（部份/方法/結果/風險/改善/檢討）
  //                  simple    = 4 欄（部份/方法/結果/改善）
  setupSheet_(ss, '檢查表模板',
    ['表單ID', '設備類別', '表單名稱', '週期', '法規依據', '填寫規則', '結果選項', '月檢樣式', '啟用'],
    [
      ['F-CRANE-D', '固定式起重機', '固定式起重機每日作業前檢點表', '每日',
       '職業安全衛生管理辦法 §52', '良好「V」/ 無此項「/」/ 不良「X」（不良需於記事欄註明）',
       'V,/,X', '', '是'],
      // ⚠ F-CRANE-M 的「結果選項」必須留空（crane_full schema 用硬編碼 normal/abnormal）
      ['F-CRANE-M', '固定式起重機', '固定式起重機每月定期檢查紀錄', '每月',
       '起重升降機具安全規則 §26', '勾選檢查方法、結果（正常/異常）、風險評估（V/?/—）、改善措施、定期檢討',
       '', '天車完整版', '是'],
      ['F-FORK-D', '堆高機', '堆高機每日使用前檢點表', '每日',
       '職業安全衛生管理辦法 §50', '良好「○」/ 尚可「△」/ 不良待修「X」（由授課教師檢查）',
       '○,△,X', '', '是'],
      ['F-FORK-M', '堆高機', '堆高機每月定期檢查表', '每月',
       '起重升降機具安全規則 §128', '正常打「ˇ」/ 異常打「X」',
       'ˇ,X', '簡式月檢', '是'],
      ['F-AWP-D', '高空工作車', '車載式高空工作車每日作業前檢點表', '每日',
       '依附件「車載式高空工作車每日作業前檢點表」', '檢查結果正常打「V」，異常打「X」；異常項目需提出改善措施',
       'V,X', '', '是'],
      ['F-AWP-SD', '高空工作車', '自走式高空工作車每日作業前檢查表', '每日',
       '依附件「高空作業車作業前檢查表（自主檢查表）」', '每日檢查合格後打「ˇ」，異常打「X」；異常應停止使用並通知相關人員處理',
       'ˇ,X', '', '是'],
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

      // ----- 高空工作車日檢 16 項（車載式）-----
      ['F-AWP-D', 1, '昇空臂、昇空桶有無損壞、裂痕、變形，昇空桶有無鑽孔或底部有無破洞', '目視檢查', true],
      ['F-AWP-D', 2, '鋼構與昇空臂絕緣接合處外觀有無龜裂、變形、接合鬆動，昇空臂搖晃是否過大', '目視檢查', true],
      ['F-AWP-D', 3, '操作桿之把手及保護裝置有無脫落', '目視檢查', true],
      ['F-AWP-D', 4, '昇空臂基座介面有無鬆弛龜裂變形、結構配件有無鬆動或遺失、螺栓螺帽有無鬆弛或脫落及是否旋緊密合、各部組件功能是否完妥、是否搖晃過大或鬆動異常聲響', '目視檢查', true],
      ['F-AWP-D', 5, '各高壓油管及各接頭有否洩漏及定位（含基座、旋轉軸承及齒輪箱、上下臂之油壓缸、昇空桶油管）', '目視檢查', true],
      ['F-AWP-D', 6, '各組件焊接部位有無變形（含基座、旋轉、撐腳、上臂肘、上臂頂、下臂、昇空桶）', '目視檢查', true],
      ['F-AWP-D', 7, '電瓶樁頭、電瓶水是否正常；胎壓是否正常', '目視檢查', true],
      ['F-AWP-D', 8, '車體接地是否符合規定', '目視檢查', true],
      ['F-AWP-D', 9, '各種儀表功能是否正常', '目視檢查', true],
      ['F-AWP-D', 10, '上、下控制器切換開關（含緊急停止）功能是否正常', '試車動作測試', true],
      ['F-AWP-D', 11, '下控制器昇降及旋轉之功能是否正常', '試車動作測試', true],
      ['F-AWP-D', 12, '上控制器上、下臂昇降及旋轉（操作鬆鎖裝置）功能是否正常', '試車動作測試', true],
      ['F-AWP-D', 13, '外伸撐座功能是否正常', '試車動作測試', true],
      ['F-AWP-D', 14, '煞車器、離合器、開關控制器、動力傳動器（PTO）、油壓泵運轉是否正常', '試車動作測試', true],
      ['F-AWP-D', 15, '油壓煞車是否正確', '試車動作測試', true],
      ['F-AWP-D', 16, '其他維修保養手冊需要安檢項目', '依保養手冊', true],

      // ----- 高空工作車日檢 19 項（自走式自主檢查表）-----
      ['F-AWP-SD', 1, '【作業環境】地面是否堅硬平坦無塌陷', '檢視', true],
      ['F-AWP-SD', 2, '【作業環境】環境及通道是否淨空且無危險物及有害物', '檢視', true],
      ['F-AWP-SD', 3, '【作業環境】是否鄰近道路作業並做好圍隔離措施', '檢視', true],
      ['F-AWP-SD', 4, '【人員】作業人數確認並危害告之', '說明', true],
      ['F-AWP-SD', 5, '【人員】個人防護具是否齊全', '檢視', true],
      ['F-AWP-SD', 6, '【人員】精神狀況是否良好', '檢視', true],
      ['F-AWP-SD', 7, '【工作車輛】煞車系統是否正常有效', '測試', true],
      ['F-AWP-SD', 8, '【工作車輛】蜂鳴器、警示燈是否正常', '測試', true],
      ['F-AWP-SD', 9, '【工作車輛】各項功能開關是否正常有效', '測試', true],
      ['F-AWP-SD', 10, '【工作車輛】作業欄是否變形、毀損', '檢視', true],
      ['F-AWP-SD', 11, '【工作車輛】輪胎、胎壓、軸承、螺絲是否正常', '檢視', true],
      ['F-AWP-SD', 12, '【工作車輛】指示儀表是否正常有效', '檢視', true],
      ['F-AWP-SD', 13, '【工作車輛】油管電線是否龜裂破損', '檢視', true],
      ['F-AWP-SD', 14, '【工作車輛】結構及插銷是否鏽蝕、變形', '檢視', true],
      ['F-AWP-SD', 15, '【工作車輛】水、機油、柴油、操作油是否正常無洩漏', '檢視', true],
      ['F-AWP-SD', 16, '【工作車輛】緊急洩壓閥是否正常有效', '測試', true],
      ['F-AWP-SD', 17, '【工作車輛】前進後退、舉升及制動裝置、傾斜度、水平測試是否正常', '測試', true],
      ['F-AWP-SD', 18, '【工作車輛】具外撐座者，其外撐座功能是否正常', '測試', true],
      ['F-AWP-SD', 19, '【工作車輛】引擎、水箱、啟動馬達、發電機裝置是否正常', '測試', true],
    ]
  );

  // 填報紀錄（只建欄位、不塞資料）
  // 加 clientSubmissionId（idempotency）+ 異常事件數（方便快速辨識哪天有異常）
  setupSheet_(ss, '填報紀錄',
    ['紀錄ID', '送出時間', '檢查日期', '表單類型', '設備代號', '設備名稱',
     '設備類別', '檢點人員', '異常事件數', '完整資料JSON', 'PDF連結',
     '簽核狀態', '主管姓名', '主管簽核時間', '主管簽核Token', '草稿DocID', '草稿Doc連結',
     'clientSubmissionId', '備註'],
    []
  );
  setupApprovalStatusValidation_(ss);

  // 機具設備異常事件追蹤（Layer 1）
  // 每填一張表的每個「結果=bad」項目，自動寫一列到這
  ensureMachineIncidentSheet_(ss);
  setupSheet_(ss, MACHINE_INCIDENT_SHEET_NAME,
    ['事件ID', '通報日期', '通報時間', '設備代號', '設備名稱', '設備類別',
     '表單類型', '項次', '項目名稱', '結果代號', '異常說明', '照片數',
     'PDF連結', '紀錄ID',
     '狀態', '預計完成日', '實際完成日', '負責人', '備註'],
    []
  );
  normalizeMachineIncidentSheet_(ss);
  // 對「狀態」欄加下拉資料驗證
  setupIncidentStatusValidation_(ss);

  if (typeof setupDailyIncidentSheet_ === 'function') {
    setupDailyIncidentSheet_(ss);
  }

  // 套用欄寬與文字換行（讓 Sheet 視覺更舒適）
  try { applyColumnWidthsAndWrap_(); } catch (e) { Logger.log('套用欄寬失敗：' + e); }

  // 中文化 + 下拉驗證（把初始 seed 的 true/false 轉成 是/否、加各選項下拉）
  try { applyChineseSettingsAndDropdowns(); } catch (e) { Logger.log('套用下拉驗證失敗：' + e); }

  Logger.log('資料庫初始化完成。請接著到 Sheets 確認 → 回 Apps Script 執行 installDailyReminderTrigger');
}

function applyProjectResourceNames() {
  const result = {
    ok: true,
    spreadsheetName: '',
    archiveRootName: '',
    scriptProjectName: '',
    machineIncidentSheetName: '',
    dailyIncidentSheetName: '',
    dailyIncidentArchiveFolderName: '',
  };

  const ss = SpreadsheetApp.openById(CONFIG.DB_SHEET_ID);
  ss.rename('ISHA 檢查與通報資料庫');
  result.spreadsheetName = ss.getName();

  try {
    const root = DriveApp.getFolderById(CONFIG.ARCHIVE_ROOT_FOLDER_ID);
    root.setName('ISHA 檢查與通報歸檔');
    result.archiveRootName = root.getName();
  } catch (err) {
    result.archiveRootName = 'rename_failed: ' + String(err.message || err);
  }

  try {
    DriveApp.getFileById(ScriptApp.getScriptId()).setName('ISHA 檢查與通報 API');
    result.scriptProjectName = 'ISHA 檢查與通報 API';
  } catch (err) {
    result.scriptProjectName = 'rename_failed: ' + String(err.message || err);
  }

  const machineIncidentSheet = ensureMachineIncidentSheet_(ss);
  result.machineIncidentSheetName = machineIncidentSheet ? machineIncidentSheet.getName() : '';

  if (typeof setupDailyIncidentSheet_ === 'function') {
    setupDailyIncidentSheet_(ss);
    const sheet = getDailyIncidentSheet_(ss);
    result.dailyIncidentSheetName = sheet ? sheet.getName() : '';
  }
  if (typeof ensureDailyIncidentSettings_ === 'function') {
    ensureDailyIncidentSettings_(ss);
    result.dailyIncidentArchiveFolderName = getSetting_('dailyIncidentArchiveFolderName', '');
  }

  return result;
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

function normalizeMachineIncidentSheet_(ss) {
  const sheet = getMachineIncidentSheet_(ss);
  if (!sheet) return { deletedColumns: 0 };
  const expected = new Set([
    '事件ID', '通報日期', '通報時間', '設備代號', '設備名稱', '設備類別',
    '表單類型', '項次', '項目名稱', '結果代號', '異常說明', '照片數',
    'PDF連結', '紀錄ID', '狀態', '預計完成日', '實際完成日', '負責人', '備註',
  ]);
  const lastCol = sheet.getLastColumn();
  const lastRow = sheet.getLastRow();
  if (lastCol < 1) return { deletedColumns: 0 };
  const headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0].map(v => String(v || '').trim());
  let deletedColumns = 0;
  for (let c = headers.length; c >= 1; c--) {
    const header = headers[c - 1];
    if (!header || expected.has(header)) continue;
    const values = lastRow > 1
      ? sheet.getRange(2, c, lastRow - 1, 1).getValues().flat()
      : [];
    const hasData = values.some(v => String(v || '').trim());
    if (hasData) continue;
    sheet.deleteColumn(c);
    deletedColumns++;
  }
  return { deletedColumns };
}

function ensureSystemSettingDefaults_(ss, rows) {
  const sheet = ss.getSheetByName('系統設定');
  if (!sheet) return;
  const data = sheet.getDataRange().getValues();
  const existing = new Set(data.slice(1).map(r => String(r[0] || '').trim()).filter(Boolean));
  const toAppend = [];
  rows.forEach(row => {
    if (!existing.has(row[0])) toAppend.push(row);
  });
  if (toAppend.length > 0) {
    sheet.getRange(sheet.getLastRow() + 1, 1, toAppend.length, 3).setValues(toAppend);
  }
}

function updateMonthlySettingNotes_() {
  const notes = {
    monthlyCheckWindowStart: '月檢應檢期起始日；適用三間教室、堆高機、固定式起重機；應檢期內 LINE「狀態」顯示尚未填，應檢期後到補填日前靜默隱藏，補填日起再次顯示並提醒',
    monthlyCheckWindowEnd: '月檢應檢期結束日；適用三間教室、堆高機、固定式起重機；應檢期內 LINE「狀態」顯示尚未填，應檢期後到補填日前靜默隱藏，補填日起再次顯示並提醒',
    monthlyReminderStartDay: '月檢補填提醒起始日；適用三間教室、堆高機、固定式起重機；本月未填時，從此日起重新顯示於 LINE「狀態」並推播補填提醒',
  };
  const ss = SpreadsheetApp.openById(CONFIG.DB_SHEET_ID);
  const sheet = ss.getSheetByName('系統設定');
  if (!sheet) throw new Error('找不到系統設定工作表');

  const data = sheet.getDataRange().getValues();
  const headers = data[0].map(h => String(h || '').trim());
  const keyCol = headers.indexOf('鍵');
  const valueCol = headers.indexOf('值');
  const noteCol = headers.indexOf('備註');
  if (keyCol < 0 || valueCol < 0 || noteCol < 0) {
    throw new Error('系統設定缺必要欄位');
  }

  const existing = {};
  for (let i = 1; i < data.length; i++) {
    const key = String(data[i][keyCol] || '').trim();
    if (key) existing[key] = i + 1;
  }

  let updated = 0;
  let inserted = 0;
  Object.keys(notes).forEach(key => {
    const rowNo = existing[key];
    if (rowNo) {
      sheet.getRange(rowNo, noteCol + 1).setValue(notes[key]);
      updated++;
      return;
    }
    const row = new Array(headers.length).fill('');
    row[keyCol] = key;
    row[valueCol] = key === 'monthlyReminderStartDay' ? '25' : (key === 'monthlyCheckWindowEnd' ? '5' : '1');
    row[noteCol] = notes[key];
    sheet.getRange(sheet.getLastRow() + 1, 1, 1, headers.length).setValues([row]);
    inserted++;
  });

  SpreadsheetApp.flush();
  return { sheetName: '系統設定', updated, inserted, keys: Object.keys(notes) };
}

function setupSupervisorSheet_(ss) {
  return setupSubscriberSheet_(ss);
}

function setupSubscriberSheet_(ss) {
  let sheet = ss.getSheetByName('訂閱者清單');
  const legacy = ss.getSheetByName('主管清單');
  if (!sheet && legacy) {
    legacy.setName('訂閱者清單');
    sheet = legacy;
  }
  if (!sheet) {
    setupSheet_(ss, '訂閱者清單', getSubscriberSheetHeaders_(), []);
    sheet = ss.getSheetByName('訂閱者清單');
  }
  ensureSubscriberSheetHeaders_(sheet);
  return sheet;
}

function getSubscriberNotificationColumns_() {
  return ['機具設備異常', '機具設備日檢點未填', '機具設備月檢點未填', '三間教室月檢'];
}

function getSubscriberSheetHeaders_() {
  return ['姓名', 'LINE_USER_ID', '是否訂閱', '是否為主管', '是否為同仁']
    .concat(getSubscriberNotificationColumns_())
    .concat(['公文登記桌', '備註']);
}

function getSubscriberSheetHeaderNotes_() {
  return {
    '姓名': '同仁或主管姓名。日常事件、公文待發文會用姓名比對通知對象。',
    'LINE_USER_ID': 'LINE 使用者 ID。由同仁在 LINE 輸入「我的ID」取得後填入。',
    '是否訂閱': '主動推播總開關。是＝允許系統主動推播；否＝仍可使用指令查詢，但不收主動通知。這是試算表控管，不是 LINE@ 後台的好友狀態。',
    '是否為主管': '主管身分。是＝可收到主管簽核、主管審閱等主管通知。',
    '是否為同仁': '同仁身分。是＝可作為日常事件填報/承辦人、公文待發文承辦人等對象。',
    '機具設備異常': '細分通知開關。只有填「是」才會收到機具設備檢查異常通知；空白或否＝不收。',
    '機具設備日檢點未填': '細分通知開關。只有填「是」才會收到機具設備日檢未填提醒；空白或否＝不收。',
    '機具設備月檢點未填': '細分通知開關。只有填「是」才會收到機具設備月檢未填提醒；空白或否＝不收。',
    '三間教室月檢': '細分通知開關。只有填「是」才會收到三間教室月檢未填提醒；空白或否＝不收。月檢送審簽核通知只看「是否為主管」。',
    '公文登記桌': '公文登記桌身分。是＝可收到已命中訂閱同仁的待發文彙總。',
    '備註': '純備註欄，不控制通知。若要暫停主動通知，請改「是否訂閱」或各細分通知欄。',
  };
}

function applySubscriberSheetUsability_(sheet) {
  if (!sheet) return;
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(h => String(h || '').trim());
  const notes = getSubscriberSheetHeaderNotes_();
  const widths = {
    '姓名': 100,
    'LINE_USER_ID': 260,
    '是否訂閱': 120,
    '是否為主管': 110,
    '是否為同仁': 110,
    '機具設備異常': 120,
    '機具設備日檢點未填': 150,
    '機具設備月檢點未填': 150,
    '三間教室月檢': 120,
    '公文登記桌': 120,
    '備註': 220,
  };
  sheet.setFrozenRows(1);
  headers.forEach((header, i) => {
    const col = i + 1;
    if (notes[header]) sheet.getRange(1, col).setNote(notes[header]);
    if (widths[header]) sheet.setColumnWidth(col, widths[header]);
    if (notes[header]) {
      try { sheet.showColumns(col); } catch (e) { Logger.log('訂閱者清單欄位顯示失敗：' + header + ' / ' + e); }
    }
  });
}

function ensureSubscriberSheetHeaders_(sheet) {
  const lastCol = Math.max(sheet.getLastColumn(), 1);
  const headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0].map(h => String(h || '').trim());
  const legacyActiveCol = headers.indexOf('是否啟用');
  const supervisorCol = headers.indexOf('是否為主管');
  if (supervisorCol < 0 && legacyActiveCol >= 0) {
    sheet.getRange(1, legacyActiveCol + 1).setValue('是否為主管');
    headers[legacyActiveCol] = '是否為主管';
  }

  getSubscriberSheetHeaders_().forEach(name => {
    if (headers.indexOf(name) >= 0) return;
    sheet.getRange(1, sheet.getLastColumn() + 1).setValue(name);
    headers.push(name);
  });

  const idCol = headers.indexOf('LINE_USER_ID');
  // 只自動啟用「是否訂閱」總開關；細分通知欄必須由管理者明確填「是」才推播。
  const defaultYesCols = ['是否訂閱']
    .map(name => headers.indexOf(name))
    .filter(i => i >= 0);
  if (idCol >= 0 && defaultYesCols.length && sheet.getLastRow() >= 2) {
    const range = sheet.getRange(2, 1, sheet.getLastRow() - 1, headers.length);
    const data = range.getValues();
    let changed = false;
    data.forEach(row => {
      const id = String(row[idCol] || '').trim();
      if (!id) return;
      defaultYesCols.forEach(col => {
        const current = String(row[col] || '').trim();
        if (current) return;
        row[col] = '是';
        changed = true;
      });
    });
    if (changed) range.setValues(data);
  }
  applySubscriberSheetUsability_(sheet);
}

function syncSupervisorIdsToSheet_() {
  const props = PropertiesService.getScriptProperties();
  const ids = (props.getProperty('LINE_TARGET_USER_IDS') || '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);
  const unique = Array.from(new Set(ids));
  if (unique.length === 0) {
    throw new Error('LINE_TARGET_USER_IDS 為空，無法同步訂閱者清單');
  }

  const ss = SpreadsheetApp.openById(CONFIG.DB_SHEET_ID);
  const sheet = setupSupervisorSheet_(ss);
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(h => String(h || '').trim());
  const nameCol = headers.indexOf('姓名');
  const idCol = headers.indexOf('LINE_USER_ID');
  const subscribeCol = headers.indexOf('是否訂閱');
  const activeCol = getLineSupervisorFlagColumnIndex_(headers);
  const noteCol = headers.indexOf('備註');
  if (idCol < 0 || activeCol < 0) throw new Error('訂閱者清單缺必要欄位');

  const lastRow = sheet.getLastRow();
  const data = lastRow >= 2 ? sheet.getRange(2, 1, lastRow - 1, headers.length).getValues() : [];
  const byId = {};
  data.forEach((row, i) => {
    const id = String(row[idCol] || '').trim();
    if (id) byId[id] = { rowNo: i + 2, values: row };
  });

  const appendRows = [];
  let updated = 0;
  unique.forEach((id, i) => {
    const existing = byId[id];
    if (existing) {
      const row = existing.values.slice();
      let dirty = false;
      if (nameCol >= 0 && !String(row[nameCol] || '').trim()) {
        row[nameCol] = '訂閱者' + (i + 1);
        dirty = true;
      }
      if (activeCol >= 0 && !String(row[activeCol] || '').trim()) {
        row[activeCol] = '否';
        dirty = true;
      }
      if (subscribeCol >= 0 && !String(row[subscribeCol] || '').trim()) {
        row[subscribeCol] = '是';
        dirty = true;
      }
      if (noteCol >= 0 && !String(row[noteCol] || '').trim()) {
        row[noteCol] = '由目前訂閱者同步';
        dirty = true;
      }
      if (dirty) {
        sheet.getRange(existing.rowNo, 1, 1, headers.length).setValues([row]);
        updated++;
      }
      return;
    }

    const row = new Array(headers.length).fill('');
    if (nameCol >= 0) row[nameCol] = '訂閱者' + (i + 1);
    row[idCol] = id;
    if (subscribeCol >= 0) row[subscribeCol] = '是';
    row[activeCol] = '否';
    if (noteCol >= 0) row[noteCol] = '由目前訂閱者同步';
    appendRows.push(row);
  });

  if (appendRows.length > 0) {
    sheet.getRange(sheet.getLastRow() + 1, 1, appendRows.length, headers.length).setValues(appendRows);
  }

  const supervisorIds = getSupervisorUserIdsFromSheet_();
  props.setProperty('SUPERVISOR_USER_IDS', supervisorIds.join(','));
  try { applyChineseSettingsAndDropdowns(); } catch (e) { Logger.log('訂閱者清單 dropdown 套用失敗：' + e); }
  SpreadsheetApp.flush();

  return {
    source: 'LINE_TARGET_USER_IDS',
    sourceCount: ids.length,
    subscriberCount: unique.length,
    supervisorCount: supervisorIds.length,
    inserted: appendRows.length,
    updated,
    sheetName: '訂閱者清單',
  };
}

function getSupervisorStatus_() {
  const props = PropertiesService.getScriptProperties();
  const targetIds = new Set((props.getProperty('LINE_TARGET_USER_IDS') || '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean));

  const ss = SpreadsheetApp.openById(CONFIG.DB_SHEET_ID);
  const sheet = setupSupervisorSheet_(ss);
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(h => String(h || '').trim());
  const nameCol = headers.indexOf('姓名');
  const idCol = headers.indexOf('LINE_USER_ID');
  const subscribeCol = getLineSubscriberActiveColumnIndex_(headers);
  const supervisorCol = getLineSupervisorFlagColumnIndex_(headers);
  const staffCol = headers.indexOf('是否為同仁');
  const noteCol = headers.indexOf('備註');
  const notificationColumns = (typeof LINE_NOTIFICATION_COLUMNS !== 'undefined')
    ? Object.keys(LINE_NOTIFICATION_COLUMNS).map(k => LINE_NOTIFICATION_COLUMNS[k])
    : [];
  if (idCol < 0) throw new Error('訂閱者清單缺 LINE_USER_ID 欄位');

  const data = sheet.getLastRow() >= 2
    ? sheet.getRange(2, 1, sheet.getLastRow() - 1, headers.length).getValues()
    : [];
  const subscribers = data.map((row, i) => {
    const id = String(row[idCol] || '').trim();
    const subscribed = subscribeCol < 0 ? true : isActiveValue_(row[subscribeCol]);
    const isSupervisor = supervisorCol >= 0 ? isActiveValue_(row[supervisorCol]) : false;
    const isStaff = staffCol >= 0 ? isActiveValue_(row[staffCol]) : false;
    const notificationFlags = {};
    notificationColumns.forEach(colName => {
      const col = headers.indexOf(colName);
      notificationFlags[colName] = col >= 0 ? isLineNotificationEnabled_(row[col]) : false;
    });
    return {
      rowNo: i + 2,
      name: nameCol >= 0 ? String(row[nameCol] || '').trim() : '',
      userIdMasked: maskLineUserId_(id),
      active: subscribed,
      subscribed,
      isSupervisor,
      isStaff,
      notificationFlags,
      inGeneralTarget: id ? targetIds.has(id) : false,
      note: noteCol >= 0 ? String(row[noteCol] || '').trim() : '',
    };
  });
  const subscribedRows = subscribers.filter(s => s.subscribed);
  const supervisors = subscribers.filter(s => s.isSupervisor);

  return {
    sheetName: '訂閱者清單',
    legacyTargetUserCount: targetIds.size,
    targetUserCount: targetIds.size,
    subscriberCount: subscribers.length,
    subscribedCount: subscribedRows.length,
    supervisorCount: supervisors.length,
    staffCount: subscribers.filter(s => s.isStaff).length,
    activeCount: subscribedRows.length,
    subscribedNotInLegacyTargetCount: subscribedRows.filter(s => !s.inGeneralTarget).length,
    activeNotInGeneralTargetCount: subscribedRows.filter(s => !s.inGeneralTarget).length,
    subscribers,
    supervisors,
  };
}

function maskLineUserId_(id) {
  const s = String(id || '').trim();
  if (s.length <= 10) return s ? '(短ID)' : '';
  return s.substring(0, 4) + '...' + s.substring(s.length - 4);
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
 * 用途：清掉某天的測試資料，含填報紀錄 / 機具設備異常事件 / Drive PDF
 *
 * 參數：dateStr = 'YYYY-MM-DD'（西元年月日）
 * 回傳：summary 字串（人類可讀的執行報告）
 *
 * ⚠ 一旦執行不可逆（PDF setTrashed 可救回 30 天，sheet row 刪掉就沒了）
 *   只應由 admin endpoint 觸發 + 帶 token
 */
/**
 * 清掉「所有」填報紀錄 / 機具設備異常事件 / Drive PDF
 *
 * 用途：production launch 前清空所有測試 / 試運轉資料（一次性）
 *
 * 安全：
 *   - 必須帶 confirm='YES_DELETE_ALL'，不然拒絕
 *   - dryRun 預覽
 *   - PDF setTrashed 而非永久刪除（Drive 30 天可救）
 *   - 不動表頭 row、不動 schema、不動 設備清單 / 檢查表模板 / 檢查項目 / 系統設定
 */
function cleanupAllSubmissionsAndIncidents_(opts) {
  opts = opts || {};
  const dryRun = !!opts.dryRun;
  const confirm = opts.confirm;
  // 修 P1.3: dryRun 也要 confirm，避免 admin token 持有者亂打就能探勘紀錄筆數
  if (!dryRun && confirm !== 'YES_DELETE_ALL') {
    throw new Error('confirm=YES_DELETE_ALL 必填 才能真的清');
  }
  if (dryRun && confirm !== 'YES_DRY_RUN' && confirm !== 'YES_DELETE_ALL') {
    throw new Error('dryRun 需帶 confirm=YES_DRY_RUN');
  }

  const ss = SpreadsheetApp.openById(CONFIG.DB_SHEET_ID);
  const report = [];
  let trashedPdfs = 0;
  let pdfErrors = 0;

  // 1. 填報紀錄 — 刪所有 data row + trash PDF
  const recSheet = ss.getSheetByName('填報紀錄');
  if (recSheet) {
    const lastRow = recSheet.getLastRow();
    const dataRows = lastRow - 1;  // 扣掉 header
    let pdfsToTrash = [];
    if (dataRows > 0) {
      const headers = recSheet.getRange(1, 1, 1, recSheet.getLastColumn()).getValues()[0];
      const idxPdf = headers.indexOf('PDF連結');
      const idxDraft = headers.indexOf('草稿DocID');
      if (idxPdf >= 0) {
        const urls = recSheet.getRange(2, idxPdf + 1, dataRows, 1).getValues().flat();
        urls.forEach(u => {
          const m = String(u || '').match(/\/d\/([A-Za-z0-9_-]+)/);
          if (m) pdfsToTrash.push(m[1]);
        });
      }
      if (idxDraft >= 0) {
        const ids = recSheet.getRange(2, idxDraft + 1, dataRows, 1).getValues().flat();
        ids.forEach(id => {
          const s = String(id || '').trim();
          if (s) pdfsToTrash.push(s);
        });
      }
      if (!dryRun) {
        pdfsToTrash.forEach(fid => {
          try { DriveApp.getFileById(fid).setTrashed(true); trashedPdfs++; }
          catch (e) { pdfErrors++; Logger.log(`[cleanupAll] PDF ${fid} 失敗: ${e}`); }
        });
        // 全部刪除（保留 header）
        recSheet.deleteRows(2, dataRows);
      }
    }
    report.push(`${dryRun ? '[DRY-RUN]' : '✓'} 填報紀錄：${dryRun ? '會刪' : '刪除'} ${dataRows} 列、${dryRun ? '會 trash' : 'trashed'} ${dryRun ? pdfsToTrash.length : trashedPdfs} PDF${pdfErrors ? `（PDF 失敗 ${pdfErrors}）` : ''}`);
  }

  // 2. 機具設備異常事件 — 刪所有 data row
  const incSheet = getMachineIncidentSheet_(ss);
  if (incSheet) {
    const lastRow = incSheet.getLastRow();
    const dataRows = lastRow - 1;
    if (dataRows > 0 && !dryRun) {
      incSheet.deleteRows(2, dataRows);
    }
    report.push(`${dryRun ? '[DRY-RUN]' : '✓'} 機具設備異常事件：${dryRun ? '會刪' : '刪除'} ${dataRows} 列`);
  }

  const summary = report.join('\n');
  Logger.log(summary);
  return summary;
}

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
    const idxDraft = headers.indexOf('草稿DocID');
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
        if (idxDraft >= 0) {
          const draftId = String(data[i][idxDraft] || '').trim();
          if (draftId) recPdfsToTrash.push(draftId);
        }
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

  // === 2. 清機具設備異常事件 ===
  const incSheet = getMachineIncidentSheet_(ss);
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
    report.push(`${dryRun ? '[DRY-RUN]' : '✓'} 機具設備異常事件：${dryRun ? '會刪' : '刪除'} ${incRowsToDelete.length} 列`);
  }

  const summary = report.join('\n');
  Logger.log(summary);
  return summary;
}

/**
 * 把指定設備的所有未完成機具設備異常事件，狀態批次改成「已完成」
 *
 * 用途：模擬承辦人在「機具設備異常事件」表批次標記，主要給 demo 用
 *      (實際使用建議在試算表手動下拉改，比較看得到上下文)
 *
 * 參數：
 *   equipmentId   — 設備代號（必填）
 *   formType      — 'daily' / 'monthly'（選填，不填則兩種都處理）
 *
 * 回傳：summary 字串
 */
function markIncidentsCompletedForEquipment_(equipmentId, formType) {
  if (!equipmentId) throw new Error('需提供 equipmentId');
  const ss = SpreadsheetApp.openById(CONFIG.DB_SHEET_ID);
  const sheet = getMachineIncidentSheet_(ss);
  if (!sheet || sheet.getLastRow() < 2) return '無機具設備異常事件可處理';

  const data = sheet.getDataRange().getValues();
  const headers = data[0];
  const idxEqp = headers.indexOf('設備代號');
  const idxType = headers.indexOf('表單類型');
  const idxStatus = headers.indexOf('狀態');
  const idxCompleted = headers.indexOf('實際完成日');
  if (idxEqp < 0 || idxStatus < 0) throw new Error('機具設備異常事件表缺欄位');

  const targetType = formType === 'daily' ? '每日'
                    : formType === 'monthly' ? '每月' : null;
  const todayStr = Utilities.formatDate(new Date(), tz_(), 'yyyy-MM-dd');
  let updated = 0;
  for (let i = 1; i < data.length; i++) {
    if (data[i][idxEqp] !== equipmentId) continue;
    if (targetType && data[i][idxType] !== targetType) continue;
    const cur = String(data[i][idxStatus] || '').trim();
    if (cur === '已完成') continue;
    // 用 setValue 一格一格寫（量小不影響效能；保留欄位 dataValidation）
    sheet.getRange(i + 1, idxStatus + 1).setValue('已完成');
    if (idxCompleted >= 0 && !data[i][idxCompleted]) {
      sheet.getRange(i + 1, idxCompleted + 1).setValue(todayStr);
    }
    updated++;
  }
  return `✓ 設備「${equipmentId}」更新 ${updated} 筆異常事件為「已完成」`;
}

/**
 * 列出「待處理 / 處理中 / 待重檢」機具設備異常事件
 * （讓承辦人 / 主管能從外部 API 查目前累積未完成的事件）
 */
function listOpenIncidents_() {
  const ss = SpreadsheetApp.openById(CONFIG.DB_SHEET_ID);
  const sheet = getMachineIncidentSheet_(ss);
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
      pdfUrl: data[i][idx('PDF連結')],
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
    [MACHINE_INCIDENT_SHEET_NAME]: {
      '事件ID': 90, '通報日期': 100, '通報時間': 80,
      '設備代號': 110, '設備名稱': 140, '設備類別': 90,
      '表單類型': 80, '項次': 55, '項目名稱': 240, '結果代號': 80,
      '異常說明': 260, '照片數': 60, 'PDF連結': 140, '紀錄ID': 90,
      '狀態': 100, '預計完成日': 110, '實際完成日': 110, '負責人': 90, '備註': 200,
    },
    '日常異常事件通報': {
      '事件ID': 130, '建立時間': 150, '填報日期': 100, '發生地點': 140,
      '填報人': 100, '承辦人': 100, '填報事項': 120, '異常事項': 280, '異常事情': 280,
      '處理狀況': 100, '處理說明': 280, '處理完成日期': 110,
      '陳核主管': 100, '審核狀態': 120, '主管審核意見': 240, '主管審核時間': 150,
      '照片數': 70, '照片資料夾連結': 160, 'PDF連結': 160, '待審PDF檔案ID': 160,
      '承辦更新Token': 180, '主管審核Token': 180, 'clientSubmissionId': 130, '流程紀錄': 320, '備註': 180,
    },
    '公文待發文佇列': {
      '檢核日期': 100, '檢核時段': 90, '文件Key': 180, '批次ID': 120,
      '公文文號': 130, '發文字號': 130, '承辦人員': 150, '承辦人姓名': 100,
      '承辦單位': 130, '限辦日期': 100, '通知狀態': 100, '通知時間': 150,
      '通知結果': 220, '建立時間': 150, '更新時間': 150, '備註': 200,
    },
    '公文待發文執行紀錄': {
      '批次ID': 120, '檢核日期': 100, '檢核時段': 90, '開始時間': 150,
      '結束時間': 150, '狀態': 100, '抓取筆數': 90, '寫入筆數': 90,
      'dryRun': 70, '錯誤摘要': 260, '建立時間': 150,
    },
    '填報紀錄': {
      '紀錄ID': 90, '送出時間': 140, '檢查日期': 100, '表單類型': 80,
      '設備代號': 110, '設備名稱': 140, '設備類別': 90, '檢點人員': 100,
      '異常事件數': 90, '完整資料JSON': 200, 'PDF連結': 140,
      '簽核狀態': 110, '主管姓名': 100, '主管簽核時間': 140,
      '主管簽核Token': 160, '草稿DocID': 160, '草稿Doc連結': 140,
      'clientSubmissionId': 100, '備註': 150,
    },
    '檢查表模板': {
      '表單ID': 100, '設備類別': 100, '表單名稱': 240, '週期': 70,
      '法規依據': 180, '填寫規則': 280, '結果選項': 100, '月檢樣式': 110, '啟用': 60,
    },
    '檢查項目': {
      '表單ID': 100, '項目順序': 80, '項目名稱': 320, '檢查方法': 110, '啟用': 60,
    },
    '設備清單': {
      '設備代號': 110, '設備名稱': 140, '機械編號': 130, '型式規格': 180,
      '設備類別': 100, '所在位置': 100, '場地表分頁': 280, '日檢表單ID': 110, '啟用': 60,
    },
    '系統設定': { '鍵': 140, '值': 320, '備註': 280 },
    '節假日關鍵字': { '關鍵字': 120, '備註': 200 },
  };
  // 這些欄位文字較長，要開「自動換行」
  const wrapCols = ['項目名稱', '表單名稱', '異常說明', '填寫規則', '法規依據',
                    '完整資料JSON', '備註', '型式規格', '場地表分頁', '值',
                    '草稿Doc連結', 'PDF連結', '異常事項', '異常事情', '處理說明',
                    '主管審核意見', '照片資料夾連結', '通知結果', '錯誤摘要'];

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

function setupApprovalStatusValidation_(ss) {
  const sheet = ss.getSheetByName('填報紀錄');
  if (!sheet) return;
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  const statusCol = headers.indexOf('簽核狀態') + 1;
  if (statusCol < 1) return;
  const range = sheet.getRange(2, statusCol, sheet.getMaxRows() - 1, 1);
  const rule = SpreadsheetApp.newDataValidation()
    .requireValueInList(['待主管簽核', '已簽核歸檔', '簽核略過'], true)
    .setAllowInvalid(false)
    .setHelpText('請從下拉選單選擇簽核狀態')
    .build();
  range.setDataValidation(rule);
  Logger.log('「填報紀錄」簽核狀態欄已加下拉驗證');
}

/**
 * 對「機具設備異常事件」表的「狀態」欄加下拉資料驗證
 * 5 個值：待處理 / 處理中 / 已完成 / 待重檢 / 不處理
 */
function setupIncidentStatusValidation_(ss) {
  const sheet = getMachineIncidentSheet_(ss);
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
  Logger.log('「機具設備異常事件」狀態欄已加下拉驗證');
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
  try {
    const subscriberSheet = setupSubscriberSheet_(ss);
    report.push(`✓ LINE 對照表確認為「${subscriberSheet.getName()}」`);
  } catch (e) {
    report.push('⚠ LINE 訂閱者清單整理失敗：' + e);
  }

  // ===== 1b. 先把英文 header 改成中文（idempotent）=====
  const HEADER_RENAMES = {
    '檢查表模板': { 'resultOptions': '結果選項', 'monthlySchema': '月檢樣式' },
  };
  Object.keys(HEADER_RENAMES).forEach(sheetName => {
    const sheet = ss.getSheetByName(sheetName);
    if (!sheet) return;
    const lastCol = Math.max(sheet.getLastColumn(), 1);
    const headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
    const rename = HEADER_RENAMES[sheetName];
    let renamed = 0;
    headers.forEach((h, i) => {
      if (rename[h]) {
        sheet.getRange(1, i + 1).setValue(rename[h]);
        renamed++;
      }
    });
    if (renamed > 0) report.push(`✓ 「${sheetName}」重新命名 ${renamed} 個英文欄位 → 中文`);
  });

  // ===== 2. 套用各表 dropdown + 中文化 =====
  const SHEET_PROFILES = {
    '設備清單': [
      { col: '啟用',     options: ['是', '否'],       migrate: { TRUE: '是', FALSE: '否' } },
      { col: '設備類別', options: categories,         strict: false },
      { col: '日檢表單ID', options: [''].concat(templateIds), strict: false },
    ],
    '檢查表模板': [
      { col: '啟用',     options: ['是', '否'],       migrate: { TRUE: '是', FALSE: '否' } },
      { col: '週期',     options: ['每日', '每月'],   strict: true },
      { col: '設備類別', options: categories,         strict: false },
      { col: '月檢樣式', options: ['', '簡式月檢', '天車完整版'], strict: false,
        migrate: { SIMPLE: '簡式月檢', CRANE_FULL: '天車完整版' } },
    ],
    '檢查項目': [
      { col: '啟用',     options: ['是', '否'],       migrate: { TRUE: '是', FALSE: '否' } },
      { col: '表單ID',   options: templateIds,        strict: false },
    ],
    '訂閱者清單': [
      { col: '是否訂閱', options: ['是', '否'],       migrate: { TRUE: '是', FALSE: '否' } },
      { col: '是否為主管', options: ['是', '否'],       migrate: { TRUE: '是', FALSE: '否' } },
      { col: '是否為同仁', options: ['是', '否'],       migrate: { TRUE: '是', FALSE: '否' } },
      { col: '機具設備異常', options: ['是', '否'],       migrate: { TRUE: '是', FALSE: '否' } },
      { col: '機具設備日檢點未填', options: ['是', '否'], migrate: { TRUE: '是', FALSE: '否' } },
      { col: '機具設備月檢點未填', options: ['是', '否'], migrate: { TRUE: '是', FALSE: '否' } },
      { col: '三間教室月檢', options: ['是', '否'],       migrate: { TRUE: '是', FALSE: '否' } },
      { col: '公文登記桌', options: ['是', '否'],       migrate: { TRUE: '是', FALSE: '否' } },
    ],
    '每日作業檢核': [
      { col: '15天後課程是否報備', options: DAILY_WORK_CHECK_OPTIONS || ['是', '否', '不適用'], strict: true },
      { col: '1天後異動是否完成', options: DAILY_WORK_CHECK_OPTIONS || ['是', '否', '不適用'], strict: true },
      { col: '公文系統是否成功發送', options: DAILY_WORK_CHECK_OPTIONS || ['是', '否', '不適用'], strict: true },
    ],
    '公文待發文佇列': [
      { col: '通知狀態', options: ['待通知', '已通知', '查無LINE', '通知失敗', '略過'], strict: true },
    ],
    '工作日例外': [
      { col: '是否上班', options: ['是', '否'],       migrate: { TRUE: '是', FALSE: '否' } },
    ],
    '日常異常事件通報': [
      { col: '填報事項', options: DAILY_INCIDENT_SUBJECTS || ['環境設施', '場地使用', '安全衛生', '人員反映', '其他'], strict: false },
      { col: '處理狀況', options: DAILY_INCIDENT_PROCESS_STATUSES || ['待處理', '處理中', '處理完成'], strict: true },
      { col: '審核狀態', options: DAILY_INCIDENT_REVIEW_STATUSES || ['未送審', '待主管審核', '已結案', '退回補正'], strict: true },
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

  // ===== 2b. 補填 / 修正「檢查表模板」的「結果選項」/「月檢樣式」=====
  //
  // ⚠ F-CRANE-M 的「結果選項」必須留空（不能寫 '正常,異常'）—
  //   crane_full schema 前端硬寫 'normal'/'abnormal' 兩個 radio、不讀
  //   resultOptions。若 sheet 填了 '正常,異常'，後端 validation 會擋掉
  //   前端送的英文值，造成天車月檢送不出。
  const TEMPLATE_DEFAULTS = {
    'F-CRANE-D': { '結果選項': 'V,/,X',  '月檢樣式': '' },
    'F-CRANE-M': { '結果選項': '',       '月檢樣式': '天車完整版' },  // 結果選項刻意留空
    'F-FORK-D':  { '結果選項': '○,△,X', '月檢樣式': '' },
    'F-FORK-M':  { '結果選項': 'ˇ,X',   '月檢樣式': '簡式月檢' },
    'F-AWP-D':   { '結果選項': 'V,X',    '月檢樣式': '' },
    'F-AWP-SD':  { '結果選項': 'ˇ,X',   '月檢樣式': '' },
  };
  // 強制清空的特定錯誤值（舊版 bug 殘留 / 使用者誤填）
  const FORCED_CLEAR = {
    'F-CRANE-M': { '結果選項': ['正常,異常', '正常, 異常'] },
  };
  if (tplSheet) {
    const tData = tplSheet.getDataRange().getValues();
    const tHdr = tData[0];
    const tIdIdx = tHdr.indexOf('表單ID');
    const ropIdx2 = tHdr.indexOf('結果選項');
    const schIdx2 = tHdr.indexOf('月檢樣式');
    let backfilled = 0, cleared = 0;
    const colMap = { '結果選項': ropIdx2, '月檢樣式': schIdx2 };
    for (let i = 1; i < tData.length; i++) {
      const id = String(tData[i][tIdIdx] || '').trim();
      // 先強制清空已知錯誤值
      const fc = FORCED_CLEAR[id];
      if (fc) {
        for (const col of Object.keys(fc)) {
          const ci = colMap[col];
          if (ci < 0) continue;
          const cur = String(tData[i][ci] || '').trim();
          if (fc[col].includes(cur)) {
            tplSheet.getRange(i + 1, ci + 1).setValue('');
            cleared++;
          }
        }
      }
      // 然後補填空白欄位
      const defaults = TEMPLATE_DEFAULTS[id];
      if (!defaults) continue;
      for (const col of Object.keys(defaults)) {
        const ci = colMap[col];
        if (ci < 0) continue;
        const want = defaults[col];
        if (!want) continue;  // 預設要留空就跳過
        if (!String(tData[i][ci] || '').trim()) {
          tplSheet.getRange(i + 1, ci + 1).setValue(want);
          backfilled++;
        }
      }
    }
    if (cleared > 0) report.push(`✓ 修正「檢查表模板」錯誤值 ${cleared} 格`);
    if (backfilled > 0) report.push(`✓ 補填「檢查表模板」空白欄位 ${backfilled} 格`);
  }

  // ===== 3. 機具設備異常事件.狀態（沿用既有設定） =====
  setupIncidentStatusValidation_(ss);
  report.push('✓ 「機具設備異常事件.狀態」下拉已套用');

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
     '○,△,X', '', '是'],
    ['F-FORK-M', '堆高機', '堆高機每月定期檢查表', '每月',
     '起重升降機具安全規則 §128', '正常打「ˇ」/ 異常打「X」',
     'ˇ,X', '簡式月檢', '是'],
  ];
  const tplColMap = ['表單ID', '設備類別', '表單名稱', '週期', '法規依據', '填寫規則', '結果選項', '月檢樣式', '啟用'];
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

function addAerialWorkPlatformTemplatesAndEquipment() {
  const ss = SpreadsheetApp.openById(CONFIG.DB_SHEET_ID);
  const result = {
    templatesAdded: 0,
    templatesUpdated: 0,
    templatesDisabled: 0,
    itemsAdded: 0,
    itemsUpdated: 0,
    itemsDisabled: 0,
    equipmentsAdded: 0,
    equipmentsUpdated: 0,
    settingsUpdated: 0,
  };

  setupSheet_(ss, '設備清單',
    ['設備代號', '設備名稱', '機械編號', '型式規格', '設備類別', '所在位置', '場地表分頁', '日檢表單ID', '啟用'],
    []
  );

  const templateRows = [
    ['F-AWP-D', '高空工作車', '車載式高空工作車每日作業前檢點表', '每日',
     '依附件「車載式高空工作車每日作業前檢點表」', '檢查結果正常打「V」，異常打「X」；異常項目需提出改善措施',
     'V,X', '', '是'],
    ['F-AWP-SD', '高空工作車', '自走式高空工作車每日作業前檢查表', '每日',
     '依附件「高空作業車作業前檢查表（自主檢查表）」', '每日檢查合格後打「ˇ」，異常打「X」；異常應停止使用並通知相關人員處理',
     'ˇ,X', '', '是'],
  ];
  const templateCols = ['表單ID', '設備類別', '表單名稱', '週期', '法規依據', '填寫規則', '結果選項', '月檢樣式', '啟用'];
  const tplSheet = ss.getSheetByName('檢查表模板');
  const tplHeaders = tplSheet.getRange(1, 1, 1, tplSheet.getLastColumn()).getValues()[0].map(h => String(h || '').trim());
  const tplIdCol = tplHeaders.indexOf('表單ID');
  const existingTplRows = new Map();
  if (tplIdCol >= 0 && tplSheet.getLastRow() > 1) {
    tplSheet.getRange(2, 1, tplSheet.getLastRow() - 1, tplHeaders.length).getValues()
      .forEach((r, i) => existingTplRows.set(String(r[tplIdCol] || '').trim(), i + 2));
  }
  const tplAppend = [];
  templateRows.forEach(src => {
    const row = new Array(tplHeaders.length).fill('');
    templateCols.forEach((col, i) => {
      const ci = tplHeaders.indexOf(col);
      if (ci >= 0) row[ci] = src[i];
    });
    const existingRow = existingTplRows.get(src[0]);
    if (existingRow) {
      const range = tplSheet.getRange(existingRow, 1, 1, tplHeaders.length);
      range.clearDataValidations();
      range.setValues([row]);
      result.templatesUpdated += 1;
      return;
    }
    tplAppend.push(row);
  });
  const oldMonthlyTplRow = existingTplRows.get('F-AWP-M');
  if (oldMonthlyTplRow) {
    const activeCol = tplHeaders.indexOf('啟用');
    const schemaCol = tplHeaders.indexOf('月檢樣式');
    if (activeCol >= 0) tplSheet.getRange(oldMonthlyTplRow, activeCol + 1).setValue('否');
    if (schemaCol >= 0) tplSheet.getRange(oldMonthlyTplRow, schemaCol + 1).setValue('');
    result.templatesDisabled += 1;
  }
  if (tplAppend.length) {
    const range = tplSheet.getRange(tplSheet.getLastRow() + 1, 1, tplAppend.length, tplHeaders.length);
    range.clearDataValidations();
    range.setValues(tplAppend);
    result.templatesAdded = tplAppend.length;
  }

  const itemRows = [
    ['F-AWP-D', 1, '昇空臂、昇空桶有無損壞、裂痕、變形，昇空桶有無鑽孔或底部有無破洞', '目視檢查', true],
    ['F-AWP-D', 2, '鋼構與昇空臂絕緣接合處外觀有無龜裂、變形、接合鬆動，昇空臂搖晃是否過大', '目視檢查', true],
    ['F-AWP-D', 3, '操作桿之把手及保護裝置有無脫落', '目視檢查', true],
    ['F-AWP-D', 4, '昇空臂基座介面有無鬆弛龜裂變形、結構配件有無鬆動或遺失、螺栓螺帽有無鬆弛或脫落及是否旋緊密合、各部組件功能是否完妥、是否搖晃過大或鬆動異常聲響', '目視檢查', true],
    ['F-AWP-D', 5, '各高壓油管及各接頭有否洩漏及定位（含基座、旋轉軸承及齒輪箱、上下臂之油壓缸、昇空桶油管）', '目視檢查', true],
    ['F-AWP-D', 6, '各組件焊接部位有無變形（含基座、旋轉、撐腳、上臂肘、上臂頂、下臂、昇空桶）', '目視檢查', true],
    ['F-AWP-D', 7, '電瓶樁頭、電瓶水是否正常；胎壓是否正常', '目視檢查', true],
    ['F-AWP-D', 8, '車體接地是否符合規定', '目視檢查', true],
    ['F-AWP-D', 9, '各種儀表功能是否正常', '目視檢查', true],
    ['F-AWP-D', 10, '上、下控制器切換開關（含緊急停止）功能是否正常', '試車動作測試', true],
    ['F-AWP-D', 11, '下控制器昇降及旋轉之功能是否正常', '試車動作測試', true],
    ['F-AWP-D', 12, '上控制器上、下臂昇降及旋轉（操作鬆鎖裝置）功能是否正常', '試車動作測試', true],
    ['F-AWP-D', 13, '外伸撐座功能是否正常', '試車動作測試', true],
    ['F-AWP-D', 14, '煞車器、離合器、開關控制器、動力傳動器（PTO）、油壓泵運轉是否正常', '試車動作測試', true],
    ['F-AWP-D', 15, '油壓煞車是否正確', '試車動作測試', true],
    ['F-AWP-D', 16, '其他維修保養手冊需要安檢項目', '依保養手冊', true],
    ['F-AWP-SD', 1, '【作業環境】地面是否堅硬平坦無塌陷', '檢視', true],
    ['F-AWP-SD', 2, '【作業環境】環境及通道是否淨空且無危險物及有害物', '檢視', true],
    ['F-AWP-SD', 3, '【作業環境】是否鄰近道路作業並做好圍隔離措施', '檢視', true],
    ['F-AWP-SD', 4, '【人員】作業人數確認並危害告之', '說明', true],
    ['F-AWP-SD', 5, '【人員】個人防護具是否齊全', '檢視', true],
    ['F-AWP-SD', 6, '【人員】精神狀況是否良好', '檢視', true],
    ['F-AWP-SD', 7, '【工作車輛】煞車系統是否正常有效', '測試', true],
    ['F-AWP-SD', 8, '【工作車輛】蜂鳴器、警示燈是否正常', '測試', true],
    ['F-AWP-SD', 9, '【工作車輛】各項功能開關是否正常有效', '測試', true],
    ['F-AWP-SD', 10, '【工作車輛】作業欄是否變形、毀損', '檢視', true],
    ['F-AWP-SD', 11, '【工作車輛】輪胎、胎壓、軸承、螺絲是否正常', '檢視', true],
    ['F-AWP-SD', 12, '【工作車輛】指示儀表是否正常有效', '檢視', true],
    ['F-AWP-SD', 13, '【工作車輛】油管電線是否龜裂破損', '檢視', true],
    ['F-AWP-SD', 14, '【工作車輛】結構及插銷是否鏽蝕、變形', '檢視', true],
    ['F-AWP-SD', 15, '【工作車輛】水、機油、柴油、操作油是否正常無洩漏', '檢視', true],
    ['F-AWP-SD', 16, '【工作車輛】緊急洩壓閥是否正常有效', '測試', true],
    ['F-AWP-SD', 17, '【工作車輛】前進後退、舉升及制動裝置、傾斜度、水平測試是否正常', '測試', true],
    ['F-AWP-SD', 18, '【工作車輛】具外撐座者，其外撐座功能是否正常', '測試', true],
    ['F-AWP-SD', 19, '【工作車輛】引擎、水箱、啟動馬達、發電機裝置是否正常', '測試', true],
  ];
  const itemCols = ['表單ID', '項目順序', '項目名稱', '檢查方法', '啟用'];
  const itemSheet = ss.getSheetByName('檢查項目');
  const itemHeaders = itemSheet.getRange(1, 1, 1, itemSheet.getLastColumn()).getValues()[0].map(h => String(h || '').trim());
  const formIdCol = itemHeaders.indexOf('表單ID');
  const orderCol = itemHeaders.indexOf('項目順序');
  const existingItems = new Map();
  if (formIdCol >= 0 && orderCol >= 0 && itemSheet.getLastRow() > 1) {
    itemSheet.getRange(2, 1, itemSheet.getLastRow() - 1, itemHeaders.length).getValues()
      .forEach((r, i) => existingItems.set(String(r[formIdCol] || '').trim() + '|' + String(r[orderCol] || '').trim(), i + 2));
  }
  const itemAppend = [];
  itemRows.forEach(src => {
    const key = src[0] + '|' + src[1];
    const row = new Array(itemHeaders.length).fill('');
    itemCols.forEach((col, i) => {
      const ci = itemHeaders.indexOf(col);
      if (ci >= 0) row[ci] = src[i];
    });
    const existingRow = existingItems.get(key);
    if (existingRow) {
      const range = itemSheet.getRange(existingRow, 1, 1, itemHeaders.length);
      range.clearDataValidations();
      range.setValues([row]);
      result.itemsUpdated += 1;
      return;
    }
    itemAppend.push(row);
  });
  const activeItemCol = itemHeaders.indexOf('啟用');
  if (formIdCol >= 0 && activeItemCol >= 0 && itemSheet.getLastRow() > 1) {
    itemSheet.getRange(2, 1, itemSheet.getLastRow() - 1, itemHeaders.length).getValues()
      .forEach((r, i) => {
        if (String(r[formIdCol] || '').trim() === 'F-AWP-M' && isActiveValue_(r[activeItemCol])) {
          itemSheet.getRange(i + 2, activeItemCol + 1).setValue('否');
          result.itemsDisabled += 1;
        }
      });
  }
  if (itemAppend.length) {
    const range = itemSheet.getRange(itemSheet.getLastRow() + 1, 1, itemAppend.length, itemHeaders.length);
    range.clearDataValidations();
    range.setValues(itemAppend);
    result.itemsAdded = itemAppend.length;
  }

  const eqSheet = ss.getSheetByName('設備清單');
  const eqHeaders = eqSheet.getRange(1, 1, 1, eqSheet.getLastColumn()).getValues()[0].map(h => String(h || '').trim());
  const eqIdCol = eqHeaders.indexOf('設備代號');
  const existingEqRows = new Map();
  if (eqIdCol >= 0 && eqSheet.getLastRow() > 1) {
    eqSheet.getRange(2, 1, eqSheet.getLastRow() - 1, eqHeaders.length).getValues()
      .forEach((r, i) => existingEqRows.set(String(r[eqIdCol] || '').trim(), i + 2));
  }
  const equipmentRows = [
    {
      id: 'AWP-LJ-001',
      name: '車載式高空工作車',
      serial: 'AWP-LJ-001',
      type: '車載式高空工作車',
      dailyTemplateId: 'F-AWP-D',
    },
    {
      id: 'AWP-LJ-SP-001',
      name: '自走式高空工作車',
      serial: 'AWP-LJ-SP-001',
      type: '自走式高空工作車',
      dailyTemplateId: 'F-AWP-SD',
    },
  ];
  equipmentRows.forEach(eqp => {
    const row = new Array(eqHeaders.length).fill('');
    const setE = (name, value) => { const i = eqHeaders.indexOf(name); if (i >= 0) row[i] = value; };
    setE('設備代號', eqp.id);
    setE('設備名稱', eqp.name);
    setE('機械編號', eqp.serial);
    setE('型式規格', eqp.type);
    setE('設備類別', '高空工作車');
    setE('所在位置', '龍井高空車實習場地');
    setE('場地表分頁', 'gid:518002759');
    setE('日檢表單ID', eqp.dailyTemplateId);
    setE('啟用', '是');
    const existingRow = existingEqRows.get(eqp.id);
    if (existingRow) {
      const range = eqSheet.getRange(existingRow, 1, 1, eqHeaders.length);
      range.clearDataValidations();
      range.setValues([row]);
      result.equipmentsUpdated += 1;
      return;
    }
    const range = eqSheet.getRange(eqSheet.getLastRow() + 1, 1, 1, eqHeaders.length);
    range.clearDataValidations();
    range.setValues([row]);
    result.equipmentsAdded += 1;
  });

  result.settingsUpdated = ensureVenueUsageKeywordSetting_(ss, '高空工作車', '高') ? 1 : 0;
  try { applyChineseSettingsAndDropdowns(); } catch (e) { Logger.log('dropdown 重套失敗：' + e); }
  try { applyColumnWidthsAndWrap_(); } catch (e) { Logger.log('欄寬重套失敗：' + e); }
  SpreadsheetApp.flush();
  Logger.log('addAerialWorkPlatformTemplatesAndEquipment 完成：' + JSON.stringify(result));
  return result;
}

function ensureVenueUsageKeywordSetting_(ss, category, keyword) {
  const sheet = ss.getSheetByName('系統設定');
  if (!sheet) throw new Error('找不到系統設定工作表');
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(h => String(h || '').trim());
  const keyCol = headers.indexOf('鍵');
  const valueCol = headers.indexOf('值');
  const noteCol = headers.indexOf('備註');
  if (keyCol < 0 || valueCol < 0) throw new Error('系統設定缺必要欄位');

  const key = 'venueUsageRequiredKeywords';
  const desired = category + '=' + keyword;
  const data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][keyCol] || '').trim() !== key) continue;
    const current = String(data[i][valueCol] || '').trim();
    const existing = parseVenueUsageRequiredKeywords_(current, category);
    if (existing !== null) return false;
    const next = current ? current + ';' + desired : desired;
    sheet.getRange(i + 1, valueCol + 1).setValue(next);
    if (noteCol >= 0) sheet.getRange(i + 1, noteCol + 1).setValue('共用場地分頁的使用判定必要關鍵字；例：堆高機需含「堆」、高空工作車需含「高」才算使用');
    return true;
  }

  const row = new Array(headers.length).fill('');
  row[keyCol] = key;
  row[valueCol] = desired;
  if (noteCol >= 0) row[noteCol] = '共用場地分頁的使用判定必要關鍵字；例：堆高機需含「堆」、高空工作車需含「高」才算使用';
  sheet.getRange(sheet.getLastRow() + 1, 1, 1, headers.length).setValues([row]);
  return true;
}

/**
 * 加每日場地防護具檢點 — template / items / 場地
 *
 * 設計：
 * - 場地當特殊「設備」處理，category = '防護具檢點'
 * - 表單共用 daily.html，因為 schema 跟一般 daily 一樣（V/X 二選一）
 * - 場地名稱跟設備名稱對應：VENUE-CRANE → 固定式起重機實習場地
 *
 * 來源：天車安全防護用具檢查表.docx
 * 法規：職業安全衛生設施規則 §286（雇主供給防護具，並使勞工確實使用）
 */
function addPpeTemplatesAndEquipments() {
  const ss = SpreadsheetApp.openById(CONFIG.DB_SHEET_ID);
  const result = { templateAdded: 0, templateRenamed: 0, itemsAdded: 0, venuesAdded: 0 };
  const ppeTemplateName = '每日場地防護具檢點表';

  // ===== 1. 加模板 F-PPE-D =====
  const tplSheet = ss.getSheetByName('檢查表模板');
  const tplHeaders = tplSheet.getRange(1, 1, 1, tplSheet.getLastColumn()).getValues()[0];
  const tplLastRow = tplSheet.getLastRow();
  const existingTplIds = new Set();
  const tplIdCol = tplHeaders.indexOf('表單ID');
  const tplNameCol = tplHeaders.indexOf('表單名稱');
  let existingPpeTemplateRow = -1;
  if (tplLastRow > 1 && tplIdCol >= 0) {
    tplSheet.getRange(2, tplIdCol + 1, tplLastRow - 1, 1).getValues()
      .forEach((r, i) => {
        const id = String(r[0] || '').trim();
        existingTplIds.add(id);
        if (id === 'F-PPE-D') existingPpeTemplateRow = i + 2;
      });
  }
  if (!existingTplIds.has('F-PPE-D')) {
    const tplRow = new Array(tplHeaders.length).fill('');
    const setT = (name, v) => { const i = tplHeaders.indexOf(name); if (i >= 0) tplRow[i] = v; };
    setT('表單ID',   'F-PPE-D');
    setT('設備類別', '防護具檢點');
    setT('表單名稱', ppeTemplateName);
    setT('週期',     '每日');
    setT('法規依據', '職業安全衛生設施規則 §286');
    setT('填寫規則', '良好打「V」/ 不良打「X」（不良需於記事欄註明）');
    setT('結果選項', 'V,X');
    setT('月檢樣式', '');
    setT('啟用',     '是');
    tplSheet.getRange(tplSheet.getLastRow() + 1, 1, 1, tplHeaders.length).setValues([tplRow]);
    result.templateAdded = 1;
  } else if (existingPpeTemplateRow > 0 && tplNameCol >= 0) {
    const nameCell = tplSheet.getRange(existingPpeTemplateRow, tplNameCol + 1);
    if (String(nameCell.getValue() || '').trim() !== ppeTemplateName) {
      nameCell.setValue(ppeTemplateName);
      result.templateRenamed = 1;
    }
  }

  // ===== 2. 加項目（2 項：安全帽 / 安全背心）=====
  const itemSheet = ss.getSheetByName('檢查項目');
  const itemHeaders = itemSheet.getRange(1, 1, 1, itemSheet.getLastColumn()).getValues()[0];
  const itemLastRow = itemSheet.getLastRow();
  const existingItems = new Set();
  if (itemLastRow > 1) {
    const data = itemSheet.getRange(2, 1, itemLastRow - 1, itemHeaders.length).getValues();
    const idIdx = itemHeaders.indexOf('表單ID');
    const orderIdx = itemHeaders.indexOf('項目順序');
    data.forEach(r => existingItems.add(`${r[idIdx]}|${r[orderIdx]}`));
  }
  const ppeItems = [
    { order: 1, name: '安全帽',   method: '目視（配件完整 / 無破損 / 無髒汙）' },
    { order: 2, name: '安全背心', method: '目視（無破損 / 無髒汙）' },
  ];
  const newItemRows = [];
  ppeItems.forEach(it => {
    if (existingItems.has(`F-PPE-D|${it.order}`)) return;
    const row = new Array(itemHeaders.length).fill('');
    const setI = (name, v) => { const i = itemHeaders.indexOf(name); if (i >= 0) row[i] = v; };
    setI('表單ID',   'F-PPE-D');
    setI('項目順序', it.order);
    setI('項目名稱', it.name);
    setI('檢查方法', it.method);
    setI('啟用',     '是');
    newItemRows.push(row);
  });
  if (newItemRows.length > 0) {
    itemSheet.getRange(itemSheet.getLastRow() + 1, 1, newItemRows.length, itemHeaders.length).setValues(newItemRows);
    result.itemsAdded = newItemRows.length;
  }

  // ===== 3. 加場地（當特殊設備）=====
  const eqSheet = ss.getSheetByName('設備清單');
  const eqHeaders = eqSheet.getRange(1, 1, 1, eqSheet.getLastColumn()).getValues()[0];
  const eqLastRow = eqSheet.getLastRow();
  const existingEqIds = new Set();
  if (eqLastRow > 1) {
    const idCol = eqHeaders.indexOf('設備代號');
    eqSheet.getRange(2, idCol + 1, eqLastRow - 1, 1).getValues()
      .forEach(r => existingEqIds.add(String(r[0])));
  }
  const venues = [
    { id: 'VENUE-CRANE', name: '固定式起重機實習場地', location: '三樓' },
    { id: 'VENUE-FORK',  name: '堆高機實習場地',       location: '一樓' },
  ];
  const newEqRows = [];
  venues.forEach(v => {
    if (existingEqIds.has(v.id)) return;
    const row = new Array(eqHeaders.length).fill('');
    const setE = (name, value) => { const i = eqHeaders.indexOf(name); if (i >= 0) row[i] = value; };
    setE('設備代號',   v.id);
    setE('設備名稱',   v.name);
    setE('機械編號',   '');
    setE('型式規格',   '');
    setE('設備類別',   '防護具檢點');
    setE('所在位置',   v.location);
    setE('場地表分頁', '');   // 防護具不對場地表（不需要 reminder）
    setE('啟用',       '是');
    newEqRows.push(row);
  });
  if (newEqRows.length > 0) {
    eqSheet.getRange(eqSheet.getLastRow() + 1, 1, newEqRows.length, eqHeaders.length).setValues(newEqRows);
    result.venuesAdded = newEqRows.length;
  }

  // ===== 4. 重新套用 dropdown（讓「每日場地防護具檢點」進設備類別下拉）=====
  try { applyChineseSettingsAndDropdowns(); } catch (e) { Logger.log('dropdown 重套失敗：' + e); }

  const summary = `✓ template +${result.templateAdded}、renamed +${result.templateRenamed}、items +${result.itemsAdded}、venues +${result.venuesAdded}`;
  Logger.log(summary);
  return summary;
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

function getDatabaseSheetInventory_() {
  const ss = SpreadsheetApp.openById(CONFIG.DB_SHEET_ID);
  const sheets = ss.getSheets().map(sheet => {
    const lastRow = sheet.getLastRow();
    const lastColumn = sheet.getLastColumn();
    const headers = (lastRow >= 1 && lastColumn >= 1)
      ? sheet.getRange(1, 1, 1, lastColumn).getValues()[0].map(v => String(v || '').trim())
      : [];
    return {
      name: sheet.getName(),
      sheetId: sheet.getSheetId(),
      index: sheet.getIndex(),
      hidden: sheet.isSheetHidden(),
      maxRows: sheet.getMaxRows(),
      maxColumns: sheet.getMaxColumns(),
      lastRow,
      lastColumn,
      dataRows: Math.max(0, lastRow - 1),
      headers,
    };
  });
  return {
    spreadsheetName: ss.getName(),
    spreadsheetId: CONFIG.DB_SHEET_ID,
    sheetCount: sheets.length,
    sheets,
  };
}
