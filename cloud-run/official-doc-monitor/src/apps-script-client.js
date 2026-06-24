export async function sendToAppsScript(config, payload) {
  if (!config.appsScriptReportingEnabled) {
    return { ok: false, skipped: true, reason: 'APPS_SCRIPT_REPORTING_ENABLED is false' };
  }
  if (!config.appsScriptUrl) {
    return { ok: false, skipped: true, reason: 'APPS_SCRIPT_URL not configured' };
  }
  const body = {
    apiToken: config.appsScriptApiToken,
    adminToken: config.appsScriptAdminToken,
    action: 'enqueueOfficialDocuments',
    ...payload,
  };
  const res = await fetch(config.appsScriptUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch (_) {
    throw new Error(`Apps Script returned non-JSON response: HTTP ${res.status}`);
  }
  if (!res.ok || !json.ok) {
    throw new Error(`Apps Script enqueue failed: HTTP ${res.status} ${json.error || text}`);
  }
  return json;
}
