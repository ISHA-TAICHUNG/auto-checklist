import { readSecretFromEnv } from './secrets.js';

function envBool(name, defaultValue) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return defaultValue;
  return ['1', 'true', 'yes', 'y', 'on'].includes(String(raw).toLowerCase());
}

function currentTaipeiSlot() {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Taipei',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date());
}

function currentTaipeiDate() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Taipei',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

export async function loadConfig() {
  const dryRun = envBool('DRY_RUN', true);
  const mockHtmlPath = String(process.env.MOCK_HTML_PATH || '').trim();
  const needsVitalLogin = !mockHtmlPath;
  const username = needsVitalLogin
    ? await readSecretFromEnv({ directEnv: 'VITAL_OD_USERNAME', secretEnv: 'VITAL_OD_USERNAME_SECRET' })
    : '';
  const password = needsVitalLogin
    ? await readSecretFromEnv({ directEnv: 'VITAL_OD_PASSWORD', secretEnv: 'VITAL_OD_PASSWORD_SECRET' })
    : '';

  return {
    targetUrl: String(process.env.TARGET_URL || 'https://od.vitalyun.com/').trim(),
    waitForPublishUrl: String(process.env.WAIT_FOR_PUBLISH_URL || '').trim(),
    timezone: String(process.env.TIMEZONE || 'Asia/Taipei').trim(),
    date: String(process.env.CHECK_DATE || currentTaipeiDate()).trim(),
    slot: String(process.env.SLOT || currentTaipeiSlot()).trim(),
    dryRun,
    notify: envBool('NOTIFY', false),
    headless: envBool('HEADLESS', true),
    maxRecords: Number(process.env.MAX_RECORDS || 50),
    mockHtmlPath,
    username,
    password,
    appsScriptReportingEnabled: envBool('APPS_SCRIPT_REPORTING_ENABLED', false),
    appsScriptUrl: String(process.env.APPS_SCRIPT_URL || '').trim(),
    appsScriptApiToken: await readSecretFromEnv({
      directEnv: 'APPS_SCRIPT_API_TOKEN',
      secretEnv: 'APPS_SCRIPT_API_TOKEN_SECRET',
    }),
    appsScriptAdminToken: await readSecretFromEnv({
      directEnv: 'APPS_SCRIPT_ADMIN_TOKEN',
      secretEnv: 'APPS_SCRIPT_ADMIN_TOKEN_SECRET',
    }),
  };
}

export function validateConfig(config) {
  if (!config.mockHtmlPath) {
    if (!config.username || !config.password) throw new Error('VITAL_OD credentials are missing');
  }
  if (config.appsScriptReportingEnabled && !config.appsScriptUrl) {
    throw new Error('APPS_SCRIPT_REPORTING_ENABLED is true but APPS_SCRIPT_URL is missing');
  }
  if (config.appsScriptReportingEnabled && (!config.appsScriptApiToken || !config.appsScriptAdminToken)) {
    throw new Error('Apps Script URL is set but api/admin tokens are missing');
  }
  if (config.appsScriptReportingEnabled && String(config.appsScriptAdminToken || '').trim().length < 48) {
    throw new Error('APPS_SCRIPT_ADMIN_TOKEN is too short for reporting mode');
  }
  if (config.appsScriptReportingEnabled && config.appsScriptAdminToken === config.appsScriptApiToken) {
    throw new Error('APPS_SCRIPT_ADMIN_TOKEN must be different from APPS_SCRIPT_API_TOKEN');
  }
}
