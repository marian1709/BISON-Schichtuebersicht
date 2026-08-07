import fs from 'node:fs';
import path from 'node:path';

const DEFAULT_SCHEDULE_CONFIG_FILE = path.join(process.cwd(), 'config', 'schedule.json');

function positiveNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function idList(value, fieldName) {
  if (value === undefined) return [];
  if (!Array.isArray(value)) {
    throw new Error(`${fieldName} must be an array`);
  }
  return value.map(String);
}

function loadScheduleConfig(fileName) {
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(fileName, 'utf8'));
  } catch (error) {
    throw new Error(`Could not load schedule config ${fileName}: ${error.message}`);
  }

  if (!Array.isArray(parsed.teams) || parsed.teams.length === 0) {
    throw new Error('schedule.json must contain at least one team');
  }

  return {
    departmentIds: idList(parsed.departmentIds, 'departmentIds'),
    teams: parsed.teams.map((team, index) => {
      const name = String(team.name ?? '').trim();
      const color = String(team.color ?? '').trim();
      if (!name || !color) {
        throw new Error(`teams[${index}] requires name and color`);
      }

      return {
        team: name,
        color,
        leaderEmployeeIds: idList(team.leaders, `teams[${index}].leaders`),
        substituteEmployeeIds: idList(team.substitutes, `teams[${index}].substitutes`)
      };
    })
  };
}

export function loadConfig(env = process.env) {
  const scheduleConfigFile = path.resolve(env.SCHEDULE_CONFIG_FILE ?? DEFAULT_SCHEDULE_CONFIG_FILE);
  const schedule = loadScheduleConfig(scheduleConfigFile);

  return {
    port: positiveNumber(env.PORT, 3000),
    cacheTtlMs: 5 * 60 * 1000,
    refreshIntervalMs: 5 * 60 * 1000,
    frontendPollMs: 60 * 1000,
    dayCount: 7,
    setupToken: env.SETUP_TOKEN,
    plandayTokenFile: env.PLANDAY_TOKEN_FILE ?? path.join(process.cwd(), 'data', 'planday-token.json'),
    teamRules: schedule.teams,
    planday: {
      apiBaseUrl: 'https://openapi.planday.com',
      authorizeUrl: 'https://id.planday.com/connect/authorize',
      tokenUrl: 'https://id.planday.com/connect/token',
      clientId: env.PLANDAY_CLIENT_ID,
      clientSecret: env.PLANDAY_CLIENT_SECRET,
      refreshToken: env.PLANDAY_REFRESH_TOKEN,
      redirectUri: env.PLANDAY_REDIRECT_URI,
      scopes: 'openid offline_access shift:read',
      shiftsPath: '/scheduling/v1.0/shifts',
      shiftsMethod: 'GET',
      shiftsLimit: 300,
      departmentsPath: '/hr/v1/Departments',
      departmentIds: schedule.departmentIds
    }
  };
}
