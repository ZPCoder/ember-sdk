import type { RankedFormat } from "./types.ts";

const DECK_CODE_VERSION = "ASTRA2";
const LEGACY_DECK_CODE_VERSION = "ASTRA1";
const MAX_ENCODED_LENGTH = 12_000;
const CARD_ID_PATTERN = /^[a-z0-9][a-z0-9-]*$/;

export type DecodedDeckCode = {
  version: 1 | 2;
  format: RankedFormat | null;
  name: string | null;
  cardIds: string[];
};

export type DeckCodePayload = {
  format: RankedFormat;
  name: string;
  cardIds: readonly string[];
};

function normalizeDeckName(name: string): string {
  const normalized = name.trim() || "未命名卡组";
  return normalized.slice(0, 32);
}

function encodeDeckName(name: string): string {
  return encodeURIComponent(normalizeDeckName(name)).replace(
    /[!'()*]/g,
    (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
}

function base64UrlToBytes(value: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]+$/.test(value) || value.length % 4 === 1) {
    throw new Error("卡组代码格式无效。");
  }
  const normalized = value.replaceAll("-", "+").replaceAll("_", "/");
  const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
  const binary = atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function parseCardIds(value: string): string[] {
  const ids = value.split(",");
  if (ids.length === 0 || ids.some((id) => !CARD_ID_PATTERN.test(id))) {
    throw new Error("卡组代码包含无效卡牌编号。");
  }
  return ids;
}

function decodeRawDeckCode(raw: string): DecodedDeckCode {
  if (raw.startsWith(`${DECK_CODE_VERSION}|`)) {
    const parts = raw.split("|");
    if (parts.length !== 4) throw new Error("ASTRA2 卡组代码字段不完整。");
    const format = parts[1];
    if (format !== "standard" && format !== "wild") {
      throw new Error("卡组代码包含未知模式。");
    }
    let name: string;
    try {
      name = decodeURIComponent(parts[2]);
    } catch {
      throw new Error("卡组代码名称无效。");
    }
    return {
      version: 2,
      format,
      name: normalizeDeckName(name),
      cardIds: parseCardIds(parts[3]),
    };
  }

  if (raw.startsWith(`${LEGACY_DECK_CODE_VERSION}|`)) {
    return {
      version: 1,
      format: null,
      name: null,
      cardIds: parseCardIds(raw.slice(LEGACY_DECK_CODE_VERSION.length + 1)),
    };
  }

  if (raw.includes(",") && !raw.includes("|")) {
    return {
      version: 1,
      format: null,
      name: null,
      cardIds: parseCardIds(raw),
    };
  }

  throw new Error("不支持的卡组代码版本。");
}

export function encodeDeckCode(payload: DeckCodePayload): string {
  if (payload.format !== "standard" && payload.format !== "wild") {
    throw new Error("无法导出未知模式的卡组。");
  }
  const cardIds = parseCardIds(payload.cardIds.join(","));
  const raw = [
    DECK_CODE_VERSION,
    payload.format,
    encodeDeckName(payload.name),
    cardIds.join(","),
  ].join("|");
  return bytesToBase64Url(new TextEncoder().encode(raw));
}

function decodeSingleDeckCode(trimmed: string): DecodedDeckCode {
  if (
    trimmed.startsWith(`${DECK_CODE_VERSION}|`) ||
    trimmed.startsWith(`${LEGACY_DECK_CODE_VERSION}|`) ||
    (trimmed.includes(",") && !trimmed.includes("|"))
  ) {
    return decodeRawDeckCode(trimmed);
  }
  const raw = new TextDecoder("utf-8", { fatal: true }).decode(
    base64UrlToBytes(trimmed),
  );
  return decodeRawDeckCode(raw);
}

export function decodeDeckCode(value: string): DecodedDeckCode {
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > MAX_ENCODED_LENGTH) {
    throw new Error("卡组代码为空或过长。");
  }

  let directError: unknown;
  try {
    return decodeSingleDeckCode(trimmed);
  } catch (error) {
    directError = error;
  }

  const lines = trimmed.split(/\r?\n/).reverse();
  for (const line of lines) {
    let candidate = line.trim();
    const labeledCode = candidate.match(/^#\s*卡组代码\s*[:：]\s*(\S+)\s*$/);
    if (labeledCode) candidate = labeledCode[1];
    else if (!candidate || candidate.startsWith("#")) continue;
    try {
      return decodeSingleDeckCode(candidate);
    } catch {
      // A readable deck list contains many non-code lines; keep scanning upward.
    }
  }

  throw directError;
}
