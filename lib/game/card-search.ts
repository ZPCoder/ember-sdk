export type CardSearchInput = {
  name: string;
  description: string;
  cost: number;
  attack?: number;
  health?: number;
  owned: number;
  copyLimit: number;
  type: string;
  rarity: string;
  searchTerms?: readonly string[];
};

type NumericField = "cost" | "attack" | "health" | "owned";

type NumericPredicate = {
  min?: number;
  max?: number;
  parity?: "even" | "odd";
};

export type CardSearchClause =
  | { kind: "text"; value: string }
  | { kind: "numeric"; field: NumericField; predicate: NumericPredicate }
  | { kind: "property"; field: "type" | "rarity"; value: string }
  | { kind: "inventory"; value: "missing" | "extra" }
  | { kind: "invalid" };

const NUMERIC_FIELDS: Readonly<Record<string, NumericField | undefined>> = Object.freeze({
  mana: "cost",
  cost: "cost",
  法力: "cost",
  费用: "cost",
  attack: "attack",
  攻击: "attack",
  health: "health",
  生命: "health",
  owned: "owned",
  持有: "owned",
});

const PROPERTY_FIELDS: Readonly<Record<string, "type" | "rarity" | undefined>> = Object.freeze({
  type: "type",
  类型: "type",
  rarity: "rarity",
  稀有度: "rarity",
});

const TYPE_ALIASES: Readonly<Record<string, string | undefined>> = Object.freeze({
  minion: "unit",
  unit: "unit",
  随从: "unit",
  单位: "unit",
  spell: "spell",
  战术: "spell",
  法术: "spell",
  weapon: "weapon",
  武器: "weapon",
  hero: "hero",
  英雄: "hero",
});

const RARITY_ALIASES: Readonly<Record<string, string | undefined>> = Object.freeze({
  common: "common",
  普通: "common",
  rare: "rare",
  稀有: "rare",
  epic: "epic",
  史诗: "epic",
  legendary: "legendary",
  传说: "legendary",
});

function normalize(value: string): string {
  return value.trim().toLocaleLowerCase("zh-CN");
}

function parseNumericPredicate(value: string): NumericPredicate | null {
  const normalized = normalize(value).replaceAll("−", "-");
  if (normalized === "even" || normalized === "偶数") return { parity: "even" };
  if (normalized === "odd" || normalized === "奇数") return { parity: "odd" };
  const range = /^(\d+)-(\d+)$/.exec(normalized);
  if (range) {
    const left = Number(range[1]);
    const right = Number(range[2]);
    return { min: Math.min(left, right), max: Math.max(left, right) };
  }
  const minimum = /^(\d+)\+$/.exec(normalized);
  if (minimum) return { min: Number(minimum[1]) };
  const maximum = /^(\d+)-$/.exec(normalized);
  if (maximum) return { max: Number(maximum[1]) };
  if (/^\d+$/.test(normalized)) {
    const exact = Number(normalized);
    return { min: exact, max: exact };
  }
  return null;
}

/** Parse quoted phrases and Hearthstone-style filter tags into AND clauses. */
export function parseCardSearch(query: string): readonly CardSearchClause[] {
  const tokens = [...query.matchAll(/"([^"]+)"|(\S+)/g)]
    .map((match) => normalize(match[1] ?? match[2] ?? ""))
    .filter(Boolean);
  return tokens.map((token): CardSearchClause => {
    if (token === "missing" || token === "缺少" || token === "未拥有") {
      return { kind: "inventory", value: "missing" };
    }
    if (token === "extra" || token === "多余" || token === "额外") {
      return { kind: "inventory", value: "extra" };
    }
    const separator = token.indexOf(":");
    if (separator > 0) {
      const key = token.slice(0, separator);
      const value = token.slice(separator + 1);
      const numericField = NUMERIC_FIELDS[key];
      if (numericField) {
        const predicate = parseNumericPredicate(value);
        return predicate ? { kind: "numeric", field: numericField, predicate } : { kind: "invalid" };
      }
      const propertyField = PROPERTY_FIELDS[key];
      if (propertyField) {
        if (!value) return { kind: "invalid" };
        const aliases = propertyField === "type" ? TYPE_ALIASES : RARITY_ALIASES;
        return { kind: "property", field: propertyField, value: aliases[value] ?? value };
      }
      if (key === "has" || key === "包含" || key === "文本") {
        return value ? { kind: "text", value } : { kind: "invalid" };
      }
    }
    return { kind: "text", value: token };
  });
}

function matchesNumeric(value: number | undefined, predicate: NumericPredicate): boolean {
  if (value === undefined || !Number.isFinite(value)) return false;
  if (predicate.parity === "even" && Math.abs(value % 2) !== 0) return false;
  if (predicate.parity === "odd" && Math.abs(value % 2) !== 1) return false;
  if (predicate.min !== undefined && value < predicate.min) return false;
  if (predicate.max !== undefined && value > predicate.max) return false;
  return true;
}

export function matchesParsedCardSearch(
  card: CardSearchInput,
  clauses: readonly CardSearchClause[],
): boolean {
  const normalizedType = TYPE_ALIASES[normalize(card.type)] ?? normalize(card.type);
  const normalizedRarity = RARITY_ALIASES[normalize(card.rarity)] ?? normalize(card.rarity);
  const searchableText = [card.name, card.description, ...(card.searchTerms ?? [])]
    .map(normalize)
    .join("\n");
  return clauses.every((clause) => {
    if (clause.kind === "invalid") return false;
    if (clause.kind === "text") return searchableText.includes(clause.value);
    if (clause.kind === "inventory") {
      return clause.value === "missing"
        ? card.owned < card.copyLimit
        : card.owned > card.copyLimit;
    }
    if (clause.kind === "property") {
      return clause.field === "type"
        ? normalizedType === clause.value
        : normalizedRarity === clause.value;
    }
    return matchesNumeric(card[clause.field], clause.predicate);
  });
}

export function matchesCardSearch(card: CardSearchInput, query: string): boolean {
  return matchesParsedCardSearch(card, parseCardSearch(query));
}
