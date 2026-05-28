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

function getSupervisorUserIds_() {
  const fromSheet = getSupervisorUserIdsFromSheet_();
  if (fromSheet.length > 0) return fromSheet;
  return getLineConfig_().supervisorIds;
}

function getSupervisorUserIdsFromSheet_() {
  try {
    if (!CONFIG.DB_SHEET_ID || CONFIG.DB_SHEET_ID.startsWith('REPLACE_')) return [];
    const sheet = SpreadsheetApp.openById(CONFIG.DB_SHEET_ID).getSheetByName('主管清單');
    if (!sheet || sheet.getLastRow() < 2) return [];
    const data = sheet.getDataRange().getValues();
    const headers = data[0].map(h => String(h || '').trim());
    const idCol = headers.indexOf('LINE_USER_ID');
    const activeCol = headers.indexOf('是否啟用');
    if (idCol < 0) return [];
    const ids = [];
    data.slice(1).forEach(row => {
      const id = String(row[idCol] || '').trim();
      const active = activeCol < 0 ? true : isActiveValue_(row[activeCol]);
      if (id && active) ids.push(id);
    });
    return Array.from(new Set(ids));
  } catch (err) {
    Logger.log('[LINE] 讀取主管清單失敗，改用 SUPERVISOR_USER_IDS: ' + err);
    return [];
  }
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
      { type: 'action', action: { type: 'message', label: '📷 QR 選單', text: 'QR選單' } },
      { type: 'action', action: { type: 'message', label: '❓ 幫助',    text: '幫助' } },
      { type: 'action', action: { type: 'message', label: '📍 這裡',    text: '這裡' } },
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

/**
 * 高層 API：寄未填提醒（給 Reminder.gs 用）
 * 自動加 Quick Reply 按鈕
 */
function sendReminder_(category, equipments, webFrontendUrl, opts) {
  const flex = buildReminderFlex_(category, equipments, webFrontendUrl || '', opts);
  return linePush_(withQuickReply_(flex));
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
  const supervisorIds = getSupervisorUserIds_();
  if (supervisorIds.length > 1) return lineMulticast_(supervisorIds, messages);
  if (supervisorIds.length === 1) return linePushTo_(supervisorIds[0], messages, 'push');
  return linePush_(messages);
}

/**
 * 簡單文字訊息（debug / fallback）
 * 自動加 Quick Reply 按鈕
 */
function sendLineText_(text) {
  return linePush_(withQuickReply_({ type: 'text', text }));
}
