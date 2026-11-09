// 주인공 도트 스프라이트 (261103melbourne 저장소 hero3d: 블렌더 3D를 8방향 렌더 → 96px · 24색 · 1px 외곽선).
// 시트 한 장 = 동작 하나. 행 = 방향 (S, SE, E, NE, N, NW, W, SW), 열 = 프레임, 칸 96×96, 배경 투명.

import idleUrl from './assets/hero/hero_idle.png';
import walkUrl from './assets/hero/hero_walk.png';
import runUrl from './assets/hero/hero_run.png';
import punchUrl from './assets/hero/hero_punch.png';
import jumpUrl from './assets/hero/hero_jump.png';
import waveUrl from './assets/hero/hero_wave.png';

export const CELL = 96;
export const DIRS = ['S', 'SE', 'E', 'NE', 'N', 'NW', 'W', 'SW'] as const;
export const DIR_NAMES = ['정면', '오른쪽 앞', '오른쪽', '오른쪽 뒤', '뒤', '왼쪽 뒤', '왼쪽', '왼쪽 앞'];

export type HeroAction = 'idle' | 'walk' | 'run' | 'punch' | 'jump' | 'wave';

export interface ActionDef {
  id: HeroAction;
  name: string;
  url: string;
  /** 초당 프레임 */
  fps: number;
  /** 끝나면 처음부터 (false면 한 번 하고 대기로) */
  loop: boolean;
}

export const ACTIONS: ActionDef[] = [
  { id: 'idle', name: '대기', url: idleUrl, fps: 6, loop: true },
  { id: 'walk', name: '걷기', url: walkUrl, fps: 10, loop: true },
  { id: 'run', name: '달리기', url: runUrl, fps: 13, loop: true },
  { id: 'punch', name: '펀치', url: punchUrl, fps: 14, loop: false },
  { id: 'jump', name: '점프', url: jumpUrl, fps: 12, loop: false },
  { id: 'wave', name: '손 흔들기', url: waveUrl, fps: 8, loop: true },
];

export interface Sheet {
  img: HTMLImageElement;
  /** 프레임 수 (시트 너비 ÷ 칸) */
  frames: number;
}

const sheets = new Map<HeroAction, Promise<Sheet>>();

export function loadSheet(id: HeroAction): Promise<Sheet> {
  let p = sheets.get(id);
  if (!p) {
    const def = ACTIONS.find((a) => a.id === id)!;
    p = new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve({ img, frames: Math.max(1, Math.round(img.naturalWidth / CELL)) });
      img.onerror = reject;
      img.src = def.url;
    });
    sheets.set(id, p);
  }
  return p;
}

/** 시트의 한 칸 (방향 dir, 프레임 frame)을 캔버스에 그린다. 도트가 번지지 않게 정수 배율로 */
export function drawFrame(ctx: CanvasRenderingContext2D, sheet: Sheet, dir: number, frame: number, x: number, y: number, scale: number) {
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(sheet.img, frame * CELL, dir * CELL, CELL, CELL, x, y, CELL * scale, CELL * scale);
}
