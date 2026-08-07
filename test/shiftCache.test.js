import assert from 'node:assert/strict';
import test from 'node:test';
import { ShiftCache } from '../src/services/shiftCache.js';

const teamRules = [
  {
    team: 'Team Alex',
    color: '#FA7E01',
    leaderEmployeeIds: ['168016'],
    substituteEmployeeIds: ['183450']
  },
  {
    team: 'Team Patrick',
    color: '#7ADBDA',
    leaderEmployeeIds: ['165918'],
    substituteEmployeeIds: ['182966']
  },
  {
    team: 'Team Dennis',
    color: '#0A994C',
    leaderEmployeeIds: ['171211'],
    substituteEmployeeIds: ['166385']
  }
];

test('selects the expected teams when employees help in another team', () => {
  const cache = new ShiftCache({
    client: null,
    teamRules,
    cacheTtlMs: 300_000,
    dayCount: 1
  });
  const raw = [
    { start: '2026-08-10T06:00', employeeId: 166385, shiftTypeId: 205105 },
    { start: '2026-08-10T14:00', employeeId: 168016, shiftTypeId: 197741 },
    { start: '2026-08-10T14:00', employeeId: 171211, shiftTypeId: 205106 },
    { start: '2026-08-10T14:00', employeeId: 183450, shiftTypeId: 205106 },
    { start: '2026-08-10T22:00', employeeId: 165918, shiftTypeId: 205107 },
    { start: '2026-08-10T22:00', employeeId: 182966, shiftTypeId: 205107 }
  ];
  const days = [
    {
      date: '2026-08-10',
      weekday: 'Montag',
      label: '10.08.',
      shifts: []
    }
  ];

  const [day] = cache.reduceToPublicData(raw, days);

  assert.deepEqual(
    day.shifts.map(({ periodKey, groupName }) => ({ periodKey, groupName })),
    [
      { periodKey: 'early', groupName: 'Team Dennis' },
      { periodKey: 'late', groupName: 'Team Alex' },
      { periodKey: 'night', groupName: 'Team Patrick' }
    ]
  );
});
