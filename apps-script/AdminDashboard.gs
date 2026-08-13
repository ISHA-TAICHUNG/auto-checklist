/**
 * ===== 主管營運資訊面板 =====
 *
 * 僅由 doPost 的 adminDashboardStatus 呼叫。所有資料都先通過
 * API_TOKEN + ADMIN_TOKEN 驗證，且回傳內容不包含 LINE userId、token 或簽核網址。
 */

const ADMIN_DASHBOARD_CACHE_KEY = "admin_dashboard_status_v1";
const ADMIN_DASHBOARD_CACHE_SECONDS = 120;
const ADMIN_DASHBOARD_SNAPSHOT_PREFIX = "admin_dashboard_snapshot_v1_";
// Script Properties 單值上限按位元組計算；中文可占 3 bytes，保守切小。
const ADMIN_DASHBOARD_SNAPSHOT_CHUNK_SIZE = 2500;
const ADMIN_DASHBOARD_REFRESH_SECONDS = 600;

function getAdminDashboardStatus_(opts) {
  opts = opts || {};
  const forceRefresh = opts.forceRefresh === true;
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
  const chunks = [];
  for (let offset = 0; offset < text.length; offset += ADMIN_DASHBOARD_SNAPSHOT_CHUNK_SIZE) {
    chunks.push(text.slice(offset, offset + ADMIN_DASHBOARD_SNAPSHOT_CHUNK_SIZE));
  }
  const properties = PropertiesService.getScriptProperties();
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
}

function dashboardReadPersistedSnapshot_() {
  try {
    const properties = PropertiesService.getScriptProperties();
    const count = Number(properties.getProperty(ADMIN_DASHBOARD_SNAPSHOT_PREFIX + "count") || 0);
    if (!count || count > 20) return null;
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
      });
    });
  }

  const checkWindow = getMonthlyCheckWindow_();
  const reminderStartDay = getMonthlyReminderStartDay_();
  const day = dateParts_(today).d;
  const monthlyVisible =
    (day >= checkWindow.start && day <= checkWindow.end) || day >= reminderStartDay;
  const monthly = (monthlyVisible ? Object.keys(monthlyByCategory) : [])
    .sort((a, b) => a.localeCompare(b, "zh-Hant"))
    .map((category) => {
      const completed = dashboardHasChecklistRecord_(recordIndex, "每月", category, today);
      return {
        category,
        equipmentName: monthlyByCategory[category].equipmentName,
        completed,
        status: completed ? "completed" : "pending",
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
      visible: monthlyVisible,
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
  return {
    capturedAt: dashboardNowLabel_(),
    machine: {
      count: machine.count || 0,
      items: (machine.incidents || []).slice(0, 20).map((row) => ({
        incidentId: String(row.incidentId || ""),
        reportDate: String(row.reportDate || ""),
        equipmentName: String(row.equipmentName || ""),
        category: String(row.category || ""),
        itemName: String(row.itemName || ""),
        status: String(row.status || "待處理"),
        assignee: String(row.assignee || ""),
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
      })),
    },
  };
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
    items: records.slice(0, 30).map((row) => ({
      checkDate: row.checkDate || "",
      formType: row.formTypeZh || row.formType || "",
      equipmentName: row.equipmentName || "",
      inspector: row.inspector || "",
      incidentCount: Number(row.incidentCount || 0),
      submittedAt: row.submittedAtLabel || row.submittedAt || "",
      ageHours: row.ageHours == null ? null : Number(row.ageHours),
      ageDays: row.ageDays == null ? null : Number(row.ageDays),
      status: row.status || "待主管簽核",
    })),
  };
}

function dashboardOfficialDocumentStatus_() {
  const snapshot = dashboardOfficialDocumentSnapshotReadOnly_({});
  const byHandler = {};
  (snapshot.records || []).forEach((row) => {
    const name = String(row.handlerName || row.handler || "未標示").trim() || "未標示";
    byHandler[name] = (byHandler[name] || 0) + 1;
  });
  return {
    capturedAt: dashboardNowLabel_(),
    snapshotDate: snapshot.date || "",
    slot: snapshot.slot || snapshot.latestSlot || "",
    count: snapshot.count || 0,
    byHandler: Object.keys(byHandler)
      .sort((a, b) => a.localeCompare(b, "zh-Hant"))
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
    monthlyVisible: checks.monthly ? Boolean(checks.monthly.visible) : null,
    incidentOpen:
      incidents.available && incidents.machine && incidents.daily
        ? Number(incidents.machine.count || 0) + Number(incidents.daily.count || 0)
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
      supervisor: value(row, "陳核主管"),
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
  const index = { daily: {}, monthly: {} };
  if (!sheet || sheet.getLastRow() < 2) return index;
  const data = sheet.getDataRange().getValues();
  const headers = data[0].map((h) => String(h || "").trim());
  const dateCol = headers.indexOf("檢查日期");
  const typeCol = headers.indexOf("表單類型");
  const categoryCol = headers.indexOf("設備類別");
  if (dateCol < 0 || typeCol < 0 || categoryCol < 0) throw new Error("CHECK_RECORD_SCHEMA_INVALID");
  data.slice(1).forEach((row) => {
    const raw = row[dateCol];
    const date = raw instanceof Date ? raw : new Date(String(raw || "") + "T00:00:00+08:00");
    if (isNaN(date.getTime())) return;
    const category = String(row[categoryCol] || "").trim();
    const type = String(row[typeCol] || "").trim();
    if (!category) return;
    if (type === "每日") index.daily[formatISODate_(date) + "|" + category] = true;
    if (type === "每月") {
      const parts = dateParts_(date);
      index.monthly[parts.y + "-" + parts.m + "|" + category] = true;
    }
  });
  return index;
}

function dashboardHasChecklistRecord_(index, type, category, date) {
  if (type === "每日") return Boolean(index.daily[formatISODate_(date) + "|" + category]);
  const parts = dateParts_(date);
  return Boolean(index.monthly[parts.y + "-" + parts.m + "|" + category]);
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
