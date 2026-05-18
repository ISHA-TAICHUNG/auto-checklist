/**
 * ===== Web App 入口（純 JSON API 模式）=====
 *
 * 部署為 Web App 後（執行身分=自己、存取權=任何人），前端（GitHub Pages）
 * 透過下列 endpoints 呼叫：
 *
 *   GET  ...exec?api=meta&form=daily&eqp=CRANE-LJ-001
 *   GET  ...exec?api=equipments
 *   POST ...exec   body={ formType, equipmentId, ... }    →  送出檢查表
 *
 * Apps Script 對 fetch 沒有 CORS 限制，前端可直接 fetch（不需 mode:'no-cors'）。
 * 但 doPost 的 body 必須以 text/plain 送出（Apps Script 限制），前端 JSON.stringify 後送純字串。
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

      default:
        throw new Error('未知的 api: ' + api);
    }
    return jsonResponse_(result);
  } catch (err) {
    Logger.log('doGet 失敗：' + err);
    return jsonResponse_({ ok: false, error: String(err.message || err) });
  }
}

function doPost(e) {
  try {
    const payload = JSON.parse(e.postData.contents || '{}');
    const result = handleSubmission_(payload);
    return jsonResponse_(result);
  } catch (err) {
    Logger.log('doPost 失敗：' + err);
    return jsonResponse_({ ok: false, error: String(err.message || err) });
  }
}

function jsonResponse_(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
