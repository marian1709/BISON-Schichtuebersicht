import path from 'node:path';

function positiveNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function loadConfig(env = process.env) {
  return {
    port: positiveNumber(env.PORT, 3000),
    cacheTtlMs: 5 * 60 * 1000,
    refreshIntervalMs: 5 * 60 * 1000,
    frontendPollMs: 60 * 1000,
    dayCount: 7,
    adminPassword: env.ADMIN_PASSWORD,
    appConfigFile: path.resolve(env.APP_CONFIG_FILE ?? path.join(process.cwd(), 'data', 'app-config.json')),
    legacyScheduleFile: path.resolve(
      env.SCHEDULE_CONFIG_FILE ?? path.join(process.cwd(), 'config', 'schedule.json')
    ),
    plandayTokenFile: env.PLANDAY_TOKEN_FILE ?? path.join(process.cwd(), 'data', 'planday-token.json'),
    planday: {
      apiBaseUrl: 'https://openapi.planday.com',
      authorizeUrl: 'https://id.planday.com/connect/authorize',
      tokenUrl: 'https://id.planday.com/connect/token',
      clientId: env.PLANDAY_CLIENT_ID,
      clientSecret: env.PLANDAY_CLIENT_SECRET,
      refreshToken: env.PLANDAY_REFRESH_TOKEN,
      redirectUri: env.PLANDAY_REDIRECT_URI,
      scopes: 'openid offline_access shift:read employee:read department:read',
      shiftsPath: '/scheduling/v1.0/shifts',
      shiftsMethod: 'GET',
      shiftsLimit: 300,
      departmentsPath: '/hr/v1/Departments',
      employeesPath: '/hr/v1/Employees',
      departmentIds: []
    }
  };
}
