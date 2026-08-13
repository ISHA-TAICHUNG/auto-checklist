/**
 * ===== 主管營運資訊面板 =====
 *
 * 僅由 doPost 的 adminDashboardStatus 呼叫。所有資料都先通過
 * API_TOKEN + ADMIN_TOKEN 驗證，且回傳內容不包含 LINE userId、token 或簽核網址。
 */

const ADMIN_DASHBOARD_CACHE_KEY = "admin_dashboard_status_v3";
const ADMIN_DASHBOARD_CACHE_SECONDS = 120;
const ADMIN_DASHBOARD_SNAPSHOT_PREFIX = "admin_dashboard_snapshot_v3_";
// Script Properties 單值上限按位元組計算；中文可占 3 bytes，保守切小。
const ADMIN_DASHBOARD_SNAPSHOT_CHUNK_SIZE = 2500;
const ADMIN_DASHBOARD_SNAPSHOT_MAX_CHUNKS = 60;
const ADMIN_DASHBOARD_SNAPSHOT_MAX_BYTES = 200000;
const ADMIN_DASHBOARD_REFRESH_SECONDS = 600;
const ADMIN_DASHBOARD_ACTION_MODES = ["resolveLink", "previewNotification", "sendNotification"];
const ADMIN_DASHBOARD_RECORD_TYPES = [
  "machineIncident",
  "dailyIncident",
  "approval",
  "checklist",
];
const ADMIN_DASHBOARD_NOTIFICATION_DEDUPE_SECONDS = 10 * 60;
const ADMIN_DASHBOARD_NOTIFICATION_IN_FLIGHT_SECONDS = 3 * 60;
const ADMIN_DASHBOARD_ACTION_TOKEN_TTL_SECONDS = 30 * 60;
const ADMIN_DASHBOARD_LEGACY_SNAPSHOT_PREFIXES = ["admin_dashboard_snapshot_v2_"];

/**
 * 營運中控台核發的短效操作權杖。權杖只能用於指定的
 * 資料與操作範圍，不包含 ADMIN_TOKEN，30 分鐘後自動失效。
 */
function createAdminDashboardActionToken_(scope, recordId) {
  const safeScope = String(scope || "").trim();
  const safeRecordId = String(recordId || "").trim();
  if (!safeScope || !safeRecordId) throw new Error("缺少管理操作權杖範圍或紀錄ID");
  const payload = {
    v: 1,
    s: safeScope,
    r: safeRecordId,
    e: Math.floor(Date.now() / 1000) + ADMIN_DASHBOARD_ACTION_TOKEN_TTL_SECONDS,
  };
  const encoded = Utilities.base64EncodeWebSafe(
    JSON.stringify(payload),
    Utilities.Charset.UTF_8,
  ).replace(/=+$/g, "");
  return encoded + "." + adminDashboardActionTokenSignature_(encoded);
}

function isValidAdminDashboardActionToken_(token, scope, recordId) {
  try {
    assertAdminDashboardActionToken_(token, scope, recordId);
    return true;
  } catch (_) {
    return false;
  }
}

function assertAdminDashboardActionToken_(token, scope, recordId) {
  const parts = String(token || "").split(".");
  if (
    parts.length !== 2 ||
    !adminDashboardConstantTimeEqual_(
      parts[1],
      adminDashboardActionTokenSignature_(parts[0]),
    )
  ) {
    throw new Error("管理操作連結無效");
  }
  let payload;
  try {
    let encoded = parts[0];
    while (encoded.length % 4) encoded += "=";
    payload = JSON.parse(
      Utilities.newBlob(Utilities.base64DecodeWebSafe(encoded))
        .getDataAsString("UTF-8"),
    );
  } catch (_) {
    throw new Error("管理操作連結格式錯誤");
  }
  if (
    payload.v !== 1 ||
    String(payload.s || "") !== String(scope || "") ||
    String(payload.r || "") !== String(recordId || "")
  ) {
    throw new Error("管理操作連結與紀錄不符");
  }
  if (!payload.e || Number(payload.e) < Math.floor(Date.now() / 1000)) {
    throw new Error("管理操作連結已逾期，請從中控台重新開啟");
  }
  return payload;
}

function adminDashboardActionTokenSecret_() {
  const properties = PropertiesService.getScriptProperties();
  let secret = properties.getProperty("ADMIN_DASHBOARD_ACTION_SECRET") || "";
  if (secret) return secret;

  // 首次建立時序列化，避免兩個並行請求各自簽出不同密鑰的短效連結。
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) throw new Error("系統忙碌，請稍後再試");
  try {
    secret = properties.getProperty("ADMIN_DASHBOARD_ACTION_SECRET") || "";
    if (!secret) {
      secret = uuid_() + "-" + uuid_();
      properties.setProperty("ADMIN_DASHBOARD_ACTION_SECRET", secret);
    }
    return secret;
  } finally {
    lock.releaseLock();
  }
}

function adminDashboardActionTokenSignature_(encoded) {
  const bytes = Utilities.computeHmacSha256Signature(
    String(encoded || ""),
    adminDashboardActionTokenSecret_(),
    Utilities.Charset.UTF_8,
  );
  return bytes
    .map((value) => ((value + 256) % 256).toString(16).padStart(2, "0"))
    .join("");
}

function adminDashboardConstantTimeEqual_(left, right) {
  const a = String(left || "");
  const b = String(right || "");
  let diff = a.length ^ b.length;
  const max = Math.max(a.length, b.length);
  for (let index = 0; index < max; index++) {
    diff |= (a.charCodeAt(index) || 0) ^ (b.charCodeAt(index) || 0);
  }
  return diff === 0;
}

function getAdminDashboardStatus_(opts) {
  opts = opts || {};
  const forceRefresh = opts.forceRefresh === true;
  const snapshotOnly = opts.snapshotOnly === true && !forceRefresh;
  const cache = CacheService.getScriptCache();
  const cached = forceRefresh ? "" : cache.get(ADMIN_DASHBOARD_CACHE_KEY);
  if (cached) {
    try {
      return dashboardDecorateSnapshot_(JSON.parse(cached), "cache");
    } catch (_) {}
  }

  // 先回傳最近一次成功快照，避免使用者每次開啟都等待多個
  // Sheets / Drive / LINE 來源依序查詢。完整更新由前端在畫面顯示後執行。
  if (!forceRefresh) {
    const persisted = dashboardReadPersistedSnapshot_();
    if (persisted) return dashboardDecorateSnapshot_(persisted, "snapshot");
  }

  // 首次開啟尚未建立快照時，先完成權限驗證並立即回傳空殼。
  // 前端會在解鎖後於背景建立完整快照，避免使用者卡在驗證視窗。
  if (snapshotOnly) return dashboardPendingSnapshot_();

  const now = new Date();
  const today = todayStart_();
  const sections = {};
  const sectionErrors = {};

  sections.checks = dashboardCaptureSection_(
    "checks",
    () => dashboardChecklistStatus_(today),
    sectionErrors,
  );
  sections.incidents = dashboardCaptureSection_(
    "incidents",
    dashboardIncidentStatus_,
    sectionErrors,
  );
  sections.approvals = dashboardCaptureSection_(
    "approvals",
    dashboardApprovalStatus_,
    sectionErrors,
  );
  sections.officialDocuments = dashboardCaptureSection_(
    "officialDocuments",
    dashboardOfficialDocumentStatus_,
    sectionErrors,
  );
  sections.notifications = dashboardCaptureSection_(
    "notifications",
    dashboardNotificationStatus_,
    sectionErrors,
  );
  sections.system = dashboardCaptureSection_(
    "system",
    dashboardSystemHealth_,
    sectionErrors,
  );

  const result = {
    ok: true,
    generatedAt: Utilities.formatDate(now, tz_(), "yyyy-MM-dd'T'HH:mm:ssXXX"),
    generatedAtLabel: Utilities.formatDate(now, tz_(), "yyyy/MM/dd HH:mm:ss"),
    date: formatISODate_(today),
    timeZone: tz_(),
    refreshAfterSeconds: ADMIN_DASHBOARD_REFRESH_SECONDS,
    cached: false,
    overall: dashboardOverallStatus_(sections, sectionErrors),
    summary: dashboardSummary_(sections),
    sections,
    sectionErrors,
  };

  try {
    const serialized = JSON.stringify(result);
    cache.put(
      ADMIN_DASHBOARD_CACHE_KEY,
      serialized,
      ADMIN_DASHBOARD_CACHE_SECONDS,
    );
    dashboardPersistSnapshot_(serialized);
  } catch (_) {}
  return result;
}

function dashboardPendingSnapshot_() {
  return {
    ok: true,
    generatedAt: "",
    generatedAtLabel: "正在建立最新資料",
    date: formatISODate_(todayStart_()),
    timeZone: tz_(),
    refreshAfterSeconds: ADMIN_DASHBOARD_REFRESH_SECONDS,
    cached: false,
    cacheSource: "none",
    snapshotPending: true,
    snapshotStale: true,
    overall: { level: "neutral", label: "資料更新中" },
    summary: {},
    sections: {},
    sectionErrors: {},
  };
}

function dashboardDecorateSnapshot_(snapshot, source) {
  const result = Object.assign({}, snapshot || {});
  const generatedAtMs = Date.parse(String(result.generatedAt || ""));
  const ageSeconds = isNaN(generatedAtMs)
    ? null
    : Math.max(0, Math.floor((Date.now() - generatedAtMs) / 1000));
  result.cached = true;
  result.cacheSource = source;
  result.snapshotAgeSeconds = ageSeconds;
  result.snapshotStale = ageSeconds == null || ageSeconds > ADMIN_DASHBOARD_REFRESH_SECONDS;
  result.refreshAfterSeconds = ADMIN_DASHBOARD_REFRESH_SECONDS;
  return result;
}

function dashboardPersistSnapshot_(serialized) {
  const text = String(serialized || "");
  if (!text) return;
  const properties = PropertiesService.getScriptProperties();
  const chunks = [];
  for (let offset = 0; offset < text.length; offset += ADMIN_DASHBOARD_SNAPSHOT_CHUNK_SIZE) {
    chunks.push(text.slice(offset, offset + ADMIN_DASHBOARD_SNAPSHOT_CHUNK_SIZE));
  }
  const byteLength = Utilities.newBlob(text, "application/json").getBytes().length;
  if (
    chunks.length > ADMIN_DASHBOARD_SNAPSHOT_MAX_CHUNKS ||
    byteLength > ADMIN_DASHBOARD_SNAPSHOT_MAX_BYTES
  ) {
    dashboardDeleteSnapshotByPrefix_(properties, ADMIN_DASHBOARD_SNAPSHOT_PREFIX);
    dashboardDeleteLegacySnapshots_(properties);
    Logger.log("[AdminDashboard] snapshot 超出保存上限，已清除舊快照 bytes=" + byteLength);
    return;
  }
  const previousCount = Number(properties.getProperty(ADMIN_DASHBOARD_SNAPSHOT_PREFIX + "count") || 0);
  const values = {};
  values[ADMIN_DASHBOARD_SNAPSHOT_PREFIX + "count"] = String(chunks.length);
  chunks.forEach((chunk, index) => {
    values[ADMIN_DASHBOARD_SNAPSHOT_PREFIX + index] = chunk;
  });
  properties.setProperties(values, false);
  for (let index = chunks.length; index < previousCount; index++) {
    properties.deleteProperty(ADMIN_DASHBOARD_SNAPSHOT_PREFIX + index);
  }
  dashboardDeleteLegacySnapshots_(properties);
}

function dashboardDeleteLegacySnapshots_(properties) {
  ADMIN_DASHBOARD_LEGACY_SNAPSHOT_PREFIXES.forEach((prefix) => {
    dashboardDeleteSnapshotByPrefix_(properties, prefix);
  });
}

function dashboardDeleteSnapshotByPrefix_(properties, prefix) {
  const values = properties.getProperties();
  Object.keys(values).forEach((key) => {
    const suffix = key.substring(prefix.length);
    if (key === prefix + "count" || (key.indexOf(prefix) === 0 && /^\d+$/.test(suffix))) {
      properties.deleteProperty(key);
    }
  });
}

function dashboardReadPersistedSnapshot_() {
  try {
    const properties = PropertiesService.getScriptProperties();
    const count = Number(properties.getProperty(ADMIN_DASHBOARD_SNAPSHOT_PREFIX + "count") || 0);
    if (!count || count > ADMIN_DASHBOARD_SNAPSHOT_MAX_CHUNKS) return null;
    let serialized = "";
    for (let index = 0; index < count; index++) {
      const chunk = properties.getProperty(ADMIN_DASHBOARD_SNAPSHOT_PREFIX + index);
      if (chunk == null) return null;
      serialized += chunk;
    }
    const parsed = JSON.parse(serialized);
    return parsed && parsed.ok === true ? parsed : null;
  } catch (_) {
    return null;
  }
}

function dashboardCaptureSection_(name, getter, errors) {
  try {
    const value = getter();
    return Object.assign({ available: true }, value || {});
  } catch (err) {
    errors[name] = "SOURCE_UNAVAILABLE";
    Logger.log("[AdminDashboard:" + name + "] " + err + "\n" + ((err && err.stack) || ""));
    return { available: false };
  }
}

function dashboardChecklistStatus_(today) {
  const equipments = dashboardEquipmentListReadOnly_();
  const cyclesByCategory = getTemplateCyclesByCategory_();
  const recordIndex = dashboardChecklistRecordIndex_();
  const venueContext = dashboardVenueContext_();
  const dailyByCategory = {};
  const monthlyByCategory = {};

  equipments.forEach((item) => {
    const equipment = item;
    const cycles = cyclesByCategory[equipment.category] || [];

    if (cycles.indexOf("每日") >= 0 && equipment.category !== "防護具檢點") {
      if (!dailyByCategory[equipment.category]) {
        dailyByCategory[equipment.category] = {
          category: equipment.category,
          equipments: [],
          usage: [],
        };
      }
      const group = dailyByCategory[equipment.category];
      group.equipments.push({
        equipmentId: equipment.equipmentId,
        equipmentName: equipment.equipmentName,
        location: equipment.location || "",
      });
      const usage = dashboardVenueUsage_(equipment, today, venueContext);
      if (usage && usage.used) {
        group.usage.push({
          equipmentId: equipment.equipmentId,
          equipmentName: equipment.equipmentName,
          content: usage.content || "",
        });
      }
    }

    if (isMonthlyReminderCategory_(equipment.category)) {
      if (!monthlyByCategory[equipment.category]) {
        monthlyByCategory[equipment.category] = {
          category: equipment.category,
          equipmentName: equipment.equipmentName,
        };
      }
    }
  });

  const daily = Object.keys(dailyByCategory)
    .sort((a, b) => a.localeCompare(b, "zh-Hant"))
    .map((category) => {
      const group = dailyByCategory[category];
      const required = group.usage.length > 0;
      const completed = required && dashboardHasChecklistRecord_(recordIndex, "每日", category, today);
      return {
        category,
        required,
        completed,
        status: !required ? "unused" : completed ? "completed" : "pending",
        usage: group.usage.map((row) => row.content).filter(Boolean).join("、"),
        equipmentCount: group.equipments.length,
        records: dashboardChecklistRecords_(recordIndex, "每日", category, today),
      };
    });

  if (typeof dailyPpeChecklistStatusResults_ === "function") {
    dailyPpeChecklistStatusResults_(today).forEach((row) => {
      daily.push({
        category: row.category || row.equipmentName || "場地防護具",
        required: true,
        completed: Boolean(row.alreadyFilled),
        status: row.alreadyFilled ? "completed" : "pending",
        usage: row.usage || "",
        equipmentCount: 1,
        records: dashboardChecklistRecordsForEquipment_(
          recordIndex,
          "每日",
          row.equipmentId,
          today,
        ),
      });
    });
  }

  const checkWindow = getMonthlyCheckWindow_();
  const reminderStartDay = getMonthlyReminderStartDay_();
  const day = dateParts_(today).d;
  const monthlyReminderActive =
    (day >= checkWindow.start && day <= checkWindow.end) || day >= reminderStartDay;
  // 營運資訊面板需整月呈現月檢進度；提醒是否啟動仍另外保留，
  // 不因面板顯示而改變 LINE 主動推播時段。
  const monthly = Object.keys(monthlyByCategory)
    .sort((a, b) => a.localeCompare(b, "zh-Hant"))
    .map((category) => {
      const completed = dashboardHasChecklistRecord_(recordIndex, "每月", category, today);
      return {
        category,
        equipmentName: monthlyByCategory[category].equipmentName,
        completed,
        status: completed ? "completed" : "pending",
        records: dashboardChecklistRecords_(recordIndex, "每月", category, today),
      };
    });

  const dailyRequired = daily.filter((row) => row.required);
  const monthlyCompleted = monthly.filter((row) => row.completed).length;
  return {
    capturedAt: dashboardNowLabel_(),
    daily: {
      completed: dailyRequired.filter((row) => row.completed).length,
      required: dailyRequired.length,
      pending: dailyRequired.filter((row) => !row.completed).length,
      items: daily,
    },
    monthly: {
      completed: monthlyCompleted,
      required: monthly.length,
      pending: Math.max(0, monthly.length - monthlyCompleted),
      visible: true,
      reminderActive: monthlyReminderActive,
      checkWindowStart: checkWindow.start,
      checkWindowEnd: checkWindow.end,
      reminderStartDay,
      items: monthly,
    },
  };
}

function dashboardIncidentStatus_() {
  const machine = listOpenIncidents_();
  const daily = dashboardListOpenDailyIncidentsReadOnly_();
  const machineGroups = dashboardGroupMachineIncidents_(machine.incidents || []);
  return {
    capturedAt: dashboardNowLabel_(),
    machine: {
      count: machineGroups.length,
      itemCount: machine.count || 0,
      items: machineGroups.slice(0, 20).map((row) => ({
        recordId: String(row.recordId || ""),
        reportDate: String(row.reportDate || ""),
        equipmentName: String(row.equipmentName || ""),
        category: String(row.category || ""),
        itemName: String(row.itemName || ""),
        status: String(row.status || "待處理"),
        assignee: String(row.assignee || ""),
        pendingItemCount: Number(row.pendingItemCount || 0),
        hasPdf: /^https:\/\//.test(String(row.pdfUrl || "")),
        canManage: row.canManage === true,
      })),
    },
    daily: {
      count: daily.count || 0,
      items: (daily.incidents || []).slice(0, 20).map((row) => ({
        incidentId: String(row.incidentId || ""),
        reportDate: String(row.reportDate || ""),
        location: String(row.location || ""),
        subject: String(row.subject || row.reportItem || ""),
        processStatus: String(row.processStatus || "待處理"),
        reviewStatus: String(row.reviewStatus || "未送審"),
        handler: String(row.owner || ""),
        supervisor: String(row.supervisor || ""),
        hasPdf: Boolean(row.hasPdf),
      })),
    },
  };
}

function dashboardGroupMachineIncidents_(incidents) {
  const groups = {};
  (incidents || []).forEach((row) => {
    const recordId = String(row.recordId || row.incidentId || "").trim();
    if (!recordId) return;
    if (!groups[recordId]) {
      groups[recordId] = {
        recordId,
        reportDate: String(row.reportDate || ""),
        equipmentName: String(row.equipmentName || ""),
        category: String(row.category || ""),
        itemNames: [],
        statuses: [],
        assignees: [],
        pdfUrl: String(row.pdfUrl || ""),
        pendingItemCount: 0,
        canManage: Boolean(String(row.recordId || "").trim()),
      };
    }
    const group = groups[recordId];
    group.canManage = group.canManage && Boolean(String(row.recordId || "").trim());
    group.pendingItemCount += 1;
    if (row.itemName) group.itemNames.push(String(row.itemName));
    if (row.status) group.statuses.push(String(row.status));
    if (row.assignee) group.assignees.push(String(row.assignee));
    if (!group.pdfUrl && row.pdfUrl) group.pdfUrl = String(row.pdfUrl);
  });
  return Object.keys(groups)
    .map((recordId) => {
      const group = groups[recordId];
      const names = Array.from(new Set(group.itemNames.filter(Boolean)));
      const statuses = Array.from(new Set(group.statuses.filter(Boolean)));
      return Object.assign(group, {
        itemName: group.pendingItemCount > 1
          ? group.pendingItemCount + " 項異常待處理"
          : (names[0] || "異常待處理"),
        status: statuses.length === 1 ? statuses[0] : "處理中",
        assignee: Array.from(new Set(group.assignees.filter(Boolean))).join("、"),
      });
    })
    .sort((a, b) => String(b.reportDate || "").localeCompare(String(a.reportDate || "")));
}

function dashboardApprovalStatus_() {
  const records = listPendingApprovalRecords_({
    includeApprovalUrl: false,
    minAgeHours: 0,
  });
  return {
    capturedAt: dashboardNowLabel_(),
    pendingCount: records.length,
    overdueOneDayCount: records.filter((row) => Number(row.ageHours || 0) >= 24).length,
    items: records.slice(0, 30).map((row) => {
      const fileUrl = dashboardFirstHttpsUrl_(row.fileUrl);
      const draftDocUrl = dashboardFirstHttpsUrl_(row.draftDocUrl);
      return {
        recordId: row.recordId || "",
        checkDate: row.checkDate || "",
        formType: row.formTypeZh || row.formType || "",
        equipmentName: row.equipmentName || "",
        inspector: row.inspector || "",
        incidentCount: Number(row.incidentCount || 0),
        submittedAt: row.submittedAtLabel || row.submittedAt || "",
        ageHours: row.ageHours == null ? null : Number(row.ageHours),
        ageDays: row.ageDays == null ? null : Number(row.ageDays),
        status: row.status || "待主管簽核",
        hasDocument: Boolean(fileUrl || draftDocUrl),
        documentLabel: fileUrl ? "查看 PDF" : "查看待簽核表",
      };
    }),
  };
}

/**
 * 營運中控台的操作入口。doPost 會先驗證 API_TOKEN + ADMIN_TOKEN；
 * 此處再以白名單限制模式與紀錄類型，前端不能傳網址、LINE userId 或任意姓名。
 */
function handleAdminDashboardAction_(payload) {
  payload = payload || {};
  const mode = String(payload.mode || "").trim();
  const recordType = String(payload.recordType || "").trim();
  const recordId = sanitizeText_(payload.recordId, 120).trim();
  if (ADMIN_DASHBOARD_ACTION_MODES.indexOf(mode) < 0) {
    throw new Error("未知管理操作模式");
  }
  if (ADMIN_DASHBOARD_RECORD_TYPES.indexOf(recordType) < 0) {
    throw new Error("未知管理操作紀錄類型");
  }
  if (!recordId) throw new Error("缺少管理操作紀錄ID");

  if (mode === "resolveLink") {
    return dashboardResolveActionLink_(recordType, recordId, payload.linkType);
  }
  if (mode === "previewNotification") {
    return dashboardPreviewNotification_(recordType, recordId);
  }
  return dashboardSendNotification_(recordType, recordId, payload.requestId);
}

function dashboardResolveActionLink_(recordType, recordId, linkType) {
  const requested = String(linkType || "").trim();
  let url = "";
  let label = "開啟";

  if (recordType === "machineIncident") {
    const dashboardGroup = dashboardMachineIncidentGroupByReference_(recordId);
    if (requested === "pdf") {
      if (dashboardGroup.canManage) {
        const group = getMachineIncidentGroupByReference_(recordId);
        url = group.handlingPdfUrl || group.originalPdfUrl || dashboardGroup.pdfUrl || "";
        label = group.handlingPdfUrl ? "開啟處理紀錄 PDF" : "開啟檢查 PDF";
      } else {
        url = dashboardGroup.pdfUrl || "";
        label = "開啟歷史檢查 PDF";
      }
    } else if (requested === "handle") {
      if (!dashboardGroup.canManage) {
        throw new Error("此歷史異常缺少紀錄ID，僅能查看原始 PDF");
      }
      url = createMachineIncidentHandlingAdminLink_(dashboardGroup.recordId).url;
      label = "開啟處理回報";
    } else {
      throw new Error("未知管理操作連結類型");
    }
  } else if (recordType === "dailyIncident") {
    const found = getDailyIncidentRecord_(recordId);
    const incident = publicDailyIncidentSummary_(found.data);
    if (requested === "pdf") {
      url = incident.pdfUrl || "";
      label = "開啟事件 PDF";
    } else if (requested === "handle") {
      if (incident.reviewStatus === "待主管審核") {
        throw new Error("此日常事件已送主管正式審核");
      }
      url = dashboardDailyIncidentActionUrl_(incident.incidentId, "update");
      label = "開啟處理回報";
    } else if (requested === "review") {
      if (incident.reviewStatus === "待主管審核") {
        url = dashboardDailyIncidentActionUrl_(incident.incidentId, "approval");
        label = "開啟主管審核";
      } else if (incident.processStatus === "處理中" && incident.supervisor) {
        url = dashboardDailyIncidentActionUrl_(incident.incidentId, "comment");
        label = "開啟主管處理意見";
      } else {
        throw new Error("此日常事件目前沒有可開啟的主管審閱流程");
      }
    } else {
      throw new Error("未知管理操作連結類型");
    }
  } else if (recordType === "approval") {
    const record = dashboardPendingApprovalById_(recordId);
    if (requested === "document" || requested === "pdf") {
      const fileUrl = dashboardFirstHttpsUrl_(record.fileUrl);
      url = fileUrl || dashboardFirstHttpsUrl_(record.draftDocUrl);
      label = fileUrl ? "開啟檢查 PDF" : "開啟待簽核檢查表";
    } else if (requested === "review") {
      url = dashboardApprovalActionUrl_(record.recordId);
      label = "開啟主管簽核";
    } else {
      throw new Error("未知管理操作連結類型");
    }
  } else {
    if (requested !== "document" && requested !== "pdf") {
      throw new Error("未知管理操作連結類型");
    }
    const record = getApprovalRecordById_(recordId);
    const fileUrl = dashboardFirstHttpsUrl_(record.fileUrl);
    url = fileUrl || dashboardFirstHttpsUrl_(record.draftDocUrl);
    label = fileUrl ? "開啟檢點 PDF" : "開啟待簽核檢點表";
  }

  if (!/^https:\/\//.test(String(url || ""))) {
    throw new Error("目前沒有可開啟的檔案或處理連結");
  }
  return { ok: true, action: "resolvedLink", recordType, recordId, label, url };
}

function dashboardApprovalActionUrl_(recordId) {
  return buildApprovalUrl_(
    recordId,
    createAdminDashboardActionToken_("approval", recordId),
  );
}

function dashboardDailyIncidentActionUrl_(incidentId, action) {
  const base = getWebAppBaseUrl_();
  if (!/^https:\/\//.test(String(base || ""))) return "";
  const pages = {
    update: { page: "incident-update", scope: "daily-update" },
    approval: { page: "incident-approve", scope: "daily-approval" },
    comment: { page: "incident-comment", scope: "daily-comment" },
  };
  const config = pages[String(action || "")];
  if (!config) throw new Error("未知日常事件管理操作");
  const token = createAdminDashboardActionToken_(config.scope, incidentId);
  return `${base}?page=${config.page}&incidentId=${encodeURIComponent(incidentId)}&token=${encodeURIComponent(token)}`;
}

function dashboardPreviewNotification_(recordType, recordId) {
  const plan = dashboardBuildNotificationPlan_(recordType, recordId);
  return dashboardPublicNotificationPlan_(plan);
}

function dashboardSendNotification_(recordType, recordId, requestId) {
  const safeRequestId = sanitizeText_(requestId, 100).trim();
  if (!/^[A-Za-z0-9_-]{12,100}$/.test(safeRequestId)) {
    throw new Error("缺少有效的提醒請求編號，請重新開啟確認視窗");
  }
  const cache = CacheService.getScriptCache();
  const requestKey = "admin_dashboard_notify_request_" + sha256Hex_(safeRequestId).substring(0, 32);
  const previous = cache.get(requestKey);
  if (previous) {
    try {
      return Object.assign({}, JSON.parse(previous), { duplicateRequest: true });
    } catch (_) {}
  }
  // 送出前重新查正式資料與目前訂閱者，並先取得群組後的
  // 正式紀錄 ID，避免同一份檢查的多項異常各自重複推播。
  const plan = dashboardBuildNotificationPlan_(recordType, recordId);
  const recordKey = "admin_dashboard_notify_record_" +
    sha256Hex_(plan.recordType + ":" + plan.recordId).substring(0, 32);
  const nowSeconds = Math.floor(Date.now() / 1000);
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) throw new Error("系統忙碌，請稍後再試");
  let priorSentHashes = [];
  let targetsToSend = [];
  try {
    const repeated = cache.get(requestKey);
    if (repeated) {
      try {
        return Object.assign({}, JSON.parse(repeated), { duplicateRequest: true });
      } catch (_) {}
    }
    const state = dashboardReadNotificationState_(cache.get(recordKey));
    if (
      state.sendingAt &&
      nowSeconds - Number(state.sendingAt) < ADMIN_DASHBOARD_NOTIFICATION_IN_FLIGHT_SECONDS
    ) {
      throw new Error("這筆提醒正在發送，請稍後查看結果");
    }
    priorSentHashes = Array.isArray(state.sentHashes) ? state.sentHashes : [];
    const priorSet = {};
    priorSentHashes.forEach((hash) => { priorSet[String(hash)] = true; });
    targetsToSend = plan.targets.filter(
      (target) => !priorSet[dashboardNotificationTargetHash_(target)],
    );
    if (!targetsToSend.length) {
      throw new Error("這筆提醒剛剛已送給所有目前收件人，請稍後再試");
    }
    cache.put(
      recordKey,
      JSON.stringify({ sentHashes: priorSentHashes, sendingAt: nowSeconds }),
      ADMIN_DASHBOARD_NOTIFICATION_DEDUPE_SECONDS,
    );
  } finally {
    lock.releaseLock();
  }

  let result;
  try {
    result = dashboardExecuteNotificationPlan_(
      Object.assign({}, plan, { targets: targetsToSend }),
    );
  } catch (err) {
    dashboardFinishNotificationState_(recordKey, priorSentHashes, []);
    throw err;
  }

  dashboardFinishNotificationState_(
    recordKey,
    priorSentHashes,
    result.sentTargetHashes,
  );
  const response = {
    ok: result.failedNames.length === 0 && result.sentNames.length > 0,
    action: "sentNotification",
    recordType: plan.recordType,
    recordId: plan.recordId,
    title: plan.title,
    sentNames: result.sentNames,
    failedNames: result.failedNames,
    alreadySentNames: plan.targets
      .filter((target) => priorSentHashes.indexOf(dashboardNotificationTargetHash_(target)) >= 0)
      .map((target) => target.name),
    sentCount: result.sentNames.length,
    estimatedMessages: result.sentNames.length,
  };
  cache.put(
    requestKey,
    JSON.stringify(response),
    ADMIN_DASHBOARD_NOTIFICATION_DEDUPE_SECONDS,
  );
  return response;
}

function dashboardReadNotificationState_(value) {
  try {
    const parsed = JSON.parse(String(value || ""));
    return parsed && typeof parsed === "object"
      ? parsed
      : { sentHashes: [], sendingAt: 0 };
  } catch (_) {
    return { sentHashes: [], sendingAt: 0 };
  }
}

function dashboardFinishNotificationState_(recordKey, previousHashes, newHashes) {
  const cache = CacheService.getScriptCache();
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) {
    // CacheService 是盡力而為；搶不到鎖時仍保留本次成功名單，
    // 避免 3 分鐘後把已收到的人再次列入補發。
    const sentHashes = dashboardMergeNotificationHashes_(previousHashes, newHashes);
    cache.put(
      recordKey,
      JSON.stringify({ sentHashes, sendingAt: 0 }),
      ADMIN_DASHBOARD_NOTIFICATION_DEDUPE_SECONDS,
    );
    return;
  }
  try {
    const latest = dashboardReadNotificationState_(cache.get(recordKey));
    const sentHashes = dashboardMergeNotificationHashes_(
      previousHashes,
      latest.sentHashes,
      newHashes,
    );
    cache.put(
      recordKey,
      JSON.stringify({ sentHashes, sendingAt: 0 }),
      ADMIN_DASHBOARD_NOTIFICATION_DEDUPE_SECONDS,
    );
  } finally {
    lock.releaseLock();
  }
}

function dashboardMergeNotificationHashes_() {
  let hashes = [];
  for (let index = 0; index < arguments.length; index++) {
    hashes = hashes.concat(arguments[index] || []);
  }
  return Array.from(new Set(
    hashes.map((hash) => String(hash || "")).filter(Boolean),
  ));
}

function dashboardNotificationTargetHash_(target) {
  return sha256Hex_(String(target && target.userId || "")).substring(0, 32);
}

function dashboardBuildNotificationPlan_(recordType, recordId) {
  if (recordType === "machineIncident") {
    return dashboardMachineIncidentNotificationPlan_(recordId);
  }
  if (recordType === "dailyIncident") {
    return dashboardDailyIncidentNotificationPlan_(recordId);
  }
  if (recordType === "approval") {
    return dashboardApprovalNotificationPlan_(recordId);
  }
  throw new Error("此紀錄類型不支援 LINE 提醒");
}

function dashboardMachineIncidentNotificationPlan_(recordId) {
  const dashboardGroup = dashboardMachineIncidentGroupByReference_(recordId);
  if (!dashboardGroup.canManage) {
    throw new Error("此歷史異常缺少紀錄ID，無法由中控台提醒負責人");
  }
  const group = getMachineIncidentGroupByReference_(recordId);
  const pendingItems = group.items.filter((item) => item.status !== "已完成" && item.status !== "不處理");
  if (!pendingItems.length) throw new Error("這筆機具設備異常目前沒有待處理項目");
  const names = pendingItems.map((item) => String(item.owner || "").trim()).filter(Boolean);
  if (pendingItems.some((item) => !String(item.owner || "").trim())) {
    const approval = getApprovalRecordById_(group.recordId);
    if (approval.inspector) names.push(approval.inspector);
  }
  const resolution = dashboardResolveNamedTargets_(names, {
    requireStaff: true,
    notificationColumn: LINE_NOTIFICATION_COLUMNS.MACHINE_INCIDENT,
    skipUnavailable: true,
  });
  const targets = resolution.targets;
  if (!targets.length) {
    throw new Error("找不到可通知的機具設備異常負責人；請先確認填報紀錄的檢點人員或異常表負責人");
  }
  return {
    recordType: "machineIncident",
    recordId: group.recordId,
    title: "機具設備異常處理提醒",
    description: `${group.equipmentName}｜${pendingItems.length} 項待處理`,
    targets,
    skippedNames: resolution.skippedNames,
    context: { group },
  };
}

function dashboardMachineIncidentGroupByReference_(reference) {
  const target = sanitizeText_(reference, 120).trim();
  const source = listOpenIncidents_();
  const matches = dashboardGroupMachineIncidents_(source.incidents || [])
    .filter((row) => String(row.recordId || "") === target);
  if (!matches.length) throw new Error("找不到符合的機具設備異常");
  if (matches.length > 1) throw new Error("事件ID命中多筆檢查，請使用完整事件ID");
  return matches[0];
}

function dashboardDailyIncidentNotificationPlan_(recordId) {
  const found = getDailyIncidentRecord_(recordId);
  const incident = publicDailyIncidentSummary_(found.data);
  if (incident.reviewStatus === "已結案") throw new Error("此日常事件已結案");
  const targets = [];
  const skippedNames = [];
  let title = "日常事件處理提醒";
  let notificationKind = "owner";

  if (incident.reviewStatus === "待主管審核") {
    title = "日常事件主管簽核提醒";
    notificationKind = "approval";
    targets.push(dashboardResolvePersonTarget_(incident.supervisorKey, incident.supervisor, { requireSupervisor: true }));
  } else {
    const reporter = dashboardResolvePersonTargetOptional_(
      incident.reporterKey,
      incident.reporter,
      { requireStaff: true },
      skippedNames,
    );
    const owner = dashboardResolvePersonTargetOptional_(
      incident.ownerKey,
      incident.owner,
      { requireStaff: true },
      skippedNames,
    );
    if (reporter) targets.push(reporter);
    if (owner) targets.push(owner);

    if (incident.supervisorKey || incident.supervisor) {
      if (incident.processStatus === "處理中") {
        title = "日常事件處理追蹤提醒";
        notificationKind = "processing";
      }
      targets.push(dashboardResolvePersonTarget_(incident.supervisorKey, incident.supervisor, { requireSupervisor: true }));
    } else {
      listLineSubscriberPeople_()
        .filter((person) => person.isSupervisor)
        .forEach((person) => targets.push(person));
    }
  }
  const uniqueTargets = dashboardUniqueTargets_(targets.filter(Boolean));
  if (!uniqueTargets.length) throw new Error("找不到可通知的日常事件相關人員");
  return {
    recordType: "dailyIncident",
    recordId: incident.incidentId,
    title,
    description: `${incident.location || "未標示地點"}｜${incident.subject || "日常事件"}`,
    targets: uniqueTargets,
    skippedNames: Array.from(new Set(skippedNames)),
    context: { incident, notificationKind },
  };
}

function dashboardApprovalNotificationPlan_(recordId) {
  const record = dashboardPendingApprovalById_(recordId, { includeApprovalUrl: true });
  const targets = listLineSubscriberPeople_().filter((person) => person.isSupervisor);
  if (!targets.length) throw new Error("找不到可通知的主管");
  return {
    recordType: "approval",
    recordId: record.recordId,
    title: "檢查紀錄主管簽核提醒",
    description: `${record.equipmentName}｜${record.formTypeZh || record.formType}檢查紀錄`,
    targets: dashboardUniqueTargets_(targets),
    context: { record },
  };
}

function dashboardPublicNotificationPlan_(plan) {
  return {
    ok: true,
    action: "notificationPreview",
    recordType: plan.recordType,
    recordId: plan.recordId,
    title: plan.title,
    description: plan.description,
    recipientNames: plan.targets.map((target) => target.name),
    recipientCount: plan.targets.length,
    estimatedMessages: plan.targets.length,
    skippedNames: plan.skippedNames || [],
    quotaNote: "每位收件人預估使用 1 則 LINE 主動訊息額度",
  };
}

function dashboardExecuteNotificationPlan_(plan) {
  const sentNames = [];
  const failedNames = [];
  const sentTargetHashes = [];
  let targetIndex = 0;
  const push = (target, buildMessage) => {
    targetIndex += 1;
    try {
      const message = buildMessage();
      const result = linePushTo_(target.userId, withQuickReply_(message), "push");
      if (result && result.ok) {
        sentNames.push(target.name);
        sentTargetHashes.push(dashboardNotificationTargetHash_(target));
      } else {
        failedNames.push(target.name);
        Logger.log(
          `[AdminDashboard] LINE reminder failed type=${plan.recordType} targetIndex=${targetIndex} code=${result && result.code || "unknown"}`,
        );
      }
    } catch (_) {
      // 不記錄姓名或 LINE userId，避免日誌留下個資；其餘收件人仍繼續發送。
      failedNames.push(target.name);
      Logger.log(
        `[AdminDashboard] LINE reminder exception type=${plan.recordType} targetIndex=${targetIndex}`,
      );
    }
  };

  if (plan.recordType === "machineIncident") {
    plan.targets.forEach((target) => {
      push(target, () => {
        const link = createMachineIncidentHandlingLink_(plan.context.group.recordId, target.userId);
        return buildMachineIncidentHandlingLinkFlex_(plan.context.group, link.url, target.name);
      });
    });
  } else if (plan.recordType === "dailyIncident") {
    // LINE 可能數小時後才被打開，因此沿用紀錄自身的長效權杖；
    // 中控台直接開啟的 resolveLink 才使用 30 分鐘短效權杖。
    const incident = plan.context.incident;
    if (
      plan.context.notificationKind === "approval" &&
      !/^https:\/\//.test(String(incident.approvalUrl || ""))
    ) {
      throw new Error("無法建立日常事件主管簽核連結");
    }
    if (
      plan.context.notificationKind === "processing" &&
      !/^https:\/\//.test(String(incident.commentUrl || ""))
    ) {
      throw new Error("無法建立日常事件主管意見連結");
    }
    plan.targets.forEach((target) => {
      push(target, () => {
        if (plan.context.notificationKind === "approval" && target.isSupervisor) {
          return buildDailyIncidentApprovalFlex_(incident);
        }
        if (plan.context.notificationKind === "processing" && target.isSupervisor) {
          return buildDailyIncidentProcessingReviewFlex_(incident);
        }
        return buildDailyIncidentCreatedFlex_(incident, {
          title: "📌 日常事件處理提醒",
          color: "#B06000",
          accentColor: "#B06000",
        });
      });
    });
  } else {
    const record = plan.context.record;
    const noticeRecord = {
      recordId: record.recordId,
      checkDate: parseISODate_(record.checkDate),
      formType: record.formType,
      equipment: {
        equipmentId: record.equipmentId,
        equipmentName: record.equipmentName,
        category: record.category,
      },
      inspector: record.inspector,
      incidentCount: record.incidentCount,
      approvalUrl: record.approvalUrl,
    };
    if (!/^https:\/\//.test(String(noticeRecord.approvalUrl || ""))) {
      throw new Error("無法建立主管簽核連結");
    }
    const message = buildApprovalRequestFlex_(noticeRecord);
    plan.targets.forEach((target) => push(target, () => message));
  }
  return { sentNames, failedNames, sentTargetHashes };
}

function dashboardPendingApprovalById_(recordId, opts) {
  opts = opts || {};
  const target = String(recordId || "").trim();
  const records = listPendingApprovalRecords_({
    includeApprovalUrl: opts.includeApprovalUrl === true,
    minAgeHours: 0,
    recordId: target,
  });
  for (let i = 0; i < records.length; i++) {
    if (String(records[i].recordId || "").trim() === target) return records[i];
  }
  throw new Error("找不到待簽核紀錄，可能已由其他主管完成簽核");
}

function dashboardResolvePersonTarget_(personKey, name, opts) {
  opts = opts || {};
  const people = listLineSubscriberPeople_();
  const key = String(personKey || "").trim();
  const targetName = String(name || "").trim();
  let matches = key
    ? people.filter((person) => person.key === key)
    : people.filter((person) => person.name === targetName);
  matches = matches.filter((person) => {
    if (opts.requireSupervisor && !person.isSupervisor) return false;
    if (opts.requireStaff && !(person.isStaff || person.isSupervisor)) return false;
    if (
      opts.notificationColumn &&
      !(person.notifications && person.notifications[opts.notificationColumn])
    ) return false;
    return true;
  });
  if (matches.length > 1) throw new Error("收件人姓名重複，請在訂閱者清單確認身分");
  if (!matches.length) throw new Error("找不到可通知的收件人，請在訂閱者清單確認身分與 LINE 綁定");
  return matches[0];
}

function dashboardResolvePersonTargetOptional_(personKey, name, opts, skippedNames) {
  if (!String(personKey || "").trim() && !String(name || "").trim()) return null;
  try {
    return dashboardResolvePersonTarget_(personKey, name, opts);
  } catch (err) {
    if (String(err && err.message || err).indexOf("收件人姓名重複") >= 0) throw err;
    const targetName = String(name || "").trim();
    if (targetName && Array.isArray(skippedNames)) skippedNames.push(targetName);
    return null;
  }
}

function dashboardResolveNamedTargets_(names, opts) {
  opts = opts || {};
  const uniqueNames = Array.from(new Set((names || []).map((name) => String(name || "").trim()).filter(Boolean)));
  const targets = [];
  const skippedNames = [];
  uniqueNames.forEach((name) => {
    try {
      targets.push(dashboardResolvePersonTarget_("", name, opts));
    } catch (err) {
      if (!opts.skipUnavailable) throw err;
      if (String(err && err.message || err).indexOf("收件人姓名重複") >= 0) throw err;
      skippedNames.push(name);
    }
  });
  return {
    targets: dashboardUniqueTargets_(targets),
    skippedNames: Array.from(new Set(skippedNames)),
  };
}

function dashboardUniqueTargets_(targets) {
  const seen = {};
  return (targets || []).filter((target) => {
    const id = String(target && target.userId || "").trim();
    if (!id || seen[id]) return false;
    seen[id] = true;
    return true;
  });
}

function dashboardOfficialDocumentStatus_() {
  const snapshot = dashboardOfficialDocumentSnapshotReadOnly_({});
  const byHandler = {};
  (snapshot.records || []).forEach((row) => {
    const name = String(row.handlerName || row.handler || "未標示承辦人").trim() || "未標示承辦人";
    byHandler[name] = (byHandler[name] || 0) + 1;
  });
  return {
    capturedAt: dashboardNowLabel_(),
    snapshotDate: snapshot.date || "",
    slot: snapshot.slot || snapshot.latestSlot || "",
    count: snapshot.count || 0,
    byHandler: Object.keys(byHandler)
      .sort((a, b) => byHandler[b] - byHandler[a] || a.localeCompare(b, "zh-Hant"))
      .map((name) => ({ name, count: byHandler[name] })),
  };
}

function dashboardNotificationStatus_() {
  const quota = getLineMessageQuotaStatus_();
  const targetCounts = {};
  let subscriberCount = 0;
  const ss = SpreadsheetApp.openById(CONFIG.DB_SHEET_ID);
  const sheet = getLineSubscriberSheet_(ss);
  if (sheet && sheet.getLastRow() >= 2) {
    const data = sheet.getDataRange().getValues();
    const headers = data[0].map((h) => String(h || "").trim());
    const idCol = headers.indexOf("LINE_USER_ID");
    const activeCol = getLineSubscriberActiveColumnIndex_(headers);
    const columns = typeof LINE_NOTIFICATION_COLUMNS !== "undefined"
      ? Object.keys(LINE_NOTIFICATION_COLUMNS).map((key) => LINE_NOTIFICATION_COLUMNS[key])
      : [];
    const allIds = new Set();
    const idsByColumn = {};
    columns.forEach((column) => {
      idsByColumn[column] = new Set();
    });
    if (idCol >= 0) {
      data.slice(1).forEach((row) => {
        const id = String(row[idCol] || "").trim();
        const active = activeCol < 0 ? true : isActiveValue_(row[activeCol]);
        if (!id || !active) return;
        allIds.add(id);
        columns.forEach((column) => {
          const col = headers.indexOf(column);
          if (col >= 0 && isLineNotificationEnabled_(row[col])) {
            idsByColumn[column].add(id);
          }
        });
      });
    }
    subscriberCount = allIds.size;
    columns.forEach((column) => {
      targetCounts[column] = idsByColumn[column].size;
    });
  }
  const quotaValue = quota.quota && quota.quota.body ? quota.quota.body.value : null;
  const usageValue = quota.consumption && quota.consumption.body
    ? quota.consumption.body.totalUsage
    : null;
  return {
    capturedAt: dashboardNowLabel_(),
    subscriberCount,
    targetCounts,
    lineQuota: {
      available: Boolean(quota.ok),
      type: quota.quota && quota.quota.body ? quota.quota.body.type : "unknown",
      limit: typeof quotaValue === "number" ? quotaValue : null,
      used: typeof usageValue === "number" ? usageValue : null,
      remaining: typeof quota.remaining === "number" ? quota.remaining : null,
      isExhausted: quota.isExhausted,
    },
  };
}

function dashboardSystemHealth_() {
  const status = getSystemStatus_();
  const triggerCounts = {};
  (status.triggers || []).forEach((trigger) => {
    triggerCounts[trigger.handler] = (triggerCounts[trigger.handler] || 0) + 1;
  });
  // 待簽核彙總由 dailyReminderJob 內部呼叫，並不是獨立觸發器。
  const expected = ["dailyReminderJob"];
  if (isActiveValue_(getSetting_("dailyPpeAssignmentEnabled", "是"))) {
    expected.push("dailyPpeAssignmentJob");
  }
  if (typeof isDailyWorkCheckEnabled_ === "function" && isDailyWorkCheckEnabled_()) {
    expected.push(
      "dailyWorkCheckReminder1630Job",
      "dailyWorkCheckReminder1700Job",
      "dailyWorkCheckCleanupJob",
    );
  }
  const triggers = expected.map((handler) => ({
    handler,
    count: triggerCounts[handler] || 0,
    ok: (triggerCounts[handler] || 0) === 1,
  }));
  return {
    capturedAt: dashboardNowLabel_(),
    archiveOk: Boolean(status.archive && status.archive.ok),
    venueOk: Boolean(status.venue && status.venue.ok),
    venueTitle: status.venue && status.venue.title ? status.venue.title : "",
    triggers,
    allTriggerCount: (status.triggers || []).length,
    links: {
      archive: CONFIG.ARCHIVE_ROOT_FOLDER_ID
        ? "https://drive.google.com/drive/folders/" + CONFIG.ARCHIVE_ROOT_FOLDER_ID
        : "",
    },
  };
}

function dashboardSummary_(sections) {
  const checks = sections.checks || {};
  const incidents = sections.incidents || {};
  const approvals = sections.approvals || {};
  const notifications = sections.notifications || {};
  return {
    dailyCompleted: checks.daily ? checks.daily.completed : null,
    dailyRequired: checks.daily ? checks.daily.required : null,
    monthlyPending: checks.monthly ? checks.monthly.pending : null,
    monthlyCompleted: checks.monthly ? checks.monthly.completed : null,
    monthlyRequired: checks.monthly ? checks.monthly.required : null,
    monthlyVisible: checks.monthly ? Boolean(checks.monthly.visible) : null,
    incidentOpen:
      incidents.available && incidents.machine && incidents.daily
        ? Number(incidents.machine.itemCount || 0) + Number(incidents.daily.count || 0)
        : null,
    approvalPending:
      typeof approvals.pendingCount === "number" ? approvals.pendingCount : null,
    lineRemaining:
      notifications.lineQuota && typeof notifications.lineQuota.remaining === "number"
        ? notifications.lineQuota.remaining
        : null,
  };
}

/** 純讀取公文快照，不建立分頁、不補欄位、不套格式。 */
function dashboardOfficialDocumentSnapshotReadOnly_(payload) {
  payload = payload || {};
  const ss = SpreadsheetApp.openById(CONFIG.DB_SHEET_ID);
  const sheet = getOfficialDocumentQueueSheet_(ss);
  const dateStr = sanitizeOfficialDocumentDate_(payload.date);
  const requestedSlot = String(payload.slot || "").trim();
  if (!sheet || sheet.getLastRow() < 2 || sheet.getLastColumn() < 1) {
    return { date: dateStr, slot: requestedSlot, latestSlot: "", count: 0, records: [] };
  }
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0]
    .map((h) => String(h || "").trim());
  const dateCol = headers.indexOf("檢核日期");
  const slotCol = headers.indexOf("檢核時段");
  if (dateCol < 0 || slotCol < 0) throw new Error("OFFICIAL_DOCUMENT_SCHEMA_INVALID");
  const data = sheet.getRange(2, 1, sheet.getLastRow() - 1, headers.length).getValues();
  const todayRows = data.filter((row) => officialDocumentDateKey_(row[dateCol]) === dateStr);
  const latestSlot = todayRows.map((row) => officialDocumentSlotKey_(row[slotCol]))
    .filter(Boolean).sort().pop() || "";
  const targetSlot = requestedSlot || latestSlot;
  const rows = targetSlot
    ? todayRows.filter((row) => officialDocumentSlotKey_(row[slotCol]) === targetSlot)
    : [];
  return {
    date: dateStr,
    slot: targetSlot,
    latestSlot,
    count: rows.length,
    records: rows.map((row) => rowToOfficialDocumentRecord_(row, headers)),
  };
}

/** 純讀取日常事件，避免查詢面板時觸發舊分頁改名。 */
function dashboardListOpenDailyIncidentsReadOnly_() {
  const ss = SpreadsheetApp.openById(CONFIG.DB_SHEET_ID);
  let sheet = ss.getSheetByName(DAILY_INCIDENT_SHEET_NAME);
  if (!sheet) {
    for (let i = 0; i < DAILY_INCIDENT_LEGACY_SHEET_NAMES.length; i++) {
      sheet = ss.getSheetByName(DAILY_INCIDENT_LEGACY_SHEET_NAMES[i]);
      if (sheet) break;
    }
  }
  if (!sheet || sheet.getLastRow() < 2) return { count: 0, incidents: [] };
  const data = sheet.getDataRange().getValues();
  const headers = data[0].map((h) => String(h || "").trim());
  const index = (name) => headers.indexOf(name);
  const reviewCol = index("審核狀態");
  const rows = data.slice(1).filter((row) => {
    const review = reviewCol >= 0 ? String(row[reviewCol] || "").trim() : "";
    return review !== "已結案";
  });
  const value = (row, name) => {
    const col = index(name);
    return col >= 0 ? row[col] : "";
  };
  const incidents = rows.map((row) => ({
      incidentId: value(row, "事件ID"),
      createdAt: value(row, "建立時間"),
      reportDate: normalizeSheetDateString_(value(row, "填報日期")),
      location: value(row, "發生地點"),
      subject: value(row, "填報事項"),
      processStatus: value(row, "處理狀況"),
      reviewStatus: value(row, "審核狀態"),
      owner: value(row, "承辦人"),
      reporter: value(row, "填報人"),
      ownerKey: value(row, "承辦人Key"),
      reporterKey: value(row, "填報人Key"),
      supervisor: value(row, "陳核主管"),
      supervisorKey: value(row, "陳核主管Key"),
      hasPdf: /^https:\/\//.test(String(value(row, "PDF連結") || "")),
    })).sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")));
  return {
    count: incidents.length,
    incidents: incidents.slice(0, 20),
  };
}

function dashboardEquipmentListReadOnly_() {
  const ss = SpreadsheetApp.openById(CONFIG.DB_SHEET_ID);
  const sheet = ss.getSheetByName("設備清單");
  if (!sheet || sheet.getLastRow() < 2) return [];
  const data = sheet.getDataRange().getValues();
  const headers = data[0].map((h) => String(h || "").trim());
  const col = (name) => headers.indexOf(name);
  const idCol = col("設備代號");
  const nameCol = col("設備名稱");
  const categoryCol = col("設備類別");
  const locationCol = col("所在位置");
  const venueCol = col("場地表分頁");
  const activeCol = col("啟用");
  if (idCol < 0 || nameCol < 0 || categoryCol < 0 || activeCol < 0) {
    throw new Error("EQUIPMENT_SCHEMA_INVALID");
  }
  return data.slice(1).filter((row) => isActiveValue_(row[activeCol])).map((row) => ({
    equipmentId: row[idCol],
    equipmentName: row[nameCol],
    category: row[categoryCol],
    location: locationCol >= 0 ? row[locationCol] : "",
    venueSheetTab: venueCol >= 0 ? row[venueCol] : "",
    active: true,
  }));
}

function dashboardChecklistRecordIndex_() {
  const ss = SpreadsheetApp.openById(CONFIG.DB_SHEET_ID);
  const sheet = ss.getSheetByName("填報紀錄");
  const index = {
    daily: {},
    monthly: {},
    dailyByEquipment: {},
    monthlyByEquipment: {},
  };
  if (!sheet || sheet.getLastRow() < 2) return index;
  const data = sheet.getDataRange().getValues();
  const headers = data[0].map((h) => String(h || "").trim());
  const dateCol = headers.indexOf("檢查日期");
  const typeCol = headers.indexOf("表單類型");
  const categoryCol = headers.indexOf("設備類別");
  const recordCol = headers.indexOf("紀錄ID");
  const equipmentIdCol = headers.indexOf("設備代號");
  const equipmentNameCol = headers.indexOf("設備名稱");
  const pdfCol = headers.indexOf("PDF連結");
  const draftCol = headers.indexOf("草稿Doc連結");
  if (dateCol < 0 || typeCol < 0 || categoryCol < 0 || recordCol < 0) {
    throw new Error("CHECK_RECORD_SCHEMA_INVALID");
  }
  data.slice(1).forEach((row, rowIndex) => {
    const raw = row[dateCol];
    const date = raw instanceof Date ? raw : new Date(String(raw || "") + "T00:00:00+08:00");
    if (isNaN(date.getTime())) return;
    const category = String(row[categoryCol] || "").trim();
    const type = String(row[typeCol] || "").trim();
    if (!category) return;
    const recordId = String(row[recordCol] || "").trim();
    const equipmentId = equipmentIdCol >= 0
      ? String(row[equipmentIdCol] || "").trim()
      : "";
    const equipmentName = equipmentNameCol >= 0
      ? String(row[equipmentNameCol] || "").trim()
      : "";
    const fileUrl = pdfCol >= 0 ? String(row[pdfCol] || "").trim() : "";
    const draftDocUrl = draftCol >= 0 ? String(row[draftCol] || "").trim() : "";
    const validFileUrl = dashboardFirstHttpsUrl_(fileUrl);
    const validDraftDocUrl = dashboardFirstHttpsUrl_(draftDocUrl);
    const record = {
      recordId,
      equipmentId,
      equipmentName,
      hasDocument: Boolean(validFileUrl || validDraftDocUrl),
      documentLabel: validFileUrl
        ? "查看 PDF"
        : validDraftDocUrl
          ? "查看待簽核表"
          : "",
    };
    const itemKey = equipmentId || equipmentName || recordId || "row-" + String(rowIndex + 2);
    if (type === "每日") {
      const dateKey = formatISODate_(date);
      dashboardChecklistIndexRecord_(index.daily, dateKey + "|" + category, itemKey, record);
      if (equipmentId) {
        dashboardChecklistIndexRecord_(
          index.dailyByEquipment,
          dateKey + "|" + equipmentId,
          itemKey,
          record,
        );
      }
    }
    if (type === "每月") {
      const parts = dateParts_(date);
      const monthKey = parts.y + "-" + parts.m;
      dashboardChecklistIndexRecord_(index.monthly, monthKey + "|" + category, itemKey, record);
      if (equipmentId) {
        dashboardChecklistIndexRecord_(
          index.monthlyByEquipment,
          monthKey + "|" + equipmentId,
          itemKey,
          record,
        );
      }
    }
  });
  return index;
}

function dashboardChecklistIndexRecord_(collection, bucketKey, itemKey, record) {
  if (!collection[bucketKey]) collection[bucketKey] = {};
  collection[bucketKey][itemKey] = record;
}

function dashboardHasChecklistRecord_(index, type, category, date) {
  return dashboardChecklistRecords_(index, type, category, date).length > 0;
}

function dashboardChecklistRecords_(index, type, category, date) {
  let bucket;
  if (type === "每日") {
    bucket = index.daily[formatISODate_(date) + "|" + category];
  } else {
    const parts = dateParts_(date);
    bucket = index.monthly[parts.y + "-" + parts.m + "|" + category];
  }
  return dashboardChecklistPublicRecords_(bucket);
}

function dashboardChecklistRecordsForEquipment_(index, type, equipmentId, date) {
  const safeEquipmentId = String(equipmentId || "").trim();
  if (!safeEquipmentId) return [];
  let bucket;
  if (type === "每日") {
    bucket = index.dailyByEquipment[formatISODate_(date) + "|" + safeEquipmentId];
  } else {
    const parts = dateParts_(date);
    bucket = index.monthlyByEquipment[
      parts.y + "-" + parts.m + "|" + safeEquipmentId
    ];
  }
  return dashboardChecklistPublicRecords_(bucket);
}

function dashboardChecklistPublicRecords_(bucket) {
  if (!bucket) return [];
  return Object.keys(bucket)
    .map((key) => bucket[key])
    .filter((record) => record && record.recordId)
    .sort((a, b) =>
      String(a.equipmentName || a.equipmentId).localeCompare(
        String(b.equipmentName || b.equipmentId),
        "zh-Hant",
      ),
    );
}

function dashboardFirstHttpsUrl_() {
  for (let index = 0; index < arguments.length; index++) {
    const value = String(arguments[index] || "").trim();
    if (/^https:\/\//.test(value)) return value;
  }
  return "";
}

function dashboardVenueContext_() {
  return {
    spreadsheet: SpreadsheetApp.openById(getVenueSheetId_()),
    holidays: getHolidayKeywords_(),
  };
}

function dashboardVenueUsage_(equipment, date, context) {
  const tabName = equipment.venueSheetTab || CONFIG.VENUE_SHEET_DEFAULT_TAB;
  const sheet = getVenueSheetByRef_(context.spreadsheet, tabName);
  if (!sheet) return { used: false, content: "", reason: "分頁不存在" };
  const parts = dateParts_(date);
  const lastCol = sheet.getLastColumn();
  const lastRow = sheet.getLastRow();
  if (lastCol < 1 || lastRow < 3) return { used: false, content: "", reason: "無資料列" };
  const header = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  let dateCol = -1;
  for (let i = 0; i < header.length; i++) {
    if (cellStr_(header[i]).replace(/\s/g, "") === parts.m + "月") {
      dateCol = i + 1;
      break;
    }
  }
  if (dateCol < 0) return { used: false, content: "", reason: "月份欄位不存在" };
  const rows = sheet.getRange(3, dateCol, lastRow - 2, 2).getValues();
  for (let i = 0; i < rows.length; i++) {
    const rawDay = rows[i][0];
    const day = rawDay instanceof Date ? rawDay.getDate() : Number(rawDay);
    if (day !== parts.d) continue;
    const content = cellStr_(rows[i][1]);
    if (!content) return { used: false, content: "", reason: null };
    for (let h = 0; h < context.holidays.length; h++) {
      const keyword = context.holidays[h];
      if (keyword && content.indexOf(keyword) >= 0) {
        return { used: false, content, reason: "節假日（" + keyword + "）" };
      }
    }
    const required = getVenueUsageRequiredKeywords_(equipment);
    if (required.length && !hasAnyKeyword_(content, required)) {
      return { used: false, content, reason: "未命中場地使用關鍵字" };
    }
    return { used: true, content, reason: null };
  }
  return { used: false, content: "", reason: "當月找不到該日" };
}

function dashboardOverallStatus_(sections, errors) {
  if (Object.keys(errors || {}).length) {
    return { level: "warning", label: "部分資料無法取得" };
  }
  const system = sections.system || {};
  const triggerProblem = (system.triggers || []).some((row) => !row.ok);
  if (!system.archiveOk || !system.venueOk || triggerProblem) {
    return { level: "warning", label: "需要檢查" };
  }
  return { level: "healthy", label: "運作正常" };
}

function dashboardNowLabel_() {
  return Utilities.formatDate(new Date(), tz_(), "yyyy/MM/dd HH:mm:ss");
}
