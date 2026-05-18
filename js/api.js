/**
 * ===== 與 Apps Script Web App 溝通的 client =====
 *
 * Apps Script 限制：
 *   - doPost 若收到 application/json 會觸發 CORS preflight，Apps Script 不允許
 *   - 用 Content-Type: text/plain;charset=utf-8 避開
 *   - 沒有 CORS 限制（不像一般 web server）— fetch 直接呼叫即可
 *
 * 安全：
 *   - POST 一律帶 apiToken（後端會驗證）
 *   - 不傳大於 500KB 的 payload
 */
(function () {
  const C = window.SYSTEM_CONFIG;

  function ensureConfigured(needToken) {
    if (!C.API_BASE || C.API_BASE.indexOf('PASTE_YOUR') === 0) {
      throw new Error('尚未設定 API_BASE（請編輯 js/config.js）');
    }
    if (needToken && (!C.API_TOKEN || C.API_TOKEN.indexOf('PASTE_YOUR') === 0)) {
      throw new Error('尚未設定 API_TOKEN（請編輯 js/config.js）');
    }
  }

  function buildUrl(params) {
    const qs = Object.entries(params)
      .filter(([, v]) => v !== undefined && v !== null && v !== '')
      .map(([k, v]) => encodeURIComponent(k) + '=' + encodeURIComponent(v))
      .join('&');
    return C.API_BASE + (qs ? '?' + qs : '');
  }

  async function apiGet(params) {
    ensureConfigured(false);
    const res = await fetch(buildUrl(params), { method: 'GET' });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return res.json();
  }

  async function apiPost(payload) {
    ensureConfigured(true);
    const body = JSON.stringify(Object.assign({ apiToken: C.API_TOKEN }, payload));
    if (body.length > 500 * 1024) {
      throw new Error('資料太大（>500KB），請檢查簽名圖大小');
    }
    const res = await fetch(C.API_BASE, {
      method: 'POST',
      // 明示 text/plain 避免觸發 Apps Script 不支援的 CORS preflight
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body,
    });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return res.json();
  }

  window.API = {
    listEquipments: () => apiGet({ api: 'equipments' }),
    getFormMeta: (form, eqp) => apiGet({ api: 'meta', form, eqp }),
    submit: (payload) => apiPost(payload),
    health: () => apiGet({ api: 'health' }),
    branding: () => apiGet({ api: 'branding' }),
  };

  // 啟動時自動 fetch 機構名稱、更新所有 .org-name 元素
  async function loadBranding() {
    try {
      const r = await window.API.branding();
      if (r.ok && r.organizationName) {
        document.querySelectorAll('[data-org-name]').forEach(el => {
          el.textContent = r.organizationName;
        });
      }
    } catch (e) { /* 無 branding 不致命 */ }
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', loadBranding);
  } else {
    loadBranding();
  }
})();
