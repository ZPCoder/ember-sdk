import { DEFAULT_STARTER_DECK } from "./catalog.js";
import type { BattleCommand } from "./types.js";

export type TrainingProgress = {
  mulligan: boolean;
  cardPlayed: boolean;
  attack: boolean;
  turnEnded: boolean;
};

export type TrainingStage = "mulligan" | "play-card" | "end-turn" | "attack" | "complete";

export type TrainingDialogue = {
  speaker: string;
  role: "mentor" | "opponent";
  line: string;
};

export const TRAINING_DECK_ID = "training:starter";
export const TRAINING_MATCH_SEED = 0x1a57_2026;
export const TRAINING_STARTING_PLAYER = 0 as const;
export const TRAINING_OPPONENT_ARCHETYPE_ID = "radiance-midrange";
export const TRAINING_PLAYER_DECK: readonly string[] = DEFAULT_STARTER_DECK;
export const TRAINING_PLAY_CARD_ID = "sun-dawn-scout";
export const TRAINING_DIALOGUE_BY_STAGE: Readonly<Record<TrainingStage, TrainingDialogue>> = Object.freeze({
  mulligan: {
    speaker: "战术教官 · 伊蕾",
    role: "mentor",
    line: "雾门正在闭合。别改动我为你校准的起手——先确认链路。",
  },
  "play-card": {
    speaker: "战术教官 · 伊蕾",
    role: "mentor",
    line: "很好。让晨辉斥候先越过雾门，第一束光会为整条战线定向。",
  },
  "end-turn": {
    speaker: "棱镜演算体",
    role: "opponent",
    line: "微弱的先遣信号已经捕获。结束行动，我会展开棱镜防线。",
  },
  attack: {
    speaker: "战术教官 · 伊蕾",
    role: "mentor",
    line: "别被护盾诱导。选中斥候，越过守卫，直接标记敌方核心。",
  },
  complete: {
    speaker: "棱镜演算体",
    role: "opponent",
    line: "核心轨迹已暴露。基础演算完成——接下来的每一步由你决定。",
  },
});

export type TrainingChapterId = "mist-gate" | "prism-wall" | "tide-archive";

export type TrainingObjective = {
  id: string;
  kind: "mulligan" | "use-coin" | "play-card" | "end-turn" | "attack-hero" | "attack-unit" | "discover";
  label: string;
  detail: string;
  instruction: string;
  cardId?: string;
};

export type TrainingChapterDefinition = {
  id: TrainingChapterId;
  order: number;
  title: string;
  subtitle: string;
  bossName: string;
  bossArchetypeId: string;
  seed: number;
  startingPlayer: 0 | 1;
  objectives: readonly TrainingObjective[];
  dialogue: readonly TrainingDialogue[];
};

export type TrainingCampaignState = {
  completedChapterIds: TrainingChapterId[];
};

export const TRAINING_CHAPTERS: readonly TrainingChapterDefinition[] = Object.freeze([
  {
    id: "mist-gate",
    order: 1,
    title: "第一关 · 雾门初光",
    subtitle: "部署冲锋单位并立即命中核心",
    bossName: "雾门哨兵",
    bossArchetypeId: "neutral-toolbox",
    seed: 0x1a57_2026,
    startingPlayer: 0,
    objectives: [
      { id: "keep-hand", kind: "mulligan", label: "确认固定起手", detail: "教学牌序已经校准；直接确认起手。", instruction: "教学起手固定，请直接确认。" },
      { id: "deploy-scout", kind: "play-card", cardId: "sun-dawn-scout", label: "部署晨辉斥候", detail: "使用高亮的 1 费冲锋单位。", instruction: "请使用「晨辉斥候」。" },
      { id: "strike-core", kind: "attack-hero", label: "立即攻击核心", detail: "冲锋单位登场当回合即可攻击。", instruction: "请用晨辉斥候攻击敌方核心。" },
    ],
    dialogue: [
      { speaker: "战术教官 · 伊蕾", role: "mentor", line: "雾门正在闭合。别改动我为你校准的起手——先确认链路。" },
      { speaker: "战术教官 · 伊蕾", role: "mentor", line: "让晨辉斥候先越过雾门。冲锋意味着它不必等待。" },
      { speaker: "雾门哨兵", role: "opponent", line: "未经许可的先遣信号。我的核心已锁定你的坐标。" },
      { speaker: "战术教官 · 伊蕾", role: "mentor", line: "漂亮的直击。你已经掌握部署与即时攻击。" },
    ],
  },
  {
    id: "prism-wall",
    order: 2,
    title: "第二关 · 棱镜防线",
    subtitle: "等待回合并击破护盾单位",
    bossName: "棱镜守门人",
    bossArchetypeId: "radiance-midrange",
    seed: 0x1a57_2026,
    startingPlayer: 0,
    objectives: [
      { id: "keep-hand", kind: "mulligan", label: "确认固定起手", detail: "保持晨辉斥候与后续资源。", instruction: "教学起手固定，请直接确认。" },
      { id: "deploy-scout", kind: "play-card", cardId: "sun-dawn-scout", label: "建立先遣战线", detail: "部署晨辉斥候，但先不要攻击。", instruction: "请使用「晨辉斥候」。" },
      { id: "yield-turn", kind: "end-turn", label: "结束当前回合", detail: "让守门人展开它的护盾防线。", instruction: "现在结束回合。" },
      { id: "break-shield", kind: "attack-unit", label: "攻击护盾单位", detail: "选择晨辉斥候并攻击镜盾守望者。", instruction: "请攻击敌方的镜盾守望者。" },
    ],
    dialogue: [
      { speaker: "战术教官 · 伊蕾", role: "mentor", line: "第二道门会用护盾诱导你的攻击。先确认同一组校准手牌。" },
      { speaker: "战术教官 · 伊蕾", role: "mentor", line: "部署斥候，但克制冲锋本能；这次我们要观察敌方防线。" },
      { speaker: "棱镜守门人", role: "opponent", line: "微弱的先遣信号已经捕获。结束行动，我会展开棱镜防线。" },
      { speaker: "战术教官 · 伊蕾", role: "mentor", line: "护盾能抵消第一次伤害。攻击守望者，亲眼确认它如何破碎。" },
      { speaker: "棱镜守门人", role: "opponent", line: "护盾频率失稳。你已识别防线的第一处裂缝。" },
    ],
  },
  {
    id: "tide-archive",
    order: 3,
    title: "第三关 · 潮汐档案",
    subtitle: "使用幸运币并完成一次发现",
    bossName: "逆流档案官",
    bossArchetypeId: "tide-control",
    seed: 2,
    startingPlayer: 1,
    objectives: [
      { id: "keep-hand", kind: "mulligan", label: "确认后手起手", detail: "后手会获得一张幸运币。", instruction: "教学起手固定，请直接确认。" },
      { id: "spend-coin", kind: "use-coin", label: "使用幸运币", detail: "获得 1 点本回合临时能量。", instruction: "请先使用幸运币。" },
      { id: "cast-insight", kind: "play-card", cardId: "sun-orbit-insight", label: "施放环日启示", detail: "用 2 点能量打开发现选择。", instruction: "请使用「环日启示」。" },
      { id: "choose-discovery", kind: "discover", label: "完成一次发现", detail: "从三个候选项中选择一张加入手牌。", instruction: "请从三个候选项中选择一张牌。" },
    ],
    dialogue: [
      { speaker: "战术教官 · 伊蕾", role: "mentor", line: "这次由档案官先行动。确认起手，留意后手额外获得的资源。" },
      { speaker: "逆流档案官", role: "opponent", line: "你的能量落后一拍。那枚不起眼的幸运币，是你唯一的时间差。" },
      { speaker: "战术教官 · 伊蕾", role: "mentor", line: "把临时能量投入环日启示，主动寻找当前局面的答案。" },
      { speaker: "逆流档案官", role: "opponent", line: "三份档案，只能带走一份。选择本身也是战术。" },
      { speaker: "战术教官 · 伊蕾", role: "mentor", line: "三道门全部通过。现在你已掌握节奏、防线与资源选择。" },
    ],
  },
]);

export const EMPTY_TRAINING_CAMPAIGN: Readonly<TrainingCampaignState> = Object.freeze({
  completedChapterIds: [],
});

export function getTrainingChapter(id: string | null | undefined): TrainingChapterDefinition | undefined {
  return TRAINING_CHAPTERS.find((chapter) => chapter.id === id);
}

export function trainingDeckId(chapterId: TrainingChapterId): string {
  return `training:${chapterId}`;
}

export function trainingChapterIdFromDeckId(deckId: string | null | undefined): TrainingChapterId | null {
  const id = deckId?.startsWith("training:") ? deckId.slice("training:".length) : "";
  return getTrainingChapter(id)?.id ?? null;
}

export function normalizeTrainingCampaign(value: unknown): TrainingCampaignState {
  const raw = value && typeof value === "object" && Array.isArray((value as { completedChapterIds?: unknown }).completedChapterIds)
    ? (value as { completedChapterIds: unknown[] }).completedChapterIds
    : [];
  const completedChapterIds: TrainingChapterId[] = [];
  for (const chapter of TRAINING_CHAPTERS) {
    if (!raw.includes(chapter.id)) break;
    completedChapterIds.push(chapter.id);
  }
  return { completedChapterIds };
}

export function trainingChapterUnlocked(campaign: TrainingCampaignState, chapterId: TrainingChapterId): boolean {
  const index = TRAINING_CHAPTERS.findIndex((chapter) => chapter.id === chapterId);
  return index === 0 || (index > 0 && campaign.completedChapterIds.includes(TRAINING_CHAPTERS[index - 1]!.id));
}

function trainingObjectiveMatches(objective: TrainingObjective, command: BattleCommand): boolean {
  switch (objective.kind) {
    case "mulligan":
      return command.type === "mulligan" && command.cardIndexes.length === 0;
    case "use-coin":
      return command.type === "use-coin" || (command.type === "play-card" && command.cardId === "the-coin");
    case "play-card":
      return command.type === "play-card" && command.cardId === objective.cardId && command.placement !== "enemy";
    case "end-turn":
      return command.type === "end-turn";
    case "attack-hero":
      return command.type === "attack" && command.target.kind === "hero" && command.target.player === 1;
    case "attack-unit":
      return command.type === "attack" && command.target.kind === "unit";
    case "discover":
      return command.type === "choose-discover";
  }
}

export function trainingChapterProgressForCommands(
  chapterId: TrainingChapterId,
  commands: readonly BattleCommand[],
): { completed: number; invalid: boolean } {
  const chapter = getTrainingChapter(chapterId)!;
  let completed = 0;
  for (const command of commands) {
    if (command.player !== 0 || command.type === "concede") continue;
    const objective = chapter.objectives[completed];
    if (!objective) continue;
    if (!trainingObjectiveMatches(objective, command)) return { completed, invalid: true };
    completed += 1;
  }
  return { completed, invalid: false };
}

export function trainingChapterCommandAllowed(
  chapterId: TrainingChapterId,
  commands: readonly BattleCommand[],
  command: BattleCommand,
): boolean {
  if (command.type === "concede") return true;
  const chapter = getTrainingChapter(chapterId)!;
  const progress = trainingChapterProgressForCommands(chapterId, commands);
  if (progress.invalid) return false;
  const objective = chapter.objectives[progress.completed];
  return objective ? trainingObjectiveMatches(objective, command) : true;
}

export const EMPTY_TRAINING_PROGRESS: Readonly<TrainingProgress> = Object.freeze({
  mulligan: false,
  cardPlayed: false,
  attack: false,
  turnEnded: false,
});

export function trainingProgressForFacts(
  previous: TrainingProgress,
  facts: {
    status: string;
    cardsPlayed: number;
    attacks: number;
    log: readonly string[];
  },
): TrainingProgress {
  return {
    mulligan: previous.mulligan || facts.status !== "mulligan",
    cardPlayed: previous.cardPlayed || facts.cardsPlayed > 0,
    attack: previous.attack || facts.attacks > 0,
    turnEnded: previous.turnEnded || facts.log.some((line) => line.includes("我方结束了回合")),
  };
}

export function trainingGateProgressForFacts(
  previous: TrainingProgress,
  facts: {
    status: "mulligan" | "playing" | "discover" | "choose-one" | "game-over";
    cardsPlayed: number;
    attacks: number;
    log: readonly string[];
  },
): TrainingProgress {
  const cumulative = trainingProgressForFacts(previous, facts);
  if (currentTrainingStage(cumulative) === "complete") return cumulative;
  return trainingProgressForFacts(EMPTY_TRAINING_PROGRESS, facts);
}

export function currentTrainingStage(progress: TrainingProgress): TrainingStage {
  if (!progress.mulligan) return "mulligan";
  if (!progress.cardPlayed) return "play-card";
  if (!progress.turnEnded) return "end-turn";
  if (!progress.attack) return "attack";
  return "complete";
}

export function trainingCommandAllowed(
  progress: TrainingProgress,
  command: BattleCommand,
): boolean {
  if (command.type === "concede") return true;
  const stage = currentTrainingStage(progress);
  if (stage === "complete") return true;
  if (stage === "mulligan") {
    return command.type === "mulligan" && command.cardIndexes.length === 0;
  }
  if (stage === "play-card") {
    return command.type === "play-card"
      && command.cardId === TRAINING_PLAY_CARD_ID
      && command.placement !== "enemy";
  }
  if (stage === "end-turn") return command.type === "end-turn";
  return command.type === "attack"
    && command.target.kind === "hero"
    && command.target.player === 1;
}
