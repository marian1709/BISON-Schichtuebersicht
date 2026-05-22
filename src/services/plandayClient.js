const TOKEN_EXPIRY_BUFFER_MS = 60 * 1000;
const MAX_ERROR_BODY_LENGTH = 1000;

function joinUrl(baseUrl, resourcePath) {
  return `${baseUrl.replace(/\/$/, '')}/${resourcePath.replace(/^\//, '')}`;
}

function assertRequired(name, value) {
  if (!value) {
    throw new Error(`${name} is required`);
  }
}

function encodeOAuthParam(value) {
  return encodeURIComponent(value);
}

async function throwPlandayHttpError(response, prefix) {
  const body = await response.text();
  const details = body ? `: ${body.slice(0, MAX_ERROR_BODY_LENGTH)}` : '';
  throw new Error(`${prefix} with HTTP ${response.status}${details}`);
}

export class PlandayClient {
  constructor(config, tokenStore) {
    this.config = config;
    this.tokenStore = tokenStore;
    this.accessToken = null;
    this.accessTokenExpiresAt = 0;
  }

  async fetchShifts({ from, to }) {
    assertRequired('PLANDAY_CLIENT_ID', this.config.clientId);

    const token = await this.getAccessToken();
    const method = this.config.shiftsMethod.toUpperCase();
    const url = new URL(joinUrl(this.config.apiBaseUrl, this.config.shiftsPath));
    const requestOptions = {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        'X-ClientId': this.config.clientId,
        Accept: 'application/json'
      }
    };

    const payload = {
      from,
      to,
      departmentIds: this.config.departmentIds,
      shiftStatus: this.config.shiftStatus
    };

    if (method === 'GET') {
      url.searchParams.set('from', from);
      url.searchParams.set('to', to);
      if (this.config.shiftsLimit) {
        url.searchParams.set('limit', String(this.config.shiftsLimit));
      }
      if (this.config.departmentIds.length > 0) {
        url.searchParams.set('departmentIds', this.config.departmentIds.join(','));
      }
      if (this.config.shiftStatus && this.config.shiftStatus !== 'Both') {
        url.searchParams.set('shiftStatus', this.config.shiftStatus);
      }
    } else {
      requestOptions.headers['Content-Type'] = 'application/json';
      requestOptions.body = JSON.stringify(payload);
    }

    const response = await fetch(url, requestOptions);
    if (!response.ok) {
      await throwPlandayHttpError(response, 'Planday shift request failed');
    }

    return response.json();
  }

  getAuthorizationUrl({ redirectUri, state }) {
    assertRequired('PLANDAY_CLIENT_ID', this.config.clientId);

    const params = [
      ['client_id', this.config.clientId],
      ['response_type', 'code'],
      ['redirect_uri', redirectUri],
      ['scope', this.config.scopes],
      ['state', state]
    ];

    const query = params
      .map(([key, value]) => `${encodeOAuthParam(key)}=${encodeOAuthParam(value)}`)
      .join('&');

    return `${this.config.authorizeUrl}?${query}`;
  }

  async exchangeAuthorizationCode({ code, redirectUri }) {
    assertRequired('PLANDAY_CLIENT_ID', this.config.clientId);
    assertRequired('authorization code', code);

    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: this.config.clientId,
      code,
      redirect_uri: redirectUri
    });

    if (this.config.clientSecret) {
      body.set('client_secret', this.config.clientSecret);
    }

    const tokenResponse = await this.requestToken(body, 'Planday authorization failed');
    await this.storeTokenResponse(tokenResponse);
    return {
      hasRefreshToken: Boolean(tokenResponse.refresh_token),
      expiresIn: tokenResponse.expires_in ?? null
    };
  }

  async listDepartments() {
    return this.fetchSetupList(this.config.departmentsPath);
  }

  async listShiftGroups() {
    return this.fetchSetupList(this.config.shiftGroupsPath);
  }

  async fetchSetupList(resourcePath) {
    const token = await this.getAccessToken();
    const response = await fetch(joinUrl(this.config.apiBaseUrl, resourcePath), {
      headers: {
        Authorization: `Bearer ${token}`,
        'X-ClientId': this.config.clientId,
        Accept: 'application/json'
      }
    });

    if (!response.ok) {
      await throwPlandayHttpError(response, 'Planday setup list request failed');
    }

    return response.json();
  }

  async getAccessToken() {
    if (this.accessToken && Date.now() < this.accessTokenExpiresAt - TOKEN_EXPIRY_BUFFER_MS) {
      return this.accessToken;
    }

    const refreshToken = (await this.tokenStore.getRefreshToken()) || this.config.refreshToken;
    if (!refreshToken) {
      throw new Error('Planday is not authorized yet. Open /setup/planday/authorize first.');
    }

    const body = new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: this.config.clientId,
      refresh_token: refreshToken
    });

    if (this.config.clientSecret) {
      body.set('client_secret', this.config.clientSecret);
    }

    const tokenResponse = await this.requestToken(body, 'Planday token refresh failed');
    await this.storeTokenResponse(tokenResponse);
    return this.accessToken;
  }

  async requestToken(body, errorPrefix) {
    const response = await fetch(this.config.tokenUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json'
      },
      body
    });

    if (!response.ok) {
      await throwPlandayHttpError(response, errorPrefix);
    }

    const tokenResponse = await response.json();
    if (!tokenResponse.access_token) {
      throw new Error('Planday token response did not include an access token');
    }

    return tokenResponse;
  }

  async storeTokenResponse(tokenResponse) {
    this.accessToken = tokenResponse.access_token;
    this.accessTokenExpiresAt = Date.now() + Number(tokenResponse.expires_in ?? 3600) * 1000;

    if (tokenResponse.refresh_token) {
      await this.tokenStore.write({
        refreshToken: tokenResponse.refresh_token
      });
    }
  }
}
