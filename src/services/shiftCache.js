function isoDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function addDays(date, days) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function buildDayRange(dayCount) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  return Array.from({ length: dayCount }, (_, index) => {
    const date = addDays(today, index);
    return {
      date: isoDate(date),
      weekday: new Intl.DateTimeFormat('de-DE', { weekday: 'long' }).format(date),
      label: new Intl.DateTimeFormat('de-DE', { day: '2-digit', month: '2-digit' }).format(date),
      shifts: []
    };
  });
}

function asArray(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.data)) return payload.data;
  if (Array.isArray(payload?.items)) return payload.items;
  if (Array.isArray(payload?.results)) return payload.results;
  return [];
}

function pickShiftData(entry) {
  return entry.current ?? entry.approved ?? entry.firstApproved ?? entry.atWorkStart ?? entry.workedTime ?? entry;
}

function pickFirst(...values) {
  return values.find((value) => value !== undefined && value !== null && value !== '');
}

function shiftStart(shift) {
  return pickFirst(shift.start, shift.startDateTime, shift.shiftStart, shift.startTime);
}

function shiftEnd(shift) {
  return pickFirst(shift.end, shift.endDateTime, shift.shiftEnd, shift.endTime);
}

function employeeIdFrom(entry, shift) {
  return pickFirst(shift.employeeId, shift.employee_id, entry.employeeId, entry.employee_id);
}

function dateFromShift(shift) {
  if (shift.date) return String(shift.date).slice(0, 10);
  const start = shiftStart(shift);
  if (!start) return null;
  const date = new Date(start);
  return Number.isNaN(date.getTime()) ? null : isoDate(date);
}

function hourFromDateTime(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.getHours();
}

function shiftPeriodFromStart(value) {
  const hour = hourFromDateTime(value);
  if (hour === null) {
    return { key: 'unknown', label: 'Schicht' };
  }

  if (hour >= 4 && hour < 12) {
    return { key: 'early', label: 'Frühschicht' };
  }

  if (hour >= 12 && hour < 20) {
    return { key: 'late', label: 'Spätschicht' };
  }

  return { key: 'night', label: 'Nachtschicht' };
}

const periodOrder = new Map([
  ['early', 1],
  ['late', 2],
  ['night', 3],
  ['unknown', 4]
]);

function emptyPublicData(dayCount) {
  return {
    generatedAt: null,
    lastSuccessfulUpdate: null,
    warning: 'Noch keine Schichtdaten geladen.',
    days: buildDayRange(dayCount)
  };
}

export class ShiftCache {
  constructor({ client, teamRules, cacheTtlMs, dayCount }) {
    this.client = client;
    this.teamRules = teamRules;
    this.cacheTtlMs = cacheTtlMs;
    this.dayCount = dayCount;
    this.publicData = emptyPublicData(dayCount);
    this.lastAttempt = null;
    this.lastError = null;
    this.isUpdating = false;
  }

  getState() {
    return {
      hasData: Boolean(this.publicData.lastSuccessfulUpdate),
      isStale: this.isStale(),
      lastSuccessfulUpdate: this.publicData.lastSuccessfulUpdate,
      lastAttempt: this.lastAttempt,
      lastError: this.lastError
    };
  }

  getPublicData() {
    return {
      ...this.publicData,
      warning: this.lastError ? 'Daten konnten zuletzt nicht aktualisiert werden.' : this.publicData.warning
    };
  }

  setTeamRules(teamRules) {
    this.teamRules = teamRules;
    this.publicData.generatedAt = null;
  }

  isStale() {
    if (!this.publicData.generatedAt) return true;
    return Date.now() - new Date(this.publicData.generatedAt).getTime() >= this.cacheTtlMs;
  }

  async refreshIfNeeded({ force = false } = {}) {
    if (this.isUpdating) return;
    if (!force && !this.isStale()) return;
    await this.refresh();
  }

  async refresh() {
    this.isUpdating = true;
    this.lastAttempt = new Date().toISOString();

    try {
      const days = buildDayRange(this.dayCount);
      const raw = await this.client.fetchShifts({
        from: days[0].date,
        to: days.at(-1).date
      });

      this.publicData = {
        generatedAt: new Date().toISOString(),
        lastSuccessfulUpdate: new Date().toISOString(),
        warning: null,
        days: this.reduceToPublicData(raw, days)
      };
      this.lastError = null;
    } catch (error) {
      this.lastError = {
        time: new Date().toISOString(),
        message: error.message
      };
      console.error('Planday refresh failed:', error.message);
    } finally {
      this.isUpdating = false;
    }
  }

  reduceToPublicData(rawPayload, days) {
    const daysByDate = new Map(days.map((day) => [day.date, { ...day, shifts: [] }]));
    const dedupe = new Set();
    const teamCandidates = new Map();

    for (const entry of asArray(rawPayload)) {
      const shift = pickShiftData(entry);
      const period = shiftPeriodFromStart(shiftStart(shift));

      const date = dateFromShift(shift);
      const day = daysByDate.get(date);
      if (!day) continue;

      const candidate = this.teamCandidateForShift(entry, shift);
      if (!candidate) continue;

      const bucketKey = `${date}|${period.key}`;
      const bucket = teamCandidates.get(bucketKey) ?? {
        day,
        period,
        teams: new Map()
      };
      const team = bucket.teams.get(candidate.groupName) ?? {
        ...candidate,
        leaderIds: new Set(),
        substituteIds: new Set()
      };
      team[candidate.role].add(candidate.employeeId);
      bucket.teams.set(candidate.groupName, team);
      teamCandidates.set(bucketKey, bucket);
    }

    for (const bucket of teamCandidates.values()) {
      const selected = [...bucket.teams.values()].sort((a, b) => {
        const aMatches = a.leaderIds.size + a.substituteIds.size;
        const bMatches = b.leaderIds.size + b.substituteIds.size;
        return (
          bMatches - aMatches ||
          Number(b.leaderIds.size > 0) - Number(a.leaderIds.size > 0) ||
          a.priority - b.priority
        );
      })[0];
      if (selected) this.addPublicShift(bucket.day, bucket.period, selected, dedupe);
    }

    return [...daysByDate.values()].map((day) => ({
      ...day,
      shifts: day.shifts.sort((a, b) => {
        return (
          (periodOrder.get(a.periodKey) ?? 99) - (periodOrder.get(b.periodKey) ?? 99) ||
          a.groupName.localeCompare(b.groupName, 'de')
        );
      })
    }));
  }

  addPublicShift(day, period, team, dedupe) {
    const key = `${day.date}|${period.key}|${team.groupName}`;
    if (dedupe.has(key)) return;
    dedupe.add(key);

    day.shifts.push({
      groupName: team.groupName,
      color: team.color,
      periodKey: period.key,
      periodLabel: period.label
    });
  }

  teamCandidateForShift(entry, shift) {
    const employeeId = String(employeeIdFrom(entry, shift) ?? '');
    if (!employeeId) return null;

    const leaderIndex = this.teamRules.findIndex((rule) => rule.leaderEmployeeIds.includes(employeeId));
    if (leaderIndex >= 0) {
      const leaderRule = this.teamRules[leaderIndex];
      return {
        groupName: leaderRule.team,
        color: leaderRule.color,
        priority: leaderIndex,
        role: 'leaderIds',
        employeeId
      };
    }

    const substituteIndex = this.teamRules.findIndex((rule) => rule.substituteEmployeeIds.includes(employeeId));
    if (substituteIndex >= 0) {
      const substituteRule = this.teamRules[substituteIndex];
      return {
        groupName: substituteRule.team,
        color: substituteRule.color,
        priority: substituteIndex,
        role: 'substituteIds',
        employeeId
      };
    }

    return null;
  }
}
