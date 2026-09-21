import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

const COLOR_PATTERN = /^#[0-9a-f]{6}$/i;

export class ConfigValidationError extends Error {
  constructor(errors) {
    super('Configuration is invalid');
    this.name = 'ConfigValidationError';
    this.errors = errors;
  }
}

function stringId(value) {
  if (value === undefined || value === null || value === '') return null;
  return String(value);
}

function normalizeTeam(team) {
  return {
    id: String(team.id ?? crypto.randomUUID()),
    name: String(team.name ?? team.team ?? '').trim(),
    color: String(team.color ?? '').trim().toUpperCase(),
    leaderEmployeeId: stringId(team.leaderEmployeeId ?? team.leaderId ?? team.leaders?.[0]),
    substituteEmployeeId: stringId(
      team.substituteEmployeeId ?? team.substituteId ?? team.substitutes?.[0]
    )
  };
}

export function normalizeAppConfig(value) {
  return {
    version: 2,
    departmentId: stringId(value?.departmentId ?? value?.departmentIds?.[0]),
    teams: Array.isArray(value?.teams) ? value.teams.map(normalizeTeam) : []
  };
}

export function validateAppConfig(value, { allowEmpty = false } = {}) {
  const config = normalizeAppConfig(value);
  const errors = [];
  const names = new Set();
  const employeeAssignments = new Map();

  if (!config.departmentId && !allowEmpty) {
    errors.push({ field: 'departmentId', message: 'Bitte ein Department auswählen.' });
  }
  if (config.teams.length === 0 && !allowEmpty) {
    errors.push({ field: 'teams', message: 'Mindestens ein Team ist erforderlich.' });
  }

  for (const [index, team] of config.teams.entries()) {
    const prefix = `teams.${index}`;
    const normalizedName = team.name.toLocaleLowerCase('de');

    if (!team.name) {
      errors.push({ field: `${prefix}.name`, message: 'Der Teamname ist erforderlich.' });
    } else if (names.has(normalizedName)) {
      errors.push({ field: `${prefix}.name`, message: 'Teamnamen müssen eindeutig sein.' });
    }
    names.add(normalizedName);

    if (!COLOR_PATTERN.test(team.color)) {
      errors.push({ field: `${prefix}.color`, message: 'Die Farbe muss ein Hex-Wert wie #FA7E01 sein.' });
    }
    if (!team.leaderEmployeeId) {
      errors.push({ field: `${prefix}.leaderEmployeeId`, message: 'Bitte eine Führung auswählen.' });
    }
    if (!team.substituteEmployeeId) {
      errors.push({
        field: `${prefix}.substituteEmployeeId`,
        message: 'Bitte eine Stellvertretung auswählen.'
      });
    }
    if (
      team.leaderEmployeeId &&
      team.substituteEmployeeId &&
      team.leaderEmployeeId === team.substituteEmployeeId
    ) {
      errors.push({
        field: `${prefix}.substituteEmployeeId`,
        message: 'Führung und Stellvertretung müssen unterschiedliche Accounts sein.'
      });
    }

    for (const [role, employeeId] of [
      ['leaderEmployeeId', team.leaderEmployeeId],
      ['substituteEmployeeId', team.substituteEmployeeId]
    ]) {
      if (!employeeId) continue;
      const assignedTo = employeeAssignments.get(employeeId);
      if (assignedTo) {
        errors.push({
          field: `${prefix}.${role}`,
          message: `Dieser Account ist bereits ${assignedTo} zugeordnet.`
        });
      } else {
        employeeAssignments.set(employeeId, `Team „${team.name || index + 1}“`);
      }
    }
  }

  if (errors.length > 0) throw new ConfigValidationError(errors);
  return config;
}

export function toTeamRules(config) {
  return config.teams.map((team) => ({
    team: team.name,
    color: team.color,
    leaderEmployeeIds: team.leaderEmployeeId ? [team.leaderEmployeeId] : [],
    substituteEmployeeIds: team.substituteEmployeeId ? [team.substituteEmployeeId] : []
  }));
}

export class ConfigStore {
  constructor({ filePath, legacyFilePath }) {
    this.filePath = filePath;
    this.legacyFilePath = legacyFilePath;
    this.config = null;
  }

  async initialize() {
    const stored = await this.readJson(this.filePath);
    if (stored) {
      this.config = validateAppConfig(stored, { allowEmpty: true });
      return this.get();
    }

    const legacy = await this.readJson(this.legacyFilePath);
    this.config = validateAppConfig(legacy ?? {}, { allowEmpty: !legacy });
    await this.writeAtomic(this.config);
    return this.get();
  }

  get() {
    return structuredClone(this.config);
  }

  async save(value) {
    const validated = validateAppConfig(value);
    await this.writeAtomic(validated);
    this.config = validated;
    return this.get();
  }

  async readJson(filePath) {
    try {
      return JSON.parse(await fs.readFile(filePath, 'utf8'));
    } catch (error) {
      if (error.code === 'ENOENT') return null;
      throw new Error(`Could not read configuration ${filePath}: ${error.message}`);
    }
  }

  async writeAtomic(config) {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    const temporaryFile = `${this.filePath}.${process.pid}.${crypto.randomUUID()}.tmp`;
    await fs.writeFile(temporaryFile, `${JSON.stringify(config, null, 2)}\n`, {
      encoding: 'utf8',
      mode: 0o600
    });
    await fs.rename(temporaryFile, this.filePath);
  }
}
