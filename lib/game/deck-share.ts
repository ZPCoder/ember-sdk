import { CARD_BY_ID } from "./catalog.ts";
import {
  decodeDeckCode,
  encodeDeckCode,
  type DeckCodePayload,
} from "./deck-code.ts";

type SharedCard = {
  id: string;
  count: number;
  cost: number | null;
  name: string;
};

export function formatDeckShareText(payload: DeckCodePayload): string {
  const code = encodeDeckCode(payload);
  const normalized = decodeDeckCode(code);
  const counts = new Map<string, number>();
  for (const cardId of normalized.cardIds) {
    counts.set(cardId, (counts.get(cardId) ?? 0) + 1);
  }
  const cards: SharedCard[] = Array.from(counts, ([id, count]) => {
    const card = CARD_BY_ID[id];
    return {
      id,
      count,
      cost: card?.cost ?? null,
      name: card?.name ?? id,
    };
  }).sort((a, b) => {
    const costDifference = (a.cost ?? Number.MAX_SAFE_INTEGER) -
      (b.cost ?? Number.MAX_SAFE_INTEGER);
    if (costDifference !== 0) return costDifference;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });

  return [
    `# 余烬协议牌组：${normalized.name}`,
    `# 模式：${normalized.format === "wild" ? "狂野模式" : "标准模式"}`,
    `# ${normalized.cardIds.length} 张卡牌 · ${cards.length} 种`,
    "",
    ...cards.map(
      (card) => `${card.count}x (${card.cost ?? "?"}) ${card.name}`,
    ),
    "",
    "# 卡组代码",
    code,
    "",
    "# 复制完整牌表或仅复制上方代码，均可在余烬协议中导入。",
  ].join("\n");
}
