/**
 * ===== LINE Webhook 處理 + 雙向指令 dispatcher =====
 *
 * 由 Main.gs 的 doPost 在偵測到 LINE webhook 簽章時轉進來。
 *
 * 支援指令（傳給 bot 的 text message）：
 *   - 狀態 / status         今日填表進度
 *   - 待發文 / dispatch     查詢自己今日公文待發文快照（非即時登入）
 *   - 異常 / open           待處理異常事件清單
 *   - 通報 / incident       日常異常事件通報表
 *   - 待處理 / incidents    日常異常事件未結案清單
 *   - 事件 事件ID           查詢日常異常事件
 *   - 更新 事件ID           取得日常異常事件處理回報連結
 *   - 陳核 事件ID           日常異常事件送主管審核
 *   - QR 設備代號          QR Code (附連結)
 *   - 完成 事件ID          標記異常已完成
 *   - 我的ID / myid         回應自己的 userId（debug 用）
 *   - 幫助 / help           列指令
 */

/**
 * 處理 LINE webhook 進來的 payload
 * 由 Main.gs doPost 在 path 是 LINE webhook 時呼叫
 *
 * 注意：簽章驗證 (X-Line-Signature) Apps Script 讀不到 HTTP headers
 * 已改在 doPost 用 URL query token 驗證 (LINE_WEBHOOK_QUERY_TOKEN)
 * 此函式收到 rawBody 已是通過 doPost 驗證的 — 不再做 secret 驗證
 */
function handleLineWebhook_(rawBody) {
  let body;
  try {
    body = JSON.parse(rawBody);
  } catch (_) {
    return { ok: false, error: 'bad_json' };
  }
  const events = body.events || [];
  for (const ev of events) {
    try {
      dispatchLineEvent_(ev);
    } catch (e) {
      Logger.log('[LINE webhook] event 處理失敗: ' + e + '\n' + (e.stack || ''));
    }
  }
  return { ok: true, processed: events.length };
}

function dispatchLineEvent_(ev) {
  if (ev.type === 'follow') {
    return lineReply_(ev.replyToken, buildLineFriendWelcomeFlex_());
  }

  // 只處理 message + text 類型
  if (ev.type !== 'message' || !ev.message || ev.message.type !== 'text') return;
  const text = String(ev.message.text || '').trim();
  const replyToken = ev.replyToken;
  const source = ev.source || {};
  const userId = source.userId || '';

  // 群組訊息：只有提到 bot 才回（避免吵）
  // 簡化：群組訊息要 @bot 開頭，或前綴 / 才處理
  if (source.type === 'group' || source.type === 'room') {
    if (!text.startsWith('/') && !text.startsWith('@')) return;
  }
  const cmd = normalizeLineCommand_(text);

  if (source.type === 'user' && typeof startLoadingAnimation_ === 'function') {
    startLoadingAnimation_(userId, 10);
  }

  if (requiresLineSubscriberAuth_(cmd) && !isLineSubscriberUser_(userId)) {
    return lineReply_(replyToken, buildSubscriberRegistrationFlex_());
  }

  // 指令路由
  if (/^(狀態|status)$/i.test(cmd))    return cmdStatus_(replyToken, userId);
  if (/^(每日作業|作業|work|dailywork)$/i.test(cmd)) return cmdDailyWorkCheck_(replyToken);
  if (/^(待發文|公文待發文|dispatch|documents)$/i.test(cmd)) return cmdOfficialDocumentDispatch_(replyToken, userId);
  if (/^(異常|open)$/i.test(cmd))      return cmdOpenIncidents_(replyToken);
  if (/^(通報|incident)$/i.test(cmd))  return cmdDailyIncidentReport_(replyToken);
  if (/^(待處理|incidents)$/i.test(cmd)) return cmdDailyIncidentList_(replyToken, userId);
  let dailyMatch = matchDailyIncidentLineCommand_(cmd, '事件');
  if (dailyMatch) {
    const incId = dailyMatch;
    return cmdDailyIncidentDetail_(replyToken, incId, userId);
  }
  dailyMatch = matchDailyIncidentLineCommand_(cmd, '更新');
  if (dailyMatch) {
    const incId = dailyMatch;
    return cmdDailyIncidentUpdate_(replyToken, incId, userId);
  }
  dailyMatch = matchDailyIncidentLineCommand_(cmd, '陳核');
  if (dailyMatch) {
    const incId = dailyMatch;
    return cmdDailyIncidentSubmitApproval_(replyToken, incId, userId);
  }
  dailyMatch = matchDailyIncidentLineCommand_(cmd, '結案');
  if (dailyMatch) {
    return lineReply_(replyToken, withQuickReply_(buildDailyIncidentNoticeFlex_(
      '🖊 日常事件由主管審核結案',
      '日常異常事件需由主管開啟審核圖卡，按「同意結案」後才算正式結案。請先在處理回報頁將狀態改為「處理完成」並陳核主管。',
      { color: '#1a73e8' }
    )));
  }
  if (/^QR\s*(選單|列表|menu|list)$/i.test(cmd)) return cmdQRList_(replyToken);
  if (/^QR\s*(.+)$/i.test(cmd)) {
    const eqp = cmd.match(/^QR\s*(.+)$/i)[1].trim();
    return cmdQR_(replyToken, eqp);
  }
  if (/^完成\s*(.+)$/i.test(cmd)) {
    const incId = cmd.match(/^完成\s*(.+)$/i)[1].trim();
    return cmdComplete_(replyToken, incId, userId);
  }
  if (/^(我的ID|myid|whoami)$/i.test(cmd)) {
    return lineReply_(replyToken, { type: 'text', text: `你的 userId: ${userId}` });
  }
  if (/^(幫助|help|\?)$/i.test(cmd))  return cmdHelp_(replyToken);

  // 未知指令：群組 ignore、個人回提示
  if (source.type === 'user') {
    return lineReply_(replyToken, {
      type: 'text',
      text: '看不懂這個操作。請輸入「幫助」查看可用清單，或點下方按鈕操作。',
    });
  }
}

function requiresLineSubscriberAuth_(cmd) {
  const text = String(cmd || '').trim();
  if (!text) return false;
  if (/^(幫助|help|\?|我的ID|myid|whoami)$/i.test(text)) return false;
  return true;
}

function normalizeLineCommand_(text) {
  let s = String(text || '').trim();
  try { s = s.normalize('NFKC'); } catch (_) {}
  return s
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .replace(/^[\/@]+/, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeDailyIncidentCommandId_(value) {
  const normalized = String(value || '')
    .replace(/[‐‑‒–—－]/g, '-')
    .replace(/\s+/g, '')
    .toUpperCase();
  const compact = normalized.replace(/-/g, '');
  const m = compact.match(/^INC(\d{7})(\d{3})$/);
  return m ? `INC-${m[1]}-${m[2]}` : normalized;
}

function matchDailyIncidentLineCommand_(cmd, verb) {
  const re = new RegExp('^' + verb + '\\s*(INC[\\s\\-‐‑‒–—－]*\\d{7}[\\s\\-‐‑‒–—－]*\\d{3})$', 'i');
  const m = String(cmd || '').match(re);
  return m ? normalizeDailyIncidentCommandId_(m[1]) : '';
}

// ===== 指令實作 =====

function cmdHelp_(replyToken) {
  return lineReply_(replyToken, {
    type: 'text',
    text: [
      'ISHA 通知小幫手｜可用指令',
      '',
      '常用功能：',
      '狀態：今日填表進度、月檢應填 / 補填提醒',
      '待發文：查看 16:30 / 17:00 雲端檢核快照，不是即時登入公文系統',
      '異常：查機具設備檢查產生的未完成異常',
      '通報：開啟日常異常事件通報表',
      '待處理：查未結案日常異常事件',
      'QR選單：設備、教室月檢表單入口',
      '',
      '日常事件：',
      '事件 <事件ID>：查詢日常事件摘要',
      '更新 <事件ID>：取得處理回報連結',
      '陳核 <事件ID>：處理完成後通知主管審核',
      '日常事件只顯示本人填報、承辦或被指定主管審核的案件。',
      '',
      '機具設備異常：',
      '完成 <事件ID>：將機具設備異常標記為已完成',
      '',
      'QR 快捷：',
      'QR CRANE-LJ-001：固定式起重機',
      'QR FORK-LJ-A～FORK-LJ-F：堆高機 A～F',
      'QR AWP-LJ-001：車載式高空工作車',
      'QR AWP-LJ-SP-001：自走高空車',
      'QR CLASSROOM-LJ-MEAS-PPE：龍井教室月檢',
      'QR CLASSROOM-FX-MEAS-PPE：復興教室月檢',
      'QR CLASSROOM-ZM-MEAS-PPE：忠明教室月檢',
      '',
      '提醒與通知：',
      '日檢 / 月檢未填提醒由系統排程推播。',
      '三間教室、堆高機、固定式起重機月檢完成後會通知主管簽核。',
      '每日場地防護具不再逐日催填；每月第一個工作日會提醒承辦開啟月度彙整 PDF 簽名確認。',
      '一般推播由試算表「訂閱者清單」的「是否訂閱」控制；設為否就不收主動通知。',
      '設備異常、日檢未填、機具月檢未填、三間教室月檢可再用同名欄位分別控制。',
      '主管通知由「是否為主管」加上對應通知欄位共同控制。',
      '',
      '待發文注意：',
      '看不到本人資料時，請確認 LINE 已在「訂閱者清單」綁定姓名、是否訂閱=是，並標記為同仁。',
      '顯示尚未有檢核紀錄時，代表當日批次尚未跑完或尚未寫入快照。',
      '',
      '其他：',
      '我的ID：顯示你的 LINE userId',
      '幫助：顯示這個清單',
      '',
      '請直接在 ISHA 通知小幫手的一對一聊天中操作。',
    ].join('\n'),
  });
}

/**
 * QR 選單：列出所有設備/月檢按鈕讓使用者點。
 */
function cmdQRList_(replyToken) {
  return lineReply_(replyToken, buildQrMenuFlex_());
}

function cmdStatus_(replyToken, userId) {
  // 跑 dryRun 的 dailyReminderJob 拿狀態（含 monthlyReminderJob_ 已過濾的月檢結果）
  // 月檢設備：非應檢期(1-5)且非補填提醒期(25+)時，monthlyReminderJob_ 已完全不 push，狀態不會列
  const results = dailyReminderJob({ dryRun: true });
  const messages = [buildChecklistStatusFlex_(results)];
  if (typeof isDailyWorkCheckEnabled_ === 'function' && isDailyWorkCheckEnabled_() &&
      typeof getDailyWorkCheckStatus_ === 'function' && typeof buildDailyWorkStatusFlex_ === 'function') {
    messages.push(buildDailyWorkStatusFlex_(getDailyWorkCheckStatus_({ userId })));
  }
  return lineReply_(replyToken, withQuickReply_(messages));
}

// 舊版每日作業檢核已停用；此指令只保留停用提示，避免舊 quick reply 或舊截圖入口失效無回應。
function cmdDailyWorkCheck_(replyToken) {
  if (typeof isDailyWorkCheckEnabled_ === 'function' && !isDailyWorkCheckEnabled_()) {
    return lineReply_(replyToken, withQuickReply_({
      type: 'text',
      text: '每日作業檢核已暫停使用；後續改由公文待發文雲端檢核於 16:30 / 17:00 提醒。',
    }));
  }
  const url = (typeof buildDailyWorkCheckPublicUrl_ === 'function') ? buildDailyWorkCheckPublicUrl_() : '';
  if (!url) return lineReply_(replyToken, { type: 'text', text: '✗ 系統設定 webFrontendUrl 未填，無法建立每日作業檢核連結' });
  return lineReply_(replyToken, withQuickReply_(buildDailyWorkCheckEntryFlex_(url)));
}

function cmdOfficialDocumentDispatch_(replyToken, userId) {
  if (typeof getOfficialDocumentQueueStatusForUser_ !== 'function') {
    return lineReply_(replyToken, { type: 'text', text: '✗ 公文待發文模組尚未部署完成' });
  }
  return lineReply_(replyToken, withQuickReply_(getOfficialDocumentQueueStatusForUser_(userId)));
}

function cmdOpenIncidents_(replyToken) {
  const res = listOpenIncidents_();
  const incidents = res.incidents || [];
  return lineReply_(replyToken, withQuickReply_(buildOpenIncidentsFlex_(incidents)));
}

function cmdDailyIncidentReport_(replyToken) {
  const url = (typeof buildDailyIncidentPublicUrl_ === 'function') ? buildDailyIncidentPublicUrl_() : '';
  if (!url) return lineReply_(replyToken, { type: 'text', text: '✗ 系統設定 webFrontendUrl 未填，無法建立日常事件通報連結' });
  return lineReply_(replyToken, withQuickReply_(buildDailyIncidentReportEntryFlex_(url)));
}

function cmdDailyIncidentList_(replyToken, userId) {
  const res = (typeof listOpenDailyIncidentsForLineUser_ === 'function')
    ? listOpenDailyIncidentsForLineUser_(userId)
    : listOpenDailyIncidents_();
  const incidents = res.incidents || [];
  return lineReply_(replyToken, withQuickReply_(buildDailyIncidentListFlex_(incidents)));
}

function cmdDailyIncidentDetail_(replyToken, incidentId, userId) {
  try {
    const inc = (typeof getDailyIncidentPublicDetailForLineUser_ === 'function')
      ? getDailyIncidentPublicDetailForLineUser_(incidentId, userId)
      : getDailyIncidentPublicDetail_(incidentId);
    const flex = buildDailyIncidentCreatedFlex_(inc, {
      title: '📌 日常異常事件',
      color: '#1a73e8',
      accentColor: '#174ea6',
    });
    return lineReply_(replyToken, withQuickReply_(flex));
  } catch (err) {
    return lineReply_(replyToken, { type: 'text', text: '✗ ' + friendlyError_(err) });
  }
}

function cmdDailyIncidentUpdate_(replyToken, incidentId, userId) {
  try {
    const inc = (typeof getDailyIncidentPublicDetailForLineUser_ === 'function')
      ? getDailyIncidentPublicDetailForLineUser_(incidentId, userId)
      : getDailyIncidentPublicDetail_(incidentId);
    if (!inc.updateUrl) return lineReply_(replyToken, { type: 'text', text: '✗ 系統設定 webAppUrl 未填，無法建立處理回報連結' });
    const flex = buildDailyIncidentCreatedFlex_(inc, {
      title: '🛠 日常事件處理回報',
      color: '#174EA6',
      accentColor: '#174EA6',
    });
    return lineReply_(replyToken, withQuickReply_(flex));
  } catch (err) {
    return lineReply_(replyToken, { type: 'text', text: '✗ ' + friendlyError_(err) });
  }
}

function cmdDailyIncidentSubmitApproval_(replyToken, incidentId, userId) {
  try {
    const res = (typeof submitDailyIncidentForApprovalFromLine_ === 'function')
      ? submitDailyIncidentForApprovalFromLine_({ incidentId }, userId)
      : submitDailyIncidentForApproval_({ incidentId });
    if (!res.ok) return lineReply_(replyToken, { type: 'text', text: '✗ 陳核失敗' });
    const inc = res.incident;
    const flex = buildDailyIncidentCreatedFlex_(inc, {
      title: '🖊 已送主管審核',
      color: '#1a73e8',
      accentColor: '#174ea6',
    });
    return lineReply_(replyToken, withQuickReply_(flex));
  } catch (err) {
    return lineReply_(replyToken, { type: 'text', text: '✗ ' + friendlyError_(err) });
  }
}

function formatDailyIncidentApprovalNoticeForLine_(notice) {
  if (!notice) return '但主管 LINE 通知狀態不明，請確認主管是否收到審核圖卡。';
  if (notice.skipped) return '但主管 LINE 通知設定目前關閉。';
  if (notice.ok) {
    if (notice.targetMode === 'named') return '已通知指定主管。';
    if (notice.targetMode === 'keyed') return '已通知指定主管。';
    return '已通知主管。';
  }
  if (notice.reason === 'supervisor_not_found') return `但找不到「${notice.supervisorName || '指定主管'}」的 LINE 通知對象。`;
  if (notice.reason === 'no_supervisor') return '但沒有標記為主管的 LINE 通知對象。';
  if (notice.reason === 'no_token') return '但 LINE_CHANNEL_ACCESS_TOKEN 未設定。';
  return '但主管 LINE 通知未送出，請確認 LINE 設定或手動轉貼審核連結。';
}

function cmdQR_(replyToken, eqp) {
  if (isLegacyScbaQrEquipment_(eqp)) {
    return lineReply_(replyToken, {
      type: 'text',
      text: 'SCBA 月檢已併入三間教室月檢表下方區塊，請改用 QR選單 選擇龍井、復興或忠明教室月檢。',
    });
  }
  const url = (CONFIG.webFrontendUrl || getSettingValue_('webFrontendUrl') || '');
  if (!url) return lineReply_(replyToken, { type: 'text', text: '✗ 系統設定 webFrontendUrl 未填' });
  const targetUrl = buildChecklistQrTargetUrl_(url, eqp);
  const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(targetUrl)}`;
  return lineReply_(replyToken, [
    { type: 'image', originalContentUrl: qrUrl, previewImageUrl: qrUrl },
    { type: 'text', text: `🔗 ${targetUrl}` },
  ]);
}

function buildChecklistQrTargetUrl_(baseUrl, eqp) {
  const normalizedEqp = String(eqp || '').trim().toUpperCase();
  const page = isMonthlyOnlyQrEquipment_(normalizedEqp) ? 'monthly.html' : 'daily.html';
  return `${String(baseUrl || '').replace(/\/$/, '')}/${page}?eqp=${encodeURIComponent(normalizedEqp)}`;
}

function isMonthlyOnlyQrEquipment_(eqp) {
  return [
    'CLASSROOM-LJ-MEAS-PPE',
    'CLASSROOM-FX-MEAS-PPE',
    'CLASSROOM-ZM-MEAS-PPE',
  ].indexOf(String(eqp || '').trim().toUpperCase()) >= 0;
}

function isLegacyScbaQrEquipment_(eqp) {
  return String(eqp || '').trim().toUpperCase() === 'PPE-SCBA-MONTHLY';
}

function cmdComplete_(replyToken, incIdPrefix, byUserId) {
  // P2.1 (codex 2026-05-26): prefix 至少 8 碼且必須唯一命中（避免 LINE 使用者打太短誤標多筆）
  if (!incIdPrefix || incIdPrefix.length < 8) {
    return lineReply_(replyToken, { type: 'text', text: '✗ 事件ID 至少需 8 碼' });
  }
  // 用 prefix 找完整事件 ID
  const ss = SpreadsheetApp.openById(CONFIG.DB_SHEET_ID);
  const sheet = getMachineIncidentSheet_(ss);
  if (!sheet) return lineReply_(replyToken, { type: 'text', text: '✗ 找不到「機具設備異常事件」表' });
  const data = sheet.getDataRange().getValues();
  const headers = data[0];
  const idCol = headers.indexOf('事件ID');
  const statusCol = headers.indexOf('狀態');
  const completedCol = headers.indexOf('實際完成日');
  const ownerCol = headers.indexOf('負責人');
  if (idCol < 0 || statusCol < 0) {
    return lineReply_(replyToken, { type: 'text', text: '✗ 「機具設備異常事件」表缺欄位' });
  }
  // 先找所有符合 prefix 的「未完成」列，若 >1 拒絕（避免一次標多筆）
  const matched = [];
  for (let i = 1; i < data.length; i++) {
    const id = String(data[i][idCol] || '');
    if (!id.startsWith(incIdPrefix)) continue;
    if (String(data[i][statusCol]) === '已完成') continue;
    matched.push({ rowIdx: i, id });
  }
  if (matched.length === 0) {
    return lineReply_(replyToken, { type: 'text', text: '✗ 找不到符合的未完成異常（prefix 太短或已完成）' });
  }
  if (matched.length > 1) {
    return lineReply_(replyToken, {
      type: 'text',
      text: `✗ Prefix「${incIdPrefix}」命中 ${matched.length} 筆，請貼完整事件ID 才能標記（避免誤標）`,
    });
  }
  let found = 0;
  const today = Utilities.formatDate(new Date(), tz_(), 'yyyy-MM-dd');
  matched.forEach(m => {
    const i = m.rowIdx;
    sheet.getRange(i + 1, statusCol + 1).setValue('已完成');
    if (completedCol >= 0 && !data[i][completedCol]) {
      sheet.getRange(i + 1, completedCol + 1).setValue(today);
    }
    if (ownerCol >= 0 && byUserId && !data[i][ownerCol]) {
      sheet.getRange(i + 1, ownerCol + 1).setValue(`LINE:${byUserId.substring(0,8)}`);
    }
    found++;
  });
  const msg = found > 0
    ? `✓ 已標記 ${found} 筆異常為「已完成」`
    : `✗ 找不到 ID 開頭為 ${incIdPrefix} 的待處理異常`;
  return lineReply_(replyToken, { type: 'text', text: msg });
}

/**
 * 取得「系統設定」表中某 key 的值
 */
function getSettingValue_(key) {
  try {
    const sheet = SpreadsheetApp.openById(CONFIG.DB_SHEET_ID).getSheetByName('系統設定');
    if (!sheet) return null;
    const data = sheet.getDataRange().getValues();
    for (let i = 1; i < data.length; i++) {
      if (data[i][0] === key) return data[i][1];
    }
  } catch (_) {}
  return null;
}
