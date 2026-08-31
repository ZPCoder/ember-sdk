export interface Clock {
  now(): number;
}

export interface SecureRng {
  fill(target: Uint32Array): void;
}

export interface Storage {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  remove(key: string): Promise<void>;
}

export type NetworkRequest = {
  url: string;
  method?: "GET" | "POST" | "PUT" | "DELETE";
  headers?: Readonly<Record<string, string>>;
  body?: string;
  signal?: AbortSignal;
};

export type NetworkResponse = {
  status: number;
  headers: Readonly<Record<string, string>>;
  body: string;
};

export interface Network {
  request(input: NetworkRequest): Promise<NetworkResponse>;
}

export const systemClock: Clock = Object.freeze({ now: () => Date.now() });

export const webSecureRng: SecureRng = Object.freeze({
  fill(target: Uint32Array): void {
    const cryptoApi = globalThis.crypto;
    if (!cryptoApi?.getRandomValues) {
      throw new Error("A cryptographically secure RNG adapter is required.");
    }
    cryptoApi.getRandomValues(target);
  },
});

export class MemoryStorage implements Storage {
  readonly #values = new Map<string, string>();

  async get(key: string): Promise<string | null> {
    return this.#values.get(key) ?? null;
  }

  async set(key: string, value: string): Promise<void> {
    this.#values.set(key, value);
  }

  async remove(key: string): Promise<void> {
    this.#values.delete(key);
  }
}

export class FetchNetwork implements Network {
  async request(input: NetworkRequest): Promise<NetworkResponse> {
    const response = await fetch(input.url, {
      method: input.method ?? "GET",
      headers: input.headers,
      body: input.body,
      signal: input.signal,
    });
    return {
      status: response.status,
      headers: Object.fromEntries(response.headers.entries()),
      body: await response.text(),
    };
  }
}
