import assert from "node:assert/strict";
import test from "node:test";
import { EmberClientSdk } from "../src/client-sdk.js";
import { MemoryStorage, type Network } from "../src/platform.js";

test("client SDK persists a short-lived server-issued session", async () => {
  const network: Network = {
    async request() {
      return {
        status: 200,
        headers: {},
        body: JSON.stringify({
          accessToken: "opaque-token",
          expiresAt: 2_000,
          playerId: "player-1",
          configVersion: "2026.08.31",
        }),
      };
    },
  };
  const sdk = new EmberClientSdk({
    baseUrl: "https://api.invalid",
    clock: { now: () => 1_000 },
    network,
    storage: new MemoryStorage(),
  });

  await sdk.exchangeChannelTicket({ platform: "4399", ticket: "one-use", clientVersion: "1.0.0" });
  assert.equal((await sdk.loadSession())?.playerId, "player-1");
});

test("client SDK rejects an already expired session", async () => {
  const sdk = new EmberClientSdk({
    baseUrl: "https://api.invalid",
    clock: { now: () => 2_000 },
    network: {
      async request() {
        return {
          status: 200,
          headers: {},
          body: JSON.stringify({ accessToken: "x", expiresAt: 1_999, playerId: "p", configVersion: "v" }),
        };
      },
    },
    storage: new MemoryStorage(),
  });
  await assert.rejects(
    sdk.exchangeChannelTicket({ platform: "4399", ticket: "t", clientVersion: "1" }),
    /expired/,
  );
});
