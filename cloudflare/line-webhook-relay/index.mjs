// LINE Webhook 前置層：先回 200 並顯示轉圈，再把原始事件交給 Apps Script。
// 這裡只呼叫 chat/loading/start，不送任何訊息；回覆仍由 Apps Script 用 reply 送出，不占訊息額度。

const LINE_LOADING_URL = 'https://api.line.me/v2/bot/chat/loading/start';
// LINE 以最後一次請求的秒數為準，Apps Script 起動後會改送 20 秒；回覆一到，轉圈就會消失。
const LOADING_SECONDS = 30;
// Apps Script 的固定錯誤碼才寫進 log；其他文字可能含資料，一律記成 rejected。
const SAFE_ERROR_CODE = /^[a-z_]{1,64}$/;
// Workers 回應後約 30 秒就會中止背景工作，先逾時才留得下紀錄；只代表等太久，Apps Script 可能仍會跑完。
const GAS_TIMEOUT_MS = 25000;

async function isValidSignature(body, signature, channelSecret) {
  if (!signature) return false;
  let expected;
  try {
    expected = Uint8Array.from(atob(signature), (c) => c.charCodeAt(0));
  } catch (_) {
    return false;
  }
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(channelSecret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['verify'],
  );
  return crypto.subtle.verify('HMAC', key, expected, body);
}

// 只挑 Apps Script 正常流程會回覆的事件，否則轉圈會空等到逾時。
function loadingUserIds(events) {
  const ids = new Set();
  for (const ev of events) {
    const source = ev.source || {};
    const isText = ev.type === 'message' && ev.message && ev.message.type === 'text';
    if (source.type === 'user' && source.userId && (isText || ev.type === 'postback')) {
      ids.add(source.userId);
    }
  }
  return [...ids];
}

// 以下兩個函式回傳可安全寫入 log 的失敗原因，成功時回傳空字串。
async function startLoading(chatId, env) {
  const res = await fetch(LINE_LOADING_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'Bearer ' + env.LINE_CHANNEL_ACCESS_TOKEN,
    },
    body: JSON.stringify({ chatId, loadingSeconds: LOADING_SECONDS }),
  });
  return res.ok ? '' : 'HTTP ' + res.status;
}

async function forwardToGas(body, env) {
  const signal = AbortSignal.timeout(GAS_TIMEOUT_MS);
  // 手動處理轉址：自動跟隨遇到 307/308 會重送 POST，重跑指令可能多耗 push 額度。
  let res = await fetch(env.GAS_WEBHOOK_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body,
    redirect: 'manual',
    signal,
  });
  let prefix = 'HTTP ';
  // 307/308 語意是請重送，GET 拿到的不是 doPost 的結果，因此視為失敗。
  if ([301, 302, 303].includes(res.status)) {
    const location = res.headers.get('location');
    if (!location) return 'HTTP ' + res.status;
    res = await fetch(location, { signal });
    prefix = 'result HTTP ';
  }
  if (!res.ok) return prefix + res.status;

  // 網址或 token 失效時可能回登入頁或 ok:false。processed 只有 webhook 回應才有，可排除 doGet。
  const text = await res.text();
  let result;
  try {
    result = JSON.parse(text);
  } catch (_) {
    return 'not_json';
  }
  if (result && result.ok === true && typeof result.processed === 'number') return '';
  const code = result && result.error;
  return typeof code === 'string' && SAFE_ERROR_CODE.test(code) ? code : 'rejected';
}

// 不輸出 err.message：fetch 的錯誤訊息可能帶出含 token 的網址。
async function reportFailure(label, task) {
  try {
    const failure = await task;
    if (failure) console.error('[relay] ' + label + ' ' + failure);
  } catch (err) {
    console.error('[relay] ' + label + ' ' + err.name);
  }
}

// ponytail: 轉送失敗只記錄不重試，避免指令重複執行；要保證送達時再改接 Queues。
async function relay(body, userIds, env) {
  await Promise.all([
    ...userIds.map((id) => reportFailure('loading', startLoading(id, env))),
    reportFailure('gas', forwardToGas(body, env)),
  ]);
}

export default {
  async fetch(request, env, ctx) {
    if (request.method !== 'POST') return new Response('Not Found', { status: 404 });
    if (!env.LINE_CHANNEL_SECRET || !env.LINE_CHANNEL_ACCESS_TOKEN || !env.GAS_WEBHOOK_URL) {
      return new Response('Not Configured', { status: 500 });
    }

    const body = await request.arrayBuffer();
    const signature = request.headers.get('x-line-signature');
    if (!(await isValidSignature(body, signature, env.LINE_CHANNEL_SECRET))) {
      return new Response('Unauthorized', { status: 401 });
    }

    let events;
    try {
      events = JSON.parse(new TextDecoder().decode(body)).events;
    } catch (_) {
      return new Response('Bad Request', { status: 400 });
    }

    // LINE 後台的 Verify 會送空事件，不需要叫醒 Apps Script。
    if (Array.isArray(events) && events.length > 0) {
      ctx.waitUntil(relay(body, loadingUserIds(events), env));
    }
    return new Response('OK');
  },
};
