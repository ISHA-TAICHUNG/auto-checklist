/**
 * ===== Web App 入口（純 JSON API 模式）=====
 *
 * 部署為 Web App 後（執行身分=自己、存取權=任何人），前端（GitHub Pages）
 * 透過下列 endpoints 呼叫：
 *
 *   GET  ...exec?api=health
 *   GET  ...exec?api=equipments               — 設備清單
 *   GET  ...exec?api=meta&form=...&eqp=...    — 檢查表模板
 *   GET  ...exec?api=branding                  — 機構名稱（前端啟動載入）
 *   GET  ...exec?api=status                    — 系統狀態（不含 secret）
 *   GET  ...exec?api=admin&action=...&token=...  — 管理用，需 token
 *
 *   POST ...exec   body={ apiToken, formType, equipmentId, ... }
 *
 * doPost 強制驗證 apiToken；body 必須是 JSON 字串（前端用 fetch + Content-Type
 * text/plain 送出，避開 Apps Script 對 application/json preflight 的限制）。
 */

function doGet(e) {
  const api = (e && e.parameter && e.parameter.api) || 'health';

  try {
    let result;
    switch (api) {
      case 'health':
        result = { ok: true, name: 'auto-checklist-api', version: '1.0' };
        break;

      case 'equipments':
        result = { ok: true, equipments: getEquipmentList_() };
        break;

      case 'meta': {
        const form = e.parameter.form;
        const eqp = e.parameter.eqp;
        if (!form || !eqp) throw new Error('需提供 form 與 eqp 參數');
        result = { ok: true, meta: getFormMeta_(form, eqp) };
        break;
      }

      case 'lockedItems': {
        // 取「特定設備 + 特定表單類型」尚未處理完成的異常項
        // 前端用此鎖定 row（只能選異常）+ 帶入上次異常說明
        const form = e.parameter.form;
        const eqp = e.parameter.eqp;
        if (!form || !eqp) throw new Error('需提供 form 與 eqp 參數');
        result = { ok: true, locked: getLockedItemsForEquipment_(eqp, form) };
        break;
      }

      case 'status':
        // 公開版只回最小資訊（避免 codex P2: 洩漏內部 ID）
        // 完整診斷請在 Apps Script 編輯器執行 getSystemStatus_() 查看
        result = {
          ok: true,
          version: '1.0',
          timeZone: tz_(),
          name: 'auto-checklist-api',
        };
        break;

      case 'branding':
        result = { ok: true, organizationName: getOrgHeader_() };
        break;

      case 'admin': {
        // 維護動作 — 兩層 token：
        //   - 唯讀類（reminderStatus / openIssues / fetchPdf）→ 用 API_TOKEN（公開前端也能查）
        //   - 寫入/破壞性類（其餘）→ 用 ADMIN_TOKEN（存 Script Properties，不公開）
        // 安全分層由 codex review 2026-05-26 觸發加入
        if (e.parameter.token !== CONFIG.API_TOKEN) throw new Error('未授權');
        const action = e.parameter.action;
        // 寫入類 actions 白名單 — 這些必須額外用 ADMIN_TOKEN
        // codex 2026-05-26 round 2 P1.2: fetchPdf 雖唯讀但回 PDF binary（含簽名/姓名）→ 升級成需 ADMIN_TOKEN
        const WRITE_ACTIONS = ['formatSheets', 'runInit', 'applyDropdowns',
                               'setEquipmentField', 'addPpe', 'setLineProps',
                               'testLineIncident', 'markCompleted', 'fetchPdf',
                               'addMonthlySafetyPpeForms'];
        // 破壞性 actions — 需 ADMIN_TOKEN + ALLOW_DESTRUCTIVE_HTTP=YES kill switch
        const DESTRUCTIVE_ACTIONS = ['cleanupAll', 'cleanupDate'];
        if (WRITE_ACTIONS.indexOf(action) >= 0 || DESTRUCTIVE_ACTIONS.indexOf(action) >= 0) {
          if (!checkAdminToken_(e.parameter.adminToken)) {
            throw new Error('未授權：此 action 需 adminToken（Script Properties ADMIN_TOKEN）');
          }
        }
        if (DESTRUCTIVE_ACTIONS.indexOf(action) >= 0 && !destructiveHttpAllowed_()) {
          throw new Error('未授權：破壞性 action 預設禁止 HTTP 呼叫，請在 Apps Script 編輯器手動執行函式（或設 Script Property ALLOW_DESTRUCTIVE_HTTP=YES）');
        }
        switch (action) {
          case 'formatSheets': {
            // 重新套用欄寬與換行設定（idempotent）
            applyColumnWidthsAndWrap_();
            result = { ok: true, action, message: 'column widths applied' };
            break;
          }
          case 'runInit': {
            // Schema migration helper — 從外部觸發 initializeDatabase
            // 安全性：受 ADMIN_TOKEN 限制 + initializeDatabase 是 idempotent
            // (重複跑不會破壞既有資料，setupSheet_ 對既有表只補缺欄位)
            initializeDatabase();
            result = { ok: true, action, message: 'initializeDatabase 執行完成' };
            break;
          }
          case 'applyDropdowns': {
            // 統一各設定表的選項欄位下拉 + 把 TRUE/FALSE 改成 是/否
            // idempotent，重複跑無害
            const summary = applyChineseSettingsAndDropdowns();
            result = { ok: true, action, summary };
            break;
          }
          case 'setEquipmentField': {
            // 改設備清單某列的某欄位
            // 例：?action=setEquipmentField&eqp=VENUE-CRANE&field=所在位置&value=三樓
            const eqp = e.parameter.eqp;
            const field = e.parameter.field;
            const value = e.parameter.value;
            if (!eqp || !field) throw new Error('需提供 eqp 與 field');
            const ss = SpreadsheetApp.openById(CONFIG.DB_SHEET_ID);
            const sh = ss.getSheetByName('設備清單');
            const data = sh.getDataRange().getValues();
            const headers = data[0];
            const idCol = headers.indexOf('設備代號');
            const fldCol = headers.indexOf(field);
            if (idCol < 0) throw new Error('設備清單缺「設備代號」欄');
            if (fldCol < 0) throw new Error('找不到欄位：' + field);
            let updated = 0;
            for (let i = 1; i < data.length; i++) {
              if (String(data[i][idCol]) === eqp) {
                sh.getRange(i + 1, fldCol + 1).setValue(value || '');
                updated++;
              }
            }
            result = { ok: true, action, eqp, field, value, updated };
            break;
          }
          case 'addPpe': {
            // 加防護具檢點 template + 2 個項目 + 2 個場地（VENUE-CRANE / VENUE-FORK）
            const summary = addPpeTemplatesAndEquipments();
            result = { ok: true, action, summary };
            break;
          }
          case 'addMonthlySafetyPpeForms': {
            // 加龍井/復興/忠明量測設備及 PPE 月檢 + SCBA 月檢
            const summary = addMonthlySafetyPpeForms();
            result = { ok: true, action, summary };
            break;
          }
          case 'setLineProps': {
            // 設 LINE 推播相關 Properties（從 ISHA-bot 那邊複製過來）
            // 用 doPost 傳 JSON body 比較安全（不會在 URL 中曝露 token）
            // 但 admin 一律走 doGet，這裡接受 URL params 也 OK（admin 半公開 trade-off）
            const props = PropertiesService.getScriptProperties();
            const updates = {};
            ['LINE_CHANNEL_ACCESS_TOKEN','LINE_CHANNEL_SECRET',
             'LINE_TARGET_GROUP_ID','LINE_TARGET_USER_IDS','LINE_ADMIN_USER_IDS',
             'INCIDENT_SHEET_URL'].forEach(k => {
              if (e.parameter[k] !== undefined) updates[k] = e.parameter[k];
            });
            if (Object.keys(updates).length === 0) {
              throw new Error('需提供至少一個 LINE_* property');
            }
            props.setProperties(updates, false);
            result = { ok: true, action, set: Object.keys(updates) };
            break;
          }
          case 'testLineIncident': {
            // 測試異常通報 LINE 是否正常推（內部 try 包，回傳完整錯誤訊息給 admin）
            try {
              const cfg = (typeof getLineConfig_ === 'function') ? getLineConfig_() : null;
              const diagnose = {
                hasGetLineConfig: typeof getLineConfig_ === 'function',
                hasSendIncidentAlert: typeof sendIncidentAlert_ === 'function',
                token: cfg ? (cfg.token ? '✓ ' + cfg.token.substring(0, 8) + '...' : '✗ 缺') : '✗ cfg null',
                groupId: cfg ? (cfg.groupId || '(空)') : '?',
                userIds: cfg ? cfg.userIds : [],
                userIdsCount: cfg ? cfg.userIds.length : 0,
                incidentSheetUrl: PropertiesService.getScriptProperties().getProperty('INCIDENT_SHEET_URL') || '(空)',
              };
              let pushResult = null;
              if (cfg && cfg.token && typeof sendIncidentAlert_ === 'function') {
                pushResult = sendIncidentAlert_({
                  equipmentName: '【測試】堆高機 A 號',
                  category: '堆高機',
                  formType: '每日',
                  order: 3,
                  itemName: '【測試】煞車油是否足夠',
                  result: 'X',
                  description: '這是 testLineIncident 觸發的測試訊息',
                  photoCount: 0,
                  status: '待處理',
                  reportDate: '2026-05-22',
                  fileUrl: 'https://drive.google.com/file/d/test-fileid/view',
                });
              }
              result = { ok: true, action, diagnose, pushResult };
            } catch (innerErr) {
              // 移除 stack 回傳（codex review 2026-05-26）— 避免洩漏內部結構給拿到 ADMIN_TOKEN 的人
              Logger.log('[testLineIncident] 失敗: ' + innerErr + '\n' + (innerErr.stack || ''));
              result = { ok: false, action, error: String(innerErr.message || innerErr) };
            }
            break;
          }
          case 'markCompleted': {
            // 把指定設備所有未完成異常事件 批次改成「已完成」
            // (模擬承辦改狀態，主要 demo 用；實務建議在試算表手動改)
            const eqp = e.parameter.eqp;
            const form = e.parameter.form;  // 選填
            const summary = markIncidentsCompletedForEquipment_(eqp, form);
            result = { ok: true, action, summary };
            break;
          }
          case 'cleanupAll': {
            // 清掉所有填報紀錄 + 異常事件 + Drive PDF
            // ⚠ 不可逆（PDF 可救 30 天）
            // 修 P1.3: dryRun=1 也要 confirm=YES_DRY_RUN，實刪要 confirm=YES_DELETE_ALL
            //         避免 admin token 持有者亂打就能探勘紀錄筆數
            const dryRun = e.parameter.dryRun === '1';
            const confirm = e.parameter.confirm || '';
            if (dryRun && confirm !== 'YES_DRY_RUN' && confirm !== 'YES_DELETE_ALL') {
              throw new Error('cleanupAll dryRun 需帶 confirm=YES_DRY_RUN');
            }
            Logger.log('[cleanupAll] dryRun=' + dryRun + ' at ' + new Date().toISOString());
            const summary = cleanupAllSubmissionsAndIncidents_({ dryRun, confirm });
            result = { ok: true, action, dryRun, summary };
            break;
          }
          case 'cleanupDate': {
            // 清掉指定日期的所有測試資料（填報紀錄 + 異常事件 + Drive PDF）
            // ⚠ 一旦執行不可逆，PDF 進回收桶可救回 30 天
            // 修 codex P2.2 (round 2): 與 cleanupAll 對稱加 confirm 守衛
            //   - dryRun: 需 confirm=YES_DRY_RUN
            //   - 實刪: 需 confirm=YES_DELETE_DATE
            const dateStr = e.parameter.date;
            const dryRun = e.parameter.dryRun === '1';
            const confirm = e.parameter.confirm || '';
            if (!dateStr) throw new Error('需提供 date 參數 (YYYY-MM-DD)');
            if (dryRun && confirm !== 'YES_DRY_RUN' && confirm !== 'YES_DELETE_DATE') {
              throw new Error('cleanupDate dryRun 需帶 confirm=YES_DRY_RUN');
            }
            if (!dryRun && confirm !== 'YES_DELETE_DATE') {
              throw new Error('cleanupDate 實刪需帶 confirm=YES_DELETE_DATE');
            }
            Logger.log('[cleanupDate] date=' + dateStr + ' dryRun=' + dryRun + ' at ' + new Date().toISOString());
            const summary = cleanupTestDataForDate_(dateStr, { dryRun });
            result = { ok: true, action, date: dateStr, dryRun, summary };
            break;
          }
          case 'openIssues': {
            // 唯讀：列出狀態 != 已完成 & != 不處理 的異常事件
            result = { ok: true, ...listOpenIncidents_() };
            break;
          }
          case 'reminderStatus': {
            // 唯讀：跑 dailyReminderJob 的 dry-run，看當日各設備狀態（不寄信）
            const results = dailyReminderJob({ dryRun: true });
            result = { ok: true, dryRun: true, count: results.length, results };
            break;
          }
          case 'fetchPdf': {
            // 唯讀，且只允許讀「archive root 之下 + mimeType=PDF」的檔案
            // 雙重限制（codex P1 + DB Sheet 移入歸檔資料夾後的延伸保護）：
            //   - isUnderArchiveRoot_：限制範圍只能歸檔資料夾
            //   - mimeType 檢查：避免下載 DB Sheet / 其他非 PDF 檔
            const fid = e.parameter.fileId;
            if (!fid) throw new Error('需要 fileId');
            if (!isUnderArchiveRoot_(fid)) throw new Error('該檔案非系統歸檔範圍');
            const file = DriveApp.getFileById(fid);
            if (file.getMimeType() !== 'application/pdf') {
              throw new Error('該檔案非 PDF（mimeType: ' + file.getMimeType() + '）');
            }
            const blob = file.getBlob();
            result = { ok: true, base64: Utilities.base64Encode(blob.getBytes()) };
            break;
          }
          default:
            throw new Error('未知 admin action: ' + action);
        }
        break;
      }

      default:
        throw new Error('未知的 api: ' + api);
    }
    return jsonResponse_(result);
  } catch (err) {
    Logger.log('doGet 失敗：' + err + '\n' + (err.stack || ''));
    return jsonResponse_({ ok: false, error: friendlyError_(err) });
  }
}

function doPost(e) {
  try {
    const raw = (e && e.postData && e.postData.contents) || '';
    if (!raw) throw new Error('空白 payload');
    if (raw.length > CONFIG.MAX_PAYLOAD_BYTES) {
      throw new Error('payload 過大');
    }

    // === LINE Webhook 偵測 ===
    // Apps Script 讀不到 X-Line-Signature header（codex 2026-05-26 P1）
    // 改用 URL query token 驗證：Webhook URL 在 LINE Console 設成 exec_url?lineWebhookToken=XXX
    // - LINE_WEBHOOK_QUERY_TOKEN 未設 → fail-closed 直接拒絕（避免匿名觸發完成異常等指令）
    // - 設了 → 嚴格比對
    if (typeof handleLineWebhook_ === 'function' && raw.indexOf('"events"') >= 0 && raw.indexOf('"destination"') >= 0) {
      const expected = getLineWebhookQueryToken_();
      const provided = (e.parameter && e.parameter.lineWebhookToken) || '';
      if (!expected || expected.length < 32) {
        Logger.log('[LINE webhook] LINE_WEBHOOK_QUERY_TOKEN 未設置，拒絕 webhook');
        return jsonResponse_({ ok: false, error: 'webhook_token_not_configured' });
      }
      if (provided !== expected) {
        Logger.log('[LINE webhook] query token 不符，拒絕');
        return jsonResponse_({ ok: false, error: 'invalid_webhook_token' });
      }
      const r = handleLineWebhook_(raw);
      return jsonResponse_(r);
    }

    let payload;
    try {
      payload = JSON.parse(raw);
    } catch (_) {
      throw new Error('payload 不是合法 JSON');
    }

    if (!CONFIG.API_TOKEN || CONFIG.API_TOKEN.indexOf('REPLACE_') === 0) {
      throw new Error('系統未設定 API_TOKEN');
    }
    if (payload.apiToken !== CONFIG.API_TOKEN) {
      throw new Error('未授權');
    }
    delete payload.apiToken;
    // 移除 payload._debug stack 回傳（codex 2026-05-26 P1）— 避免任何拿到 API_TOKEN 的人能拉到 stack
    delete payload._debug;

    const result = handleSubmission_(payload);
    return jsonResponse_(result);

  } catch (err) {
    Logger.log('doPost 失敗：' + err + '\n' + (err.stack || ''));
    return jsonResponse_({ ok: false, error: friendlyError_(err) });
  }
}

/**
 * 將內部錯誤包成對前端較友善的訊息（不洩漏 stack）
 */
function friendlyError_(err) {
  const msg = String((err && err.message) || err);
  const businessErrors = ['未授權', 'payload 過大', 'payload 不是合法 JSON',
    '簽名格式錯誤', '簽名圖太大', '空白 payload', '系統忙碌，請稍後再試',
    '找不到設備', '需提供', '缺少',
    // 業務驗證錯誤（v8.10 加）
    '標為異常但未填', '仍有未處理異常', '無法標為',
    // 修 P2.2: 補白名單（讓使用者看到真因而非「請聯絡管理員」）
    '結果值不合法', '風險值不合法', '照片超過', '照片過大', '照片格式錯誤',
    '設備已停用', '找不到模板', '檢查表模板缺必要欄位',
    '日期格式', 'cleanupAll dryRun 需帶', 'cleanupDate dryRun 需帶', 'cleanupDate 實刪需帶',
    // admin 用錯誤訊息
    '該檔案非', '需要 fileId', '未知 admin action', '未知的 api',
    // 新增安全分層相關 (codex 2026-05-26)
    'adminToken', '此 action 需 adminToken', '破壞性 action', 'ADMIN_TOKEN', 'ALLOW_DESTRUCTIVE_HTTP',
    'webhook_token', 'invalid_webhook_token'];
  if (businessErrors.some(k => msg.indexOf(k) >= 0)) return msg;
  return '系統處理失敗，請聯絡管理員';
}

function jsonResponse_(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
