/**
 * Polyfill: crypto.randomUUID（iOS 15.4+ / Chrome 92+ 才原生支援）
 * 在較舊瀏覽器掛 polyfill，確保 idempotency UUID 仍能產生
 */
(function () {
  if (window.crypto && typeof window.crypto.randomUUID === 'function') return;
  const cryptoObj = window.crypto || window.msCrypto || {};
  cryptoObj.randomUUID = function () {
    // RFC 4122 v4 UUID
    const rand = cryptoObj.getRandomValues
      ? () => {
          const buf = new Uint8Array(16);
          cryptoObj.getRandomValues(buf);
          return buf;
        }
      : () => {
          const buf = new Uint8Array(16);
          for (let i = 0; i < 16; i++) buf[i] = Math.floor(Math.random() * 256);
          return buf;
        };
    const b = rand();
    b[6] = (b[6] & 0x0f) | 0x40;  // version 4
    b[8] = (b[8] & 0x3f) | 0x80;  // variant
    const h = i => b[i].toString(16).padStart(2, '0');
    return `${h(0)}${h(1)}${h(2)}${h(3)}-${h(4)}${h(5)}-${h(6)}${h(7)}-${h(8)}${h(9)}-${h(10)}${h(11)}${h(12)}${h(13)}${h(14)}${h(15)}`;
  };
  window.crypto = cryptoObj;
})();

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

  function buildUrl(params, cacheBust) {
    const entries = Object.entries(params)
      .filter(([, v]) => v !== undefined && v !== null && v !== '')
    // Apps Script Web App 會經過轉址；部分行動瀏覽器/代理可能把轉址後的
    // 404 快取在固定 URL。每次 GET 使用新的查詢參數，避免沿用錯誤回應。
    if (cacheBust) {
      entries.push(['_cb', `${Date.now()}-${Math.random().toString(36).slice(2)}`]);
    }
    const qs = entries
      .map(([k, v]) => encodeURIComponent(k) + '=' + encodeURIComponent(v))
      .join('&');
    return C.API_BASE + (qs ? '?' + qs : '');
  }

  async function apiGet(params) {
    ensureConfigured(false);
    let lastError = null;
    // Apps Script occasionally returns a cached redirect/404 or an HTML error
    // page even though the endpoint is healthy. Retry with a fresh URL.
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const res = await fetch(buildUrl(params, true), {
          method: 'GET',
          cache: 'no-store',
        });
        if (!res.ok) {
          lastError = new Error('HTTP ' + res.status);
        } else {
          try {
            return await res.json();
          } catch (parseError) {
            lastError = new Error('後端回應格式錯誤');
            lastError.cause = parseError;
          }
        }
      } catch (error) {
        lastError = error;
      }
      if (attempt < 2) {
        await new Promise(resolve => setTimeout(resolve, 300 * (attempt + 1)));
      }
    }
    throw lastError || new Error('GET 失敗');
  }

  async function apiPost(payload, options) {
    options = options || {};
    ensureConfigured(true);
    const body = JSON.stringify(Object.assign({ apiToken: C.API_TOKEN }, payload));
    // 5MB 上限（含多張異常照片）；和後端 Config.gs MAX_PAYLOAD_BYTES 一致
    if (body.length > 5 * 1024 * 1024) {
      throw new Error('資料太大（>5MB），請減少照片張數或縮小簽名');
    }
    const timeoutMs = Number(options.timeoutMs || 0);
    const controller = timeoutMs > 0 && typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timeout = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
    let res;
    try {
      res = await fetch(C.API_BASE, {
        method: 'POST',
        // 明示 text/plain 避免觸發 Apps Script 不支援的 CORS preflight
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body,
        signal: controller ? controller.signal : undefined,
      });
    } catch (error) {
      if (error && error.name === 'AbortError') throw new Error('連線逾時，請稍後重試');
      throw error;
    } finally {
      if (timeout) clearTimeout(timeout);
    }
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return res.json();
  }

  window.API = {
    listEquipments: () => apiGet({ api: 'equipments' }),
    getFormMeta: (form, eqp) => apiGet({ api: 'meta', form, eqp }),
    getLockedItems: (form, eqp) => apiGet({ api: 'lockedItems', form, eqp }),
    getApproval: (recordId, token) => apiGet({ api: 'approval', recordId, token }),
    getDailyWorkMeta: () => apiGet({ api: 'dailyWorkMeta' }),
    dailyIncidentPeople: () => {
      ensureConfigured(true);
      return apiGet({ api: 'dailyIncidentPeople', token: C.API_TOKEN });
    },
    submit: (payload) => apiPost(payload),
    submitDailyIncident: (payload) => apiPost(Object.assign({ action: 'submitDailyIncident' }, payload)),
    submitDailyWorkCheck: (payload) => apiPost(Object.assign({ action: 'submitDailyWorkCheck' }, payload)),
    adminDashboardStatus: (adminToken) => apiPost(
      { action: 'adminDashboardStatus', adminToken },
      { timeoutMs: 45000 }
    ),
    approveRecord: (payload) => apiPost(Object.assign({ action: 'approveRecord' }, payload)),
    health: () => apiGet({ api: 'health' }),
    branding: () => apiGet({ api: 'branding' }),
  };

  // 結果代號中文標籤（按鈕顯示用，傳回後端仍是原代號以維持 PDF 一致性）
  window.RESULT_LABELS = {
    // daily 天車（V good / 無此項 / 不良）
    'V': '良好',  '/': '無此項',  'X': '不良',
    // daily 堆高機
    '○': '良好',  '△': '尚可',
    // monthly 堆高機 simple
    'ˇ': '良好',
    // monthly 天車 crane_full
    'normal': '正常',  'abnormal': '異常',
  };
  window.resultLabel = function(code) {
    const zh = window.RESULT_LABELS[code];
    return zh ? `${zh}\n${code}` : code;
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
