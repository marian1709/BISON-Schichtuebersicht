import crypto from 'node:crypto';

const COOKIE_NAME = 'bison_admin_session';
const SESSION_TTL_MS = 8 * 60 * 60 * 1000;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const MAX_LOGIN_ATTEMPTS = 5;

function parseCookies(value = '') {
  return new Map(
    value
      .split(';')
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => {
        const separator = part.indexOf('=');
        if (separator < 0) return [part, ''];
        return [part.slice(0, separator), decodeURIComponent(part.slice(separator + 1))];
      })
  );
}

function secureHash(value) {
  return crypto.createHash('sha256').update(String(value ?? ''), 'utf8').digest();
}

function cookieHeader(value, { maxAge = SESSION_TTL_MS, secure = false } = {}) {
  const parts = [
    `${COOKIE_NAME}=${encodeURIComponent(value)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Strict',
    `Max-Age=${Math.max(0, Math.floor(maxAge / 1000))}`
  ];
  if (secure) parts.push('Secure');
  return parts.join('; ');
}

export class AdminAuth {
  constructor(password) {
    this.password = password;
    this.sessions = new Map();
    this.loginAttempts = new Map();
  }

  isConfigured() {
    return Boolean(this.password);
  }

  isPasswordValid(password) {
    if (!this.isConfigured()) return false;
    return crypto.timingSafeEqual(secureHash(password), secureHash(this.password));
  }

  canAttemptLogin(key) {
    const now = Date.now();
    const recent = (this.loginAttempts.get(key) ?? []).filter((time) => now - time < LOGIN_WINDOW_MS);
    this.loginAttempts.set(key, recent);
    return recent.length < MAX_LOGIN_ATTEMPTS;
  }

  recordFailedLogin(key) {
    const attempts = this.loginAttempts.get(key) ?? [];
    attempts.push(Date.now());
    this.loginAttempts.set(key, attempts);
  }

  clearFailedLogins(key) {
    this.loginAttempts.delete(key);
  }

  createSession(req, res) {
    const sessionId = crypto.randomBytes(32).toString('base64url');
    this.sessions.set(sessionId, { expiresAt: Date.now() + SESSION_TTL_MS });
    res.setHeader('Set-Cookie', cookieHeader(sessionId, { secure: req.secure }));
  }

  destroySession(req, res) {
    const sessionId = parseCookies(req.get('cookie')).get(COOKIE_NAME);
    if (sessionId) this.sessions.delete(sessionId);
    res.setHeader('Set-Cookie', cookieHeader('', { maxAge: 0, secure: req.secure }));
  }

  isAuthenticated(req) {
    const sessionId = parseCookies(req.get('cookie')).get(COOKIE_NAME);
    if (!sessionId) return false;

    const session = this.sessions.get(sessionId);
    if (!session || session.expiresAt <= Date.now()) {
      this.sessions.delete(sessionId);
      return false;
    }

    session.expiresAt = Date.now() + SESSION_TTL_MS;
    return true;
  }

  requireSession = (req, res, next) => {
    if (!this.isConfigured()) {
      res.status(503).json({ error: 'ADMIN_PASSWORD ist nicht konfiguriert.' });
      return;
    }
    if (!this.isAuthenticated(req)) {
      res.status(401).json({ error: 'Nicht angemeldet.' });
      return;
    }
    next();
  };

  requireSameOrigin(req, res, next) {
    const origin = req.get('origin');
    if (origin) {
      const expectedOrigin = `${req.protocol}://${req.get('host')}`;
      if (origin !== expectedOrigin) {
        res.status(403).json({ error: 'Ungültiger Request-Ursprung.' });
        return;
      }
    }
    next();
  }
}
