import type { Clock, Network, Storage } from "./platform.js";

export type SessionTokens = {
  accessToken: string;
  expiresAt: number;
  playerId: string;
  configVersion: string;
};

export type ClientSdkDependencies = {
  baseUrl: string;
  clock: Clock;
  network: Network;
  storage: Storage;
};

const SESSION_KEY = "ember.session.v1";

export class EmberClientSdk {
  constructor(private readonly dependencies: ClientSdkDependencies) {}

  async exchangeChannelTicket(input: {
    platform: string;
    ticket: string;
    clientVersion: string;
  }): Promise<SessionTokens> {
    const response = await this.dependencies.network.request({
      url: `${this.dependencies.baseUrl}/v1/auth/channel/exchange`,
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
    });
    if (response.status !== 200) {
      throw new Error(`Channel exchange failed with status ${response.status}.`);
    }
    const parsed = JSON.parse(response.body) as SessionTokens;
    if (!parsed.accessToken || parsed.expiresAt <= this.dependencies.clock.now()) {
      throw new Error("Server returned an invalid or expired session.");
    }
    await this.dependencies.storage.set(SESSION_KEY, JSON.stringify(parsed));
    return parsed;
  }

  async loadSession(): Promise<SessionTokens | null> {
    const raw = await this.dependencies.storage.get(SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as SessionTokens;
    if (parsed.expiresAt <= this.dependencies.clock.now()) {
      await this.dependencies.storage.remove(SESSION_KEY);
      return null;
    }
    return parsed;
  }
}
