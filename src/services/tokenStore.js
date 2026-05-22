import fs from 'node:fs/promises';
import path from 'node:path';

export class TokenStore {
  constructor(filePath) {
    this.filePath = filePath;
    this.cached = null;
  }

  async read() {
    if (this.cached) return this.cached;

    try {
      const content = await fs.readFile(this.filePath, 'utf8');
      this.cached = JSON.parse(content);
      return this.cached;
    } catch (error) {
      if (error.code === 'ENOENT') return null;
      throw new Error('Could not read Planday token store');
    }
  }

  async write(tokens) {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });

    const current = (await this.read()) ?? {};
    const tokenChanged = Object.entries(tokens).some(([key, value]) => current[key] !== value);
    if (!tokenChanged) return;

    this.cached = {
      ...current,
      ...tokens,
      updatedAt: new Date().toISOString()
    };

    await fs.writeFile(this.filePath, JSON.stringify(this.cached, null, 2), {
      encoding: 'utf8',
      mode: 0o600
    });
  }

  async getRefreshToken() {
    const tokens = await this.read();
    return tokens?.refreshToken ?? null;
  }

  async hasRefreshToken() {
    return Boolean(await this.getRefreshToken());
  }
}
