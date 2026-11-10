// 공통 성장 저장: 도파민 모드에서 모은 골드 → 공격력·체력, 도전 모드에서 얻은 별 → 스킬 강화.
// 두 모드 모두 같은 캐릭터·같은 성장을 쓴다. 이 기기 브라우저에 저장.

import type { SkillId } from './game';

export type StatUp = 'atk' | 'hp';
/** 강화할 수 있는 스킬 (회오리 돌진·장풍은 회오리 레벨을 같이 쓴다) */
export type SkillUp = 'spin' | 'rush' | 'slam' | 'ult';

export interface Save {
  gold: number;
  stars: number;
  stat: Record<StatUp, number>;
  skill: Record<SkillUp, number>;
  /** 도전 모드 난이도별 최고 웨이브 */
  best: [number, number, number];
}

const KEY = 'control-survivor.save.v1';

export function newSave(): Save {
  return { gold: 0, stars: 0, stat: { atk: 0, hp: 0 }, skill: { spin: 0, rush: 0, slam: 0, ult: 0 }, best: [0, 0, 0] };
}

export function loadSave(): Save {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const d = JSON.parse(raw) as Partial<Save>;
      const b = newSave();
      return {
        gold: d.gold ?? 0,
        stars: d.stars ?? 0,
        stat: { ...b.stat, ...d.stat },
        skill: { ...b.skill, ...d.skill },
        best: d.best ?? b.best,
      };
    }
  } catch {
    // 못 읽으면 새로
  }
  return newSave();
}

export function writeSave(s: Save) {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    // 무시
  }
}

// ---- 효과 ----
/** 공격력 배율: 레벨당 +12% */
export const atkMul = (s: Save) => 1 + 0.12 * s.stat.atk;
/** 체력 배율: 레벨당 +10% */
export const hpMul = (s: Save) => 1 + 0.1 * s.stat.hp;
/** 스킬 Lv이 붙는 스킬 */
export const skillLvOf = (s: Save, id: SkillId) => (id === 'spindash' || id === 'spinwave' ? s.skill.spin : s.skill[id as SkillUp] ?? 0);
/** 스킬 피해 배율: 레벨당 +15% */
export const skillDmgMul = (s: Save, id: SkillId) => 1 + 0.15 * skillLvOf(s, id);
/** 스킬 쿨타임 배율: 레벨당 -5% (최소 0.6) */
export const skillCdMul = (s: Save, id: SkillId) => Math.max(0.6, 1 - 0.05 * skillLvOf(s, id));

// ---- 값 ----
export const statCost = (lv: number) => Math.round(40 * Math.pow(1.35, lv));
export const skillCost = (lv: number) => lv + 1;
export const STAT_NAMES: Record<StatUp, string> = { atk: '공격력', hp: '체력' };
export const SKILL_UP_NAMES: Record<SkillUp, string> = { spin: '회오리 (돌진·장풍 포함)', rush: '어퍼', slam: '지진', ult: '필살 백열권' };

/** 난이도: 보통 · 어려움 · 지옥 (도전 모드) */
export const DIFFS = [
  { name: '보통', hp: 1, dmg: 1, bullet: 1, gold: 2, stars: 1 },
  { name: '어려움', hp: 1.6, dmg: 1.4, bullet: 1.15, gold: 3, stars: 2 },
  { name: '지옥', hp: 2.4, dmg: 1.9, bullet: 1.3, gold: 5, stars: 3 },
] as const;
