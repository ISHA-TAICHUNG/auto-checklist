/**
 * ===== 與 Apps Script Web App 溝通的 client =====
 *
 * Apps Script 限制：
 *   - doPost 接收的 Content-Type 必須是 text/plain 或 application/x-www-form-urlencoded
 *     若送 application/json 會被當成 preflight，Apps Script 不允許
 *   - 沒有 CORS 限制（不像一般 web server）
 */
(function () {
  const C = window.SYSTEM_CONFIG;

  function buildUrl(params) {
    const qs = Object.entries(params)
      .filter(([, v]) => v !== undefined && v !== null && v !== '')
      .map(([k, v]) => encodeURIComponent(k) + '=' + encodeURIComponent(v))
      .join('&');
    return C.API_BASE + (qs ? '?' + qs : '');
  }

  async function apiGet(params) {
    if (!C.API_BASE || C.API_BASE.indexOf('PASTE_YOUR') === 0) {
      throw new Error('尚未在 web/js/config.js 設定 API_BASE');
    }
    const res = await fetch(buildUrl(params), { method: 'GET' });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return res.json();
  }

  async function apiPost(payload) {
    if (!C.API_BASE || C.API_BASE.indexOf('PASTE_YOUR') === 0) {
      throw new Error('尚未在 web/js/config.js 設定 API_BASE');
    }
    const res = await fetch(C.API_BASE, {
      method: 'POST',
      // 不指定 Content-Type 讓瀏覽器發 text/plain，避開 Apps Script preflight 問題
      body: JSON.stringify(payload),
    });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return res.json();
  }

  window.API = {
    listEquipments: () => apiGet({ api: 'equipments' }),
    getFormMeta: (form, eqp) => apiGet({ api: 'meta', form, eqp }),
    submit: (payload) => apiPost(payload),
    health: () => apiGet({ api: 'health' }),
  };
})();
