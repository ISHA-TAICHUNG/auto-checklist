/**
 * ===== LINE Bot 通知模組 =====
 *
 * 取代既有的 MailApp 寄信通知，改用 LINE Messaging API。
 *
 * 配置（在 GAS Script Properties 設定，不寫進 source code）：
 *   - LINE_CHANNEL_ACCESS_TOKEN  (必填) Channel 長期 access token
 *   - LINE_CHANNEL_SECRET        (選填) Webhook 簽章驗證用
 *   - 一般公告通知收件者：DB「訂閱者清單」的 LINE_USER_ID
 *   - 主管通知收件者：DB「訂閱者清單」中「是否為主管」= 是
 *   - LINE_TARGET_GROUP_ID / LINE_TARGET_USER_IDS 僅保留為舊設定診斷欄位，不主導公告通知
 *   - LINE_ADMIN_USER_IDS        (選填) 管理者 userId（升級通知用）
 *
 * 公開函式：
 *   - sendReminder_(category, equipments, webFrontendUrl)  取代 sendUnfilledReminder_
 *   - sendIncidentAlert_(incident)                          異常即時通報
 *   - sendApprovalRequest_(record)                           主管待簽核通知
 *   - linePushTo_(target, messages)                         底層 push
 */

const LINE_API = 'https://api.line.me/v2/bot';
const LINE_API_DATA = 'https://api-data.line.me/v2/bot';
const LINE_RICH_MENU_IMAGE_DEFAULT_URL = 'https://isha-taichung.github.io/auto-checklist/assets/line-rich-menu-main.png';

/**
 * 取得 LINE 配置（每次 fresh 讀 properties — 避免 warm start 拿到舊值）
 */
function getLineConfig_() {
  const p = PropertiesService.getScriptProperties();
  return {
    token: p.getProperty('LINE_CHANNEL_ACCESS_TOKEN') || '',
    secret: p.getProperty('LINE_CHANNEL_SECRET') || '',
    groupId: p.getProperty('LINE_TARGET_GROUP_ID') || '',
    userIds: (p.getProperty('LINE_TARGET_USER_IDS') || '').split(',').map(s => s.trim()).filter(Boolean),
    supervisorIds: (p.getProperty('SUPERVISOR_USER_IDS') || '').split(',').map(s => s.trim()).filter(Boolean),
    adminIds: (p.getProperty('LINE_ADMIN_USER_IDS') || '').split(',').map(s => s.trim()).filter(Boolean),
  };
}

function getLineSubscriberSheet_(ss) {
  return ss.getSheetByName('訂閱者清單') || ss.getSheetByName('主管清單');
}

function getLineSupervisorFlagColumnIndex_(headers) {
  const supervisorCol = headers.indexOf('是否為主管');
  if (supervisorCol >= 0) return supervisorCol;
  return headers.indexOf('是否啟用');
}

function getLineSubscriberActiveColumnIndex_(headers) {
  const candidates = ['是否訂閱', '是否啟用', '啟用'];
  for (const name of candidates) {
    const i = headers.indexOf(name);
    if (i >= 0) return i;
  }
  return -1;
}

function getLineSubscriberUserIds_(opts) {
  opts = opts || {};
  const cacheKey = 'lineSubscriberSheetUserIds:v2';
  if (!opts.forceRefresh) {
    try {
      const cached = CacheService.getScriptCache().get(cacheKey);
      if (cached) {
        const parsed = JSON.parse(cached);
        if (Array.isArray(parsed)) return parsed;
      }
    } catch (err) {
      Logger.log('[LINE] 訂閱者快取讀取失敗，改讀 DB: ' + err);
    }
  }

  const ids = [];
  try {
    if (CONFIG.DB_SHEET_ID && !CONFIG.DB_SHEET_ID.startsWith('REPLACE_')) {
      const sheet = getLineSubscriberSheet_(SpreadsheetApp.openById(CONFIG.DB_SHEET_ID));
      if (sheet && sheet.getLastRow() >= 2) {
        const data = sheet.getDataRange().getValues();
        const headers = data[0].map(h => String(h || '').trim());
        const idCol = headers.indexOf('LINE_USER_ID');
        const activeCol = getLineSubscriberActiveColumnIndex_(headers);
        if (idCol >= 0) {
          data.slice(1).forEach(row => {
            const id = String(row[idCol] || '').trim();
            const active = activeCol < 0 ? true : isActiveValue_(row[activeCol]);
            if (id && active) ids.push(id);
          });
        }
      }
    }
  } catch (err) {
    Logger.log('[LINE] 讀取訂閱者清單失敗: ' + err);
  }

  const uniqueIds = Array.from(new Set(ids.map(id => String(id || '').trim()).filter(Boolean)));
  try {
    CacheService.getScriptCache().put(cacheKey, JSON.stringify(uniqueIds), 120);
  } catch (err) {
    Logger.log('[LINE] 訂閱者快取寫入失敗: ' + err);
  }
  return uniqueIds;
}

function isLineSubscriberUser_(userId) {
  const id = String(userId || '').trim();
  if (!id) return false;
  if (getLineSubscriberUserIds_().indexOf(id) >= 0) return true;
  // 新同仁剛登錄時，120 秒快取可能尚未包含新 ID；沒命中就即時讀 DB 一次。
  return getLineSubscriberUserIds_({ forceRefresh: true }).indexOf(id) >= 0;
}

function getLineSubscriberProfileByUserId_(userId) {
  const id = String(userId || '').trim();
  if (!id) return null;
  try {
    if (!CONFIG.DB_SHEET_ID || CONFIG.DB_SHEET_ID.startsWith('REPLACE_')) return null;
    const sheet = getLineSubscriberSheet_(SpreadsheetApp.openById(CONFIG.DB_SHEET_ID));
    if (!sheet || sheet.getLastRow() < 2) return null;
    const data = sheet.getDataRange().getValues();
    const headers = data[0].map(h => String(h || '').trim());
    const nameCol = headers.indexOf('姓名');
    const idCol = headers.indexOf('LINE_USER_ID');
    const activeCol = getLineSubscriberActiveColumnIndex_(headers);
    const supervisorCol = getLineSupervisorFlagColumnIndex_(headers);
    const staffCol = headers.indexOf('是否為同仁');
    if (idCol < 0) return null;
    for (let i = 1; i < data.length; i++) {
      const rowId = String(data[i][idCol] || '').trim();
      const active = activeCol < 0 ? true : isActiveValue_(data[i][activeCol]);
      if (rowId !== id || !active) continue;
      return {
        name: nameCol >= 0 ? String(data[i][nameCol] || '').trim() : '',
        userId: rowId,
        isSupervisor: supervisorCol >= 0 ? isActiveValue_(data[i][supervisorCol]) : false,
        isStaff: staffCol >= 0 ? isActiveValue_(data[i][staffCol]) : false,
      };
    }
  } catch (err) {
    Logger.log('[LINE] 依 userId 讀取訂閱者資料失敗: ' + err);
  }
  return null;
}

function lineSubscriberPersonKeySalt_() {
  const props = PropertiesService.getScriptProperties();
  let salt = props.getProperty('LINE_SUBSCRIBER_PERSON_KEY_SALT') || '';
  if (!salt) {
    salt = uuid_() + '-' + uuid_();
    props.setProperty('LINE_SUBSCRIBER_PERSON_KEY_SALT', salt);
  }
  return salt;
}

function lineSubscriberPersonKey_(userId) {
  const id = String(userId || '').trim();
  if (!id) return '';
  return 'p_' + sha256Hex_(lineSubscriberPersonKeySalt_() + ':' + id).substring(0, 32);
}

function listLineSubscriberPeople_() {
  const people = [];
  try {
    if (!CONFIG.DB_SHEET_ID || CONFIG.DB_SHEET_ID.startsWith('REPLACE_')) return people;
    const sheet = getLineSubscriberSheet_(SpreadsheetApp.openById(CONFIG.DB_SHEET_ID));
    if (!sheet || sheet.getLastRow() < 2) return people;
    const data = sheet.getDataRange().getValues();
    const headers = data[0].map(h => String(h || '').trim());
    const nameCol = headers.indexOf('姓名');
    const idCol = headers.indexOf('LINE_USER_ID');
    const activeCol = getLineSubscriberActiveColumnIndex_(headers);
    const supervisorCol = getLineSupervisorFlagColumnIndex_(headers);
    const staffCol = headers.indexOf('是否為同仁');
    const noteCol = headers.indexOf('備註');
    if (nameCol < 0 || idCol < 0) return people;
    data.slice(1).forEach((row, index) => {
      const name = String(row[nameCol] || '').trim();
      const userId = String(row[idCol] || '').trim();
      const active = activeCol < 0 ? true : isActiveValue_(row[activeCol]);
      if (!name || !userId || !active) return;
      people.push({
        name,
        userId,
        key: lineSubscriberPersonKey_(userId),
        isSupervisor: supervisorCol >= 0 ? isActiveValue_(row[supervisorCol]) : false,
        isStaff: staffCol >= 0 ? isActiveValue_(row[staffCol]) : false,
        note: noteCol >= 0 ? String(row[noteCol] || '').trim() : '',
        rowNo: index + 2,
      });
    });
  } catch (err) {
    Logger.log('[LINE] 讀取訂閱者人員清單失敗: ' + err);
  }
  return people;
}

function publicLineSubscriberPeopleOptions_() {
  const people = listLineSubscriberPeople_();
  const byName = {};
  people.forEach(p => { byName[p.name] = (byName[p.name] || 0) + 1; });
  return people.map(p => {
    const label = byName[p.name] > 1 ? `${p.name}（第 ${p.rowNo} 列）` : p.name;
    return {
      key: p.key,
      name: p.name,
      label,
      isSupervisor: !!p.isSupervisor,
      isStaff: !!p.isStaff,
    };
  });
}

function findLineSubscriberPersonByKey_(personKey, opts) {
  opts = opts || {};
  const key = String(personKey || '').trim();
  if (!key) return null;
  const people = listLineSubscriberPeople_();
  for (const person of people) {
    if (person.key !== key) continue;
    if (opts.requireSupervisor && !person.isSupervisor) return null;
    if (opts.requireStaff && !(person.isStaff || person.isSupervisor)) return null;
    return person;
  }
  return null;
}

function findLineSubscriberTargetsByPersonKey_(personKey, opts) {
  const person = findLineSubscriberPersonByKey_(personKey, opts || {});
  if (!person || !person.userId) {
    return { ids: [], ambiguous: false, matchCount: 0, key: String(personKey || '').trim() };
  }
  return { ids: [person.userId], ambiguous: false, matchCount: 1, key: person.key, name: person.name };
}

function lineSubscriberPersonKeyMatchesUser_(personKey, userId) {
  const key = String(personKey || '').trim();
  const id = String(userId || '').trim();
  return !!key && !!id && key === lineSubscriberPersonKey_(id);
}

function findLineSubscriberTargetsByName_(targetName, opts) {
  opts = opts || {};
  const nameTarget = String(targetName || '').trim();
  if (!nameTarget) return { ids: [], ambiguous: false, matchCount: 0, name: nameTarget };
  try {
    if (!CONFIG.DB_SHEET_ID || CONFIG.DB_SHEET_ID.startsWith('REPLACE_')) {
      return { ids: [], ambiguous: false, matchCount: 0, name: nameTarget };
    }
    const sheet = getLineSubscriberSheet_(SpreadsheetApp.openById(CONFIG.DB_SHEET_ID));
    if (!sheet || sheet.getLastRow() < 2) return { ids: [], ambiguous: false, matchCount: 0, name: nameTarget };
    const data = sheet.getDataRange().getValues();
    const headers = data[0].map(h => String(h || '').trim());
    const nameCol = headers.indexOf('姓名');
    const idCol = headers.indexOf('LINE_USER_ID');
    const activeCol = getLineSubscriberActiveColumnIndex_(headers);
    const staffCol = headers.indexOf('是否為同仁');
    const supervisorCol = getLineSupervisorFlagColumnIndex_(headers);
    if (nameCol < 0 || idCol < 0) return { ids: [], ambiguous: false, matchCount: 0, name: nameTarget };
    const ids = [];
    data.slice(1).forEach(row => {
      const name = String(row[nameCol] || '').trim();
      const id = String(row[idCol] || '').trim();
      const active = activeCol < 0 ? true : isActiveValue_(row[activeCol]);
      const isSupervisor = supervisorCol >= 0 ? isActiveValue_(row[supervisorCol]) : false;
      const isStaff = staffCol >= 0 ? isActiveValue_(row[staffCol]) : false;
      const staffOk = !opts.requireStaff || isStaff || isSupervisor;
      const supervisorOk = !opts.requireSupervisor || isSupervisor;
      if (name === nameTarget && id && active && staffOk && supervisorOk) ids.push(id);
    });
    const uniqueIds = Array.from(new Set(ids));
    return {
      ids: uniqueIds,
      ambiguous: uniqueIds.length > 1,
      matchCount: uniqueIds.length,
      name: nameTarget,
    };
  } catch (err) {
    Logger.log('[LINE] 依姓名讀取訂閱者 LINE_USER_ID 失敗: ' + err);
    return { ids: [], ambiguous: false, matchCount: 0, name: nameTarget, error: String(err) };
  }
}

function getSupervisorUserIds_() {
  return getSupervisorUserIdsFromSheet_();
}

function getSupervisorUserIdsFromSheet_() {
  try {
    if (!CONFIG.DB_SHEET_ID || CONFIG.DB_SHEET_ID.startsWith('REPLACE_')) return [];
    const sheet = getLineSubscriberSheet_(SpreadsheetApp.openById(CONFIG.DB_SHEET_ID));
    if (!sheet || sheet.getLastRow() < 2) return [];
    const data = sheet.getDataRange().getValues();
    const headers = data[0].map(h => String(h || '').trim());
    const idCol = headers.indexOf('LINE_USER_ID');
    const activeCol = getLineSupervisorFlagColumnIndex_(headers);
    if (idCol < 0) return [];
    const ids = [];
    data.slice(1).forEach(row => {
      const id = String(row[idCol] || '').trim();
      const active = activeCol < 0 ? true : isActiveValue_(row[activeCol]);
      if (id && active) ids.push(id);
    });
    return Array.from(new Set(ids));
  } catch (err) {
    Logger.log('[LINE] 讀取訂閱者清單主管欄位失敗: ' + err);
    return [];
  }
}

function getSupervisorUserIdsByName_(supervisorName) {
  const target = String(supervisorName || '').trim();
  if (!target) return [];
  try {
    if (!CONFIG.DB_SHEET_ID || CONFIG.DB_SHEET_ID.startsWith('REPLACE_')) return [];
    const sheet = getLineSubscriberSheet_(SpreadsheetApp.openById(CONFIG.DB_SHEET_ID));
    if (!sheet || sheet.getLastRow() < 2) return [];
    const data = sheet.getDataRange().getValues();
    const headers = data[0].map(h => String(h || '').trim());
    const nameCol = headers.indexOf('姓名');
    const idCol = headers.indexOf('LINE_USER_ID');
    const activeCol = getLineSupervisorFlagColumnIndex_(headers);
    if (nameCol < 0 || idCol < 0) return [];
    const ids = [];
    data.slice(1).forEach(row => {
      const name = String(row[nameCol] || '').trim();
      const id = String(row[idCol] || '').trim();
      const active = activeCol < 0 ? true : isActiveValue_(row[activeCol]);
      if (id && active && name === target) ids.push(id);
    });
    return Array.from(new Set(ids));
  } catch (err) {
    Logger.log('[LINE] 依主管姓名讀取 LINE_USER_ID 失敗: ' + err);
    return [];
  }
}

function linePushToSupervisorName_(supervisorName, messages, opts) {
  opts = opts || {};
  const cfg = getLineConfig_();
  if (!cfg.token) return { ok: false, reason: 'no_token' };
  if (!Array.isArray(messages)) messages = [messages];
  let ids = [];
  let targetMode = 'named';
  if (opts.personKey) {
    const keyed = findLineSubscriberTargetsByPersonKey_(opts.personKey, { requireSupervisor: true });
    ids = keyed.ids || [];
    targetMode = 'keyed';
  }
  if (ids.length === 0) {
    ids = getSupervisorUserIdsByName_(supervisorName);
    targetMode = 'named';
  }
  if (ids.length > 1) {
    const res = lineMulticast_(ids, messages);
    return Object.assign({ targetMode, targetCount: ids.length, supervisorName }, res);
  }
  if (ids.length === 1) {
    const res = linePushTo_(ids[0], messages, 'push');
    return Object.assign({ targetMode, targetCount: 1, supervisorName }, res);
  }

  if (opts.allowFallback === true) {
  const fallbackIds = getSupervisorUserIds_();
  if (fallbackIds.length > 1) {
    const res = lineMulticast_(fallbackIds, messages);
    return Object.assign({ targetMode: 'fallback', targetCount: fallbackIds.length, supervisorName }, res);
  }
  if (fallbackIds.length === 1) {
    const res = linePushTo_(fallbackIds[0], messages, 'push');
    return Object.assign({ targetMode: 'fallback', targetCount: 1, supervisorName }, res);
  }
  }
  Logger.log('[LINE supervisor] 找不到指定主管 LINE_USER_ID，且無 fallback 主管: ' + supervisorName);
  return { ok: false, reason: 'supervisor_not_found', supervisorName, targetMode: 'none', targetCount: 0 };
}

function linePushToSupervisors_(messages) {
  const cfg = getLineConfig_();
  if (!cfg.token) {
    Logger.log('[LINE supervisor] LINE_CHANNEL_ACCESS_TOKEN 未設定，略過 push');
    return { ok: false, reason: 'no_token' };
  }
  if (!Array.isArray(messages)) messages = [messages];
  const supervisorIds = getSupervisorUserIds_();
  if (supervisorIds.length > 1) return lineMulticast_(supervisorIds, messages);
  if (supervisorIds.length === 1) return linePushTo_(supervisorIds[0], messages, 'push');
  Logger.log('[LINE supervisor] 無標記為主管的 LINE_USER_ID，略過主管通知');
  return { ok: false, reason: 'no_supervisor' };
}

function linePushDailyIncidentStakeholders_(incident, messages, opts) {
  opts = opts || {};
  const cfg = getLineConfig_();
  if (!cfg.token) {
    Logger.log('[LINE daily incident] LINE_CHANNEL_ACCESS_TOKEN 未設定，略過限定推播');
    return { ok: false, reason: 'no_token' };
  }
  if (!Array.isArray(messages)) messages = [messages];

  const keyedResults = [
    incident && incident.ownerKey,
    incident && incident.reporterKey,
  ].map(key => findLineSubscriberTargetsByPersonKey_(key, { requireStaff: opts.requireStaff === true }))
    .filter(result => result.ids.length === 1);
  const keyedNames = keyedResults.map(result => String(result.name || '').trim()).filter(Boolean);
  const stakeholderNames = Array.from(new Set([
    incident && incident.owner,
    incident && incident.reporter,
  ].map(v => String(v || '').trim()).filter(Boolean)))
    .filter(name => keyedNames.indexOf(name) < 0);
  const ownerResults = stakeholderNames.map(name =>
    findLineSubscriberTargetsByName_(name, { requireStaff: opts.requireStaff === true })
  );
  let supervisorResults = [];
  let supervisorFallbackIds = [];
  if (opts.includeSupervisor !== false && opts.includeSupervisors !== false) {
    if (incident && incident.supervisorKey) {
      supervisorResults = [findLineSubscriberTargetsByPersonKey_(incident.supervisorKey, { requireSupervisor: true })];
    } else if (incident && incident.supervisor) {
      supervisorResults = [findLineSubscriberTargetsByName_(incident.supervisor, { requireSupervisor: true })];
    } else if (opts.includeAllSupervisorsWhenNoSelected === true) {
      supervisorFallbackIds = getSupervisorUserIds_();
    }
  }
  const targetIds = [];
  const seen = {};

  keyedResults.forEach(result => {
    const id = result.ids[0];
    if (!id || seen[id]) return;
    targetIds.push(id);
    seen[id] = true;
  });
  ownerResults.forEach(result => {
    if (result.ambiguous) {
      Logger.log('[LINE daily incident] 訂閱者姓名重複，略過同仁限定推播: ' + result.name + ', matchCount=' + result.matchCount);
      return;
    }
    if (result.ids.length !== 1) return;
    const id = result.ids[0];
    if (!id || seen[id]) return;
    targetIds.push(id);
    seen[id] = true;
  });
  supervisorResults.forEach(result => {
    if (result.ambiguous) {
      Logger.log('[LINE daily incident] 主管姓名重複，略過主管限定推播: ' + result.name + ', matchCount=' + result.matchCount);
      return;
    }
    const id = result.ids.length === 1 ? String(result.ids[0] || '').trim() : '';
    if (!id || seen[id]) return;
    seen[id] = true;
    targetIds.push(id);
  });
  supervisorFallbackIds.forEach(id => {
    id = String(id || '').trim();
    if (!id || seen[id]) return;
    seen[id] = true;
    targetIds.push(id);
  });

  const anyOwnerAmbiguous = ownerResults.some(result => result.ambiguous);
  const anySupervisorAmbiguous = supervisorResults.some(result => result.ambiguous);
  const ownerMatchedCount = keyedResults.length + ownerResults.filter(result => !result.ambiguous && result.ids.length === 1).length;
  const supervisorMatchedCount = supervisorResults.filter(result => !result.ambiguous && result.ids.length === 1).length
    + supervisorFallbackIds.length;
  const ownerNames = stakeholderNames.join('、');

  if (targetIds.length === 0) {
    return {
      ok: false,
      reason: anyOwnerAmbiguous || anySupervisorAmbiguous ? 'ambiguous_recipient_line' : 'no_target',
      ownerReason: anyOwnerAmbiguous ? 'ambiguous_owner_line' : 'no_owner_line',
      ownerName: ownerNames,
      ownerMatchCount: ownerMatchedCount,
      supervisorCount: supervisorMatchedCount,
      targetMode: 'daily-incident-stakeholders',
      targetCount: 0,
    };
  }

  const res = targetIds.length > 1
    ? lineMulticast_(targetIds, messages)
    : linePushTo_(targetIds[0], messages, 'push');
  return Object.assign({
    targetMode: 'daily-incident-stakeholders',
    targetCount: targetIds.length,
    ownerName: ownerNames,
    ownerMatched: ownerMatchedCount > 0,
    ownerReason: anyOwnerAmbiguous ? 'ambiguous_owner_line' : (ownerMatchedCount > 0 ? '' : 'no_owner_line'),
    ownerMatchCount: ownerMatchedCount,
    supervisorCount: supervisorMatchedCount,
  }, res);
}

/**
 * 一般公告型 push：由 DB「訂閱者清單」控管
 *   - 有「是否訂閱」/「是否啟用」/「啟用」欄時，需為啟用值
 *   - 沒有啟用欄時，有 LINE_USER_ID 的列都視為訂閱者
 *   - 不再使用 LINE_TARGET_GROUP_ID / LINE_TARGET_USER_IDS 決定公告收件者
 */
function linePush_(messages) {
  const cfg = getLineConfig_();
  if (!cfg.token) {
    Logger.log('[LINE] LINE_CHANNEL_ACCESS_TOKEN 未設定，略過 push');
    return { ok: false, reason: 'no_token' };
  }
  if (!Array.isArray(messages)) messages = [messages];

  const subscriberIds = getLineSubscriberUserIds_();
  if (subscriberIds.length > 1) {
    const res = lineMulticast_(subscriberIds, messages);
    return Object.assign({ targetMode: 'subscriber-list', targetCount: subscriberIds.length }, res);
  }
  if (subscriberIds.length === 1) {
    const res = linePushTo_(subscriberIds[0], messages, 'push');
    return Object.assign({ targetMode: 'subscriber-list', targetCount: 1 }, res);
  }
  Logger.log('[LINE] 訂閱者清單沒有可推播的 LINE_USER_ID，略過公告通知');
  return { ok: false, reason: 'no_subscribers', targetMode: 'subscriber-list', targetCount: 0 };
}

/**
 * Push 給單一 target（user / group / room）
 * https://developers.line.biz/en/reference/messaging-api/#send-push-message
 */
function linePushTo_(to, messages, _action) {
  const cfg = getLineConfig_();
  const url = `${LINE_API}/message/push`;
  const payload = { to, messages };
  const res = UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: 'application/json',
    headers: { 'Authorization': 'Bearer ' + cfg.token },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true,
  });
  const code = res.getResponseCode();
  if (code !== 200) {
    Logger.log(`[LINE] push 失敗 code=${code} body=${res.getContentText()}`);
    return { ok: false, code, body: res.getContentText() };
  }
  return { ok: true };
}

/**
 * 觸發「正在輸入...」loading 動畫
 * 僅支援 1:1 私訊（group / room 不支援）
 * 不計入 LINE Messaging API 訊息額度；LINE API 支援 5-60 秒，本系統 UX 上限固定 20 秒。
 * https://developers.line.biz/en/reference/messaging-api/#display-a-loading-indicator
 */
function startLoadingAnimation_(chatId, seconds) {
  const cfg = getLineConfig_();
  if (!cfg.token || !chatId) return;
  // group/room ID 開頭非 U，不支援 loading
  if (!chatId.startsWith('U')) return;
  try {
    const loadingSeconds = Math.min(20, Math.max(5, seconds || 10));
    UrlFetchApp.fetch(`${LINE_API}/chat/loading/start`, {
      method: 'post',
      contentType: 'application/json',
      headers: { 'Authorization': 'Bearer ' + cfg.token },
      payload: JSON.stringify({ chatId, loadingSeconds }),
      muteHttpExceptions: true,
    });
  } catch (e) {
    Logger.log('[LINE loading] 失敗（忽略）: ' + e);
  }
}

/**
 * 常用指令 Quick Reply 按鈕（每個回覆訊息都附）
 */
function defaultQuickReply_() {
  return {
    items: [
      { type: 'action', action: { type: 'message', label: '📊 填表狀態',   text: '狀態' } },
      { type: 'action', action: { type: 'message', label: '📨 待發文',     text: '待發文' } },
      { type: 'action', action: { type: 'message', label: '🚨 設備異常',   text: '異常' } },
      { type: 'action', action: { type: 'message', label: '📝 日常通報',   text: '通報' } },
      { type: 'action', action: { type: 'message', label: '📌 日常待處理', text: '待處理' } },
      { type: 'action', action: { type: 'message', label: '📷 QR選單',     text: 'QR選單' } },
      { type: 'action', action: { type: 'message', label: '❓ 幫助',       text: '幫助' } },
    ],
  };
}

/**
 * 設備 QR 選單按鈕（點「QR 選單」後回的子按鈕）
 *
 * LINE Quick Reply 最多 13 個 items；設備 QR 選單需控制在上限內。
 */
function equipmentQuickReply_() {
  return {
    items: [
      { type: 'action', action: { type: 'message', label: '🏗 天車',      text: 'QR CRANE-LJ-001' } },
      { type: 'action', action: { type: 'message', label: '🚜 堆高機A',   text: 'QR FORK-LJ-A' } },
      { type: 'action', action: { type: 'message', label: '🚜 堆高機B',   text: 'QR FORK-LJ-B' } },
      { type: 'action', action: { type: 'message', label: '🚜 堆高機C',   text: 'QR FORK-LJ-C' } },
      { type: 'action', action: { type: 'message', label: '🚜 堆高機D',   text: 'QR FORK-LJ-D' } },
      { type: 'action', action: { type: 'message', label: '🚜 堆高機E',   text: 'QR FORK-LJ-E' } },
      { type: 'action', action: { type: 'message', label: '🚜 堆高機F',   text: 'QR FORK-LJ-F' } },
      { type: 'action', action: { type: 'message', label: '🦺 起重機防護具', text: 'QR VENUE-CRANE' } },
      { type: 'action', action: { type: 'message', label: '🦺 堆高機防護具', text: 'QR VENUE-FORK' } },
      { type: 'action', action: { type: 'message', label: '📋 龍井月檢',   text: 'QR CLASSROOM-LJ-MEAS-PPE' } },
      { type: 'action', action: { type: 'message', label: '📋 復興月檢',   text: 'QR CLASSROOM-FX-MEAS-PPE' } },
      { type: 'action', action: { type: 'message', label: '📋 忠明月檢',   text: 'QR CLASSROOM-ZM-MEAS-PPE' } },
      { type: 'action', action: { type: 'message', label: '🛞 高空車',      text: 'QR AWP-LJ-001' } },
    ],
  };
}

function qrMenuButton_(label, text) {
  return {
    type: 'button',
    style: 'secondary',
    height: 'sm',
    action: { type: 'message', label, text },
  };
}

function buildQrMenuBubble_(title, subtitle, color, buttons) {
  return {
    type: 'bubble',
    header: {
      type: 'box',
      layout: 'vertical',
      backgroundColor: color,
      paddingAll: 'md',
      contents: [
        { type: 'text', text: title, color: '#ffffff', weight: 'bold', size: 'lg', wrap: true },
        { type: 'text', text: subtitle, color: '#E8F0FE', size: 'xs', wrap: true },
      ],
    },
    body: {
      type: 'box',
      layout: 'vertical',
      spacing: 'sm',
      contents: buttons,
    },
  };
}

function buildQrMenuFlex_() {
  return {
    type: 'flex',
    altText: '📷 QR 選單',
    contents: {
      type: 'carousel',
      contents: [
        buildQrMenuBubble_('場地/機具日檢', '場地歸場地：作業前檢點表', '#1a73e8', [
          qrMenuButton_('天車', 'QR CRANE-LJ-001'),
          qrMenuButton_('堆高機 A', 'QR FORK-LJ-A'),
          qrMenuButton_('堆高機 B', 'QR FORK-LJ-B'),
          qrMenuButton_('堆高機 C', 'QR FORK-LJ-C'),
          qrMenuButton_('堆高機 D', 'QR FORK-LJ-D'),
          qrMenuButton_('堆高機 E', 'QR FORK-LJ-E'),
          qrMenuButton_('堆高機 F', 'QR FORK-LJ-F'),
          qrMenuButton_('車載高空車', 'QR AWP-LJ-001'),
          qrMenuButton_('自走高空車', 'QR AWP-LJ-SP-001'),
        ]),
        buildQrMenuBubble_('場地防護具日檢', '防護具歸防護具：場地用防護具', '#5F6368', [
          qrMenuButton_('起重機防護具', 'QR VENUE-CRANE'),
          qrMenuButton_('堆高機防護具', 'QR VENUE-FORK'),
        ]),
        buildQrMenuBubble_('教室防護具月檢', '量測設備與個人防護具月檢', '#137333', [
          qrMenuButton_('龍井教室月檢', 'QR CLASSROOM-LJ-MEAS-PPE'),
          qrMenuButton_('復興教室月檢', 'QR CLASSROOM-FX-MEAS-PPE'),
          qrMenuButton_('忠明教室月檢', 'QR CLASSROOM-ZM-MEAS-PPE'),
        ]),
      ],
    },
  };
}

/**
 * 包裝訊息加上 Quick Reply（如果還沒有的話）
 */
function withQuickReply_(messages) {
  if (!Array.isArray(messages)) messages = [messages];
  // 只有最後一則才需要 quickReply（LINE 規範）
  const last = messages[messages.length - 1];
  if (last && !last.quickReply) {
    last.quickReply = defaultQuickReply_();
  }
  return messages;
}

/**
 * Multicast：一次推送給多個 userId（不能用於 group）
 * 上限 500 user/次
 */
function lineMulticast_(userIds, messages) {
  const cfg = getLineConfig_();
  const url = `${LINE_API}/message/multicast`;
  const payload = { to: userIds, messages };
  const res = UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: 'application/json',
    headers: { 'Authorization': 'Bearer ' + cfg.token },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true,
  });
  const code = res.getResponseCode();
  if (code !== 200) {
    Logger.log(`[LINE] multicast 失敗 code=${code} body=${res.getContentText()}`);
    return { ok: false, code };
  }
  return { ok: true };
}

/**
 * Reply（回應 webhook 收到的訊息）— 雙向互動用
 * https://developers.line.biz/en/reference/messaging-api/#send-reply-message
 */
function lineReply_(replyToken, messages) {
  const cfg = getLineConfig_();
  messages = withQuickReply_(messages);
  const url = `${LINE_API}/message/reply`;
  const payload = { replyToken, messages };
  const res = UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: 'application/json',
    headers: { 'Authorization': 'Bearer ' + cfg.token },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true,
  });
  return { ok: res.getResponseCode() === 200 };
}

// ===================================================================
// Flex Message 模板（高 UI 卡片，比純文字好看）
// ===================================================================

/**
 * 未填提醒卡片
 *   category: '固定式起重機' / '堆高機'
 *   equipments: [{equipmentId, equipmentName, location}, ...]
 *   webFrontendUrl: GitHub Pages 首頁網址
 */
function buildReminderFlex_(category, equipments, webFrontendUrl, opts) {
  opts = opts || {};
  const todayROC = opts.dateLabel || formatROCDate_(new Date());
  const title = opts.title || '今日未完成檢點';
  const itemLabel = opts.itemLabel || '未填設備';
  const itemIcon = opts.itemIcon || '🔧';
  const buttonLabel = opts.buttonLabel || '立即填寫';
  const itemsBlock = equipments.slice(0, 8).map(eq => ({
    type: 'box',
    layout: 'baseline',
    spacing: 'sm',
    contents: [
      { type: 'text', text: itemIcon, flex: 1, size: 'sm' },
      { type: 'text', text: eq.equipmentName, flex: 6, size: 'sm', wrap: true, color: '#333333' },
      { type: 'text', text: eq.location || '', flex: 3, size: 'xs', color: '#888888', align: 'end' },
    ],
  }));
  const more = equipments.length > 8 ? [{
    type: 'text', text: `... 還有 ${equipments.length - 8} 台`, size: 'xs', color: '#888888', margin: 'sm',
  }] : [];
  // codex 2026-05-26 P1.4: webFrontendUrl 必須是 http/https URL，否則 LINE Flex URI 會 invalid
  const validUrl = webFrontendUrl && /^https?:\/\//.test(webFrontendUrl) ? webFrontendUrl : '';
  const bubble = {
    type: 'flex',
    altText: `⚠ ${category} ${title} (${equipments.length} 筆)`,
    contents: {
      type: 'bubble',
      header: {
        type: 'box', layout: 'vertical',
        backgroundColor: '#FFA000',
        paddingAll: 'md',
        contents: [
          { type: 'text', text: `⚠ ${title}`, color: '#ffffff', weight: 'bold', size: 'lg' },
          { type: 'text', text: todayROC, color: '#FFF3E0', size: 'sm' },
        ],
      },
      body: {
        type: 'box', layout: 'vertical', spacing: 'md',
        contents: [
          { type: 'box', layout: 'baseline', spacing: 'sm', contents: [
            { type: 'text', text: '📋 類別', flex: 2, size: 'sm', color: '#666666' },
            { type: 'text', text: category, flex: 5, size: 'sm', weight: 'bold', wrap: true },
          ]},
          { type: 'separator', margin: 'sm' },
          { type: 'text', text: `🔍 ${itemLabel}`, size: 'sm', color: '#666666', margin: 'md' },
          ...itemsBlock,
          ...more,
        ],
      },
    },
  };
  // 有 validUrl 才加 footer button；空 URL 不放 footer，避免 LINE Flex 拒絕渲染
  if (validUrl) {
    bubble.contents.footer = {
      type: 'box', layout: 'vertical', spacing: 'sm',
      contents: [{
        type: 'button',
        style: 'primary',
        color: '#1a73e8',
        action: { type: 'uri', label: `📝 ${buttonLabel}`, uri: validUrl },
      }],
    };
  }
  return bubble;
}

/**
 * 異常事件即時通報卡片
 *
 * pdfUrl:   該筆異常對應的填報 PDF（incident.fileUrl）
 * sheetUrl: 機具設備異常事件 Google Sheet（INCIDENT_SHEET_URL）
 *
 * footer 顯示：兩個按鈕（PDF + Sheet），都有就都顯示，否則只顯示有的
 */
function buildIncidentFlex_(incident, pdfUrl, sheetUrl) {
  // incident: { equipmentName, category, formType('每日'/'每月'), order, itemName, result, description, photoCount, status, reportTime }
  return {
    type: 'flex',
    altText: `🚨 ${incident.equipmentName} 第${incident.order}項異常: ${incident.description}`,
    contents: {
      type: 'bubble',
      header: {
        type: 'box', layout: 'vertical',
        backgroundColor: '#D32F2F',
        paddingAll: 'md',
        contents: [
          { type: 'text', text: '🚨 異常事件通報', color: '#ffffff', weight: 'bold', size: 'lg' },
        ],
      },
      body: {
        type: 'box', layout: 'vertical', spacing: 'sm',
        contents: [
          { type: 'box', layout: 'baseline', contents: [
            { type: 'text', text: '🏗 設備', flex: 2, size: 'sm', color: '#666666' },
            { type: 'text', text: incident.equipmentName, flex: 5, size: 'sm', weight: 'bold', wrap: true },
          ]},
          { type: 'box', layout: 'baseline', contents: [
            { type: 'text', text: '📑 表單', flex: 2, size: 'sm', color: '#666666' },
            { type: 'text', text: `${incident.formType} 第 ${incident.order} 項`, flex: 5, size: 'sm', wrap: true },
          ]},
          { type: 'box', layout: 'baseline', contents: [
            { type: 'text', text: '📌 項目', flex: 2, size: 'sm', color: '#666666' },
            { type: 'text', text: incident.itemName || '', flex: 5, size: 'sm', wrap: true },
          ]},
          { type: 'separator', margin: 'md' },
          { type: 'text', text: '⚠ 異常說明', size: 'sm', color: '#666666', margin: 'md' },
          { type: 'text', text: String(incident.description || '(無說明)'), size: 'md', color: '#D32F2F', weight: 'bold', wrap: true },
          ...(incident.photoCount > 0 ? [{ type: 'text', text: `📷 附 ${incident.photoCount} 張照片`, size: 'xs', color: '#666666', margin: 'sm' }] : []),
        ],
      },
      footer: {
        type: 'box', layout: 'vertical', spacing: 'sm',
        contents: [
          ...(pdfUrl ? [{
            type: 'button',
            style: 'primary',
            color: '#D32F2F',
            action: { type: 'uri', label: '📄 查看此次 PDF', uri: pdfUrl },
          }] : []),
          ...(sheetUrl ? [{
            type: 'button',
            style: 'secondary',
            action: { type: 'uri', label: '📋 機具異常表', uri: sheetUrl },
          }] : []),
          {
            type: 'button',
            style: (pdfUrl || sheetUrl) ? 'secondary' : 'primary',
            color: (pdfUrl || sheetUrl) ? undefined : '#D32F2F',
            action: { type: 'message', label: '🔎 查看全部待處理異常', text: '異常' },
          },
        ],
      },
    },
  };
}

function incidentSummaryItemBox_(incident) {
  const title = `第 ${incident.order || '—'} 項｜${trimLineText_(incident.itemName || '未命名項目', 70)}`;
  const desc = trimLineText_(incident.description || '(無說明)', 120);
  return {
    type: 'box',
    layout: 'vertical',
    spacing: 'xs',
    margin: 'sm',
    contents: [
      { type: 'text', text: title, size: 'sm', color: '#202124', weight: 'bold', wrap: true },
      { type: 'text', text: desc, size: 'xs', color: '#D32F2F', wrap: true },
    ],
  };
}

/**
 * 同一次設備檢查的多個異常項目彙整成一則 LINE 通知。
 * 資料表仍維持逐項建立機具設備異常事件，避免後續追蹤失去明細。
 */
function buildIncidentSummaryFlex_(summary, pdfUrl, sheetUrl) {
  const incidents = Array.isArray(summary.incidents) ? summary.incidents : [];
  const count = incidents.length;
  const shown = incidents.slice(0, 8);
  const omitted = Math.max(count - shown.length, 0);
  const photoCount = incidents.reduce((sum, item) => sum + Number(item.photoCount || 0), 0);
  return {
    type: 'flex',
    altText: `🚨 ${summary.equipmentName || '設備'} ${summary.formType || ''}檢查 ${count} 項異常`,
    contents: {
      type: 'bubble',
      header: {
        type: 'box',
        layout: 'vertical',
        backgroundColor: '#D32F2F',
        paddingAll: 'md',
        contents: [
          { type: 'text', text: '🚨 設備異常通報', color: '#ffffff', weight: 'bold', size: 'lg' },
          { type: 'text', text: `${summary.formType || '檢查'}｜${count} 項異常`, color: '#FFEBEE', size: 'sm' },
        ],
      },
      body: {
        type: 'box',
        layout: 'vertical',
        spacing: 'sm',
        contents: [
          dailyIncidentFlexField_('設備', summary.equipmentName || '—', { weight: 'bold' }),
          dailyIncidentFlexField_('類別', summary.category || '—'),
          dailyIncidentFlexField_('日期', summary.reportDate || '—'),
          dailyIncidentFlexField_('異常數', `${count} 項`, { color: '#D32F2F', weight: 'bold' }),
          ...(photoCount > 0 ? [dailyIncidentFlexField_('照片', `${photoCount} 張`)] : []),
          { type: 'separator', margin: 'md' },
          ...shown.map(incidentSummaryItemBox_),
          ...(omitted > 0 ? [{ type: 'text', text: `另有 ${omitted} 項異常，請開啟 PDF、機具設備異常事件表或點擊查看全部待處理異常。`, size: 'xs', color: '#5F6368', wrap: true, margin: 'sm' }] : []),
        ],
      },
      footer: {
        type: 'box',
        layout: 'vertical',
        spacing: 'sm',
        contents: [
          ...(pdfUrl ? [{
            type: 'button',
            style: 'primary',
            color: '#D32F2F',
            action: { type: 'uri', label: '📄 查看此次 PDF', uri: pdfUrl },
          }] : []),
          ...(sheetUrl ? [{
            type: 'button',
            style: 'secondary',
            action: { type: 'uri', label: '📋 機具異常表', uri: sheetUrl },
          }] : []),
          {
            type: 'button',
            style: (pdfUrl || sheetUrl) ? 'secondary' : 'primary',
            color: (pdfUrl || sheetUrl) ? undefined : '#D32F2F',
            action: { type: 'message', label: '🔎 查看全部待處理異常', text: '異常' },
          },
        ],
      },
    },
  };
}

function visibleChecklistStatusResults_(results) {
  return (results || []).filter(r =>
    String(r.category || '').trim() !== '防護具檢點' &&
    !isNonActionableChecklistStatus_(r)
  );
}

function isNonActionableChecklistStatus_(result) {
  const reason = String((result && result.reason) || '').trim();
  if (reason === '防護具類別不發 reminder') return true;
  if (reason === '無使用紀錄') return true;
  if (reason.indexOf('未命中') === 0 && reason.indexOf('使用關鍵字') >= 0) return true;
  if (reason.indexOf('節假日') === 0) return true;
  if (reason === '同類別已寄信' || reason === '同類別已寄月檢提醒') return true;
  return false;
}

function isFilledChecklistStatus_(result) {
  const reason = String((result && result.reason) || '').trim();
  return reason === '該類別當日已填' || reason === '該類別本月已填';
}

function normalizeChecklistPendingRow_(category, result) {
  const formType = String((result && result.formType) || '').trim();
  const reason = String((result && result.reason) || '').trim() ||
    (formType === '每月' ? '本月尚未填月檢' : '本日尚未填日檢');
  return {
    category,
    equipmentId: category,
    equipmentName: category,
    reason,
  };
}

function checklistStatusGroupWeight_(category) {
  const text = String(category || '');
  if (text.indexOf('防護具') >= 0 || text.indexOf('量測設備') >= 0 || text.indexOf('SCBA') >= 0) {
    return 20;
  }
  return 10;
}

function checklistStatusCategorySummary_(results) {
  const byCat = {};
  visibleChecklistStatusResults_(results).forEach(r => {
    const cat = r.category || '?';
    byCat[cat] = byCat[cat] || [];
    byCat[cat].push(r);
  });
  return Object.keys(byCat).sort((a, b) => {
    const weightDiff = checklistStatusGroupWeight_(a) - checklistStatusGroupWeight_(b);
    if (weightDiff !== 0) return weightDiff;
    return String(a).localeCompare(String(b), 'zh-Hant');
  }).map(cat => {
    const items = byCat[cat];
    const pendingSource = items.find(r => !r.alreadyFilled && !isFilledChecklistStatus_(r));
    const pending = pendingSource ? [normalizeChecklistPendingRow_(cat, pendingSource)] : [];
    return { category: cat, total: 1, filled: pending.length ? 0 : 1, pending };
  });
}

function buildChecklistStatusFlex_(results, opts) {
  opts = opts || {};
  const dateLabel = opts.dateLabel || formatROCDate_(new Date());
  const summaries = checklistStatusCategorySummary_(results);
  const pendingCount = summaries.reduce((sum, s) => sum + s.pending.length, 0);
  const allDone = pendingCount === 0;
  const color = allDone ? '#137333' : '#F29900';
  const title = allDone ? '✅ 目前填表正常' : `⚠ 尚有 ${pendingCount} 項需確認`;
  const categoryRows = summaries.length ? summaries.map(s => ({
    type: 'box',
    layout: 'baseline',
    spacing: 'sm',
    contents: [
      { type: 'text', text: s.category, flex: 4, size: 'sm', color: '#202124', weight: 'bold', wrap: true },
      {
        type: 'text',
        text: `${s.filled}/${s.total} 完成`,
        flex: 3,
        size: 'sm',
        color: s.pending.length ? '#B06000' : '#137333',
        weight: 'bold',
        align: 'end',
      },
    ],
  })) : [{
    type: 'text',
    text: '目前沒有需要追蹤的填表項目。',
    size: 'sm',
    color: '#5f6368',
    wrap: true,
  }];
  const pendingRows = summaries
    .flatMap(s => s.pending.map(r => ({
      category: s.category,
      label: `${r.equipmentName || r.equipmentId || '未命名設備'} — ${r.reason || '待確認'}`,
    })))
    .slice(0, 8)
    .map(item => ({
      type: 'text',
      text: `⚠ ${trimLineText_(item.label, 80)}`,
      size: 'xs',
      color: '#B06000',
      wrap: true,
    }));
  const morePending = pendingCount > 8 ? [{
    type: 'text',
    text: `... 還有 ${pendingCount - 8} 項`,
    size: 'xs',
    color: '#8a4b00',
    margin: 'sm',
  }] : [];
  return {
    type: 'flex',
    altText: `📅 ${dateLabel} 填表狀態`,
    contents: {
      type: 'bubble',
      header: {
        type: 'box',
        layout: 'vertical',
        backgroundColor: color,
        paddingAll: 'md',
        contents: [
          { type: 'text', text: '📅 填表狀態', color: '#ffffff', weight: 'bold', size: 'lg' },
          { type: 'text', text: dateLabel, color: allDone ? '#E6F4EA' : '#FFF3E0', size: 'sm' },
        ],
      },
      body: {
        type: 'box',
        layout: 'vertical',
        spacing: 'sm',
        contents: [
          { type: 'text', text: title, size: 'md', color, weight: 'bold', wrap: true },
          { type: 'separator', margin: 'md' },
          ...categoryRows,
          ...(pendingRows.length ? [
            { type: 'text', text: '待確認項目', size: 'sm', color: '#666666', margin: 'md' },
            ...pendingRows,
            ...morePending,
          ] : []),
        ],
      },
    },
  };
}

function buildDailyWorkStatusFlex_(status) {
  status = status || {};
  const allDone = status.isBusinessDay && status.total > 0 && status.pendingCount === 0;
  const nonBusinessDay = !status.isBusinessDay;
  const noStaff = status.isBusinessDay && status.total <= 0;
  const color = nonBusinessDay ? '#5f6368' : allDone ? '#137333' : '#F29900';
  const title = nonBusinessDay
    ? '今日非上班日，免填每日作業檢核'
    : noStaff
      ? '尚未設定同仁名單'
      : allDone
        ? '✅ 今日同仁皆已完成'
        : `⚠ 尚有 ${status.pendingCount} 位未完成`;
  const pendingNames = (status.pendingNames || []).slice(0, 10);
  const more = (status.pendingNames || []).length > 10 ? [{
    type: 'text',
    text: `... 還有 ${(status.pendingNames || []).length - 10} 位`,
    size: 'xs',
    color: '#8a4b00',
    margin: 'sm',
  }] : [];
  const body = [
    { type: 'text', text: title, size: 'md', color, weight: 'bold', wrap: true },
    { type: 'separator', margin: 'md' },
    {
      type: 'box',
      layout: 'baseline',
      spacing: 'sm',
      margin: 'md',
      contents: [
        { type: 'text', text: '完成狀態', flex: 4, size: 'sm', color: '#5f6368' },
        { type: 'text', text: `${status.completedCount || 0}/${status.total || 0} 完成`, flex: 5, size: 'sm', color, weight: 'bold', align: 'end' },
      ],
    },
  ];
  if (status.currentUserIsStaff) {
    body.push({
      type: 'box',
      layout: 'baseline',
      spacing: 'sm',
      margin: 'sm',
      contents: [
        { type: 'text', text: '你的狀態', flex: 4, size: 'sm', color: '#5f6368' },
        { type: 'text', text: status.currentUserCompleted ? '已完成' : '尚未完成', flex: 5, size: 'sm', color: status.currentUserCompleted ? '#137333' : '#B06000', weight: 'bold', align: 'end' },
      ],
    });
  }
  if (!nonBusinessDay && pendingNames.length) {
    body.push({ type: 'text', text: '尚未完成', size: 'sm', color: '#666666', margin: 'md' });
    pendingNames.forEach(name => body.push({
      type: 'text',
      text: `⚠ ${trimLineText_(name, 30)}`,
      size: 'xs',
      color: '#B06000',
      wrap: true,
    }));
    more.forEach(item => body.push(item));
  }
  if (!nonBusinessDay && status.reminders) {
    const r1630 = status.reminders.reminder1630 ? '16:30 已提醒' : '16:30 尚未提醒';
    const r1700 = status.reminders.reminder1700 ? '17:00 已提醒' : '17:00 尚未提醒';
    body.push({ type: 'text', text: `${r1630} / ${r1700}`, size: 'xs', color: '#5f6368', margin: 'md', wrap: true });
  }
  const url = (typeof buildDailyWorkCheckPublicUrl_ === 'function') ? buildDailyWorkCheckPublicUrl_() : '';
  return {
    type: 'flex',
    altText: `🗓 ${status.dateLabel || ''} 每日作業填寫 ${status.completedCount || 0}/${status.total || 0}`,
    contents: {
      type: 'bubble',
      header: {
        type: 'box',
        layout: 'vertical',
        backgroundColor: color,
        paddingAll: 'md',
        contents: [
          { type: 'text', text: '🗓 每日作業填寫', color: '#ffffff', weight: 'bold', size: 'lg' },
          { type: 'text', text: status.dateLabel || formatROCDate_(new Date()), color: '#ffffff', size: 'sm' },
        ],
      },
      body: {
        type: 'box',
        layout: 'vertical',
        spacing: 'sm',
        contents: body,
      },
      footer: url ? {
        type: 'box',
        layout: 'vertical',
        contents: [
          { type: 'button', style: allDone ? 'secondary' : 'primary', height: 'sm', action: { type: 'uri', label: '填寫每日作業檢核', uri: url } },
        ],
      } : undefined,
    },
  };
}

function buildDailyWorkReminderFlex_(status, slot) {
  const urgent = slot === '17:00';
  const color = urgent ? '#B3261E' : '#F29900';
  const title = urgent ? '每日作業檢核逾時未完成' : '每日作業檢核未完成';
  const pendingNames = (status.pendingNames || []).slice(0, 12);
  const body = [
    { type: 'text', text: title, size: 'md', color, weight: 'bold', wrap: true },
    { type: 'separator', margin: 'md' },
    {
      type: 'box',
      layout: 'baseline',
      spacing: 'sm',
      margin: 'md',
      contents: [
        { type: 'text', text: '完成狀態', flex: 4, size: 'sm', color: '#5f6368' },
        { type: 'text', text: `${status.completedCount || 0}/${status.total || 0} 完成`, flex: 5, size: 'sm', color, weight: 'bold', align: 'end' },
      ],
    },
    { type: 'text', text: urgent ? '仍未填寫' : '尚未填寫', size: 'sm', color: '#666666', margin: 'md' },
  ];
  pendingNames.forEach(name => body.push({ type: 'text', text: `⚠ ${trimLineText_(name, 30)}`, size: 'sm', color: '#B06000', wrap: true }));
  if ((status.pendingNames || []).length > 12) {
    body.push({ type: 'text', text: `... 還有 ${(status.pendingNames || []).length - 12} 位`, size: 'xs', color: '#8a4b00' });
  }
  body.push({ type: 'text', text: '請協助確認是否需補填。', size: 'xs', color: '#5f6368', margin: 'md', wrap: true });
  return {
    type: 'flex',
    altText: `${title} ${status.completedCount || 0}/${status.total || 0}`,
    contents: {
      type: 'bubble',
      header: {
        type: 'box',
        layout: 'vertical',
        backgroundColor: color,
        paddingAll: 'md',
        contents: [
          { type: 'text', text: '🗓 每日作業檢核', color: '#ffffff', weight: 'bold', size: 'lg' },
          { type: 'text', text: `${status.dateLabel || ''} ${slot || ''}`, color: '#ffffff', size: 'sm' },
        ],
      },
      body: { type: 'box', layout: 'vertical', spacing: 'sm', contents: body },
      footer: {
        type: 'box',
        layout: 'vertical',
        contents: [
          { type: 'button', style: 'primary', height: 'sm', action: { type: 'message', label: '查看填寫狀態', text: '狀態' } },
        ],
      },
    },
  };
}

function buildDailyWorkCheckEntryFlex_(url) {
  return {
    type: 'flex',
    altText: '🗓 每日作業檢核',
    contents: {
      type: 'bubble',
      header: {
        type: 'box',
        layout: 'vertical',
        backgroundColor: '#0F766E',
        paddingAll: 'md',
        contents: [
          { type: 'text', text: '🗓 每日作業檢核', color: '#ffffff', weight: 'bold', size: 'lg' },
          { type: 'text', text: '請於 16:30 前完成', color: '#DDF7F2', size: 'sm' },
        ],
      },
      body: {
        type: 'box',
        layout: 'vertical',
        spacing: 'sm',
        contents: [
          { type: 'text', text: '檢核 15 天後課程報備、1 天後異動，以及公文系統是否已成功發送。', size: 'sm', color: '#202124', wrap: true },
        ],
      },
      footer: {
        type: 'box',
        layout: 'vertical',
        contents: [
          { type: 'button', style: 'primary', height: 'sm', action: { type: 'uri', label: '開啟檢核表', uri: url } },
        ],
      },
    },
  };
}

function buildSubscriberRegistrationFlex_() {
  return {
    type: 'flex',
    altText: '請先完成 LINE_USER_ID 登錄',
    contents: {
      type: 'bubble',
      header: {
        type: 'box',
        layout: 'vertical',
        backgroundColor: '#1F3A5F',
        paddingAll: 'md',
        contents: [
          { type: 'text', text: 'ISHA 通知小幫手', color: '#ffffff', weight: 'bold', size: 'lg' },
          { type: 'text', text: '請先完成個人登錄', color: '#DDE7F3', size: 'sm' },
        ],
      },
      body: {
        type: 'box',
        layout: 'vertical',
        spacing: 'sm',
        contents: [
          { type: 'text', text: '此功能限已登錄的同仁或主管使用。', size: 'sm', color: '#202124', wrap: true },
          { type: 'text', text: '請按下方按鈕取得你的 LINE_USER_ID，並回報「姓名 + LINE_USER_ID」給管理員加入訂閱者清單。', size: 'sm', color: '#5f6368', wrap: true },
        ],
      },
      footer: {
        type: 'box',
        layout: 'vertical',
        spacing: 'sm',
        contents: [
          { type: 'button', style: 'primary', height: 'sm', action: { type: 'message', label: '取得我的ID', text: '我的ID' } },
          { type: 'button', style: 'secondary', height: 'sm', action: { type: 'message', label: '查看可用指令', text: '幫助' } },
        ],
      },
    },
  };
}

function buildOpenIncidentBubble_(incident) {
  const incidentId = String(incident.incidentId || '');
  const shortId = incidentId ? incidentId.substring(0, 8) : '';
  const pdfUrl = incident.pdfUrl && /^https?:\/\//.test(incident.pdfUrl) ? incident.pdfUrl : '';
  const completeAction = shortId
    ? { type: 'message', label: '標記完成', text: `/完成 ${shortId}` }
    : { type: 'message', label: '標記完成', text: '完成 ' };
  return {
    type: 'bubble',
    header: {
      type: 'box',
      layout: 'vertical',
      backgroundColor: '#D32F2F',
      paddingAll: 'md',
      contents: [
        { type: 'text', text: '🚨 設備異常', color: '#ffffff', weight: 'bold', size: 'lg' },
        { type: 'text', text: shortId || '未建立 ID', color: '#FFEBEE', size: 'sm' },
      ],
    },
    body: {
      type: 'box',
      layout: 'vertical',
      spacing: 'sm',
      contents: [
        dailyIncidentFlexField_('設備', incident.equipmentName, { weight: 'bold' }),
        dailyIncidentFlexField_('類別', incident.category || incident.formType),
        dailyIncidentFlexField_('日期', incident.reportDate),
        dailyIncidentFlexField_('項次', `第 ${incident.order || '—'} 項`),
        dailyIncidentFlexField_('狀態', incident.status || '待處理', { color: '#D32F2F', weight: 'bold' }),
        { type: 'separator', margin: 'md' },
        { type: 'text', text: '異常項目', size: 'sm', color: '#666666', margin: 'md' },
        { type: 'text', text: trimLineText_(incident.itemName || '—', 180), size: 'sm', color: '#202124', weight: 'bold', wrap: true },
        { type: 'text', text: '異常說明', size: 'sm', color: '#666666', margin: 'md' },
        { type: 'text', text: trimLineText_(incident.description || '—', 260), size: 'md', color: '#D32F2F', weight: 'bold', wrap: true },
        { type: 'text', text: incident.photoCount > 0 ? `📷 附 ${incident.photoCount} 張照片` : '📷 無照片', size: 'xs', color: '#666666', margin: 'sm' },
      ],
    },
    footer: {
      type: 'box',
      layout: 'vertical',
      spacing: 'sm',
      contents: [
        ...(pdfUrl ? [{
          type: 'button',
          style: 'secondary',
          action: { type: 'uri', label: '查看PDF', uri: pdfUrl },
        }] : []),
        {
          type: 'button',
          style: 'primary',
          color: '#D32F2F',
          action: completeAction,
        },
      ],
    },
  };
}

function buildOpenIncidentsFlex_(incidents) {
  const list = (incidents || []).slice(0, 10);
  if (list.length === 0) {
    return buildDailyIncidentNoticeFlex_('✅ 目前沒有待處理異常', '設備檢查異常目前沒有待處理、處理中或待重檢案件。', { color: '#137333' });
  }
  return {
    type: 'flex',
    altText: `🚨 待處理設備異常 ${incidents.length} 筆`,
    contents: {
      type: 'carousel',
      contents: list.map(buildOpenIncidentBubble_),
    },
  };
}

function buildApprovalRequestFlex_(record) {
  const formTypeZh = record.formType === 'daily' ? '每日' : '每月';
  const checkDateLabel = formatROCDate_(record.checkDate);
  const approvalUrl = record.approvalUrl || '';
  return {
    type: 'flex',
    altText: `🖊 ${record.equipment.equipmentName} 待主管簽核`,
    contents: {
      type: 'bubble',
      header: {
        type: 'box', layout: 'vertical',
        backgroundColor: '#1a73e8',
        paddingAll: 'md',
        contents: [
          { type: 'text', text: '🖊 待主管簽核', color: '#ffffff', weight: 'bold', size: 'lg' },
          { type: 'text', text: `${formTypeZh}檢查紀錄`, color: '#e8f0fe', size: 'sm' },
        ],
      },
      body: {
        type: 'box', layout: 'vertical', spacing: 'sm',
        contents: [
          { type: 'box', layout: 'baseline', contents: [
            { type: 'text', text: '設備', flex: 2, size: 'sm', color: '#666666' },
            { type: 'text', text: record.equipment.equipmentName, flex: 5, size: 'sm', weight: 'bold', wrap: true },
          ]},
          { type: 'box', layout: 'baseline', contents: [
            { type: 'text', text: '日期', flex: 2, size: 'sm', color: '#666666' },
            { type: 'text', text: checkDateLabel, flex: 5, size: 'sm', wrap: true },
          ]},
          { type: 'box', layout: 'baseline', contents: [
            { type: 'text', text: '檢查人', flex: 2, size: 'sm', color: '#666666' },
            { type: 'text', text: record.inspector || '', flex: 5, size: 'sm', wrap: true },
          ]},
          { type: 'box', layout: 'baseline', contents: [
            { type: 'text', text: '異常', flex: 2, size: 'sm', color: '#666666' },
            { type: 'text', text: `${record.incidentCount || 0} 項`, flex: 5, size: 'sm',
              color: record.incidentCount > 0 ? '#D32F2F' : '#137333', weight: 'bold' },
          ]},
        ],
      },
      footer: {
        type: 'box', layout: 'vertical', spacing: 'sm',
        contents: [{
          type: 'button',
          style: 'primary',
          color: '#1a73e8',
          action: { type: 'uri', label: '主管簽核', uri: approvalUrl },
        }],
      },
    },
  };
}

function dailyIncidentFlexField_(label, value, opts) {
  opts = opts || {};
  return {
    type: 'box',
    layout: 'baseline',
    spacing: 'sm',
    contents: [
      { type: 'text', text: label, flex: 2, size: 'sm', color: '#666666' },
      {
        type: 'text',
        text: trimLineText_(value || '—', opts.maxLen || 120),
        flex: 5,
        size: 'sm',
        color: opts.color || '#202124',
        weight: opts.weight || 'regular',
        wrap: true,
      },
    ],
  };
}

function buildDailyIncidentCreatedFlex_(incident, opts) {
  opts = opts || {};
  const incidentId = incident.incidentId || '';
  const updateUrl = incident.updateUrl && /^https?:\/\//.test(incident.updateUrl) ? incident.updateUrl : '';
  const pdfUrl = incident.pdfUrl && /^https?:\/\//.test(incident.pdfUrl) ? incident.pdfUrl : '';
  const headerTitle = opts.title || '🚨 日常異常事件通報';
  const headerColor = opts.color || '#D32F2F';
  const accentColor = opts.accentColor || headerColor;
  const updateAction = updateUrl
    ? { type: 'uri', label: '處理回報', uri: updateUrl }
    : { type: 'message', label: '處理回報', text: `/更新${incidentId}` };
  const approvalAction = updateUrl
    ? { type: 'uri', label: '處理完成送審', uri: updateUrl }
    : { type: 'message', label: '處理完成送審', text: `/陳核${incidentId}` };
  return {
    type: 'flex',
    altText: `🚨 日常異常事件通報 ${incidentId}`,
    contents: {
      type: 'bubble',
      header: {
        type: 'box', layout: 'vertical',
        backgroundColor: headerColor,
        paddingAll: 'md',
        contents: [
          { type: 'text', text: headerTitle, color: '#ffffff', weight: 'bold', size: 'lg' },
          { type: 'text', text: incidentId, color: '#FFEBEE', size: 'sm' },
        ],
      },
      body: {
        type: 'box', layout: 'vertical', spacing: 'sm',
        contents: [
          dailyIncidentFlexField_('地點', incident.location, { weight: 'bold' }),
          dailyIncidentFlexField_('事項', incident.subject),
          dailyIncidentFlexField_('填報人', incident.reporter),
          dailyIncidentFlexField_('承辦人', incident.owner),
          dailyIncidentFlexField_('狀態', incident.processStatus || '待處理', { color: accentColor, weight: 'bold' }),
          dailyIncidentFlexField_('審核', incident.reviewStatus || '未送審'),
          { type: 'separator', margin: 'md' },
          { type: 'text', text: '異常事項', size: 'sm', color: '#666666', margin: 'md' },
          { type: 'text', text: trimLineText_(incident.description || '—', 260), size: 'md', color: accentColor, weight: 'bold', wrap: true },
          ...(incident.processNote ? [
            { type: 'text', text: '處理說明', size: 'sm', color: '#666666', margin: 'md' },
            { type: 'text', text: trimLineText_(incident.processNote, 220), size: 'sm', color: '#202124', wrap: true },
          ] : []),
          ...(incident.reviewComment ? [
            { type: 'text', text: '主管意見', size: 'sm', color: '#666666', margin: 'md' },
            { type: 'text', text: trimLineText_(incident.reviewComment, 220), size: 'sm', color: '#174ea6', weight: 'bold', wrap: true },
          ] : []),
          { type: 'text', text: incident.photoCount > 0 ? `📷 附 ${incident.photoCount} 張照片` : '📷 無照片', size: 'xs', color: '#666666', margin: 'sm' },
        ],
      },
      footer: {
        type: 'box', layout: 'vertical', spacing: 'sm',
        contents: [
          {
            type: 'button',
            style: 'primary',
            color: headerColor,
            action: updateAction,
          },
          ...(pdfUrl ? [{
            type: 'button',
            style: 'secondary',
            action: { type: 'uri', label: '查看PDF', uri: pdfUrl },
          }] : []),
          {
            type: 'button',
            style: 'secondary',
            action: approvalAction,
          },
        ],
      },
    },
  };
}

function buildDailyIncidentReportEntryFlex_(url) {
  const validUrl = url && /^https?:\/\//.test(url) ? url : '';
  return {
    type: 'flex',
    altText: '📝 日常異常事件通報表',
    contents: {
      type: 'bubble',
      header: {
        type: 'box', layout: 'vertical',
        backgroundColor: '#1a73e8',
        paddingAll: 'md',
        contents: [
          { type: 'text', text: '📝 日常異常事件通報', color: '#ffffff', weight: 'bold', size: 'lg' },
          { type: 'text', text: '承辦填報入口', color: '#e8f0fe', size: 'sm' },
        ],
      },
      body: {
        type: 'box', layout: 'vertical', spacing: 'sm',
        contents: [
          { type: 'text', text: '用於回報日常場地、環境、安全衛生或人員反映等非設備檢查來源的異常事件。', wrap: true, size: 'sm', color: '#202124' },
          { type: 'separator', margin: 'md' },
          { type: 'text', text: '送出後會建立事件 ID、產生 PDF，並依處理狀況推送 LINE 圖卡資訊。', wrap: true, size: 'sm', color: '#5f6368', margin: 'md' },
        ],
      },
      footer: validUrl ? {
        type: 'box', layout: 'vertical', spacing: 'sm',
        contents: [{
          type: 'button',
          style: 'primary',
          color: '#1a73e8',
          action: { type: 'uri', label: '開啟通報表', uri: validUrl },
        }],
      } : undefined,
    },
  };
}

function buildDailyIncidentNoticeFlex_(title, body, opts) {
  opts = opts || {};
  const color = opts.color || '#1a73e8';
  const buttons = opts.buttons || [];
  return {
    type: 'flex',
    altText: title,
    contents: {
      type: 'bubble',
      header: {
        type: 'box', layout: 'vertical',
        backgroundColor: color,
        paddingAll: 'md',
        contents: [
          { type: 'text', text: title, color: '#ffffff', weight: 'bold', size: 'lg' },
        ],
      },
      body: {
        type: 'box', layout: 'vertical', spacing: 'sm',
        contents: [
          { type: 'text', text: trimLineText_(body || '', 420), wrap: true, size: 'sm', color: '#202124' },
        ],
      },
      footer: buttons.length ? {
        type: 'box', layout: 'vertical', spacing: 'sm',
        contents: buttons,
      } : undefined,
    },
  };
}

function buildDailyIncidentListFlex_(incidents) {
  const list = (incidents || []).slice(0, 10);
  if (list.length === 0) {
    return buildDailyIncidentNoticeFlex_('✅ 目前沒有未結案日常事件', '日常異常事件目前沒有待處理、處理中、待主管審核或退回補正案件。', { color: '#137333' });
  }
  return {
    type: 'flex',
    altText: `📌 日常異常事件待處理 ${incidents.length} 筆`,
    contents: {
      type: 'carousel',
      contents: list.map(inc => buildDailyIncidentCreatedFlex_(inc, {
        title: '📌 日常異常事件',
        color: '#D32F2F',
      }).contents),
    },
  };
}

function buildDailyIncidentReturnedFlex_(incident) {
  const incidentId = incident.incidentId || '';
  const updateUrl = incident.updateUrl && /^https?:\/\//.test(incident.updateUrl) ? incident.updateUrl : '';
  const pdfUrl = incident.pdfUrl && /^https?:\/\//.test(incident.pdfUrl) ? incident.pdfUrl : '';
  const updateAction = updateUrl
    ? { type: 'uri', label: '補正處理', uri: updateUrl }
    : { type: 'message', label: '補正處理', text: `/更新${incidentId}` };
  return {
    type: 'flex',
    altText: `↩ 日常異常事件退回補正 ${incidentId}`,
    contents: {
      type: 'bubble',
      header: {
        type: 'box', layout: 'vertical',
        backgroundColor: '#B3261E',
        paddingAll: 'md',
        contents: [
          { type: 'text', text: '↩ 主管退回補正', color: '#ffffff', weight: 'bold', size: 'lg' },
          { type: 'text', text: incidentId, color: '#FCE8E6', size: 'sm' },
        ],
      },
      body: {
        type: 'box', layout: 'vertical', spacing: 'sm',
        contents: [
          dailyIncidentFlexField_('地點', incident.location, { weight: 'bold' }),
          dailyIncidentFlexField_('事項', incident.subject),
          dailyIncidentFlexField_('承辦人', incident.owner),
          dailyIncidentFlexField_('主管', incident.supervisor),
          dailyIncidentFlexField_('狀態', incident.processStatus || '處理完成', { color: '#B3261E', weight: 'bold' }),
          { type: 'separator', margin: 'md' },
          { type: 'text', text: '退回意見', size: 'sm', color: '#666666', margin: 'md' },
          { type: 'text', text: trimLineText_(incident.reviewComment || '請補正後重新送審', 260), size: 'md', color: '#B3261E', weight: 'bold', wrap: true },
        ],
      },
      footer: {
        type: 'box', layout: 'vertical', spacing: 'sm',
        contents: [
          {
            type: 'button',
            style: 'primary',
            color: '#B3261E',
            action: updateAction,
          },
          ...(pdfUrl ? [{
            type: 'button',
            style: 'secondary',
            action: { type: 'uri', label: '查看退回PDF', uri: pdfUrl },
          }] : []),
        ],
      },
    },
  };
}

function buildDailyIncidentApprovalFlex_(incident) {
  const approvalUrl = incident.approvalUrl || '';
  const footerButtons = [{
    type: 'button',
    style: 'primary',
    color: '#1a73e8',
    action: { type: 'uri', label: '主管審核', uri: approvalUrl },
  }];
  if (incident.pdfUrl && /^https?:\/\//.test(incident.pdfUrl)) {
    footerButtons.push({
      type: 'button',
      style: 'secondary',
      action: { type: 'uri', label: '查看待審PDF', uri: incident.pdfUrl },
    });
  }
  return {
    type: 'flex',
    altText: `🖊 日常異常事件待審 ${incident.incidentId || ''}`,
    contents: {
      type: 'bubble',
      header: {
        type: 'box', layout: 'vertical',
        backgroundColor: '#1a73e8',
        paddingAll: 'md',
        contents: [
          { type: 'text', text: '🖊 日常異常事件待審', color: '#ffffff', weight: 'bold', size: 'lg' },
          { type: 'text', text: incident.incidentId || '', color: '#e8f0fe', size: 'sm' },
        ],
      },
      body: {
        type: 'box', layout: 'vertical', spacing: 'sm',
        contents: [
          dailyIncidentFlexField_('地點', incident.location, { weight: 'bold' }),
          dailyIncidentFlexField_('事項', incident.subject),
          dailyIncidentFlexField_('承辦人', incident.owner),
          dailyIncidentFlexField_('主管', incident.supervisor),
          dailyIncidentFlexField_('完成日', incident.completedDate || '—'),
          { type: 'separator', margin: 'md' },
          { type: 'text', text: '處理說明', size: 'sm', color: '#666666', margin: 'md' },
          { type: 'text', text: trimLineText_(incident.processNote || '—', 260), size: 'md', color: '#174ea6', weight: 'bold', wrap: true },
          { type: 'text', text: incident.photoCount > 0 ? `📷 附 ${incident.photoCount} 張照片` : '📷 無照片', size: 'xs', color: '#666666', margin: 'sm' },
        ],
      },
      footer: {
        type: 'box', layout: 'vertical', spacing: 'sm',
        contents: footerButtons,
      },
    },
  };
}

function buildDailyIncidentProcessingReviewFlex_(incident) {
  const commentUrl = incident.commentUrl && /^https?:\/\//.test(incident.commentUrl) ? incident.commentUrl : '';
  const pdfUrl = incident.pdfUrl && /^https?:\/\//.test(incident.pdfUrl) ? incident.pdfUrl : '';
  return {
    type: 'flex',
    altText: `💬 日常異常事件處理中請主管填寫意見 ${incident.incidentId || ''}`,
    contents: {
      type: 'bubble',
      header: {
        type: 'box', layout: 'vertical',
        backgroundColor: '#F29900',
        paddingAll: 'md',
        contents: [
          { type: 'text', text: '💬 日常異常事件處理中', color: '#ffffff', weight: 'bold', size: 'lg' },
          { type: 'text', text: incident.incidentId || '', color: '#FFF3E0', size: 'sm' },
        ],
      },
      body: {
        type: 'box', layout: 'vertical', spacing: 'sm',
        contents: [
          dailyIncidentFlexField_('地點', incident.location, { weight: 'bold' }),
          dailyIncidentFlexField_('事項', incident.subject),
          dailyIncidentFlexField_('承辦人', incident.owner),
          dailyIncidentFlexField_('主管', incident.supervisor),
          dailyIncidentFlexField_('狀態', incident.processStatus || '處理中', { color: '#F29900', weight: 'bold' }),
          { type: 'separator', margin: 'md' },
          { type: 'text', text: '目前處理說明', size: 'sm', color: '#666666', margin: 'md' },
          { type: 'text', text: trimLineText_(incident.processNote || '承辦尚未填寫處理說明', 260), size: 'md', color: '#9A6700', weight: 'bold', wrap: true },
        ],
      },
      footer: {
        type: 'box', layout: 'vertical', spacing: 'sm',
        contents: [
          ...(commentUrl ? [{
            type: 'button',
            style: 'primary',
            color: '#F29900',
            action: { type: 'uri', label: '填寫主管意見', uri: commentUrl },
          }] : []),
          ...(pdfUrl ? [{
            type: 'button',
            style: 'secondary',
            action: { type: 'uri', label: '查看目前PDF', uri: pdfUrl },
          }] : []),
        ],
      },
    },
  };
}

function buildDailyIncidentSupervisorCommentFlex_(incident) {
  const updateUrl = incident.updateUrl && /^https?:\/\//.test(incident.updateUrl) ? incident.updateUrl : '';
  const pdfUrl = incident.pdfUrl && /^https?:\/\//.test(incident.pdfUrl) ? incident.pdfUrl : '';
  return {
    type: 'flex',
    altText: `💬 主管處理意見 ${incident.incidentId || ''}`,
    contents: {
      type: 'bubble',
      header: {
        type: 'box', layout: 'vertical',
        backgroundColor: '#174EA6',
        paddingAll: 'md',
        contents: [
          { type: 'text', text: '💬 主管處理意見', color: '#ffffff', weight: 'bold', size: 'lg' },
          { type: 'text', text: incident.incidentId || '', color: '#e8f0fe', size: 'sm' },
        ],
      },
      body: {
        type: 'box', layout: 'vertical', spacing: 'sm',
        contents: [
          dailyIncidentFlexField_('地點', incident.location, { weight: 'bold' }),
          dailyIncidentFlexField_('事項', incident.subject),
          dailyIncidentFlexField_('承辦人', incident.owner),
          dailyIncidentFlexField_('主管', incident.supervisor),
          dailyIncidentFlexField_('狀態', incident.processStatus || '處理中', { color: '#174EA6', weight: 'bold' }),
          { type: 'separator', margin: 'md' },
          { type: 'text', text: '主管意見', size: 'sm', color: '#666666', margin: 'md' },
          { type: 'text', text: trimLineText_(incident.reviewComment || '—', 300), size: 'md', color: '#174EA6', weight: 'bold', wrap: true },
        ],
      },
      footer: {
        type: 'box', layout: 'vertical', spacing: 'sm',
        contents: [
          ...(updateUrl ? [{
            type: 'button',
            style: 'primary',
            color: '#174EA6',
            action: { type: 'uri', label: '承辦續填處理', uri: updateUrl },
          }] : []),
          ...(pdfUrl ? [{
            type: 'button',
            style: 'secondary',
            action: { type: 'uri', label: '查看目前PDF', uri: pdfUrl },
          }] : []),
        ],
      },
    },
  };
}

function buildDailyIncidentClosedFlex_(incident) {
  const pdfUrl = incident.pdfUrl && /^https?:\/\//.test(incident.pdfUrl) ? incident.pdfUrl : '';
  return {
    type: 'flex',
    altText: `✅ 日常異常事件已結案 ${incident.incidentId || ''}`,
    contents: {
      type: 'bubble',
      header: {
        type: 'box', layout: 'vertical',
        backgroundColor: '#137333',
        paddingAll: 'md',
        contents: [
          { type: 'text', text: '✅ 日常異常事件已結案', color: '#ffffff', weight: 'bold', size: 'lg' },
          { type: 'text', text: incident.incidentId || '', color: '#E6F4EA', size: 'sm' },
        ],
      },
      body: {
        type: 'box', layout: 'vertical', spacing: 'sm',
        contents: [
          dailyIncidentFlexField_('地點', incident.location, { weight: 'bold' }),
          dailyIncidentFlexField_('事項', incident.subject),
          dailyIncidentFlexField_('填報人', incident.reporter),
          dailyIncidentFlexField_('承辦人', incident.owner),
          dailyIncidentFlexField_('主管', incident.supervisor),
          dailyIncidentFlexField_('結案時間', incident.reviewTime || '—'),
          { type: 'separator', margin: 'md' },
          { type: 'text', text: '主管結案意見', size: 'sm', color: '#666666', margin: 'md' },
          { type: 'text', text: trimLineText_(incident.reviewComment || '同意結案', 260), size: 'md', color: '#137333', weight: 'bold', wrap: true },
        ],
      },
      footer: pdfUrl ? {
        type: 'box', layout: 'vertical', spacing: 'sm',
        contents: [{
          type: 'button',
          style: 'primary',
          color: '#137333',
          action: { type: 'uri', label: '查看結案PDF', uri: pdfUrl },
        }],
      } : undefined,
    },
  };
}

/**
 * 高層 API：寄未填提醒（給 Reminder.gs 用）
 * 自動加 Quick Reply 按鈕
 */
function sendReminder_(category, equipments, webFrontendUrl, opts) {
  const flex = buildReminderFlex_(category, equipments, webFrontendUrl || '', opts);
  return linePush_(withQuickReply_(flex));
}

function sendSupervisorReminder_(category, equipments, webFrontendUrl, opts) {
  const flex = buildReminderFlex_(category, equipments, webFrontendUrl || '', opts);
  const messages = [flex];
  const text = buildSupervisorReminderLinkText_(equipments, webFrontendUrl || '', opts);
  if (text) messages.push({ type: 'text', text });
  return linePushToSupervisors_(withQuickReply_(messages));
}

function buildSupervisorReminderLinkText_(equipments, webFrontendUrl, opts) {
  const validUrl = webFrontendUrl && /^https?:\/\//.test(webFrontendUrl) ? webFrontendUrl : '';
  if (!validUrl) return '';
  opts = opts || {};
  const label = opts.buttonLabel || '填寫';
  const names = (equipments || []).slice(0, 5).map(eq => {
    const location = eq.location ? `（${eq.location}）` : '';
    return `• ${eq.equipmentName}${location}`;
  });
  const more = equipments && equipments.length > 5 ? `\n• ... 還有 ${equipments.length - 5} 筆` : '';
  return [
    `📋 ${label}網址（可轉貼給承辦）`,
    ...names,
    more,
    validUrl,
    '',
    '主管不用填寫；若需請承辦補填，可直接轉貼上方網址。',
  ].filter(Boolean).join('\n');
}

/**
 * 高層 API：寄異常即時通報
 * incident.fileUrl  → 該次填報 PDF（優先顯示）
 * INCIDENT_SHEET_URL → 機具設備異常事件 Sheet（備援/輔助）
 * 自動加 Quick Reply 按鈕
 */
function sendIncidentAlert_(incident) {
  const pdfUrl = incident.fileUrl || incident.pdfUrl || '';
  const sheetUrl = PropertiesService.getScriptProperties().getProperty('INCIDENT_SHEET_URL') || '';
  const flex = buildIncidentFlex_(incident, pdfUrl, sheetUrl);
  return linePush_(withQuickReply_(flex));
}

function sendIncidentSummaryAlert_(summary) {
  const pdfUrl = summary.fileUrl || summary.pdfUrl || '';
  const sheetUrl = PropertiesService.getScriptProperties().getProperty('INCIDENT_SHEET_URL') || '';
  const flex = buildIncidentSummaryFlex_(summary, pdfUrl, sheetUrl);
  return linePush_(withQuickReply_(flex));
}

function sendApprovalRequest_(record) {
  if (!record.approvalUrl || !/^https?:\/\//.test(record.approvalUrl)) {
    return { ok: false, reason: 'invalid_approval_url' };
  }
  const flex = buildApprovalRequestFlex_(record);
  const messages = withQuickReply_(flex);
  return linePushToSupervisors_(messages);
}

function sendDailyIncidentCreated_(incident, opts) {
  const flex = buildDailyIncidentCreatedFlex_(incident);
  return linePushDailyIncidentStakeholders_(incident, withQuickReply_(flex), opts || {});
}

function sendDailyIncidentReturned_(incident) {
  const flex = buildDailyIncidentReturnedFlex_(incident);
  return linePushDailyIncidentStakeholders_(incident, withQuickReply_(flex), { includeSupervisor: false });
}

function sendDailyIncidentApprovalRequest_(incident) {
  const approvalUrl = incident.approvalUrl || '';
  if (!approvalUrl || !/^https?:\/\//.test(approvalUrl)) {
    return { ok: false, reason: 'invalid_daily_incident_approval_url' };
  }
  const flex = buildDailyIncidentApprovalFlex_(incident);
  return linePushToSupervisorName_(incident.supervisor, withQuickReply_(flex), { personKey: incident.supervisorKey });
}

function sendDailyIncidentProcessingReviewRequest_(incident) {
  const commentUrl = incident.commentUrl || '';
  if (!commentUrl || !/^https?:\/\//.test(commentUrl)) {
    return { ok: false, reason: 'invalid_daily_incident_comment_url' };
  }
  const flex = buildDailyIncidentProcessingReviewFlex_(incident);
  return linePushToSupervisorName_(incident.supervisor, withQuickReply_(flex), { personKey: incident.supervisorKey });
}

function sendDailyIncidentSupervisorComment_(incident) {
  const flex = buildDailyIncidentSupervisorCommentFlex_(incident);
  return linePushDailyIncidentStakeholders_(incident, withQuickReply_(flex), { includeSupervisor: false });
}

function sendDailyIncidentClosed_(incident) {
  const flex = buildDailyIncidentClosedFlex_(incident);
  return linePushDailyIncidentStakeholders_(incident, withQuickReply_(flex), { includeSupervisor: false });
}

function trimLineText_(text, maxLen) {
  const s = String(text || '');
  const limit = maxLen || 1000;
  return s.length > limit ? s.substring(0, limit - 1) + '…' : s;
}

/**
 * 簡單文字訊息（debug / fallback）
 * 自動加 Quick Reply 按鈕
 */
function sendLineText_(text) {
  return linePush_(withQuickReply_({ type: 'text', text }));
}

// ===================================================================
// LINE 圖文選單（Rich Menu）管理
// ===================================================================

function buildDefaultLineRichMenu_() {
  const frontend = String(getSetting_('webFrontendUrl', '') || CONFIG.DEFAULT_WEB_FRONTEND_URL || '')
    .replace(/\/$/, '');
  const indexUrl = frontend ? `${frontend}/index.html` : 'https://isha-taichung.github.io/auto-checklist/index.html';
  const incidentUrl = frontend ? `${frontend}/incident.html` : 'https://isha-taichung.github.io/auto-checklist/incident.html';
  return {
    size: { width: 2500, height: 1686 },
    selected: true,
    name: 'ISHA 檢查與通報工作台',
    chatBarText: 'ISHA 工作台',
    areas: [
      lineRichMenuArea_(0, 0, 834, 843, { type: 'uri', uri: indexUrl }),
      lineRichMenuArea_(834, 0, 833, 843, { type: 'message', text: '待發文' }),
      lineRichMenuArea_(1667, 0, 833, 843, { type: 'message', text: '狀態' }),
      lineRichMenuArea_(0, 843, 834, 843, { type: 'uri', uri: incidentUrl }),
      lineRichMenuArea_(834, 843, 833, 843, { type: 'message', text: '待處理' }),
      lineRichMenuArea_(1667, 843, 833, 843, { type: 'message', text: 'QR選單' }),
    ],
  };
}

function lineRichMenuArea_(x, y, width, height, action) {
  return { bounds: { x, y, width, height }, action };
}

function installDefaultLineRichMenu() {
  const cfg = getLineConfig_();
  if (!cfg.token) throw new Error('LINE_CHANNEL_ACCESS_TOKEN 未設定，無法建立圖文選單');
  const props = PropertiesService.getScriptProperties();
  const oldId = props.getProperty('LINE_DEFAULT_RICH_MENU_ID') || '';
  if (oldId) {
    try { lineRichMenuDelete_(oldId); } catch (err) { Logger.log('[LINE richmenu] 刪除舊選單失敗，繼續建立新版：' + err); }
  }

  const spec = buildDefaultLineRichMenu_();
  const createRes = lineRichMenuCreate_(spec);
  const richMenuId = createRes.richMenuId;
  const imageUrl = getSetting_('lineRichMenuImageUrl', '') || LINE_RICH_MENU_IMAGE_DEFAULT_URL;
  const imageRes = UrlFetchApp.fetch(imageUrl, { muteHttpExceptions: true });
  const imageCode = imageRes.getResponseCode();
  if (imageCode < 200 || imageCode >= 300) {
    try { lineRichMenuDelete_(richMenuId); } catch (_) {}
    throw new Error('圖文選單圖片下載失敗：HTTP ' + imageCode);
  }
  const blob = imageRes.getBlob().setName('line-rich-menu-main.png');
  lineRichMenuUploadImage_(richMenuId, blob);
  lineRichMenuSetDefault_(richMenuId);
  props.setProperty('LINE_DEFAULT_RICH_MENU_ID', richMenuId);
  props.setProperty('LINE_DEFAULT_RICH_MENU_IMAGE_URL', imageUrl);
  return { ok: true, richMenuId, imageUrl, areas: spec.areas.length };
}

function getLineRichMenuStatus() {
  const props = PropertiesService.getScriptProperties();
  const configuredId = props.getProperty('LINE_DEFAULT_RICH_MENU_ID') || '';
  let defaultId = '';
  let list = [];
  try { defaultId = lineRichMenuGetDefaultId_(); } catch (err) { Logger.log('[LINE richmenu] 讀取 default 失敗：' + err); }
  try { list = lineRichMenuList_(); } catch (err) { Logger.log('[LINE richmenu] 讀取清單失敗：' + err); }
  return {
    ok: true,
    configuredId,
    defaultId,
    count: list.length,
    richMenus: list.map(m => ({
      richMenuId: m.richMenuId,
      name: m.name,
      chatBarText: m.chatBarText,
      selected: m.selected,
    })),
  };
}

function getLineRichMenuHealth_() {
  const props = PropertiesService.getScriptProperties();
  const configuredId = props.getProperty('LINE_DEFAULT_RICH_MENU_ID') || '';
  const imageUrl = props.getProperty('LINE_DEFAULT_RICH_MENU_IMAGE_URL') || '';
  let defaultId = '';
  let list = [];
  let defaultError = '';
  let listError = '';
  try { defaultId = lineRichMenuGetDefaultId_(); } catch (err) { defaultError = friendlyError_(err); }
  try { list = lineRichMenuList_(); } catch (err) { listError = friendlyError_(err); }
  const active = list.filter(m => m.richMenuId === defaultId)[0] || null;
  return {
    ok: true,
    configured: !!configuredId,
    defaultSet: !!defaultId,
    defaultMatchesConfigured: !!configuredId && !!defaultId && configuredId === defaultId,
    configuredId: maskLineRichMenuId_(configuredId),
    defaultId: maskLineRichMenuId_(defaultId),
    count: list.length,
    defaultMenuName: active ? active.name : '',
    defaultChatBarText: active ? active.chatBarText : '',
    expectedName: 'ISHA 檢查與通報工作台',
    expectedChatBarText: 'ISHA 工作台',
    imageUrl: imageUrl || getSetting_('lineRichMenuImageUrl', '') || LINE_RICH_MENU_IMAGE_DEFAULT_URL,
    defaultError,
    listError,
  };
}

function getLineWebhookHealth_() {
  const expectedEndpoint = buildExpectedLineWebhookEndpoint_();
  const queryToken = getLineWebhookQueryToken_();
  const cfg = getLineConfig_();
  let lineEndpoint = '';
  let lineActive = false;
  let lineError = '';

  if (!cfg.token) {
    lineError = 'LINE_CHANNEL_ACCESS_TOKEN 未設定';
  } else {
    try {
      const res = lineRichMenuFetch_('/channel/webhook/endpoint', { method: 'get' });
      const body = JSON.parse(res.getContentText() || '{}') || {};
      lineEndpoint = String(body.endpoint || '');
      lineActive = body.active === true;
    } catch (err) {
      lineError = friendlyError_(err);
    }
  }

  const expectedBase = lineWebhookEndpointBase_(expectedEndpoint);
  const lineBase = lineWebhookEndpointBase_(lineEndpoint);
  const lineToken = lineWebhookEndpointToken_(lineEndpoint);

  return {
    lineTokenConfigured: !!cfg.token,
    queryTokenConfigured: !!queryToken && queryToken.length >= 32,
    currentServiceUrl: maskLineWebhookEndpoint_(ScriptApp.getService().getUrl()),
    expectedEndpoint: maskLineWebhookEndpoint_(expectedEndpoint),
    lineEndpoint: maskLineWebhookEndpoint_(lineEndpoint),
    lineEndpointConfigured: !!lineEndpoint,
    lineEndpointActive: lineActive,
    endpointMatchesExpected: !!expectedEndpoint && !!lineEndpoint && lineEndpoint === expectedEndpoint,
    endpointBaseMatchesExpected: !!expectedBase && !!lineBase && expectedBase === lineBase,
    endpointTokenMatchesExpected: !!queryToken && !!lineToken && lineToken === queryToken,
    lineError,
  };
}

function setLineWebhookEndpointToCurrent() {
  const endpoint = buildExpectedLineWebhookEndpoint_();
  if (!endpoint) {
    throw new Error('無法產生 LINE Webhook URL：請確認 Web App 已部署，且 LINE_WEBHOOK_QUERY_TOKEN 已設定');
  }
  lineRichMenuFetch_('/channel/webhook/endpoint', {
    method: 'put',
    contentType: 'application/json',
    payload: JSON.stringify({ endpoint }),
  });
  return getLineWebhookHealth_();
}

function maskLineRichMenuId_(id) {
  const s = String(id || '');
  if (!s) return '';
  if (s.length <= 14) return s.substring(0, 4) + '...';
  return s.substring(0, 8) + '...' + s.substring(s.length - 6);
}

function buildExpectedLineWebhookEndpoint_() {
  const queryToken = getLineWebhookQueryToken_();
  const serviceUrl = String(ScriptApp.getService().getUrl() || '').split('?')[0];
  if (!serviceUrl || !queryToken || queryToken.length < 32) return '';
  return serviceUrl + '?lineWebhookToken=' + encodeURIComponent(queryToken);
}

function maskLineWebhookEndpoint_(url) {
  const s = String(url || '');
  if (!s) return '';
  return s.replace(/([?&]lineWebhookToken=)([^&]+)/, '$1<redacted>');
}

function lineWebhookEndpointBase_(url) {
  return String(url || '').split('?')[0].replace(/\/+$/, '');
}

function lineWebhookEndpointToken_(url) {
  const m = String(url || '').match(/[?&]lineWebhookToken=([^&]+)/);
  if (!m) return '';
  try {
    return decodeURIComponent(m[1]);
  } catch (_) {
    return m[1];
  }
}

function deleteInstalledLineRichMenu() {
  const props = PropertiesService.getScriptProperties();
  const richMenuId = props.getProperty('LINE_DEFAULT_RICH_MENU_ID') || '';
  if (!richMenuId) return { ok: true, skipped: true, reason: 'no_installed_rich_menu_id' };
  lineRichMenuDelete_(richMenuId);
  props.deleteProperty('LINE_DEFAULT_RICH_MENU_ID');
  return { ok: true, deleted: richMenuId };
}

function lineRichMenuCreate_(spec) {
  const res = lineRichMenuFetch_('/richmenu', {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify(spec),
  });
  return JSON.parse(res.getContentText() || '{}');
}

function lineRichMenuUploadImage_(richMenuId, blob) {
  lineRichMenuDataFetch_(`/richmenu/${encodeURIComponent(richMenuId)}/content`, {
    method: 'post',
    contentType: 'image/png',
    payload: blob.getBytes(),
  });
}

function lineRichMenuSetDefault_(richMenuId) {
  lineRichMenuFetch_(`/user/all/richmenu/${encodeURIComponent(richMenuId)}`, { method: 'post' });
}

function lineRichMenuGetDefaultId_() {
  const res = lineRichMenuFetch_('/user/all/richmenu', { method: 'get' });
  return (JSON.parse(res.getContentText() || '{}') || {}).richMenuId || '';
}

function lineRichMenuList_() {
  const res = lineRichMenuFetch_('/richmenu/list', { method: 'get' });
  return (JSON.parse(res.getContentText() || '{}') || {}).richmenus || [];
}

function lineRichMenuDelete_(richMenuId) {
  lineRichMenuFetch_(`/richmenu/${encodeURIComponent(richMenuId)}`, { method: 'delete' });
}

function lineRichMenuFetch_(path, options) {
  return lineRichMenuFetchBase_(LINE_API + path, options);
}

function lineRichMenuDataFetch_(path, options) {
  return lineRichMenuFetchBase_(LINE_API_DATA + path, options);
}

function lineRichMenuFetchBase_(url, options) {
  const cfg = getLineConfig_();
  if (!cfg.token) throw new Error('LINE_CHANNEL_ACCESS_TOKEN 未設定');
  const opts = Object.assign({ muteHttpExceptions: true }, options || {});
  opts.headers = Object.assign({}, opts.headers || {}, { Authorization: 'Bearer ' + cfg.token });
  const res = UrlFetchApp.fetch(url, opts);
  const code = res.getResponseCode();
  if (code < 200 || code >= 300) {
    throw new Error(`LINE Rich Menu API 失敗：HTTP ${code} ${res.getContentText()}`);
  }
  return res;
}
