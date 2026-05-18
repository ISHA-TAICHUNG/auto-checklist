/**
 * ===== Web App 入口（純 JSON API 模式）=====
 *
 * 部署為 Web App 後（執行身分=自己、存取權=任何人），前端（GitHub Pages）
 * 透過下列 endpoints 呼叫：
 *
 *   GET  ...exec?api=meta&form=daily&eqp=CRANE-LJ-001
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
  try {
    // 1. payload size limit
    const raw = (e && e.postData && e.postData.contents) || '';
    if (!raw) throw new Error('空白 payload');
    if (raw.length > CONFIG.MAX_PAYLOAD_BYTES) {
      throw new Error('payload 過大');
    }

    // 2. parse
    let payload;
    try {
      payload = JSON.parse(raw);
    } catch (_) {
      throw new Error('payload 不是合法 JSON');
    }

    // 3. token verification（防匿名濫用）
    if (!CONFIG.API_TOKEN || CONFIG.API_TOKEN.indexOf('REPLACE_') === 0) {
      throw new Error('系統未設定 API_TOKEN');
    }
    if (payload.apiToken !== CONFIG.API_TOKEN) {
      throw new Error('未授權');
    }
    delete payload.apiToken;

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
