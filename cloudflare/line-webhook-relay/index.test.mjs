import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { afterEach, beforeEach, test } from 'node:test';
import worker from './index.mjs';

const GAS_URL = 'https://script.example/exec?lineWebhookToken=secret-token';
const RESULT_URL = 'https://script.example/echo?id=result';
const LOADING_URL = 'https://api.line.me/v2/bot/chat/loading/start';
const env = {
  LINE_CHANNEL_SECRET: 'channel-secret',
  LINE_CHANNEL_ACCESS_TOKEN: 'access-token',
  GAS_WEBHOOK_URL: GAS_URL,
};

const gasJson = (value) => new Response(JSON.stringify(value), {
  status: 200,
  headers: { 'Content-Type': 'application/json' },
});

const redirectTo = (location, status = 302) => new Response(null, {
  status,
  headers: location ? { Location: location } : {},
});

const realFetch = globalThis.fetch;
const realError = console.error;
let calls;
let logs;
let gasResponse;
let resultResponse;

// 模擬 Apps Script：POST 跑完 doPost 回 302，再由轉址網址取得結果。
function gasFetchStub() {
  return async (url, init) => {
    calls.push({ url, init });
    if (url === GAS_URL) return gasResponse();
    if (url === RESULT_URL) return resultResponse();
    return new Response('', { status: 200 });
  };
}

beforeEach(() => {
  calls = [];
  logs = [];
  gasResponse = () => redirectTo(RESULT_URL);
  resultResponse = () => gasJson({ ok: true, processed: 1 });
  globalThis.fetch = gasFetchStub();
  console.error = (message) => logs.push(message);
});

afterEach(() => {
  globalThis.fetch = realFetch;
  console.error = realError;
});

function buildRequest(payload, secret = env.LINE_CHANNEL_SECRET) {
  const body = typeof payload === 'string' ? payload : JSON.stringify(payload);
  const signature = createHmac('sha256', secret).update(body).digest('base64');
  return new Request('https://relay.example/', {
    method: 'POST',
    headers: { 'x-line-signature': signature },
    body,
  });
}

function buildCtx() {
  const pending = [];
  return { pending, waitUntil: (promise) => pending.push(promise) };
}

async function runRelay(payload) {
  const ctx = buildCtx();
  const res = await worker.fetch(buildRequest(payload), env, ctx);
  await Promise.all(ctx.pending);
  return res;
}

const textEvent = (userId, sourceType = 'user') => ({
  type: 'message',
  message: { type: 'text', text: '狀態' },
  replyToken: 'reply-token',
  source: { type: sourceType, userId },
});

test('簽章錯誤時拒絕且不呼叫任何外部服務', async () => {
  // Arrange
  const request = buildRequest({ events: [textEvent('U1')] }, 'wrong-secret');
  const ctx = buildCtx();

  // Act
  const res = await worker.fetch(request, env, ctx);

  // Assert
  assert.equal(res.status, 401);
  assert.equal(ctx.pending.length, 0);
  assert.equal(calls.length, 0);
});

for (const [name, headers] of [
  ['缺少簽章', {}],
  ['簽章不是 base64', { 'x-line-signature': '!!!not-base64!!!' }],
]) {
  test(name + '時拒絕', async () => {
    // Arrange
    const request = new Request('https://relay.example/', {
      method: 'POST',
      headers,
      body: JSON.stringify({ events: [textEvent('U1')] }),
    });

    // Act
    const res = await worker.fetch(request, env, buildCtx());

    // Assert
    assert.equal(res.status, 401);
    assert.equal(calls.length, 0);
  });
}

test('非 POST 回 404', async () => {
  // Arrange
  const request = new Request('https://relay.example/');

  // Act
  const res = await worker.fetch(request, env, buildCtx());

  // Assert
  assert.equal(res.status, 404);
  assert.equal(calls.length, 0);
});

for (const key of ['LINE_CHANNEL_SECRET', 'LINE_CHANNEL_ACCESS_TOKEN', 'GAS_WEBHOOK_URL']) {
  test('缺少 ' + key + ' 時拒絕處理', async () => {
    // Arrange
    const request = buildRequest({ events: [textEvent('U1')] });

    // Act
    const res = await worker.fetch(request, { ...env, [key]: '' }, buildCtx());

    // Assert
    assert.equal(res.status, 500);
    assert.equal(calls.length, 0);
  });
}

test('Apps Script 還沒回應時就先回 200 並已送出轉圈', async () => {
  // Arrange
  let finishGas;
  globalThis.fetch = (url, init) => {
    calls.push({ url, init });
    if (url === GAS_URL) {
      return new Promise((resolve) => {
        finishGas = () => resolve(redirectTo(RESULT_URL));
      });
    }
    if (url === RESULT_URL) return Promise.resolve(gasJson({ ok: true, processed: 1 }));
    return Promise.resolve(new Response('', { status: 200 }));
  };
  const ctx = buildCtx();

  // Act
  const res = await worker.fetch(buildRequest({ events: [textEvent('U1')] }), env, ctx);

  // Assert
  assert.equal(res.status, 200);
  assert.ok(calls.some((call) => call.url === LOADING_URL));
  assert.equal(typeof finishGas, 'function');
  finishGas();
  await Promise.all(ctx.pending);
  assert.deepEqual(logs, []);
});

test('轉圈請求帶正確的方法、憑證與秒數', async () => {
  // Arrange & Act
  await runRelay({ events: [textEvent('U1')] });

  // Assert
  const call = calls.find((item) => item.url === LOADING_URL);
  assert.equal(call.init.method, 'POST');
  assert.equal(call.init.headers.Authorization, 'Bearer access-token');
  assert.equal(call.init.headers['Content-Type'], 'application/json');
  assert.deepEqual(JSON.parse(call.init.body), { chatId: 'U1', loadingSeconds: 30 });
});

test('原始內容逐位元以 POST 轉給 Apps Script，並標明 UTF-8', async () => {
  // Arrange
  const raw = '{"destination":"Ux","events":[ {"type":"message","message":{"type":"text","text":"幫助"},"source":{"type":"user","userId":"U1"}} ]}';

  // Act
  await runRelay(raw);

  // Assert
  const gasCall = calls.find((call) => call.url === GAS_URL);
  assert.equal(gasCall.init.method, 'POST');
  assert.equal(new TextDecoder().decode(gasCall.init.body), raw);
  assert.equal(gasCall.init.headers['Content-Type'], 'application/json; charset=utf-8');
  assert.ok(gasCall.init.signal instanceof AbortSignal);
});

test('額度防線：只會呼叫轉圈與 Apps Script，絕不呼叫 LINE 訊息 API', async () => {
  // Arrange
  const events = [textEvent('U1'), { type: 'postback', replyToken: 'r2', source: { type: 'user', userId: 'U2' } }];

  // Act
  await runRelay({ events });

  // Assert
  assert.deepEqual(
    [...new Set(calls.map((call) => call.url))].sort(),
    [GAS_URL, LOADING_URL, RESULT_URL].sort(),
  );
  assert.ok(!calls.some((call) => call.url.includes('/message/')));
  assert.equal(calls.filter((call) => call.url === GAS_URL).length, 1);
});

for (const status of [301, 302, 303]) {
  test('額度防線：' + status + ' 轉址只取結果，絕不重送 POST', async () => {
    // Arrange
    gasResponse = () => redirectTo(RESULT_URL, status);

    // Act
    await runRelay({ events: [textEvent('U1')] });

    // Assert
    const gasCall = calls.find((call) => call.url === GAS_URL);
    const resultCalls = calls.filter((call) => call.url === RESULT_URL);
    assert.equal(gasCall.init.redirect, 'manual');
    assert.equal(calls.filter((call) => call.url === GAS_URL).length, 1);
    assert.equal(resultCalls.length, 1);
    assert.equal(resultCalls[0].init.method, undefined);
    assert.equal(resultCalls[0].init.body, undefined);
    assert.equal(resultCalls[0].init.redirect, undefined);
    assert.equal(resultCalls[0].init.signal, gasCall.init.signal);
    assert.deepEqual(logs, []);
  });
}

for (const status of [307, 308]) {
  test('額度防線：' + status + ' 視為失敗，不重送也不取結果', async () => {
    // Arrange
    gasResponse = () => redirectTo(RESULT_URL, status);

    // Act
    await runRelay({ events: [textEvent('U1')] });

    // Assert
    assert.equal(calls.filter((call) => call.url === GAS_URL).length, 1);
    assert.equal(calls.filter((call) => call.url === RESULT_URL).length, 0);
    assert.deepEqual(logs, ['[relay] gas HTTP ' + status]);
  });
}

test('逾時短於 Workers 約 30 秒的背景工作上限', async () => {
  // Arrange
  const realTimeout = AbortSignal.timeout;
  const seen = [];
  AbortSignal.timeout = (ms) => {
    seen.push(ms);
    return realTimeout.call(AbortSignal, ms);
  };

  // Act
  try {
    await runRelay({ events: [textEvent('U1')] });
  } finally {
    AbortSignal.timeout = realTimeout;
  }

  // Assert
  assert.equal(seen.length, 1);
  assert.ok(seen[0] > 0 && seen[0] < 30000);
});

test('只替一對一的文字與 postback 轉圈，同一人只送一次', async () => {
  // Arrange
  const events = [
    textEvent('U1'),
    textEvent('U1'),
    { type: 'postback', source: { type: 'user', userId: 'U2' } },
    textEvent('U3', 'group'),
    { type: 'message', message: { type: 'image' }, source: { type: 'user', userId: 'U4' } },
    { type: 'follow', source: { type: 'user', userId: 'U5' } },
  ];

  // Act
  await runRelay({ events });

  // Assert
  const loadingChats = calls
    .filter((call) => call.url === LOADING_URL)
    .map((call) => JSON.parse(call.init.body).chatId);
  assert.deepEqual(loadingChats, ['U1', 'U2']);
  assert.equal(calls.filter((call) => call.url === GAS_URL).length, 1);
});

for (const [name, event] of [
  ['加好友', { type: 'follow', replyToken: 'r', source: { type: 'user', userId: 'U1' } }],
  ['群組指令', textEvent('U1', 'group')],
]) {
  test('不轉圈的' + name + '事件仍要轉給 Apps Script', async () => {
    // Arrange & Act
    await runRelay({ events: [event] });

    // Assert
    assert.deepEqual(calls.map((call) => call.url), [GAS_URL, RESULT_URL]);
  });
}

test('LINE Verify 的空事件回 200，不叫醒 Apps Script', async () => {
  // Arrange
  const ctx = buildCtx();

  // Act
  const res = await worker.fetch(buildRequest({ destination: 'Ux', events: [] }), env, ctx);

  // Assert
  assert.equal(res.status, 200);
  assert.equal(ctx.pending.length, 0);
  assert.equal(calls.length, 0);
});

test('內容不是合法 JSON 時回 400', async () => {
  // Arrange
  const ctx = buildCtx();

  // Act
  const res = await worker.fetch(buildRequest('not-json'), env, ctx);

  // Assert
  assert.equal(res.status, 400);
  assert.equal(calls.length, 0);
});

for (const [name, response, expected] of [
  ['token 不符', () => gasJson({ ok: false, error: 'invalid_webhook_token' }), '[relay] gas invalid_webhook_token'],
  ['導向登入頁', () => new Response('<html>登入</html>', { status: 200 }), '[relay] gas not_json'],
  ['結果網址 HTTP 403', () => new Response('', { status: 403 }), '[relay] gas result HTTP 403'],
  ['非固定錯誤碼', () => gasJson({ ok: false, error: '王小明 查詢失敗' }), '[relay] gas rejected'],
  ['錯誤碼夾帶文字', () => gasJson({ ok: false, error: 'user abc failed' }), '[relay] gas rejected'],
  ['回應是 doGet 的形狀', () => gasJson({ ok: true, name: 'auto-checklist-api' }), '[relay] gas rejected'],
  ['回傳 null', () => gasJson(null), '[relay] gas rejected'],
  ['只有 ok:false', () => gasJson({ ok: false }), '[relay] gas rejected'],
  ['回傳空物件', () => gasJson({}), '[relay] gas rejected'],
  ['回傳陣列', () => gasJson([]), '[relay] gas rejected'],
  ['回傳數字', () => gasJson(1), '[relay] gas rejected'],
  ['error 為 null', () => gasJson({ ok: false, error: null }), '[relay] gas rejected'],
  ['ok 是字串', () => gasJson({ ok: 'true', processed: 1 }), '[relay] gas rejected'],
  ['缺少 ok', () => gasJson({ processed: 1 }), '[relay] gas rejected'],
  ['error 是陣列', () => gasJson({ ok: false, error: ['abc'] }), '[relay] gas rejected'],
]) {
  test('Apps Script ' + name + '時要留下紀錄', async () => {
    // Arrange
    resultResponse = response;

    // Act
    const res = await runRelay({ events: [textEvent('U-private')] });

    // Assert
    assert.equal(res.status, 200);
    assert.deepEqual(logs, [expected]);
  });
}

for (const [name, response, expected, resultCalled] of [
  ['直接回 HTTP 500', () => new Response('', { status: 500 }), '[relay] gas HTTP 500', 0],
  ['轉址沒有 Location', () => redirectTo(''), '[relay] gas HTTP 302', 0],
]) {
  test('Apps Script ' + name + '時要留下紀錄', async () => {
    // Arrange
    gasResponse = response;

    // Act
    await runRelay({ events: [textEvent('U1')] });

    // Assert
    assert.deepEqual(logs, [expected]);
    assert.equal(calls.filter((call) => call.url === RESULT_URL).length, resultCalled);
  });
}

test('Apps Script 不轉址直接回成功時不留紀錄', async () => {
  // Arrange
  gasResponse = () => gasJson({ ok: true, processed: 1 });

  // Act
  await runRelay({ events: [textEvent('U1')] });

  // Assert
  assert.deepEqual(logs, []);
  assert.equal(calls.filter((call) => call.url === RESULT_URL).length, 0);
});

test('Apps Script 逾時要留下 TimeoutError', async () => {
  // Arrange
  gasResponse = () => {
    throw new DOMException('timed out', 'TimeoutError');
  };

  // Act
  await runRelay({ events: [textEvent('U1')] });

  // Assert
  assert.deepEqual(logs, ['[relay] gas TimeoutError']);
});

test('讀取結果內容時逾時也記 TimeoutError，不誤標成 not_json', async () => {
  // Arrange
  resultResponse = () => new Response(new ReadableStream({
    start(controller) {
      controller.error(new DOMException('timed out', 'TimeoutError'));
    },
  }));

  // Act
  await runRelay({ events: [textEvent('U1')] });

  // Assert
  assert.deepEqual(logs, ['[relay] gas TimeoutError']);
});

test('轉圈失敗不影響轉送', async () => {
  // Arrange
  const stub = gasFetchStub();
  globalThis.fetch = async (url, init) => {
    const res = await stub(url, init);
    return url === LOADING_URL ? new Response('', { status: 429 }) : res;
  };

  // Act
  await runRelay({ events: [textEvent('U-private')] });

  // Assert
  assert.ok(calls.some((call) => call.url === GAS_URL));
  assert.deepEqual(logs, ['[relay] loading HTTP 429']);
});

test('fetch 拋例外時只記錯誤類型，不外洩 token 與使用者 ID', async () => {
  // Arrange
  globalThis.fetch = async (url) => {
    throw new TypeError('Fetch API cannot load: ' + url + ' U-private');
  };

  // Act
  await runRelay({ events: [textEvent('U-private')] });

  // Assert
  assert.deepEqual(logs.sort(), ['[relay] gas TypeError', '[relay] loading TypeError']);
  assert.ok(!logs.join().includes('secret-token'));
  assert.ok(!logs.join().includes('U-private'));
});
