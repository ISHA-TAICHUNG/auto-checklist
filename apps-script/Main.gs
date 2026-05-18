/**
 * ===== Web App 入口（純 JSON API 模式）=====
 *
 * 部署為 Web App 後（執行身分=自己、存取權=任何人），前端（GitHub Pages）
 * 透過下列 endpoints 呼叫：
 *
 *   GET  ...exec?api=meta&form=daily&eqp=<EQUIPMENT_ID>
 *   GET  ...exec?api=equipments
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

      case 'status':
        result = { ok: true, status: getSystemStatus_() };
        break;

      case 'branding':
        // public：前端 fetch 取得機構名稱（避免寫死在 source code）
        result = { ok: true, organizationName: getOrgHeader_() };
        break;

      case 'admin': {
        // 管理用：需要 token，從 doGet context 觸發
        // 這樣 ScriptApp.getService().getUrl() 才會回 production /exec URL
        if (e.parameter.token !== CONFIG.API_TOKEN) throw new Error('未授權');
        const action = e.parameter.action;
        switch (action) {
          case 'fixWebAppUrl':
            result = { ok: true, action, url: setWebAppUrlFromCurrent() };
            break;
          case 'setBranding': {
            // 把機構名稱與承辦 email 寫入 DB 系統設定
            const ok = setBrandingSettings_({
              organizationName: e.parameter.orgName || '',
              reminderEmailTo: e.parameter.email || '',
            });
            result = { ok: true, action, written: ok };
            break;
          }
          case 'testSubmit': {
            // 全流程測試 — 手動展開 handleSubmission_ 步驟以拿到真實 stack
            const steps = [];
            try {
              const equipment = getEquipmentList_()[0];
              steps.push('1. 取設備：' + equipment.equipmentId);
              const full = getEquipmentById_(equipment.equipmentId);
              steps.push('2. 取完整設備：OK');

              const payload = {
                formType: 'daily',
                equipmentId: full.equipmentId,
                checkDate: '2026-05-18',
                inspector: '自動測試',
                items: [
                  { order: 1, name: '過捲預防裝置作動狀況', result: 'V', note: '', methods: [], abnormalDesc: '', risk: '', action: '', review: '' },
                  { order: 7, name: '直、橫行軌道', result: 'X', note: 'debug', methods: [], abnormalDesc: '', risk: '', action: '', review: '' },
                ],
                signature: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkAAIAAAoAAv/lxKUAAAAASUVORK5CYII=',
              };
              validateSignature_(payload.signature);
              steps.push('3. 簽名驗證：OK');

              const recordId = uuid_();
              const submittedAt = new Date();
              const checkDate = parseISODate_(payload.checkDate);
              steps.push('4. 日期解析：OK');

              const pdfBlob = buildPdf_('daily', { recordId, submittedAt, checkDate, equipment: full, payload, rocDateStr: formatROCDate_(checkDate) });
              steps.push('5. PDF 產生：' + pdfBlob.getBytes().length + ' bytes');

              const fileName = buildPdfFilename_('daily', checkDate, full);
              pdfBlob.setName(fileName);
              steps.push('6. 檔名：' + fileName);

              const folder = getOrCreateArchiveFolder_(full.category, checkDate);
              steps.push('7. 歸檔資料夾：' + folder.getName());

              const file = folder.createFile(pdfBlob);
              const fileUrl = file.getUrl();
              const fileId = file.getId();
              steps.push('8. Drive 建檔：' + fileId);

              writeRecord_({ recordId, submittedAt, checkDate, formType: 'daily', equipment: full, payload, fileUrl });
              steps.push('9. 寫紀錄：OK');

              result = { ok: true, action, fileId, fileUrl, fileName, steps };
            } catch (err) {
              result = { ok: false, action, error: String(err.message || err), stack: String(err.stack || ''), steps };
            }
            break;
          }
          case 'fetchPdf': {
            const fid = e.parameter.fileId;
            if (!fid) throw new Error('需要 fileId');
            const blob = DriveApp.getFileById(fid).getBlob();
            result = { ok: true, base64: Utilities.base64Encode(blob.getBytes()) };
            break;
          }
          case 'testPdf': {
            // debug 用：直接跑一個簡單的 PDF 產生流程，回傳 stack（不經 friendlyError）
            try {
              const equipment = getEquipmentList_()[0];
              if (!equipment) throw new Error('沒有設備');
              const full = getEquipmentById_(equipment.equipmentId);
              const ctx = {
                recordId: 'test-' + new Date().getTime(),
                submittedAt: new Date(),
                checkDate: new Date(),
                rocDateStr: formatROCDate_(new Date()),
                equipment: full,
                payload: {
                  signature: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkAAIAAAoAAv/lxKUAAAAASUVORK5CYII=',
                  inspector: 'debug',
                  items: [{ order: 1, name: 'test', result: 'V', note: '' }],
                },
              };
              const pdf = buildPdf_('daily', ctx);
              result = { ok: true, action, pdfSize: pdf.getBytes().length };
            } catch (err) {
              result = { ok: false, action, error: String(err.message || err), stack: String(err.stack || '') };
            }
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
    Logger.log('doGet 失敗：' + err);
    // 不洩漏 stack 給前端
    return jsonResponse_({ ok: false, error: friendlyError_(err) });
  }
}

function doPost(e) {
  const debug = e && e.parameter && e.parameter.debug === '1';
  try {
    const raw = (e && e.postData && e.postData.contents) || '';
    if (!raw) throw new Error('空白 payload');
    if (raw.length > CONFIG.MAX_PAYLOAD_BYTES) {
      throw new Error('payload 過大');
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

    const result = handleSubmission_(payload);
    // debug 模式且 handleSubmission_ 失敗 → 重新拋出讓外層 catch 回 stack
    if (debug && result && result.ok === false) {
      throw new Error('handleSubmission_ 失敗：' + result.error);
    }
    return jsonResponse_(result);

  } catch (err) {
    Logger.log('doPost 失敗：' + err + '\n' + (err.stack || ''));
    if (debug) {
      return jsonResponse_({ ok: false, error: String(err.message || err), stack: String(err.stack || '') });
    }
    return jsonResponse_({ ok: false, error: friendlyError_(err) });
  }
}

/**
 * 將內部錯誤包成對前端較友善的訊息（不洩漏 stack）
 */
function friendlyError_(err) {
  const msg = String((err && err.message) || err);
  // 已知的「業務錯誤」直接顯示，其餘包成通用訊息
  const businessErrors = ['未授權', 'payload 過大', 'payload 不是合法 JSON',
    '簽名格式錯誤', '簽名圖太大', '空白 payload', '系統忙碌，請稍後再試',
    '找不到設備', '需提供', '缺少'];
  if (businessErrors.some(k => msg.indexOf(k) >= 0)) return msg;
  return '系統處理失敗，請聯絡管理員';
}

function jsonResponse_(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
