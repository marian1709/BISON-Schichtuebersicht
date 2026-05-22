const daysElement = document.querySelector('#days');
const updatedAtElement = document.querySelector('#updatedAt');
const warningElement = document.querySelector('#warning');

let refreshTimer = null;

const shiftPeriods = [
  { key: 'early', label: 'Frühschicht' },
  { key: 'late', label: 'Spätschicht' },
  { key: 'night', label: 'Nachtschicht' },
  { key: 'unknown', label: 'Weitere Schichten' }
];

function formatUpdateTime(value) {
  if (!value) return '--:--';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '--:--';
  return new Intl.DateTimeFormat('de-DE', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  }).format(date);
}

function createShiftElement(shift) {
  const item = document.createElement('li');
  item.className = 'shift';
  if (shift.color) {
    item.style.setProperty('--team-color', shift.color);
  }

  const group = document.createElement('span');
  group.className = 'group';
  group.textContent = shift.groupName;
  item.append(group);

  return item;
}

function createPeriodElement(period, shifts) {
  const section = document.createElement('section');
  section.className = `period period-${period.key}`;

  const title = document.createElement('h3');
  title.textContent = period.label;

  const list = document.createElement('ul');
  list.className = 'shift-list';

  if (shifts.length) {
    for (const shift of shifts) {
      list.append(createShiftElement(shift));
    }
  } else {
    const empty = document.createElement('li');
    empty.className = 'empty small-empty';
    empty.textContent = 'Nicht besetzt';
    list.append(empty);
  }

  section.append(title, list);
  return section;
}

function render(payload) {
  daysElement.replaceChildren();

  for (const day of payload.days ?? []) {
    const card = document.createElement('article');
    card.className = 'day-card';

    const title = document.createElement('h2');
    title.textContent = day.weekday;

    const date = document.createElement('p');
    date.className = 'date';
    date.textContent = day.label;

    const periods = document.createElement('div');
    periods.className = 'periods';

    for (const period of shiftPeriods) {
      const shifts = (day.shifts ?? []).filter((shift) => shift.periodKey === period.key);
      if (period.key !== 'unknown' || shifts.length) {
        periods.append(createPeriodElement(period, shifts));
      }
    }

    card.append(title, date, periods);
    daysElement.append(card);
  }

  updatedAtElement.textContent = `Zuletzt aktualisiert: ${formatUpdateTime(payload.lastSuccessfulUpdate)}`;
  warningElement.hidden = !payload.warning;
  if (payload.warning) {
    warningElement.textContent = payload.warning;
  }
}

async function loadShifts() {
  try {
    const response = await fetch('/api/shifts', { cache: 'no-store' });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const payload = await response.json();
    render(payload);

    const nextPoll = Number(payload.frontendPollMs) || 60_000;
    window.clearTimeout(refreshTimer);
    refreshTimer = window.setTimeout(loadShifts, nextPoll);
  } catch {
    warningElement.hidden = false;
    warningElement.textContent = 'Daten konnten zuletzt nicht aktualisiert werden';
    window.clearTimeout(refreshTimer);
    refreshTimer = window.setTimeout(loadShifts, 60_000);
  }
}

loadShifts();
