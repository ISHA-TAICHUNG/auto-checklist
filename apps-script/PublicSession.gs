/**
 * 公開前端短效票證。
 *
 * GitHub Pages 不保存任何共享密鑰。每次公開讀取受限資料或送出表單前，
 * 先向後端取得綁定單一 action 的短效票證；票證首次驗證後立即失效。
 * 這不是使用者身分驗證，但可撤銷曾公開的長效共享 token，並縮小重放範圍。
 */

const PUBLIC_SESSION_TTL_SECONDS = 10 * 60;
const PUBLIC_SESSION_USED_PREFIX = 'public-session-used:';
const PUBLIC_SESSION_ALLOWED_SCOPES = [
  'dailyIncidentPeople',
  'submitChecklist',
  'approveRecord',
  'submitDailyIncident',
  'updateDailyIncident',
  'submitDailyIncidentForApproval',
  'approveDailyIncident',
  'commentDailyIncident',
  'submitDailyWorkCheck',
];

function normalizePublicSessionScope_(scope) {
  const normalized = String(scope || '').trim();
  if (PUBLIC_SESSION_ALLOWED_SCOPES.indexOf(normalized) < 0) {
    throw new Error('不支援的公開操作');
  }
  return normalized;
}

function publicSessionSigningKey_() {
  const key = String((CONFIG && CONFIG.API_TOKEN) || '').trim();
  if (!key || key.indexOf('REPLACE_') === 0 || key.length < 32) {
    throw new Error('系統設定不完整');
  }
  return key;
}

function publicSessionBase64_(value) {
  return Utilities.base64EncodeWebSafe(
    String(value || ''),
    Utilities.Charset.UTF_8,
  );
}

function publicSessionSignature_(encodedPayload) {
  return Utilities.base64EncodeWebSafe(
    Utilities.computeHmacSha256Signature(
      String(encodedPayload || ''),
      publicSessionSigningKey_(),
      Utilities.Charset.UTF_8,
    ),
  );
}

function publicSessionSafeEqual_(left, right) {
  const a = String(left || '');
  const b = String(right || '');
  if (!a || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function publicSessionUsedKey_(nonce) {
  return PUBLIC_SESSION_USED_PREFIX + sha256Hex_(String(nonce || ''));
}

function issuePublicSession_(scope) {
  const normalizedScope = normalizePublicSessionScope_(scope);
  const nonce = Utilities.getUuid() + '-' + Utilities.getUuid();
  const expiresAt = Date.now() + PUBLIC_SESSION_TTL_SECONDS * 1000;
  const encodedPayload = publicSessionBase64_(JSON.stringify({
    nonce,
    scope: normalizedScope,
    expiresAt,
  }));
  const token = encodedPayload + '.' + publicSessionSignature_(encodedPayload);
  return {
    ok: true,
    publicSessionToken: token,
    scope: normalizedScope,
    expiresAt: new Date(expiresAt).toISOString(),
  };
}

function consumePublicSession_(token, expectedScope) {
  const candidate = String(token || '').trim();
  const scope = normalizePublicSessionScope_(expectedScope);
  if (!candidate || candidate.length < 60) return false;

  const parts = candidate.split('.');
  if (parts.length !== 2 || !publicSessionSafeEqual_(parts[1], publicSessionSignature_(parts[0]))) {
    return false;
  }

  let stored;
  try {
    stored = JSON.parse(
      Utilities.newBlob(Utilities.base64DecodeWebSafe(parts[0])).getDataAsString(),
    );
  } catch (_) {
    return false;
  }
  const expiresAt = Number(stored && stored.expiresAt || 0);
  if (!stored || stored.scope !== scope || !stored.nonce || expiresAt < Date.now()) {
    return false;
  }

  const lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) throw new Error('系統忙碌，請稍後再試');
  try {
    const cache = CacheService.getScriptCache();
    const key = publicSessionUsedKey_(stored.nonce);
    if (cache.get(key)) return false;
    const remainingSeconds = Math.max(1, Math.ceil((expiresAt - Date.now()) / 1000));
    cache.put(key, '1', remainingSeconds);
    return true;
  } finally {
    lock.releaseLock();
  }
}

function publicSubmissionScope_(payload) {
  return String((payload && payload.action) || 'submitChecklist');
}

function requirePublicSession_(payload) {
  const scope = publicSubmissionScope_(payload);
  const token = payload && payload.publicSessionToken;
  if (!consumePublicSession_(token, scope)) {
    throw new Error('操作票證無效或已逾時，請重新送出');
  }
  delete payload.publicSessionToken;
  delete payload.apiToken;
}
