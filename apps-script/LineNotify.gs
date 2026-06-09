/**
 * ===== LINE Bot 通知模組 =====
 *
 * 取代既有的 MailApp 寄信通知，改用 LINE Messaging API。
 *
 * 配置（在 GAS Script Properties 設定，不寫進 source code）：
 *   - LINE_CHANNEL_ACCESS_TOKEN  (必填) Channel 長期 access token
 *   - LINE_CHANNEL_SECRET        (選填) Webhook 簽章驗證用
 *   - LINE_TARGET_GROUP_ID       (推薦) 通知群組 ID（最高優先）
 *   - LINE_TARGET_USER_IDS       (備用) 逗號分隔 userId list（multicast）
 *   - SUPERVISOR_USER_IDS        (選填) 主管簽核通知專用 userId list
 *   - LINE_ADMIN_USER_IDS        (選填) 管理者 userId（升級通知用）
 *
 * 公開函式：
 *   - sendReminder_(category, equipments, webFrontendUrl)  取代 sendUnfilledReminder_
 *   - sendIncidentAlert_(incident)                          異常即時通報
 *   - sendApprovalRequest_(record)                           主管待簽核通知
 *   - sendCompletionAck_(record)                            填表完成回報
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

function getSupervisorUserIds_() {
  const fromSheet = getSupervisorUserIdsFromSheet_();
  if (fromSheet.length > 0) return fromSheet;
  return getLineConfig_().supervisorIds;
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
    Logger.log('[LINE] 讀取訂閱者清單主管欄位失敗，改用 SUPERVISOR_USER_IDS: ' + err);
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
      if (id && active && name && (name === target || target.indexOf(name) >= 0 || name.indexOf(target) >= 0)) ids.push(id);
    });
    return Array.from(new Set(ids));
  } catch (err) {
    Logger.log('[LINE] 依主管姓名讀取 LINE_USER_ID 失敗: ' + err);
    return [];
  }
}

function linePushToSupervisorName_(supervisorName, messages) {
  const cfg = getLineConfig_();
  if (!cfg.token) return { ok: false, reason: 'no_token' };
  if (!Array.isArray(messages)) messages = [messages];
  const ids = getSupervisorUserIdsByName_(supervisorName);
  if (ids.length > 1) {
    const res = lineMulticast_(ids, messages);
    return Object.assign({ targetMode: 'named', targetCount: ids.length, supervisorName }, res);
  }
  if (ids.length === 1) {
    const res = linePushTo_(ids[0], messages, 'push');
    return Object.assign({ targetMode: 'named', targetCount: 1, supervisorName }, res);
  }

  const fallbackIds = getSupervisorUserIds_();
  if (fallbackIds.length > 1) {
    const res = lineMulticast_(fallbackIds, messages);
    return Object.assign({ targetMode: 'fallback', targetCount: fallbackIds.length, supervisorName }, res);
  }
  if (fallbackIds.length === 1) {
    const res = linePushTo_(fallbackIds[0], messages, 'push');
    return Object.assign({ targetMode: 'fallback', targetCount: 1, supervisorName }, res);
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

/**
 * 底層 push：依設定優先級選 target
 *   群組 > multicast(多 userId) > 單 userId
 */
function linePush_(messages) {
  const cfg = getLineConfig_();
  if (!cfg.token) {
    Logger.log('[LINE] LINE_CHANNEL_ACCESS_TOKEN 未設定，略過 push');
    return { ok: false, reason: 'no_token' };
  }
  if (!Array.isArray(messages)) messages = [messages];

  // 優先群組
  if (cfg.groupId) {
    return linePushTo_(cfg.groupId, messages, 'push');
  }
  // 多 userId → multicast
  if (cfg.userIds.length > 1) {
    return lineMulticast_(cfg.userIds, messages);
  }
  // 單一 userId
  if (cfg.userIds.length === 1) {
    return linePushTo_(cfg.userIds[0], messages, 'push');
  }
  Logger.log('[LINE] 未設定任何 target (group / user)，略過 push');
  return { ok: false, reason: 'no_target' };
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
 * https://developers.line.biz/en/reference/messaging-api/#display-a-loading-indicator
 */
function startLoadingAnimation_(chatId, seconds) {
  const cfg = getLineConfig_();
  if (!cfg.token || !chatId) return;
  // group/room ID 開頭非 U，不支援 loading
  if (!chatId.startsWith('U')) return;
  try {
    UrlFetchApp.fetch(`${LINE_API}/chat/loading/start`, {
      method: 'post',
      contentType: 'application/json',
      headers: { 'Authorization': 'Bearer ' + cfg.token },
      payload: JSON.stringify({ chatId, loadingSeconds: Math.min(60, Math.max(5, seconds || 10)) }),
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
      { type: 'action', action: { type: 'message', label: '📊 狀態',    text: '狀態' } },
      { type: 'action', action: { type: 'message', label: '🚨 異常',    text: '異常' } },
      { type: 'action', action: { type: 'message', label: '📝 通報',    text: '通報' } },
      { type: 'action', action: { type: 'message', label: '📌 待處理',  text: '待處理' } },
      { type: 'action', action: { type: 'message', label: '📷 QR 選單', text: 'QR選單' } },
      { type: 'action', action: { type: 'message', label: '❓ 幫助',    text: '幫助' } },
    ],
  };
}

/**
 * 設備 QR 選單按鈕（點「QR 選單」後回的子按鈕）
 *
 * LINE Quick Reply 最多 13 個 items；目前 9 個既有入口 + 3 個月檢入口 + 回主選單剛好滿。
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
      { type: 'action', action: { type: 'message', label: '↩ 回主選單',    text: '幫助' } },
    ],
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
  if (!Array.isArray(messages)) messages = [messages];
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
 * sheetUrl: 異常事件追蹤 Google Sheet（INCIDENT_SHEET_URL）
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
      footer: (pdfUrl || sheetUrl) ? {
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
            action: { type: 'uri', label: '📋 異常事件表', uri: sheetUrl },
          }] : []),
        ],
      } : undefined,
    },
  };
}

function visibleChecklistStatusResults_(results) {
  return (results || []).filter(r =>
    String(r.category || '').trim() !== '防護具檢點' &&
    String(r.reason || '').trim() !== '防護具類別不發 reminder'
  );
}

function checklistStatusCategorySummary_(results) {
  const byCat = {};
  visibleChecklistStatusResults_(results).forEach(r => {
    const cat = r.category || '?';
    byCat[cat] = byCat[cat] || [];
    byCat[cat].push(r);
  });
  return Object.keys(byCat).map(cat => {
    const items = byCat[cat];
    const filled = items.filter(r =>
      r.reason === '該類別當日已填' || r.reason === '該類別本月已填'
    ).length;
    const pending = items.filter(r =>
      !r.alreadyFilled &&
      r.reason !== '該類別當日已填' &&
      r.reason !== '該類別本月已填'
    );
    return { category: cat, total: items.length, filled, pending };
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
          { type: 'text', text: '異常事情', size: 'sm', color: '#666666', margin: 'md' },
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
 * INCIDENT_SHEET_URL → 異常事件追蹤 Sheet（備援/輔助）
 * 自動加 Quick Reply 按鈕
 */
function sendIncidentAlert_(incident) {
  const pdfUrl = incident.fileUrl || incident.pdfUrl || '';
  const sheetUrl = PropertiesService.getScriptProperties().getProperty('INCIDENT_SHEET_URL') || '';
  const flex = buildIncidentFlex_(incident, pdfUrl, sheetUrl);
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

function sendDailyIncidentCreated_(incident) {
  const flex = buildDailyIncidentCreatedFlex_(incident);
  return linePush_(withQuickReply_(flex));
}

function sendDailyIncidentReturned_(incident) {
  const flex = buildDailyIncidentReturnedFlex_(incident);
  return linePush_(withQuickReply_(flex));
}

function sendDailyIncidentApprovalRequest_(incident) {
  const approvalUrl = incident.approvalUrl || '';
  if (!approvalUrl || !/^https?:\/\//.test(approvalUrl)) {
    return { ok: false, reason: 'invalid_daily_incident_approval_url' };
  }
  const flex = buildDailyIncidentApprovalFlex_(incident);
  return linePushToSupervisorName_(incident.supervisor, withQuickReply_(flex));
}

function sendDailyIncidentProcessingReviewRequest_(incident) {
  const commentUrl = incident.commentUrl || '';
  if (!commentUrl || !/^https?:\/\//.test(commentUrl)) {
    return { ok: false, reason: 'invalid_daily_incident_comment_url' };
  }
  const flex = buildDailyIncidentProcessingReviewFlex_(incident);
  return linePushToSupervisorName_(incident.supervisor, withQuickReply_(flex));
}

function sendDailyIncidentSupervisorComment_(incident) {
  const flex = buildDailyIncidentSupervisorCommentFlex_(incident);
  return linePush_(withQuickReply_(flex));
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
      lineRichMenuArea_(834, 0, 833, 843, { type: 'uri', uri: incidentUrl }),
      lineRichMenuArea_(1667, 0, 833, 843, { type: 'message', text: '狀態' }),
      lineRichMenuArea_(0, 843, 834, 843, { type: 'message', text: '異常' }),
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
