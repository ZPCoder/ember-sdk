import { CARD_CATALOG } from "./catalog.ts";
import { completeDeckFromCollection } from "./deck.ts";
import { cardAvailableInRankedFormat } from "./formats.ts";
import type {
  CardDefinition,
  CardSetId,
  Faction,
  RankedFormat,
} from "./types.ts";

export type DeckRecipeKind = "core" | "raptor" | "scarab";

export type DeckRecipe = {
  id: string;
  kind: DeckRecipeKind;
  faction: Faction;
  name: string;
  description: string;
  format: RankedFormat;
  focusSet: CardSetId;
  cardIds: string[];
};

const RECIPE_DEFINITIONS: readonly {
  kind: DeckRecipeKind;
  focusSet: CardSetId;
  allowedSets: readonly CardSetId[];
  nameSuffix: string;
  description: string;
}[] = [
  {
    kind: "core",
    focusSet: "core",
    allowedSets: ["core"],
    nameSuffix: "核心基石",
    description: "仅由核心系列组成，提供稳定曲线与通用战术。",
  },
  {
    kind: "raptor",
    focusSet: "raptor-2025",
    allowedSets: ["core", "raptor-2025"],
    nameSuffix: "猛禽攻势",
    description: "围绕猛禽年卡牌构筑，并用核心系列补足协同。",
  },
  {
    kind: "scarab",
    focusSet: "scarab-2026",
    allowedSets: ["core", "raptor-2025", "scarab-2026"],
    nameSuffix: "圣甲虫新锐",
    description: "聚焦圣甲虫年新卡，调用当前标准卡池完成配合。",
  },
];

function buildRecipe(
  faction: Faction,
  definition: (typeof RECIPE_DEFINITIONS)[number],
  catalog: readonly CardDefinition[],
): DeckRecipe {
  const allowed = catalog.filter(
    (card) =>
      card.set !== undefined &&
      cardAvailableInRankedFormat(card, "standard") &&
      definition.allowedSets.includes(card.set) &&
      (card.faction === faction || card.faction === "中立"),
  );
  const focusCards = allowed
    .filter(
      (card) => card.faction === faction && card.set === definition.focusSet,
    )
    .slice(0, 12);
  const collection = Object.fromEntries(
    allowed.map((card) => [card.id, card.rarity === "传说" ? 1 : 2]),
  );
  const completion = completeDeckFromCollection({
    cardIds: focusCards.map((card) => card.id),
    collection,
    format: "standard",
    catalog: allowed,
  });
  return {
    id: `${faction}-${definition.kind}`,
    kind: definition.kind,
    faction,
    name: `${faction}${definition.nameSuffix}`,
    description: definition.description,
    format: "standard",
    focusSet: definition.focusSet,
    cardIds: completion.cardIds,
  };
}

export function deckRecipesForFaction(
  faction: Faction,
  catalog: readonly CardDefinition[] = CARD_CATALOG,
): DeckRecipe[] {
  if (faction === "中立") return [];
  return RECIPE_DEFINITIONS.map((definition) =>
    buildRecipe(faction, definition, catalog)
  );
}
