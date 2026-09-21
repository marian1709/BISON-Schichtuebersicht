const loginView = document.querySelector('#loginView');
const adminView = document.querySelector('#adminView');
const loginForm = document.querySelector('#loginForm');
const loginError = document.querySelector('#loginError');
const logoutButton = document.querySelector('#logoutButton');
const message = document.querySelector('#message');
const connectionStatus = document.querySelector('#connectionStatus');
const connectButton = document.querySelector('#connectButton');
const configForm = document.querySelector('#configForm');
const departmentSelect = document.querySelector('#department');
const reloadAccountsButton = document.querySelector('#reloadAccountsButton');
const teamsElement = document.querySelector('#teams');
const teamTemplate = document.querySelector('#teamTemplate');
const addTeamButton = document.querySelector('#addTeamButton');
const discardButton = document.querySelector('#discardButton');
const saveButton = document.querySelector('#saveButton');
const dirtyState = document.querySelector('#dirtyState');

let originalConfig = null;
let employees = [];
let dirty = false;

async function api(url, options = {}) {
  const response = await fetch(url, {
    cache: 'no-store',
    ...options,
    headers: {
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...options.headers
    }
  });

  if (response.status === 401) {
    showLogin();
    throw new Error('Die Sitzung ist abgelaufen.');
  }
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    const error = new Error(payload.error || `HTTP ${response.status}`);
    error.details = payload.errors ?? [];
    throw error;
  }
  if (response.status === 204) return null;
  return response.json();
}

function showLogin() {
  adminView.hidden = true;
  loginView.hidden = false;
  document.querySelector('#password').focus();
}

function showAdmin() {
  loginView.hidden = true;
  adminView.hidden = false;
}

function showMessage(text, type = 'error') {
  message.textContent = text;
  message.className = `message message-${type}`;
  message.hidden = false;
}

function clearMessage() {
  message.hidden = true;
}

function setDirty(value) {
  dirty = value;
  dirtyState.textContent = value ? 'Ungespeicherte Änderungen' : 'Keine ungespeicherten Änderungen';
  discardButton.disabled = !value;
  saveButton.disabled = !value;
}

function populateEmployeeSelect(select, selectedId) {
  const selectedExists = employees.some((employee) => employee.id === String(selectedId));
  const options = [
    { id: '', name: 'Bitte auswählen' },
    ...employees,
    ...(!selectedExists && selectedId
      ? [{ id: String(selectedId), name: `Account ${selectedId}` }]
      : [])
  ];
  select.replaceChildren(
    ...options.map((employee) => {
      const option = document.createElement('option');
      option.value = employee.id;
      option.textContent = employee.id ? `${employee.name} (${employee.id})` : employee.name;
      return option;
    })
  );
  select.value = selectedId ? String(selectedId) : '';
}

function updateMoveButtons() {
  const cards = [...teamsElement.children];
  cards.forEach((card, index) => {
    card.querySelector('.move-up').disabled = index === 0;
    card.querySelector('.move-down').disabled = index === cards.length - 1;
  });
}

function createTeamCard(team = {}) {
  const card = teamTemplate.content.firstElementChild.cloneNode(true);
  card.dataset.id = team.id ?? crypto.randomUUID();

  const nameInput = card.querySelector('.team-name');
  const colorInput = card.querySelector('.team-color');
  const colorPicker = card.querySelector('.team-color-picker');
  const leaderInput = card.querySelector('.team-leader');
  const substituteInput = card.querySelector('.team-substitute');
  const previewName = card.querySelector('.team-preview-name');

  nameInput.value = team.name ?? '';
  colorInput.value = team.color ?? '#38BDF8';
  colorPicker.value = colorInput.value.toLowerCase();
  populateEmployeeSelect(leaderInput, team.leaderEmployeeId);
  populateEmployeeSelect(substituteInput, team.substituteEmployeeId);

  const updatePreview = () => {
    const color = /^#[0-9a-f]{6}$/i.test(colorInput.value) ? colorInput.value : '#38BDF8';
    card.style.setProperty('--team-color', color);
    previewName.textContent = nameInput.value || 'Neues Team';
  };
  updatePreview();

  nameInput.addEventListener('input', updatePreview);
  colorInput.addEventListener('input', () => {
    if (/^#[0-9a-f]{6}$/i.test(colorInput.value)) colorPicker.value = colorInput.value;
    updatePreview();
  });
  colorPicker.addEventListener('input', () => {
    colorInput.value = colorPicker.value.toUpperCase();
    updatePreview();
    setDirty(true);
  });
  card.querySelector('.remove-team').addEventListener('click', () => {
    if (nameInput.value && !window.confirm(`Team „${nameInput.value}“ wirklich löschen?`)) return;
    card.remove();
    updateMoveButtons();
    setDirty(true);
  });
  card.querySelector('.move-up').addEventListener('click', () => {
    card.previousElementSibling?.before(card);
    updateMoveButtons();
    setDirty(true);
  });
  card.querySelector('.move-down').addEventListener('click', () => {
    card.nextElementSibling?.after(card);
    updateMoveButtons();
    setDirty(true);
  });

  return card;
}

function renderTeams(teams) {
  teamsElement.replaceChildren(...teams.map(createTeamCard));
  updateMoveButtons();
}

function populateDepartments(departments, selectedId) {
  const selectedExists = departments.some((department) => department.id === selectedId);
  const options = [
    { id: '', name: 'Bitte auswählen' },
    ...departments,
    ...(!selectedExists && selectedId ? [{ id: selectedId, name: `Department ${selectedId}` }] : [])
  ];
  departmentSelect.replaceChildren(
    ...options.map((department) => {
      const option = document.createElement('option');
      option.value = department.id;
      option.textContent = department.name;
      return option;
    })
  );
  departmentSelect.value = selectedId ?? '';
}

async function loadEmployees() {
  const departmentId = departmentSelect.value;
  employees = [];
  if (!departmentId) return;

  reloadAccountsButton.disabled = true;
  reloadAccountsButton.textContent = 'Accounts werden geladen …';
  try {
    const payload = await api(`/api/admin/employees?departmentId=${encodeURIComponent(departmentId)}`);
    employees = payload.employees;
  } catch (error) {
    showMessage(`${error.message} Prüfe die Planday-Verbindung und die Berechtigung employee:read.`);
  } finally {
    reloadAccountsButton.disabled = false;
    reloadAccountsButton.textContent = 'Accounts neu laden';
  }
}

async function loadAdmin() {
  showAdmin();
  clearMessage();

  const [config, status] = await Promise.all([
    api('/api/admin/config'),
    api('/api/admin/planday/status')
  ]);
  originalConfig = structuredClone(config);
  connectionStatus.textContent = status.authorized
    ? 'Planday ist verbunden.'
    : 'Planday ist noch nicht verbunden.';
  connectButton.textContent = status.authorized ? 'Planday neu verbinden' : 'Mit Planday verbinden';

  let departments = [];
  try {
    departments = (await api('/api/admin/departments')).departments;
  } catch (error) {
    showMessage(`${error.message} Du kannst Planday über die Schaltfläche neu verbinden.`);
  }
  populateDepartments(departments, config.departmentId);
  await loadEmployees();
  renderTeams(config.teams);
  setDirty(false);

  const connection = new URLSearchParams(window.location.search).get('connection');
  if (connection === 'success') showMessage('Planday wurde erfolgreich verbunden.', 'success');
  if (connection === 'failed') showMessage('Planday konnte nicht verbunden werden.');
  if (connection === 'invalid') showMessage('Die Planday-Anmeldung ist abgelaufen. Bitte erneut versuchen.');
  if (connection) window.history.replaceState({}, '', '/admin');
}

function serializeConfig() {
  return {
    version: 2,
    departmentId: departmentSelect.value,
    teams: [...teamsElement.children].map((card) => ({
      id: card.dataset.id,
      name: card.querySelector('.team-name').value.trim(),
      color: card.querySelector('.team-color').value.trim().toUpperCase(),
      leaderEmployeeId: card.querySelector('.team-leader').value || null,
      substituteEmployeeId: card.querySelector('.team-substitute').value || null
    }))
  };
}

loginForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  loginError.hidden = true;
  const submitButton = loginForm.querySelector('button');
  submitButton.disabled = true;
  try {
    await api('/api/admin/session', {
      method: 'POST',
      body: JSON.stringify({ password: new FormData(loginForm).get('password') })
    });
    loginForm.reset();
    await loadAdmin();
  } catch (error) {
    loginError.textContent = error.message;
    loginError.hidden = false;
  } finally {
    submitButton.disabled = false;
  }
});

logoutButton.addEventListener('click', async () => {
  await api('/api/admin/session', { method: 'DELETE' }).catch(() => null);
  showLogin();
});

configForm.addEventListener('input', () => setDirty(true));
departmentSelect.addEventListener('change', async () => {
  await loadEmployees();
  renderTeams(serializeConfig().teams);
});
reloadAccountsButton.addEventListener('click', async () => {
  const current = serializeConfig();
  await loadEmployees();
  renderTeams(current.teams);
});
addTeamButton.addEventListener('click', () => {
  teamsElement.append(createTeamCard());
  updateMoveButtons();
  setDirty(true);
});
discardButton.addEventListener('click', async () => {
  populateDepartments(
    [...departmentSelect.options]
      .filter((option) => option.value)
      .map((option) => ({ id: option.value, name: option.textContent })),
    originalConfig.departmentId
  );
  await loadEmployees();
  renderTeams(originalConfig.teams);
  clearMessage();
  setDirty(false);
});
configForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  clearMessage();
  if (!configForm.reportValidity()) return;

  saveButton.disabled = true;
  saveButton.textContent = 'Wird gespeichert …';
  try {
    originalConfig = await api('/api/admin/config', {
      method: 'PUT',
      body: JSON.stringify(serializeConfig())
    });
    renderTeams(originalConfig.teams);
    setDirty(false);
    showMessage('Konfiguration gespeichert und Schichtübersicht aktualisiert.', 'success');
  } catch (error) {
    const details = error.details.map((item) => item.message).join(' ');
    showMessage(details || error.message);
    setDirty(true);
  } finally {
    saveButton.textContent = 'Speichern';
    saveButton.disabled = !dirty;
  }
});

const session = await api('/api/admin/session').catch(() => ({ authenticated: false }));
if (session.authenticated) {
  await loadAdmin().catch((error) => showMessage(error.message));
} else {
  showLogin();
  if (session.configured === false) {
    loginError.textContent = 'ADMIN_PASSWORD ist nicht konfiguriert.';
    loginError.hidden = false;
  }
}
