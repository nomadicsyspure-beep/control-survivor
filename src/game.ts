import { CELL, loadSheet, type HeroAction, type Sheet } from './hero';
import { Joystick, type Gesture } from './input';
import { sfx } from './sfx';
import { FX, MON, monFrames, ready, whiteOf } from './sprites';
import type { Tuning, UltStyle } from './settings';
import { DIFFS, atkMul, hpMul, skillCdMul, skillDmgMul, type Save } from './save';

// 손맛 시험장: 격투 소년 하나, 적은 수의 단단한 몹(역할이 있다), 5웨이브마다 보스.
// 한 손 모드: 이동만 — 펀치 콤보와 장풍은 자동. 두 손 모드(테스트): 공격·회피·장풍 버튼.
// 타격감: 히트스톱 · 화면 흔들림 · 하얀 번쩍임 · 밀려남 · 경직 · 찌그러짐 · 불꽃 · 마무리 타는 속도선과 화면 당김.

/** 조작: one 한 손 자동 · two 두 손 버튼 · gesture 제스처 · pilot 자동 이동 + 스킬 버튼 */
export type PlayMode = 'one' | 'two' | 'gesture' | 'pilot' | 'dodge';
/** 휙 회피 모드: 회피 쿨타임(초) */
const DODGE_CD = 1;
/** 판 종류: 도파민(3분 동안 몰려오는 몹 쓸어 담기) / 도전(웨이브 + 5웨이브마다 보스, 난이도) */
export type RunKind = 'horde' | 'challenge';
export interface GameOpts {
  control: PlayMode;
  run: RunKind;
  /** 도전 모드 난이도 0 보통 · 1 어려움 · 2 지옥 */
  diff: number;
  save: Save;
}
/** 도파민 모드 길이(초) · 몹 최대 수 */
const HORDE_SEC = 180;
const HORDE_MAX = 240;
/** 제스처 모드 기 모으기 단계 (모은 시간, 초): 1 장풍 · 2 지진 · 3 필살 */
export const CHARGE_LV = [0.35, 0.95, 1.7];

/** 화면의 짧은 변에 보이는 세계 크기 (세로·가로 어느 쪽이든 위험 거리가 같게) */
const VIEW = 340;
/** 주인공 그림 크기 배율 (96px 칸 → 세계 단위) */
const HERO_SCALE = 1.0;
/** 칸 안에서 발이 닿는 높이 */
const HERO_FOOT = 92;

const ROW_OF_DIR8 = [2, 1, 0, 7, 6, 5, 4, 3]; // 각도 8칸(E, SE, S, SW, W, NW, N, NE) → 시트 행(S, SE, E, NE, N, NW, W, SW)

/** 콤보 단계: 길이, 맞는 순간, 쓸 프레임, 사거리, 피해, 밀어내기, 경직, 히트스톱, 흔들림 */
const STEPS = [
  { dur: 0.2, hitAt: 0.12, frames: [0, 1, 2], reach: 64, dmg: 10, knock: 220, stun: 0.18, stop: 0.045, shake: 3, poise: 10, lunge: 0 },
  { dur: 0.2, hitAt: 0.08, frames: [3, 4, 5], reach: 66, dmg: 13, knock: 260, stun: 0.22, stop: 0.055, shake: 4, poise: 14, lunge: 0 },
  { dur: 0.32, hitAt: 0.15, frames: [1, 2, 3, 4, 4, 5], reach: 84, dmg: 26, knock: 560, stun: 0.5, stop: 0.11, shake: 10, poise: 30, lunge: 260 },
];
/** 콤보를 이어 갈 수 있는 시간 / 마무리 타 뒤 숨 고르기 */
const COMBO_WINDOW = 0.45;
const FINISH_REST = 0.3;
/** 장풍: 자동 / 수동 쿨타임, 속도, 피해 */
const WAVE_CD_AUTO = 2.4;
const WAVE_CD_MANUAL = 1.0;
const WAVE_SPEED = 430;
const WAVE_DMG = 12;
/** 회피 (두 손 모드): 길이, 속도, 쿨타임, 아슬아슬 판정 거리, 느려지는 시간 */
const DASH_T = 0.2;
const DASH_SPEED = 560;
const DASH_CD = 0.55;
const PERFECT_R = 44;
const SLOWMO_T = 0.4;

/** 스킬 (쿨타임). 한 손 모드는 조건이 맞으면 자동, 두 손 모드는 버튼 */
export const SKILLS = {
  spin: { name: '회오리 발차기', short: '회오리', cd: 1.5 },
  rush: { name: '슬라이딩 어퍼', short: '어퍼', cd: 4 },
  spindash: { name: '회오리 돌진', short: '회돌', cd: 4 },
  spinwave: { name: '회오리 장풍', short: '회장', cd: 4 },
  slam: { name: '지진 내려찍기', short: '지진', cd: 9 },
  ult: { name: '백열권', short: '필살', cd: 20 },
} as const;
export type SkillId = keyof typeof SKILLS;
export const SKILL_IDS = Object.keys(SKILLS) as SkillId[];
/** 회오리 발차기 반경 */
const SPIN_R = 120;
/** 어퍼가 올려치는 범위 (맞은 적 둘레) */
const RUSH_R = 85;
/** 제스처 연계: 기술이 끝난 뒤 다음 제스처를 이어 붙일 수 있는 시간 */
const CHAIN_WINDOW = 0.55;
/** 슬라이딩 (제스처 모드 회피): 길이 · 속도 */
const SLIDE_T = 0.26;
const SLIDE_SPEED = 470;
/** 몸통에 닿을 때 피해 배율 (탄막·돌진·범위기는 그대로 아프게) */
const CONTACT_MUL = 0.3;
/** 한 손 · 제스처 모드 화면 아래 쿨타임 표시 */
const HUD_SKILLS: Record<'one' | 'gesture', SkillId[]> = {
  one: ['spin', 'rush', 'slam', 'ult'],
  gesture: ['spin', 'rush', 'spindash', 'spinwave', 'slam', 'ult'],
};
/** 필살기 연출 길이(초): 이동안 세상이 멈춘다 */
const CINE_T: Record<Exclude<UltStyle, 'random'>, number> = { cutin: 0.95, zoom: 0.75, domain: 0.8, blackout: 0.65, none: 0 };
/** 필살기 연타 시간 / 연타 간격 / 범위 */
const ULT_FLURRY = 1.25;
const ULT_GAP = 0.05;
const ULT_R = 280;
/** 백열권 순간이동: 시작 자리에서 이 안의 적에게만 옮겨 다닌다 (어지럽지 않게 절반으로) */
const ULT_HOP_R = 100;
/** 백열권 한 타에 맞는 최대 수 */
const ULT_MAX_HITS = 120;

type Kind = 'slime' | 'bat' | 'golem' | 'boss';

interface Enemy {
  kind: Kind;
  x: number;
  y: number;
  r: number;
  hp: number;
  maxHp: number;
  speed: number;
  dmg: number;
  vx: number;
  vy: number;
  flash: number;
  stun: number;
  /** 경직 게이지: 0이 되면 무너진다 (받는 피해 ×1.5) */
  poise: number;
  maxPoise: number;
  broken: number;
  /** 찌그러짐 (맞으면 1 → 0) */
  sq: number;
  cd: number;
  cast: number;
  dashT: number;
  dx: number;
  dy: number;
  pat: number;
  volN: number;
  volT: number;
  phase: number;
  dead: boolean;
  /** 띄우기: 공중 높이와 위로 속도 (어퍼·지진·필살 마무리) */
  z: number;
  vz: number;
}

interface Bullet { x: number; y: number; vx: number; vy: number; r: number; dmg: number; life: number; boss: boolean }
interface Orb { x: number; y: number; vx: number; vy: number; life: number; hit: Set<Enemy> }
interface Particle { x: number; y: number; vx: number; vy: number; life: number; max: number; color: string; size: number; grav: number }
interface Text { x: number; y: number; text: string; color: string; size: number; life: number; max: number }
interface Spr { name: string; x: number; y: number; size: number; life: number; max: number; rot: number }
interface Ring { x: number; y: number; r: number; life: number; max: number; color: string }
interface Lane { x1: number; y1: number; x2: number; y2: number; w: number; t: number; max: number }

export interface GameResult {
  run: RunKind;
  diff: number;
  /** 도파민 모드를 끝까지 버텼나 */
  win: boolean;
  wave: number;
  kills: number;
  bestCombo: number;
  time: number;
  /** 이번 판에 번 골드·별 */
  gold: number;
  stars: number;
}

export class Game {
  readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  readonly joy: Joystick;
  private sheets: Partial<Record<HeroAction, Sheet>> = {};
  private w = 0;
  private h = 0;
  private dpr = 1;
  private scale = 1;
  private raf = 0;
  private last = 0;
  running = false;
  paused = false;

  // 플레이어
  private p = { x: 0, y: 0, r: 13, hp: 100, maxHp: 100, speed: 175, fx: 0, fy: 1, invuln: 0, kx: 0, ky: 0, moving: 0, animT: 0, dead: false };
  private atk: { step: number; t: number; hit: boolean; tx: number; ty: number } | null = null;
  private comboStep = 0;
  private comboT = 0;
  private atkCd = 0;
  private buffered = false;
  private waveCd = 1;
  private dashT = 0;
  private dashCd = 0;
  private dashX = 0;
  private dashY = 0;
  private counterReady = false;

  private enemies: Enemy[] = [];
  private bullets: Bullet[] = [];
  private orbs: Orb[] = [];
  private parts: Particle[] = [];
  private texts: Text[] = [];
  private sprs: Spr[] = [];
  private rings: Ring[] = [];
  private lanes: Lane[] = [];

  // 연출
  private stop = 0;
  private shake = 0;
  private zoom = 0;
  private slow = 0;
  private lines = 0;
  private camX = 0;
  private camY = 0;
  private hurtFlash = 0;
  /** 화면 하얀 섬광 */
  private flashT = 0;

  // 스킬
  private cds: Record<SkillId, number> = { spin: 2, rush: 2, spindash: 2, spinwave: 2, slam: 4, ult: 6 };
  /** 제스처 연계: 지금까지 이은 제스처(T 톡 · F 휙), 이어 붙일 수 있는 남은 시간, 기술 중에 미리 들어온 제스처 */
  private chainSeq = '';
  private chainT = 0;
  private pendingG: Gesture | null = null;
  private isSlide = false;
  /** 휙 회피 모드: 다음 회피까지 */
  private dodgeCd = 0;
  /** 자동 이동: 켜져 있으면 손을 떼고 있는 동안 알아서 몹을 쫓아가 때리고 탄을 조금 피한다 (끌면 그동안 직접) */
  autoMoveOn = false;
  private slideHits = new Set<Enemy>();
  private cast: { id: SkillId; t: number; phase: number; hits: number; next: number; target: Enemy | null; sx: number; sy: number; ex: number; ey: number } | null = null;
  /** 필살기 연출: 종류, 남은 시간, 처음 길이 */
  private cine: { style: Exclude<UltStyle, 'random'>; t: number; max: number } | null = null;
  /** 영역 전개: 지금 반지름 (0이면 없음) */
  private domain = 0;
  private domainOn = false;
  /** 잔상 */
  private ghosts: { x: number; y: number; row: number; action: HeroAction; frame: number; life: number }[] = [];
  private lastRow = 0;
  private lastAction: HeroAction = 'idle';
  private lastFrame = 0;
  private styleIdx = 0;

  // 진행
  private wave = 0;
  private waveT = 0;
  private kills = 0;
  private hits = 0;
  private hitT = 0;
  private bestCombo = 0;
  private time = 0;
  private banner = '';
  private bannerT = 0;

  /** 버튼 입력 (두 손 모드) */
  readonly press = { attack: false, dash: false, wave: false, spin: false, rush: false, spindash: false, spinwave: false, slam: false, ult: false };

  /** 스킬 쿨타임 남은 비율 0~1 (버튼 표시용) */
  cdRatio(id: SkillId) {
    return Math.max(0, Math.min(1, this.cds[id] / SKILLS[id].cd));
  }

  readonly mode: PlayMode;
  readonly run: RunKind;
  readonly diff: number;
  private readonly save: Save;
  /** 이번 판에 번 골드·별 */
  private gold = 0;
  private stars = 0;
  private spawnAcc = 0;
  private eliteT = 20;
  private ended = false;

  constructor(host: HTMLElement, opts: GameOpts, private readonly tuning: Tuning, private readonly onEnd: (r: GameResult) => void) {
    this.mode = opts.control;
    this.autoMoveOn = opts.control === 'pilot' || this.tuning.autoMove;
    this.run = opts.run;
    this.diff = opts.diff;
    this.save = opts.save;
    const mode = this.mode;
    this.p.maxHp = this.p.hp = Math.round(100 * hpMul(this.save));
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'game-canvas';
    host.append(this.canvas);
    this.ctx = this.canvas.getContext('2d')!;
    this.joy = new Joystick(host);
    this.joy.leftOnly = mode === 'two';
    this.joy.gestures = mode === 'gesture' || mode === 'dodge';
    for (const a of ['idle', 'walk', 'run', 'punch', 'jump'] as HeroAction[]) void loadSheet(a).then((s) => (this.sheets[a] = s));
    this.resize();
    window.addEventListener('resize', this.resize);
  }

  private resize = () => {
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    this.w = window.innerWidth;
    this.h = window.innerHeight;
    this.canvas.width = Math.round(this.w * this.dpr);
    this.canvas.height = Math.round(this.h * this.dpr);
    this.canvas.style.width = `${this.w}px`;
    this.canvas.style.height = `${this.h}px`;
    this.scale = Math.min(this.w, this.h) / VIEW;
  };

  start() {
    this.running = true;
    if (this.run === 'horde') {
      this.banner = '도파민 모드 · 3분 버티기';
      this.bannerT = 1.8;
    } else this.nextWave();
    this.last = performance.now();
    const loop = (t: number) => {
      const real = Math.min(0.05, (t - this.last) / 1000);
      this.last = t;
      if (!this.paused) this.update(real);
      this.draw();
      if (this.running) this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }

  destroy() {
    this.running = false;
    cancelAnimationFrame(this.raf);
    window.removeEventListener('resize', this.resize);
    this.canvas.remove();
  }

  // ---------------- 진행 ----------------

  private nextWave() {
    this.wave++;
    this.waveT = 0;
    const boss = this.wave % 5 === 0;
    this.banner = boss ? `WAVE ${this.wave} · 보스!` : `WAVE ${this.wave}`;
    this.bannerT = 1.6;
    if (boss) {
      this.spawn('boss');
      this.spawn('slime');
      this.spawn('slime');
      return;
    }
    const n = 3 + this.wave;
    for (let i = 0; i < n; i++) {
      const r = Math.random();
      const kind: Kind = this.wave >= 3 && r < 0.2 ? 'golem' : this.wave >= 2 && r < 0.5 ? 'bat' : 'slime';
      this.spawn(kind);
    }
  }

  private spawn(kind: Kind) {
    const a = Math.random() * Math.PI * 2;
    const horde = this.run === 'horde';
    // 도파민: 화면 바로 밖 둘레에서 / 도전: 조금 떨어진 곳에서
    const d = horde ? Math.hypot(this.w, this.h) / 2 / this.scale + 30 + Math.random() * 40 : 280 + Math.random() * 60;
    const df = DIFFS[this.diff];
    // 도파민 몹은 약하고(한두 대면 펑) 시간이 갈수록 조금 단단해진다
    const k = horde ? (kind === 'golem' ? 0.6 : 0.2) * (1 + this.time / 100) : (1 + (this.wave - 1) * 0.12) * df.hp;
    const dk = horde ? 0.8 : (1 + (this.wave - 1) * 0.06) * df.dmg;
    const base: Record<Kind, [number, number, number, number, number]> = {
      // r, hp, speed, dmg, poise
      slime: [12, 36, 72, 8, 20],
      bat: [11, 28, 95, 7, 16],
      golem: [17, 120, 46, 14, 70],
      boss: [32, 900, 52, 18, 220],
    };
    const [r, hp, speed, dmg, poise] = base[kind];
    this.enemies.push({
      kind, x: this.p.x + Math.cos(a) * d, y: this.p.y + Math.sin(a) * d, r: horde && kind !== 'golem' ? r * 0.9 : r, hp: hp * k, maxHp: hp * k,
      speed: horde && kind !== 'golem' ? speed * 0.85 : speed, dmg: dmg * dk,
      vx: 0, vy: 0, flash: 0, stun: 0, poise: horde ? poise * 0.4 : poise, maxPoise: horde ? poise * 0.4 : poise, broken: 0, sq: 0, cd: 1.5 + Math.random() * 1.5, cast: 0, dashT: 0, dx: 0, dy: 0,
      pat: 0, volN: 0, volT: 0, phase: Math.random() * 6, dead: false, z: 0, vz: 0,
    });
  }

  // ---------------- 갱신 ----------------

  private update(real: number) {
    this.flashT = Math.max(0, this.flashT - real);
    // 필살기 연출: 세상은 멈추고 연출만 흐른다
    if (this.cine) {
      this.cine.t -= real;
      if (this.cine.style === 'domain') this.domain = ULT_R * 1.15 * Math.min(1, 1 - this.cine.t / this.cine.max + 0.05);
      this.shake = Math.max(this.shake, this.cine.style === 'zoom' ? 1.5 : 0);
      if (this.cine.t <= 0) this.cine = null;
      return;
    }
    // 히트스톱: 세상은 멈추고 흔들림만 줄어든다
    if (this.stop > 0) {
      // 도파민 모드는 멈춤을 짧게 (계속 때리니까 흐름이 끊기지 않게)
      this.stop -= real * (this.run === 'horde' ? 1.7 : 1);
      this.shake = Math.max(0, this.shake - 30 * real);
      return;
    }
    // 아슬아슬 회피 뒤 잠깐 느려짐
    const ts = this.slow > 0 ? 0.3 : 1;
    this.slow -= real;
    const dt = real * ts;
    this.time += dt;
    this.shake = Math.max(0, this.shake - 26 * real);
    this.zoom = Math.max(0, this.zoom - 3 * real);
    this.lines = Math.max(0, this.lines - real);
    this.hurtFlash = Math.max(0, this.hurtFlash - real);
    this.bannerT -= real;
    this.hitT -= dt;
    if (this.hitT <= 0) this.hits = 0;

    for (const g of this.ghosts) g.life -= dt;
    this.ghosts = this.ghosts.filter((g) => g.life > 0);
    if (!this.domainOn) this.domain = Math.max(0, this.domain - 600 * dt);
    this.updatePlayer(dt);
    this.updateEnemies(dt);
    this.updateShots(dt);
    this.updateFx(dt);

    if (this.run === 'horde') this.updateHorde(dt);
    else {
      // 다음 웨이브: 거의 다 잡았거나 오래 걸리면
      this.waveT += dt;
      const alive = this.enemies.filter((e) => !e.dead).length;
      const bossAlive = this.enemies.some((e) => !e.dead && e.kind === 'boss');
      if (!bossAlive && (alive <= 1 || this.waveT > 22)) this.nextWave();
    }

    // 카메라
    this.camX += (this.p.x - this.camX) * Math.min(1, 8 * dt);
    this.camY += (this.p.y - this.camY) * Math.min(1, 8 * dt);
  }

  /** 도파민 모드: 몹이 끊임없이 몰려온다 (점점 많이), 20초마다 골렘. 3분 버티면 끝 */
  private updateHorde(dt: number) {
    const rate = 9 + this.time * 0.18;
    this.spawnAcc += rate * dt;
    while (this.spawnAcc >= 1) {
      this.spawnAcc -= 1;
      if (this.enemies.length < HORDE_MAX) this.spawn(Math.random() < 0.35 ? 'bat' : 'slime');
    }
    // 몹 무리: 가끔 한 덩어리로 우르르
    if (Math.random() < dt * 0.35) for (let i = 0; i < 16; i++) this.spawn('slime');
    this.eliteT -= dt;
    if (this.eliteT <= 0) {
      this.eliteT = 20;
      const n = 1 + Math.floor(this.time / 60);
      for (let i = 0; i < n; i++) this.spawn('golem');
      this.banner = '골렘 등장!';
      this.bannerT = 1;
    }
    // 너무 멀어진 몹은 앞으로 다시
    const far = Math.hypot(this.w, this.h) / this.scale;
    for (const e of this.enemies) {
      if (Math.hypot(e.x - this.p.x, e.y - this.p.y) > far) {
        const a = Math.random() * Math.PI * 2;
        const d = Math.hypot(this.w, this.h) / 2 / this.scale + 30;
        e.x = this.p.x + Math.cos(a) * d;
        e.y = this.p.y + Math.sin(a) * d;
      }
    }
    this.wave = 1 + Math.floor(this.time / 30);
    if (this.time >= HORDE_SEC) this.finish(true);
  }

  /** 판 끝: 잠깐 보여 주고 결과 */
  private finish(win: boolean) {
    if (this.ended) return;
    this.ended = true;
    this.banner = win ? '3분 버텼다! 끝!' : '쓰러졌다…';
    this.bannerT = 99;
    if (win) {
      this.gold += 100;
      this.p.invuln = 99;
    }
    setTimeout(() => {
      this.running = false;
      this.onEnd({
        run: this.run, diff: this.diff, win, wave: this.wave, kills: this.kills, bestCombo: this.bestCombo, time: this.time,
        gold: Math.round(this.gold), stars: this.stars,
      });
    }, 1200);
  }

  /** 자동 이동의 지금 방향 (부드럽게 꺾는다) */
  private amx = 0;
  private amy = 0;

  /**
   * 자동 이동: 가까운 몹에게 붙어서 때리고(보스·골렘에겐 조금 거리를 두고),
   * 나에게 날아오는 탄·빨간 길·몹 떼 한가운데는 피한다. 서툰 사람 정도로
   */
  private autoMove(dt: number) {
    const p = this.p;
    let ax = 0;
    let ay = 0;
    const t = this.nearest(600);
    if (t) {
      const dx = t.x - p.x;
      const dy = t.y - p.y;
      const d = Math.hypot(dx, dy) || 1;
      const want = t.kind === 'boss' ? t.r + 50 : t.r + STEPS[0].reach * 0.6;
      const k = d > want + 8 ? 1 : d < want - 12 ? -0.6 : 0;
      ax += (dx / d) * k;
      ay += (dy / d) * k;
      // 붙어 있을 땐 살짝 옆으로 돌며
      if (k === 0) {
        ax += (-dy / d) * 0.25;
        ay += (dx / d) * 0.25;
      }
    }
    // 몹 떼 한가운데는 피한다 (가까이 많으면 바깥쪽으로)
    let cx = 0;
    let cy = 0;
    let n = 0;
    for (const e of this.enemies) {
      if (e.dead) continue;
      const d = Math.hypot(e.x - p.x, e.y - p.y);
      if (d < 70) {
        cx += e.x;
        cy += e.y;
        n++;
      }
      // 기 모으는 골렘·돌진 중인 적은 비킨다
      if ((e.cast > 0 || e.dashT > 0) && e.kind !== 'slime' && d < 160) {
        ax += ((p.x - e.x) / (d || 1)) * 1.2;
        ay += ((p.y - e.y) / (d || 1)) * 1.2;
      }
    }
    if (n >= 6) {
      const ox = p.x - cx / n;
      const oy = p.y - cy / n;
      const od = Math.hypot(ox, oy) || 1;
      ax += (ox / od) * 0.8;
      ay += (oy / od) * 0.8;
    }
    // 날아오는 탄: 탄 길 옆으로
    for (const b of this.bullets) {
      const rx = p.x - b.x;
      const ry = p.y - 16 - b.y;
      const d = Math.hypot(rx, ry);
      if (d > 130 || d < 1) continue;
      const sp = Math.hypot(b.vx, b.vy) || 1;
      const ux = b.vx / sp;
      const uy = b.vy / sp;
      if (rx * ux + ry * uy < 0) continue;
      const side = rx * -uy + ry * ux;
      if (Math.abs(side) > 28) continue;
      const sgn = side >= 0 ? 1 : -1;
      const k = ((130 - d) / 130) * 2.5;
      ax += -uy * sgn * k;
      ay += ux * sgn * k;
    }
    // 빨간 길(돌진 예고): 길 밖으로
    for (const l of this.lanes) {
      const lx = l.x2 - l.x1;
      const ly = l.y2 - l.y1;
      const ll = Math.hypot(lx, ly) || 1;
      const along = ((p.x - l.x1) * lx + (p.y - l.y1) * ly) / ll;
      if (along < -20 || along > ll + 20) continue;
      const side = ((p.x - l.x1) * -ly + (p.y - l.y1) * lx) / ll;
      if (Math.abs(side) > l.w / 2 + 18) continue;
      const sgn = side >= 0 ? 1 : -1;
      ax += (-ly / ll) * sgn * 3;
      ay += (lx / ll) * sgn * 3;
    }
    const k = 1 - Math.exp(-8 * dt);
    this.amx += (ax - this.amx) * k;
    this.amy += (ay - this.amy) * k;
    const l = Math.hypot(this.amx, this.amy);
    if (l < 0.08) return { x: 0, y: 0 };
    const m = Math.min(1, l);
    return { x: (this.amx / l) * m, y: (this.amy / l) * m };
  }

  private nearest(range: number) {
    let best: Enemy | null = null;
    let bd = range;
    for (const e of this.enemies) {
      if (e.dead) continue;
      const d = Math.hypot(e.x - this.p.x, e.y - this.p.y) - e.r;
      if (d < bd) {
        bd = d;
        best = e;
      }
    }
    return best;
  }

  private updatePlayer(dt: number) {
    const p = this.p;
    if (p.dead) return;
    p.invuln -= dt;
    p.animT += dt;
    this.atkCd -= dt;
    this.comboT -= dt;
    this.waveCd -= dt;
    this.dashCd -= dt;
    for (const id of SKILL_IDS) this.cds[id] = this.tuning.noCd ? 0 : this.cds[id] - dt;
    // 자동 이동 (pilot): 화면을 끌면 그동안은 직접
    const mv = this.autoMoveOn && !this.joy.active && !this.joy.keyMoving ? this.autoMove(dt) : this.joy.move;
    const ml = Math.hypot(mv.x, mv.y);
    p.moving = ml;

    // 두 손 모드 버튼 (키보드 J·K·L도)
    const two = this.mode === 'two';
    /** 스킬을 버튼으로 쓰는 조작 (두 손 · 자동 이동) */
    const manual = two || this.mode === 'pilot';
    const wantAtk = two && (this.press.attack || this.joy.pressed('j'));
    const wantDash = manual && (this.press.dash || this.joy.pressed('k'));
    const wantWave = two && (this.press.wave || this.joy.pressed('l'));
    const wantSkill: Record<SkillId, boolean> = {
      spin: manual && (this.press.spin || this.joy.pressed('u')),
      rush: manual && (this.press.rush || this.joy.pressed('i')),
      spindash: false,
      spinwave: false,
      slam: manual && (this.press.slam || this.joy.pressed('o')),
      ult: manual && (this.press.ult || this.joy.pressed(' ')),
    };
    this.press.attack = this.press.dash = this.press.wave = false;
    this.press.spin = this.press.rush = this.press.slam = this.press.ult = false;

    // 휙 회피 모드: 스킬은 다 자동, 휙이면 슬라이딩 회피 (1초 쿨타임, 필살기 빼고 기술 중에도 끊고 피한다)
    if (this.mode === 'dodge') {
      this.dodgeCd -= dt;
      for (const g of this.joy.takeGestures()) {
        if (g.type !== 'flick') continue;
        if (this.dodgeCd > 0 || this.dashT > 0 || this.cast?.id === 'ult') {
          if (this.dodgeCd > 0) this.text(p.x, p.y - 64, `회피 ${this.dodgeCd.toFixed(1)}초`, '#9aa4b8', 11);
          continue;
        }
        if (this.cast) this.cast = null;
        this.dodgeCd = DODGE_CD;
        this.startSlide(g.dx, g.dy);
      }
    }
    // 제스처: 기술·슬라이딩 중에 들어온 것은 끝나고 바로 이어서 (마지막 하나만)
    if (this.mode === 'gesture') {
      for (const g of this.joy.takeGestures()) this.pendingG = g;
      if (!this.cast && this.dashT <= 0) {
        this.chainT -= dt;
        if (this.chainT <= 0) this.chainSeq = '';
      }
    }
    // 스킬 쓰는 중: 그것만
    if (this.cast) {
      this.updateCast(dt);
      return;
    }
    // 제스처 모드: 톡 = 회오리 · 휙 = 슬라이딩, 이어 붙이면 연계 기술
    if (this.mode === 'gesture') {
      if (this.pendingG && this.dashT <= 0) {
        const g = this.pendingG;
        this.pendingG = null;
        if (this.onGesture(g)) return;
      }
    } else {
      // 스킬 발동: 두 손 = 버튼, 한 손 = 조건이 맞으면 자동 (필살기 → 지진 → 회오리 → 어퍼 순)
      for (const id of ['ult', 'slam', 'spin', 'rush'] as SkillId[]) {
        if (this.cds[id] > 0 || this.dashT > 0) continue;
        if (manual ? wantSkill[id] : this.autoSkill(id)) {
          this.startCast(id);
          return;
        }
      }
    }

    // 회피: 자동 이동 모드는 슬라이딩 (가는 쪽으로)
    if (wantDash && this.mode === 'pilot' && this.dashCd <= 0 && this.dashT <= 0) {
      this.dashCd = DASH_CD;
      const l = ml > 0.1 ? ml : 1;
      this.startSlide(ml > 0.1 ? mv.x / l : p.fx, ml > 0.1 ? mv.y / l : p.fy);
    }
    // 회피 (두 손 모드)
    if (wantDash && two && this.dashCd <= 0 && this.dashT <= 0) {
      const l = ml > 0.1 ? ml : 1;
      this.dashX = ml > 0.1 ? mv.x / l : p.fx;
      this.dashY = ml > 0.1 ? mv.y / l : p.fy;
      this.dashT = DASH_T;
      this.dashCd = DASH_CD;
      this.atk = null;
      p.invuln = Math.max(p.invuln, DASH_T + 0.05);
      sfx.dash();
      this.checkPerfect();
    }
    if (this.dashT > 0) {
      this.dashT -= dt;
      const sp = this.isSlide ? SLIDE_SPEED * (0.55 + 0.9 * (this.dashT / SLIDE_T)) : DASH_SPEED;
      p.x += this.dashX * sp * dt;
      p.y += this.dashY * sp * dt;
      if (Math.random() < 0.7) this.part(p.x, p.y - 4, 0, 0, 0.25, this.isSlide ? 'rgba(200,170,130,0.8)' : 'rgba(220,235,255,0.7)', 5, 0);
      p.fx = this.dashX;
      p.fy = this.dashY;
      if (this.isSlide) {
        // 슬라이딩으로 지나가는 몹은 걸려 넘어진다 (살짝 띄움)
        for (const e of this.enemies) {
          if (e.dead || this.slideHits.has(e) || Math.hypot(e.x - p.x, e.y - p.y) > e.r + p.r + 8) continue;
          this.slideHits.add(e);
          if (e.kind !== 'boss') e.vz = Math.max(e.vz, 260);
          this.damage(e, 6, this.dashX, this.dashY, 80, 0.5, 8, 1, e.x, e.y - e.r * 0.5);
        }
        if (this.dashT <= 0) {
          this.isSlide = false;
          this.chainT = CHAIN_WINDOW;
        }
      }
      return;
    }

    // 공격: 한 손 = 붙으면 자동, 두 손 = 버튼
    if (this.atk) {
      const st = STEPS[this.atk.step];
      this.atk.t += dt;
      if (wantAtk && this.atk.t > st.dur * 0.5) this.buffered = true;
      // 마무리 타: 앞으로 쑥 들어간다
      if (st.lunge && this.atk.t < st.hitAt) {
        p.x += p.fx * st.lunge * dt;
        p.y += p.fy * st.lunge * dt;
      }
      if (!this.atk.hit && this.atk.t >= st.hitAt) {
        this.atk.hit = true;
        this.meleeHit(this.atk.step);
      }
      if (this.atk.t >= st.dur) {
        const finished = this.atk.step === STEPS.length - 1;
        this.atk = null;
        this.comboT = finished ? 0 : COMBO_WINDOW;
        this.comboStep = finished ? 0 : this.comboStep;
        if (finished) this.atkCd = FINISH_REST;
      }
    }
    if (!this.atk && this.atkCd <= 0) {
      const target = this.nearest(STEPS[2].reach + 6);
      const go = two ? wantAtk || this.buffered : !!target && Math.hypot(target.x - p.x, target.y - p.y) - target.r < STEPS[0].reach + 10;
      if (go) {
        this.buffered = false;
        const step = this.comboT > 0 ? Math.min(STEPS.length - 1, this.comboStep + 1) : 0;
        // 반격 찬스: 다음 공격은 바로 마무리 타
        const s = this.counterReady ? STEPS.length - 1 : step;
        this.counterReady = false;
        this.comboStep = s;
        if (target) {
          const dx = target.x - p.x;
          const dy = target.y - p.y;
          const d = Math.hypot(dx, dy) || 1;
          p.fx = dx / d;
          p.fy = dy / d;
        }
        this.atk = { step: s, t: 0, hit: false, tx: p.fx, ty: p.fy };
        p.animT = 0;
      }
    }

    // 장풍: 한 손 = 조금 먼 적에게 가끔 자동, 두 손 = 버튼
    if (this.waveCd <= 0) {
      const far = this.nearest(380);
      const autoGo = (this.mode === 'one' || this.mode === 'pilot' || this.mode === 'dodge') && far && Math.hypot(far.x - p.x, far.y - p.y) > 110;
      if (autoGo || wantWave) {
        this.waveCd = two ? WAVE_CD_MANUAL : WAVE_CD_AUTO;
        let ax = p.fx;
        let ay = p.fy;
        if (far) {
          const d = Math.hypot(far.x - p.x, far.y - p.y) || 1;
          ax = (far.x - p.x) / d;
          ay = (far.y - p.y) / d;
        }
        this.orbs.push({ x: p.x + ax * 18, y: p.y - 22 + ay * 18, vx: ax * WAVE_SPEED, vy: ay * WAVE_SPEED, life: 1.2, hit: new Set() });
        this.ring(p.x + ax * 18, p.y - 22 + ay * 18, 16, 0.2, '#8fd3ff');
        sfx.wave();
      }
    }

    // 이동 (때리는 중엔 느리게)
    const slowK = this.atk ? 0.35 : 1;
    if (ml > 0.05) {
      p.x += mv.x * p.speed * slowK * dt;
      p.y += mv.y * p.speed * slowK * dt;
      if (!this.atk) {
        p.fx = mv.x / ml;
        p.fy = mv.y / ml;
      }
    }
    // 맞고 밀려남
    p.x += p.kx * dt;
    p.y += p.ky * dt;
    const decay = Math.exp(-10 * dt);
    p.kx *= decay;
    p.ky *= decay;
  }

  private countNear(r: number) {
    let n = 0;
    let boss = false;
    for (const e of this.enemies) {
      if (e.dead) continue;
      if (Math.hypot(e.x - this.p.x, e.y - this.p.y) - e.r < r) {
        n++;
        if (e.kind === 'boss') boss = true;
      }
    }
    return { n, boss };
  }

  /** 한 손 모드: 스킬을 알아서 쓰는 조건 */
  private autoSkill(id: SkillId) {
    if (id === 'ult') {
      const c = this.countNear(ULT_R);
      return c.n >= 4 || c.boss;
    }
    if (id === 'slam') {
      const c = this.countNear(130);
      return c.n >= 4 || (c.boss && c.n >= 1);
    }
    if (id === 'spin') return this.countNear(SPIN_R - 10).n >= 3;
    const t = this.nearest(240);
    if (!t) return false;
    const d = Math.hypot(t.x - this.p.x, t.y - this.p.y) - t.r;
    return d > 100 && d < 230;
  }

  /**
   * 제스처 연계: 톡(T) · 휙(F)을 기술이 끝난 뒤 CHAIN_WINDOW 안에 이어 붙이면 다른 기술이 된다.
   *   T 회오리 · F 슬라이딩
   *   FT 슬라이딩 어퍼 · TF 회오리 돌진 · TT 회오리 장풍 · FF 이중 슬라이딩
   *   3단째(아무 제스처) = 마무리: 필살(준비됐으면) → 지진 → 장풍 부채꼴
   * 쿨타임이면 그 제스처의 기본 기술로. 시작했으면 true
   */
  private onGesture(g: Gesture) {
    const p = this.p;
    if (g.type === 'charge') return false;
    const k = g.type === 'tap' ? 'T' : 'F';
    const dirX = g.type === 'flick' ? g.dx : p.fx;
    const dirY = g.type === 'flick' ? g.dy : p.fy;
    const seq = (this.chainT > 0 ? this.chainSeq : '') + k;
    this.chainT = 0;
    let label = '';
    const ready = (id: SkillId) => this.cds[id] <= 0;
    if (seq.length >= 3) {
      this.chainSeq = '';
      if (ready('ult')) {
        this.startCast('ult');
        label = '연계 마무리 · 백열권';
      } else if (ready('slam')) {
        this.startCast('slam');
        label = '연계 마무리 · 지진';
      } else {
        this.waveFan(5);
        label = '연계 마무리 · 장풍';
        this.chainT = 0;
      }
    } else {
      this.chainSeq = seq;
      const combo: Record<string, SkillId> = { FT: 'rush', TF: 'spindash', TT: 'spinwave' };
      const id = combo[seq];
      if (id && ready(id)) {
        this.startCast(id, seq === 'FT' ? this.dashX || dirX : dirX, seq === 'FT' ? this.dashY || dirY : dirY);
        label = `연계 2단 · ${SKILLS[id].name}`;
      } else if (k === 'F') {
        this.startSlide(dirX, dirY);
        if (seq === 'FF') label = '연계 2단 · 이중 슬라이딩';
      } else if (ready('spin')) {
        this.startCast('spin');
      } else {
        this.text(p.x, p.y - 64, `회오리 ${Math.ceil(this.cds.spin)}초`, '#9aa4b8', 12);
        this.chainSeq = '';
        return false;
      }
    }
    if (label) {
      this.banner = label;
      this.bannerT = 0.7;
      this.text(p.x, p.y - 74, label.split(' · ')[0], '#ffd23f', 14);
    }
    return true;
  }

  /** 슬라이딩: 짧은 무적 미끄러짐. 아슬아슬하면 반격 찬스, 지나가는 몹은 넘어진다 */
  private startSlide(dx: number, dy: number) {
    const p = this.p;
    const l = Math.hypot(dx, dy) || 1;
    this.dashX = dx / l;
    this.dashY = dy / l;
    this.dashT = SLIDE_T;
    this.isSlide = true;
    this.slideHits.clear();
    this.atk = null;
    p.invuln = Math.max(p.invuln, SLIDE_T + 0.06);
    sfx.dash();
    this.sprs.push({ name: 'dust', x: p.x, y: p.y, size: 40, life: 0.25, max: 0.25, rot: 0 });
    this.checkPerfect();
  }

  /** 장풍 여러 발을 부채꼴로 */
  private waveFan(n: number) {
    const p = this.p;
    const far = this.nearest(380);
    const base = far ? Math.atan2(far.y - p.y, far.x - p.x) : Math.atan2(p.fy, p.fx);
    for (let i = 0; i < n; i++) {
      const a = base + (i / (n - 1) - 0.5) * 0.9;
      this.orbs.push({ x: p.x + Math.cos(a) * 18, y: p.y - 22 + Math.sin(a) * 18, vx: Math.cos(a) * WAVE_SPEED, vy: Math.sin(a) * WAVE_SPEED, life: 1.1, hit: new Set() });
    }
    this.ring(p.x, p.y - 22, 26, 0.25, '#8fd3ff');
    sfx.wave();
  }

  private startCast(id: SkillId, dirX = 0, dirY = 0) {
    const p = this.p;
    this.cds[id] = SKILLS[id].cd * skillCdMul(this.save, id);
    this.atk = null;
    // 어퍼: 방향을 줬으면 그쪽 부채꼴(±45°) 안의 가장 가까운 적, 없으면 그 방향으로 쑥
    let target: Enemy | null = null;
    if (id === 'rush' && (dirX || dirY)) {
      let bd = 280;
      for (const e of this.enemies) {
        if (e.dead) continue;
        const dx = e.x - p.x;
        const dy = e.y - p.y;
        const d = Math.hypot(dx, dy) || 1;
        if ((dx * dirX + dy * dirY) / d < Math.cos(Math.PI / 4)) continue;
        if (d < bd) {
          bd = d;
          target = e;
        }
      }
      if (!target) {
        p.fx = dirX;
        p.fy = dirY;
      }
    } else if (id === 'rush') target = this.nearest(260);
    let ex = p.x + (id === 'rush' && !target ? p.fx * 150 : 0);
    let ey = p.y + (id === 'rush' && !target ? p.fy * 150 : 0);
    if (target) {
      const dx = target.x - p.x;
      const dy = target.y - p.y;
      const d = Math.hypot(dx, dy) || 1;
      p.fx = dx / d;
      p.fy = dy / d;
      const go = Math.max(0, d - target.r - 18);
      ex = p.x + p.fx * go;
      ey = p.y + p.fy * go;
    }
    if (id === 'spindash') {
      const l = Math.hypot(dirX, dirY) || 1;
      ex = dirX / l || p.fx;
      ey = dirY / l || p.fy;
    }
    this.cast = { id, t: 0, phase: 0, hits: 0, next: 0, target, sx: p.x, sy: p.y, ex, ey };
    p.invuln = Math.max(p.invuln, id === 'ult' ? 99 : id === 'rush' ? 0.3 : 0.15);
    this.banner = SKILLS[id].name;
    this.bannerT = id === 'ult' ? 0 : 0.6;
    if (id === 'ult') {
      // 연출 고르기 (랜덤이면 돌아가며)
      let style = this.tuning.ultStyle;
      if (style === 'random') {
        const all: Exclude<UltStyle, 'random'>[] = ['cutin', 'zoom', 'domain', 'blackout'];
        style = all[this.styleIdx++ % all.length];
      }
      const st = style as Exclude<UltStyle, 'random'>;
      if (CINE_T[st] > 0) this.cine = { style: st, t: CINE_T[st], max: CINE_T[st] };
      this.domainOn = st === 'domain';
      if (st !== 'domain') this.domain = 0;
      sfx.ultCharge();
    } else if (id === 'spin') sfx.whoosh();
    else if (id === 'rush') sfx.dash();
  }

  private castEnd() {
    const id = this.cast?.id;
    this.cast = null;
    if (this.mode === 'gesture' && this.chainSeq) this.chainT = CHAIN_WINDOW;
    if (id === 'ult') {
      this.p.invuln = 0.4;
      this.domainOn = false;
    }
  }

  private ghost() {
    this.ghosts.push({ x: this.p.x, y: this.p.y, row: this.lastRow, action: this.lastAction, frame: this.lastFrame, life: 0.22 });
  }

  /** 범위 안 적 모두 때리기 (중심, 반지름, 피해, 밀기, 경직, 띄우기, 세기) */
  private aoe(cx: number, cy: number, r: number, dmg: number, knock: number, stun: number, lift: number, power: number) {
    let any = false;
    for (const e of this.enemies) {
      if (e.dead) continue;
      const dx = e.x - cx;
      const dy = e.y - cy;
      const d = Math.hypot(dx, dy) || 1;
      if (d - e.r > r) continue;
      any = true;
      if (lift > 0 && e.kind !== 'boss') e.vz = Math.max(e.vz, lift * (e.kind === 'golem' ? 0.6 : 1));
      this.damage(e, dmg, dx / d, dy / d, knock * this.tuning.knock, stun, power * 12, power, e.x, e.y - e.r * 0.7);
    }
    return any;
  }

  private updateCast(dt: number) {
    const c = this.cast!;
    const p = this.p;
    const t = this.tuning;
    c.t += dt;
    if (c.id === 'spin') {
      // 회오리 발차기: 제자리에서 빙글 세 바퀴, 맞을 때마다 둘레를 친다
      if (Math.random() < 0.8) {
        const a = c.t * 30;
        this.part(p.x + Math.cos(a) * 46, p.y - 20 + Math.sin(a) * 18, 0, -40, 0.25, '#e8f2ff', 4, 0);
      }
      if (c.hits < 3 && c.t >= 0.12 * (c.hits + 1)) {
        c.hits++;
        const last = c.hits === 3;
        const hit = this.aoe(p.x, p.y, SPIN_R, last ? 14 : 8, last ? 420 : 120, last ? 0.4 : 0.2, 0, last ? 2 : 1);
        this.sprs.push({ name: 'slash', x: p.x, y: p.y - 22, size: SPIN_R * 1.15, life: 0.14, max: 0.14, rot: c.t * 20 });
        if (hit) {
          this.stop = Math.max(this.stop, (last ? 0.07 : 0.035) * t.hitstop);
          this.shake = Math.max(this.shake, (last ? 7 : 3) * t.shake);
        } else sfx.whoosh();
      }
      if (c.t >= 0.46) this.castEnd();
    } else if (c.id === 'spindash') {
      // 회오리 돌진: 돌면서 그 방향으로 쭉, 지나가는 적을 계속 친다
      if (c.t < 0.42) {
        p.x += c.ex * 430 * dt;
        p.y += c.ey * 430 * dt;
        p.fx = c.ex;
        p.fy = c.ey;
        c.next -= dt;
        if (c.next <= 0) {
          c.next = 0.08;
          const hit = this.aoe(p.x, p.y, 100, 7, 260, 0.25, 0, 1);
          this.sprs.push({ name: 'slash', x: p.x, y: p.y - 22, size: 96, life: 0.1, max: 0.1, rot: c.t * 25 });
          if (hit) {
            this.stop = Math.max(this.stop, 0.025 * t.hitstop);
            this.shake = Math.max(this.shake, 3 * t.shake);
          }
        }
        if (Math.random() < 0.8) this.part(p.x, p.y - 6, -c.ex * 80, -c.ey * 80, 0.3, '#e8f2ff', 4, 0);
      } else this.castEnd();
    } else if (c.id === 'spinwave') {
      // 회오리 장풍: 빙글 돌다가 사방으로 장풍 8발
      if (c.hits === 0 && c.t >= 0.22) {
        c.hits = 1;
        for (let i = 0; i < 8; i++) {
          const a = (i / 8) * Math.PI * 2 + c.t;
          this.orbs.push({ x: p.x + Math.cos(a) * 20, y: p.y - 22 + Math.sin(a) * 20, vx: Math.cos(a) * WAVE_SPEED, vy: Math.sin(a) * WAVE_SPEED, life: 0.9, hit: new Set() });
        }
        this.ring(p.x, p.y - 22, 60, 0.3, '#8fd3ff');
        this.shake = Math.max(this.shake, 5 * t.shake);
        sfx.wave();
      }
      if (c.t >= 0.4) this.castEnd();
    } else if (c.id === 'rush') {
      // 돌진 어퍼: 순식간에 붙어서 위로 올려친다 (띄우기)
      const dashDur = 0.16;
      if (c.t < dashDur) {
        const k = c.t / dashDur;
        p.x = c.sx + (c.ex - c.sx) * k;
        p.y = c.sy + (c.ey - c.sy) * k;
        this.ghost();
      } else if (c.hits === 0) {
        c.hits = 1;
        p.x = c.ex;
        p.y = c.ey;
        const tgt = c.target && !c.target.dead ? c.target : this.nearest(90);
        if (tgt) {
          // 올려친 자리 둘레 전부 같은 피해로 띄운다 (보스든 몹 떼든 똑같이)
          this.aoe(tgt.x, tgt.y, RUSH_R, 32, 200, 0.7, 430, 3);
          this.stop = Math.max(this.stop, 0.12 * t.hitstop);
          this.shake = Math.max(this.shake, 9 * t.shake);
          this.zoom = 1;
          this.lines = 0.2;
          this.ring(tgt.x, tgt.y - tgt.r, 40, 0.3, '#ffe066');
        } else sfx.whoosh();
      }
      if (c.t >= 0.36) this.castEnd();
    } else if (c.id === 'slam') {
      // 지진 내려찍기: 뛰어올라 쾅 → 충격파, 둘레 적을 띄운다
      if (c.hits === 0 && c.t >= 0.42) {
        c.hits = 1;
        this.aoe(p.x, p.y, 175, 22, 380, 0.9, 260, 3);
        this.ring(p.x, p.y, 175, 0.45, '#ffb347');
        this.ring(p.x, p.y, 90, 0.35, '#ffffff');
        for (let i = 0; i < 26; i++) {
          const a = (i / 26) * Math.PI * 2;
          this.part(p.x + Math.cos(a) * 30, p.y + Math.sin(a) * 12, Math.cos(a) * 320, Math.sin(a) * 140 - 120, 0.5, i % 2 ? '#a07850' : '#d8c0a0', 4, 700);
        }
        this.sprs.push({ name: 'dust', x: p.x, y: p.y, size: 150, life: 0.4, max: 0.4, rot: 0 });
        this.stop = Math.max(this.stop, 0.1 * t.hitstop);
        this.shake = Math.max(this.shake, 13 * t.shake);
        sfx.slam();
        navigator.vibrate?.(25);
      }
      if (c.t >= 0.62) this.castEnd();
    } else {
      // 백열권: 범위 안 적들을 순식간에 마구 두들기고 → 마지막 한 방에 대폭발
      if (c.t < ULT_FLURRY) {
        this.domainOn = this.domainOn || this.domain > 0;
        c.next -= dt;
        if (c.next <= 0) {
          c.next = ULT_GAP;
          const inRange = this.enemies.filter((e) => !e.dead && Math.hypot(e.x - c.sx, e.y - c.sy) - e.r < ULT_R);
          // 범위 안 적은 붙잡혀 있다
          for (const e of inRange) {
            e.stun = Math.max(e.stun, 0.3);
            e.vx *= 0.3;
            e.vy *= 0.3;
          }
          if (inRange.length) {
            // 순간이동은 시작 자리 가까이(ULT_HOP_R)의 적에게만, 없으면 제자리 둘레에서 살짝
            const near = inRange.filter((o) => Math.hypot(o.x - c.sx, o.y - c.sy) < ULT_HOP_R);
            const a = Math.random() * Math.PI * 2;
            this.ghost();
            if (near.length) {
              const e = near[c.hits % near.length];
              p.x = e.x + Math.cos(a) * (e.r + 14);
              p.y = e.y + Math.sin(a) * (e.r + 8);
              const dx = e.x - p.x;
              const dy = e.y - p.y;
              const d = Math.hypot(dx, dy) || 1;
              p.fx = dx / d;
              p.fy = dy / d;
            } else {
              p.x = c.sx + Math.cos(a) * 24;
              p.y = c.sy + Math.sin(a) * 16;
            }
            // 한 타마다 범위(ULT_R) 안 적 전부 (최대 ULT_MAX_HITS)
            for (const o of inRange.slice(0, ULT_MAX_HITS)) {
              const ox = o.x - p.x;
              const oy = o.y - p.y;
              const od = Math.hypot(ox, oy) || 1;
              this.damage(o, 7, ox / od, oy / od, 40, 0.3, 4, 1, o.x - (ox / od) * o.r * 0.5, o.y - o.r * 0.7);
            }
            this.stop = Math.max(this.stop, 0.018 * t.hitstop);
            this.shake = Math.max(this.shake, 3 * t.shake);
          } else {
            this.ghost();
          }
          c.hits++;
        }
      } else if (c.phase === 0) {
        c.phase = 1;
        p.x = c.sx;
        p.y = c.sy;
        this.aoe(c.sx, c.sy, ULT_R + 20, 80, 720, 1.2, 380, 3);
        this.ring(c.sx, c.sy, ULT_R + 30, 0.6, '#ffe066');
        this.ring(c.sx, c.sy, ULT_R * 0.6, 0.45, '#ffffff');
        for (let i = 0; i < 60; i++) {
          const a = Math.random() * Math.PI * 2;
          const sp = 200 + Math.random() * 500;
          this.part(c.sx, c.sy - 20, Math.cos(a) * sp, Math.sin(a) * sp - 100, 0.8, ['#ffe066', '#ffffff', '#ffb347'][i % 3], 4, 400);
        }
        this.stop = Math.max(this.stop, 0.28 * t.hitstop);
        this.shake = Math.max(this.shake, 18 * t.shake);
        this.flashT = 0.18;
        this.zoom = 1;
        this.lines = 0.35;
        this.text(c.sx, c.sy - 80, '백열권!!', '#ffd23f', 34);
        sfx.ultBoom();
        navigator.vibrate?.([20, 30, 40]);
      }
      if (c.t >= ULT_FLURRY + 0.35) this.castEnd();
    }
  }

  /** 아슬아슬 회피: 회피를 누른 순간 가까이 탄이나 돌진하는 적이 있으면 → 느려짐 + 다음 공격이 마무리 타 */
  private checkPerfect() {
    const p = this.p;
    const close = this.bullets.some((b) => Math.hypot(b.x - p.x, b.y - p.y) < PERFECT_R)
      || this.enemies.some((e) => !e.dead && (e.dashT > 0 || e.cast > 0) && Math.hypot(e.x - p.x, e.y - p.y) < e.r + PERFECT_R + 20);
    if (!close) return;
    this.slow = SLOWMO_T;
    this.counterReady = true;
    this.text(p.x, p.y - 60, '반격 찬스!', '#8fd3ff', 18);
    this.ring(p.x, p.y - 10, 50, 0.4, '#8fd3ff');
    sfx.perfect();
  }

  /** 펀치 판정: 앞쪽 부채꼴 안의 적 모두 */
  private meleeHit(step: number) {
    const p = this.p;
    const st = STEPS[step];
    const t = this.tuning;
    let any = false;
    for (const e of this.enemies) {
      if (e.dead) continue;
      const dx = e.x - p.x;
      const dy = e.y - p.y;
      const d = Math.hypot(dx, dy) || 1;
      if (d - e.r > st.reach) continue;
      const cos = (dx * p.fx + dy * p.fy) / d;
      if (cos < Math.cos((95 * Math.PI) / 180) && d > e.r + 6) continue;
      any = true;
      const hx = e.x - (dx / d) * e.r * 0.6;
      const hy = e.y - e.r * 0.6 - (dy / d) * e.r * 0.3;
      this.damage(e, st.dmg, dx / d, dy / d, st.knock * t.knock, st.stun, st.poise, step + 1, hx, hy);
    }
    if (any) {
      this.stop = Math.max(this.stop, st.stop * t.hitstop);
      this.shake = Math.max(this.shake, st.shake * t.shake);
      if (step === 2) {
        this.zoom = 1;
        this.lines = 0.25;
        navigator.vibrate?.(15);
      }
    } else {
      sfx.whoosh();
    }
    // 휘두른 궤적
    const sx = p.x + p.fx * 26;
    const sy = p.y - 24 + p.fy * 18;
    this.sprs.push({ name: 'slash', x: sx, y: sy, size: step === 2 ? 64 : 40, life: 0.12, max: 0.12, rot: Math.atan2(p.fy, p.fx) });
  }

  private damage(e: Enemy, dmg: number, ux: number, uy: number, knock: number, stun: number, poise: number, power: number, hx: number, hy: number) {
    const brokenMul = e.broken > 0 ? 1.5 : 1;
    const crit = Math.random() < 0.12;
    const sk = this.cast ? skillDmgMul(this.save, this.cast.id) : 1;
    const v = Math.round(dmg * atkMul(this.save) * sk * brokenMul * (crit ? 2 : 1) * (0.9 + Math.random() * 0.2));
    e.hp -= v;
    e.flash = 0.09;
    e.sq = 1;
    // 보스는 덜 밀린다
    const kk = e.kind === 'boss' ? 0.25 : e.kind === 'golem' ? 0.55 : 1;
    e.vx += ux * knock * kk;
    e.vy += uy * knock * kk;
    e.stun = Math.max(e.stun, stun * (e.kind === 'boss' ? 0.3 : 1));
    // 때리면 쏘려던 것도 끊긴다 (보스 빼고)
    if (e.kind !== 'boss') e.cast = 0;
    // 경직 게이지
    if (e.broken <= 0) {
      e.poise -= poise;
      if (e.poise <= 0) {
        e.broken = e.kind === 'boss' ? 2.2 : 1.2;
        e.stun = Math.max(e.stun, e.broken);
        e.poise = e.maxPoise;
        if (!(this.run === 'horde' && e.maxHp < 40)) this.text(e.x, e.y - e.r * 2.6, '무너짐!', '#ffd23f', e.kind === 'boss' ? 22 : 16);
        this.ring(e.x, e.y - e.r * 0.6, e.r * 2.4, 0.35, '#ffd23f');
        this.stop = Math.max(this.stop, 0.08 * this.tuning.hitstop);
      }
    }
    // 도파민 모드의 약한 몹은 숫자를 줄인다 (화면이 숫자로 덮이지 않게)
    if (!(this.run === 'horde' && e.maxHp < 40 && !crit && Math.random() < 0.7)) {
      this.text(hx, hy - 14, String(v), crit ? '#ffb347' : '#ffffff', crit ? 20 + power * 2 : 13 + power * 2);
    }
    this.sprs.push({ name: 'star-burst', x: hx, y: hy, size: 26 + power * 12, life: 0.16, max: 0.16, rot: Math.random() * 6 });
    const n = 4 + power * 4;
    for (let i = 0; i < n; i++) {
      const a = Math.atan2(uy, ux) + (Math.random() - 0.5) * 1.6;
      const s = 120 + Math.random() * 220 * power;
      this.part(hx, hy, Math.cos(a) * s, Math.sin(a) * s - 60, 0.35, i % 2 ? '#ffe066' : '#ffffff', 2.5 + power * 0.6, 500);
    }
    sfx.hit(power);
    this.hits++;
    this.hitT = 1.6;
    this.bestCombo = Math.max(this.bestCombo, this.hits);
    if (e.hp <= 0) this.kill(e, ux, uy);
  }

  private kill(e: Enemy, ux: number, uy: number) {
    e.dead = true;
    this.kills++;
    // 보상: 도파민 = 처치마다 골드(시간이 갈수록 조금씩 더) / 도전 = 난이도만큼 골드, 보스는 별
    if (this.run === 'horde') this.gold += (e.kind === 'golem' ? 15 : 1) * (1 + this.time / 120);
    else {
      const df = DIFFS[this.diff];
      this.gold += df.gold * (e.kind === 'boss' ? 30 : e.kind === 'golem' ? 4 : 1);
      if (e.kind === 'boss') {
        this.stars += df.stars;
        this.text(e.x, e.y - e.r * 3.2, `⭐ +${df.stars}`, '#ffe066', 22);
      }
    }
    sfx.kill();
    this.sprs.push({ name: 'dust', x: e.x, y: e.y, size: e.r * 3, life: 0.35, max: 0.35, rot: 0 });
    const colors: Record<Kind, string[]> = { slime: ['#7fd06a', '#bff0a8'], bat: ['#6a4a8a', '#b38ad8'], golem: ['#8a7f74', '#c8bdb0'], boss: ['#b03050', '#ff8fa3', '#ffd23f'] };
    for (let i = 0; i < (e.kind === 'boss' ? 40 : 12); i++) {
      const a = Math.atan2(uy, ux) + (Math.random() - 0.5) * 2.4;
      const s = 80 + Math.random() * 260;
      this.part(e.x, e.y - e.r * 0.5, Math.cos(a) * s, Math.sin(a) * s - 120, 0.6, colors[e.kind][i % colors[e.kind].length], 3, 600);
    }
    if (e.kind === 'boss') {
      this.shake = 14 * this.tuning.shake;
      this.stop = 0.2 * this.tuning.hitstop;
      this.banner = '보스 격파!';
      this.bannerT = 1.6;
    }
  }

  /** 맞았다. heavy = 탄막·돌진·범위기 (아프고 크게 밀린다) / 아니면 몸통 박치기 (살짝) */
  private hurtPlayer(dmg: number, fx: number, fy: number, heavy = true) {
    const p = this.p;
    if (p.invuln > 0 || p.dead) return;
    p.hp -= dmg;
    p.invuln = heavy ? 0.7 : 0.45;
    const dx = p.x - fx;
    const dy = p.y - fy;
    const d = Math.hypot(dx, dy) || 1;
    p.kx = (dx / d) * (heavy ? 260 : 90);
    p.ky = (dy / d) * (heavy ? 260 : 90);
    this.shake = Math.max(this.shake, (heavy ? 6 : 1.5) * this.tuning.shake);
    this.hurtFlash = heavy ? 0.35 : 0.12;
    this.text(p.x, p.y - 56, `-${Math.round(dmg)}`, '#ff6b6b', heavy ? 15 : 11);
    if (heavy) this.atk = null;
    sfx.hurt();
    if (p.hp <= 0) {
      p.dead = true;
      this.finish(false);
    }
  }

  private updateEnemies(dt: number) {
    const p = this.p;
    for (const e of this.enemies) {
      if (e.dead) continue;
      e.flash -= dt;
      e.sq = Math.max(0, e.sq - 6 * dt);
      // 띄우기: 공중에 있는 동안은 꼼짝 못 한다, 떨어지면 먼지
      if (e.z > 0 || e.vz > 0) {
        e.vz -= 1300 * dt;
        e.z += e.vz * dt;
        e.stun = Math.max(e.stun, 0.15);
        if (e.z <= 0) {
          e.z = 0;
          if (e.vz < -250) {
            this.sprs.push({ name: 'dust', x: e.x, y: e.y, size: e.r * 2.6, life: 0.3, max: 0.3, rot: 0 });
            this.shake = Math.max(this.shake, 2 * this.tuning.shake);
          }
          e.vz = 0;
        }
      }
      e.stun -= dt;
      e.broken -= dt;
      e.phase += dt;
      // 밀려남
      e.x += e.vx * dt;
      e.y += e.vy * dt;
      const decay = Math.exp(-7 * dt);
      e.vx *= decay;
      e.vy *= decay;
      const dx = p.x - e.x;
      const dy = p.y - e.y;
      const d = Math.hypot(dx, dy) || 1;
      const ux = dx / d;
      const uy = dy / d;
      if (e.stun > 0) continue;
      if (e.kind === 'boss') this.bossAI(e, ux, uy, d, dt);
      else if (e.dashT > 0) {
        e.dashT -= dt;
        e.x += e.dx * 380 * dt;
        e.y += e.dy * 380 * dt;
      } else if (e.cast > 0) {
        e.cast -= dt;
        if (e.cast <= 0) this.mobSkill(e, ux, uy);
      } else {
        // 움직임: 박쥐는 거리를 두고 빙빙, 나머지는 쫓아온다
        let mx = ux;
        let my = uy;
        if (e.kind === 'bat') {
          const want = d > 210 ? 1 : d < 160 ? -1 : 0;
          mx = ux * want - uy * 0.8;
          my = uy * want + ux * 0.8;
        }
        const ml = Math.hypot(mx, my) || 1;
        e.x += (mx / ml) * e.speed * dt;
        e.y += (my / ml) * e.speed * dt;
        e.cd -= dt;
        if (e.cd <= 0 && e.kind !== 'slime' && !(this.run === 'horde' && e.kind === 'bat') && d < 300) {
          e.cast = e.kind === 'golem' ? 0.6 : 0.45;
          e.cd = e.kind === 'golem' ? 4 : 2.6;
          if (e.kind === 'golem') {
            e.dx = ux;
            e.dy = uy;
            this.lanes.push({ x1: e.x, y1: e.y, x2: e.x + ux * 190, y2: e.y + uy * 190, w: e.r * 1.8, t: 0.6, max: 0.6 });
          }
        }
      }
      // 몸통 박치기
      // 몸통 박치기는 약하게, 돌진 중엔 세게
      if (d < e.r + p.r && e.stun <= 0) {
        const dashing = e.dashT > 0;
        this.hurtPlayer(e.dmg * (dashing ? 1.25 : CONTACT_MUL), e.x, e.y, dashing);
      }
    }
    // 서로 겹치지 않게
    const list = this.enemies.filter((e) => !e.dead);
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const a = list[i];
        const b = list[j];
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const d = Math.hypot(dx, dy);
        const min = a.r + b.r;
        if (d > 0 && d < min) {
          const push = (min - d) / d / 2;
          const wa = a.kind === 'boss' ? 0.1 : 1;
          const wb = b.kind === 'boss' ? 0.1 : 1;
          a.x -= dx * push * wa;
          a.y -= dy * push * wa;
          b.x += dx * push * wb;
          b.y += dy * push * wb;
        }
      }
    }
    this.enemies = this.enemies.filter((e) => !e.dead);
  }

  private mobSkill(e: Enemy, ux: number, uy: number) {
    if (e.kind === 'bat') {
      const a = Math.atan2(uy, ux);
      const spread = this.wave >= 6 ? [-0.25, 0, 0.25] : [0];
      for (const k of spread) this.shoot(e.x, e.y - 8, a + k, 190, e.dmg * 1.5, false);
    } else if (e.kind === 'golem') {
      e.dashT = 0.5;
    }
  }

  /** 보스: 사방 탄 → 조준 산탄 3연발 → 돌진 → 졸개 부르기 (체력 절반 아래면 빨라진다) */
  private bossAI(e: Enemy, ux: number, uy: number, d: number, dt: number) {
    const rage = e.hp < e.maxHp * 0.5;
    if (e.dashT > 0) {
      e.dashT -= dt;
      if (e.dashT < 0.5) {
        e.x += e.dx * (rage ? 520 : 440) * dt;
        e.y += e.dy * (rage ? 520 : 440) * dt;
      }
      return;
    }
    if (e.volN > 0) {
      e.volT -= dt;
      if (e.volT <= 0) {
        e.volN--;
        e.volT = rage ? 0.25 : 0.33;
        const a = Math.atan2(uy, ux);
        const n = rage ? 7 : 5;
        for (let i = 0; i < n; i++) this.shoot(e.x, e.y - 10, a + (i / (n - 1) - 0.5) * 0.7, 220, e.dmg * 0.9, true);
      }
      return;
    }
    if (e.cast > 0) {
      e.cast -= dt;
      if (e.cast <= 0) {
        if (e.pat % 4 === 0) {
          const n = rage ? 22 : 16;
          const off = Math.random() * Math.PI;
          for (let i = 0; i < n; i++) {
            this.shoot(e.x, e.y - 10, off + (i / n) * Math.PI * 2, 150, e.dmg * 0.9, true);
            this.shoot(e.x, e.y - 10, off + ((i + 0.5) / n) * Math.PI * 2, 105, e.dmg * 0.9, true);
          }
        } else if (e.pat % 4 === 1) {
          e.volN = rage ? 4 : 3;
          e.volT = 0;
        } else if (e.pat % 4 === 2) {
          e.dashT = 1.0;
        } else {
          for (let i = 0; i < 4; i++) this.spawn('slime');
        }
        e.pat++;
      }
      return;
    }
    e.x += ux * e.speed * dt;
    e.y += uy * e.speed * dt;
    e.cd -= dt;
    if (e.cd <= 0 && d < 420) {
      e.cd = rage ? 2 : 2.8;
      e.cast = 0.6;
      if (e.pat % 4 === 2) {
        e.dx = ux;
        e.dy = uy;
        this.lanes.push({ x1: e.x, y1: e.y, x2: e.x + ux * 320, y2: e.y + uy * 320, w: e.r * 1.6, t: 1.0, max: 1.0 });
      }
    }
  }

  private shoot(x: number, y: number, a: number, speed: number, dmg: number, boss: boolean) {
    speed *= DIFFS[this.diff].bullet * (this.tuning.slowBullets ? 0.75 : 1);
    this.bullets.push({ x, y, vx: Math.cos(a) * speed, vy: Math.sin(a) * speed, r: boss ? 6 : 5, dmg, life: 4, boss });
  }

  private updateShots(dt: number) {
    const p = this.p;
    for (const b of this.bullets) {
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      b.life -= dt;
      if (!p.dead && Math.hypot(b.x - p.x, b.y - (p.y - 16)) < b.r + p.r * 0.8 && p.invuln <= 0) {
        b.life = 0;
        this.hurtPlayer(b.dmg, b.x - b.vx, b.y - b.vy);
      }
    }
    this.bullets = this.bullets.filter((b) => b.life > 0);
    for (const o of this.orbs) {
      o.x += o.vx * dt;
      o.y += o.vy * dt;
      o.life -= dt;
      if (Math.random() < 0.8) this.part(o.x, o.y, -o.vx * 0.1, -o.vy * 0.1, 0.25, '#bfe8ff', 3, 0);
      for (const e of this.enemies) {
        if (e.dead || o.hit.has(e)) continue;
        if (Math.hypot(e.x - o.x, e.y - e.r * 0.5 - o.y) > e.r + 18) continue;
        o.hit.add(e);
        const sp = Math.hypot(o.vx, o.vy) || 1;
        this.damage(e, WAVE_DMG, o.vx / sp, o.vy / sp, 200 * this.tuning.knock, 0.15, 8, 1, o.x, o.y);
        this.stop = Math.max(this.stop, 0.03 * this.tuning.hitstop);
        this.shake = Math.max(this.shake, 2 * this.tuning.shake);
        // 꿰뚫고 계속 날아간다 (지나가는 적 모두)
      }
    }
    this.orbs = this.orbs.filter((o) => o.life > 0);
  }

  private updateFx(dt: number) {
    for (const q of this.parts) {
      q.life -= dt;
      q.vy += q.grav * dt;
      q.vx *= 1 - 3 * dt;
      q.x += q.vx * dt;
      q.y += q.vy * dt;
    }
    this.parts = this.parts.filter((q) => q.life > 0);
    for (const t of this.texts) {
      t.life -= dt;
      t.y -= 30 * dt;
    }
    this.texts = this.texts.filter((t) => t.life > 0);
    for (const s of this.sprs) s.life -= dt;
    this.sprs = this.sprs.filter((s) => s.life > 0);
    for (const r of this.rings) r.life -= dt;
    this.rings = this.rings.filter((r) => r.life > 0);
    for (const l of this.lanes) l.t -= dt;
    this.lanes = this.lanes.filter((l) => l.t > 0);
  }

  private part(x: number, y: number, vx: number, vy: number, life: number, color: string, size: number, grav: number) {
    if (this.parts.length > 400) return;
    this.parts.push({ x, y, vx, vy, life, max: life, color, size, grav });
  }

  private text(x: number, y: number, text: string, color: string, size: number) {
    this.texts.push({ x, y, text, color, size, life: 0.7, max: 0.7 });
  }

  private ring(x: number, y: number, r: number, life: number, color: string) {
    this.rings.push({ x, y, r, life, max: life, color });
  }

  // ---------------- 그리기 ----------------

  private draw() {
    const ctx = this.ctx;
    // 줌인 연출: 연출 동안 주인공 쪽으로 확 당긴다
    const cz = this.cine?.style === 'zoom' ? Math.sin(Math.min(1, 1 - this.cine.t / this.cine.max) * Math.PI * 0.5) * 0.7 : 0;
    const s = this.scale * (1 + this.zoom * 0.04 + cz);
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.fillStyle = '#5b4a3a';
    ctx.fillRect(0, 0, this.w, this.h);
    const sx = (Math.random() - 0.5) * this.shake;
    const sy = (Math.random() - 0.5) * this.shake;
    ctx.translate(this.w / 2 + sx, this.h / 2 + sy);
    ctx.scale(s, s);
    ctx.translate(-this.camX, -this.camY);
    this.drawGround();

    // 경고 길
    for (const l of this.lanes) {
      const k = l.t / l.max;
      ctx.strokeStyle = `rgba(255,60,50,${0.18 + 0.3 * (1 - k)})`;
      ctx.lineWidth = l.w;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(l.x1, l.y1);
      ctx.lineTo(l.x2, l.y2);
      ctx.stroke();
    }
    ctx.lineCap = 'butt';

    // 그림자
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    for (const e of this.enemies) {
      ctx.beginPath();
      ctx.ellipse(e.x, e.y + e.r * 0.2, e.r * 1.1, e.r * 0.42, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.beginPath();
    ctx.ellipse(this.p.x, this.p.y, 16, 6, 0, 0, Math.PI * 2);
    ctx.fill();

    // 몹과 주인공을 아래쪽이 앞에 오게
    const drawList: { y: number; f: () => void }[] = this.enemies.map((e) => ({ y: e.y, f: () => this.drawEnemy(e) }));
    drawList.push({ y: this.p.y, f: () => this.drawHero() });
    drawList.sort((a, b) => a.y - b.y);
    for (const d of drawList) d.f();

    // 탄
    for (const b of this.bullets) {
      ctx.fillStyle = b.boss ? 'rgba(200,80,255,0.35)' : 'rgba(255,140,40,0.35)';
      ctx.beginPath();
      ctx.arc(b.x, b.y, b.r * 2, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = b.boss ? '#e7a8ff' : '#ffb347';
      ctx.beginPath();
      ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2);
      ctx.fill();
    }
    // 장풍
    for (const o of this.orbs) {
      const g = ctx.createRadialGradient(o.x, o.y, 1, o.x, o.y, 16);
      g.addColorStop(0, 'rgba(255,255,255,1)');
      g.addColorStop(0.4, 'rgba(143,211,255,0.9)');
      g.addColorStop(1, 'rgba(80,160,255,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(o.x, o.y, 16, 0, Math.PI * 2);
      ctx.fill();
    }
    // 이펙트
    for (const q of this.parts) {
      ctx.globalAlpha = Math.min(1, q.life / q.max + 0.2);
      ctx.fillStyle = q.color;
      ctx.fillRect(q.x - q.size / 2, q.y - q.size / 2, q.size, q.size);
    }
    ctx.globalAlpha = 1;
    for (const sp of this.sprs) {
      const img = FX[sp.name];
      if (!ready(img)) continue;
      const k = sp.life / sp.max;
      ctx.save();
      ctx.globalAlpha = Math.min(1, k * 1.6);
      ctx.translate(sp.x, sp.y);
      ctx.rotate(sp.rot);
      const size = sp.size * (1.15 - k * 0.3);
      ctx.drawImage(img, -size / 2, (-size / 2) * (img.naturalHeight / img.naturalWidth), size, size * (img.naturalHeight / img.naturalWidth));
      ctx.restore();
    }
    for (const r of this.rings) {
      const k = r.life / r.max;
      ctx.strokeStyle = r.color;
      ctx.globalAlpha = k;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(r.x, r.y, r.r * (1.3 - k * 0.3), 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    ctx.textAlign = 'center';
    for (const t of this.texts) {
      const k = t.life / t.max;
      const pop = k > 0.8 ? 1 + (k - 0.8) * 2.5 : 1;
      ctx.font = `900 ${Math.round(t.size * pop)}px system-ui, sans-serif`;
      ctx.globalAlpha = Math.min(1, k * 2);
      ctx.lineWidth = 3;
      ctx.strokeStyle = 'rgba(0,0,0,0.7)';
      ctx.strokeText(t.text, t.x, t.y);
      ctx.fillStyle = t.color;
      ctx.fillText(t.text, t.x, t.y);
    }
    ctx.globalAlpha = 1;

    this.drawDomain();
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.drawScreenFx();
    this.drawCine();
    if (this.flashT > 0) {
      ctx.fillStyle = `rgba(255,255,255,${Math.min(1, this.flashT / 0.18) * 0.85})`;
      ctx.fillRect(0, 0, this.w, this.h);
    }
    this.drawHud();
  }

  /** 영역 전개: 원 밖은 어둡게, 경계는 빛나게 (세계 좌표에서) */
  private drawDomain() {
    if (this.domain <= 1) return;
    const ctx = this.ctx;
    const c = this.cast;
    const cx = c?.id === 'ult' ? c.sx : this.p.x;
    const cy = c?.id === 'ult' ? c.sy : this.p.y;
    const big = 4000;
    ctx.save();
    ctx.fillStyle = 'rgba(10,6,30,0.62)';
    ctx.beginPath();
    ctx.rect(cx - big, cy - big, big * 2, big * 2);
    ctx.arc(cx, cy, this.domain, 0, Math.PI * 2, true);
    ctx.fill('evenodd');
    // 안쪽은 금빛으로 살짝
    const g = ctx.createRadialGradient(cx, cy, this.domain * 0.2, cx, cy, this.domain);
    g.addColorStop(0, 'rgba(255,220,120,0)');
    g.addColorStop(1, 'rgba(255,200,80,0.22)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(cx, cy, this.domain, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,225,130,0.95)';
    ctx.lineWidth = 3;
    ctx.stroke();
    ctx.strokeStyle = 'rgba(255,225,130,0.35)';
    ctx.lineWidth = 9;
    ctx.stroke();
    // 경계를 도는 글자 무늬
    ctx.fillStyle = 'rgba(255,230,150,0.8)';
    ctx.font = '900 10px system-ui';
    ctx.textAlign = 'center';
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2 + this.time * 0.8;
      ctx.fillText('拳', cx + Math.cos(a) * (this.domain - 10), cy + Math.sin(a) * (this.domain - 10) + 3);
    }
    ctx.restore();
  }

  /** 필살기 연출 (화면 좌표): 컷인 · 줌인 · 영역 전개 · 암전 */
  private drawCine() {
    const cn = this.cine;
    if (!cn) return;
    const ctx = this.ctx;
    const k = 1 - cn.t / cn.max; // 0 → 1
    const w = this.w;
    const h = this.h;
    if (cn.style === 'cutin') {
      ctx.fillStyle = `rgba(0,0,0,${Math.min(0.65, k * 3)})`;
      ctx.fillRect(0, 0, w, h);
      // 비스듬한 띠가 오른쪽에서 미끄러져 들어와 멈췄다가 왼쪽으로 빠진다
      const inK = Math.min(1, k / 0.22);
      const outK = Math.max(0, (k - 0.82) / 0.18);
      const off = (1 - this.ease(inK)) * w * 1.2 - this.ease(outK) * w * 1.2;
      const bh = Math.min(170, h * 0.3);
      const cy = h * 0.45;
      ctx.save();
      ctx.translate(off, 0);
      ctx.beginPath();
      ctx.moveTo(-40, cy - bh / 2 + 30);
      ctx.lineTo(w + 40, cy - bh / 2 - 30);
      ctx.lineTo(w + 40, cy + bh / 2 - 30);
      ctx.lineTo(-40, cy + bh / 2 + 30);
      ctx.closePath();
      const g = ctx.createLinearGradient(0, cy - bh / 2, 0, cy + bh / 2);
      g.addColorStop(0, '#ffb347');
      g.addColorStop(1, '#d6402e');
      ctx.fillStyle = g;
      ctx.fill();
      ctx.clip();
      // 띠 안의 속도선
      ctx.strokeStyle = 'rgba(255,255,255,0.35)';
      ctx.lineWidth = 2;
      for (let i = 0; i < 18; i++) {
        const y = cy - bh / 2 + ((i * 37 + this.time * 900) % bh);
        const x = (i * 97) % w;
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x + 120, y - 8);
        ctx.stroke();
      }
      // 큰 주인공 (펀치 내지르는 프레임)
      const sh = this.sheets.punch;
      if (sh) {
        ctx.imageSmoothingEnabled = false;
        const size = bh * 1.5;
        ctx.drawImage(sh.img, 4 * CELL, 2 * CELL, CELL, CELL, w * 0.08, cy - size * 0.62, size, size);
      }
      ctx.restore();
      ctx.save();
      ctx.translate(off * 0.6, 0);
      ctx.textAlign = 'right';
      ctx.font = `900 ${Math.round(Math.min(64, w * 0.13))}px system-ui, sans-serif`;
      ctx.lineWidth = 8;
      ctx.strokeStyle = 'rgba(60,10,0,0.85)';
      ctx.strokeText('백열권!!', w * 0.94, cy + 18);
      ctx.fillStyle = '#fff6d8';
      ctx.fillText('백열권!!', w * 0.94, cy + 18);
      ctx.restore();
    } else if (cn.style === 'zoom') {
      // 화면 테두리가 어두워지고 가운데로 빨려 드는 선
      const cx = w / 2;
      const cy = h / 2;
      const g = ctx.createRadialGradient(cx, cy, Math.min(w, h) * (0.45 - k * 0.2), cx, cy, Math.max(w, h) * 0.7);
      g.addColorStop(0, 'rgba(0,0,0,0)');
      g.addColorStop(1, `rgba(0,0,0,${0.85 * k})`);
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
      ctx.strokeStyle = `rgba(255,255,255,${0.6 * k})`;
      ctx.lineWidth = 2;
      for (let i = 0; i < 40; i++) {
        const a = Math.random() * Math.PI * 2;
        const r1 = Math.max(w, h) * (0.2 + Math.random() * 0.2);
        const r2 = r1 + 80 + Math.random() * 120;
        ctx.beginPath();
        ctx.moveTo(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1);
        ctx.lineTo(cx + Math.cos(a) * r2, cy + Math.sin(a) * r2);
        ctx.stroke();
      }
      ctx.textAlign = 'center';
      ctx.font = `900 ${Math.round(28 + k * 20)}px system-ui, sans-serif`;
      ctx.globalAlpha = Math.min(1, k * 3);
      ctx.lineWidth = 6;
      ctx.strokeStyle = 'rgba(0,0,0,0.7)';
      ctx.strokeText('백열권', cx, h * 0.22);
      ctx.fillStyle = '#ffd23f';
      ctx.fillText('백열권', cx, h * 0.22);
      ctx.globalAlpha = 1;
    } else if (cn.style === 'domain') {
      ctx.textAlign = 'center';
      ctx.font = `900 ${Math.round(Math.min(40, w * 0.09))}px system-ui, sans-serif`;
      ctx.globalAlpha = Math.min(1, k * 3);
      ctx.lineWidth = 6;
      ctx.strokeStyle = 'rgba(20,10,40,0.85)';
      ctx.strokeText('영역 전개 · 백열권', w / 2, h * 0.2);
      ctx.fillStyle = '#ffe9a8';
      ctx.fillText('영역 전개 · 백열권', w / 2, h * 0.2);
      ctx.globalAlpha = 1;
    } else if (cn.style === 'blackout') {
      // 암전: 세상이 까맣게, 주인공만 하얗게 / 적은 빨갛게 실루엣
      ctx.fillStyle = 'rgba(0,0,0,0.94)';
      ctx.fillRect(0, 0, w, h);
      const s = this.scale;
      const toX = (x: number) => w / 2 + (x - this.camX) * s;
      const toY = (y: number) => h / 2 + (y - this.camY) * s;
      for (const e of this.enemies) {
        if (e.dead) continue;
        ctx.fillStyle = 'rgba(255,40,40,0.85)';
        ctx.beginPath();
        ctx.ellipse(toX(e.x), toY(e.y - e.r * 0.9 - e.z), e.r * s * 0.9, e.r * s * 1.1, 0, 0, Math.PI * 2);
        ctx.fill();
      }
      const sh = this.sheets.punch;
      if (sh) {
        const size = CELL * HERO_SCALE * s;
        const c = whiteOf(sh.img);
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(c, 1 * CELL, this.lastRow * CELL, CELL, CELL, toX(this.p.x) - size / 2, toY(this.p.y) - HERO_FOOT * HERO_SCALE * s, size, size);
      }
      // 눈빛 한 줄
      if (k > 0.5) {
        ctx.fillStyle = `rgba(255,255,255,${(k - 0.5) * 2})`;
        ctx.fillRect(0, h / 2 - 1, w, 2);
      }
    }
  }

  private ease(x: number) {
    return 1 - Math.pow(1 - Math.min(1, Math.max(0, x)), 3);
  }

  private drawGround() {
    const ctx = this.ctx;
    const g = 64;
    const left = this.camX - this.w / this.scale / 2 - g;
    const top = this.camY - this.h / this.scale / 2 - g;
    const right = this.camX + this.w / this.scale / 2 + g;
    const bottom = this.camY + this.h / this.scale / 2 + g;
    ctx.fillStyle = 'rgba(0,0,0,0.08)';
    for (let x = Math.floor(left / g) * g; x < right; x += g) {
      for (let y = Math.floor(top / g) * g; y < bottom; y += g) {
        const h = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453;
        const r = h - Math.floor(h);
        ctx.fillRect(x + r * 40, y + ((r * 7) % 1) * 40, 4 + r * 6, 3);
      }
    }
  }

  private drawEnemy(e: Enemy) {
    const ctx = this.ctx;
    const name = e.kind === 'boss' ? 'devil' : e.kind;
    const img = MON[name];
    // 기 모으기: 빨간 고리가 조여 든다 / 무너짐: 노란 별
    if (e.cast > 0 && e.stun <= 0) {
      const k = Math.min(1, e.cast / 0.6);
      ctx.strokeStyle = `rgba(255,70,50,${0.9 - k * 0.4})`;
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.arc(e.x, e.y - e.r * 0.6, e.r * (1.1 + k * 1.3), 0, Math.PI * 2);
      ctx.stroke();
    }
    if (ready(img)) {
      const frames = monFrames(img);
      const fh = img.naturalHeight;
      const f = Math.floor(e.phase * (e.stun > 0 ? 2 : 7)) % frames;
      const size = e.r * 2.9;
      // 맞으면 찌그러졌다가 돌아온다
      const sqx = 1 + e.sq * 0.25;
      const sqy = 1 - e.sq * 0.2;
      const jx = e.flash > 0 ? (Math.random() - 0.5) * 4 : 0;
      const dw = size * sqx;
      const dh = size * sqy;
      const x = e.x - dw / 2 + jx;
      const y = e.y + e.r * 0.3 - dh - e.z;
      ctx.drawImage(img, f * fh, 0, fh, fh, x, y, dw, dh);
      if (e.flash > 0) {
        ctx.globalAlpha = Math.min(1, e.flash / 0.09);
        ctx.drawImage(whiteOf(img), f * fh, 0, fh, fh, x, y, dw, dh);
        ctx.globalAlpha = 1;
      }
    } else {
      ctx.fillStyle = '#8c6';
      ctx.beginPath();
      ctx.arc(e.x, e.y - e.r, e.r, 0, Math.PI * 2);
      ctx.fill();
    }
    if (e.broken > 0) {
      for (let i = 0; i < 3; i++) {
        const a = e.phase * 5 + (i * Math.PI * 2) / 3;
        ctx.fillStyle = '#ffe066';
        ctx.font = '900 12px system-ui';
        ctx.fillText('★', e.x + Math.cos(a) * e.r, e.y - e.r * 2.3 + Math.sin(a) * 4);
      }
    }
    // 체력·경직 막대 (맞은 적과 보스만)
    if (e.hp < e.maxHp || e.kind === 'boss') {
      const w = e.kind === 'boss' ? 70 : e.r * 2.2;
      const x = e.x - w / 2;
      const y = e.y + e.r * 0.5;
      ctx.fillStyle = 'rgba(0,0,0,0.55)';
      ctx.fillRect(x - 1, y - 1, w + 2, 6);
      ctx.fillStyle = '#ff5c6c';
      ctx.fillRect(x, y, (w * Math.max(0, e.hp)) / e.maxHp, 3);
      ctx.fillStyle = e.broken > 0 ? '#ffe066' : '#c9d1e0';
      ctx.fillRect(x, y + 3, w * (e.broken > 0 ? 1 : e.poise / e.maxPoise), 1.5);
    }
  }

  private drawHero() {
    const ctx = this.ctx;
    const p = this.p;
    let action: HeroAction = 'idle';
    let frame = 0;
    const a = Math.atan2(p.fy, p.fx);
    const k = ((Math.round(a / (Math.PI / 4)) % 8) + 8) % 8;
    let row = ROW_OF_DIR8[k];
    const c = this.cast;
    if (c && (c.id === 'spin' || c.id === 'spindash' || c.id === 'spinwave')) {
      // 회오리: 방향을 빙글빙글 돌린다
      action = 'run';
      frame = 3;
      row = (row + Math.floor(c.t * 26)) % 8;
    } else if (c && c.id === 'rush') {
      action = c.t < 0.16 ? 'run' : 'jump';
      frame = c.t < 0.16 ? 3 : Math.min(4, 2 + Math.floor((c.t - 0.16) * 18));
    } else if (c && c.id === 'slam') {
      action = 'jump';
      frame = Math.min(7, Math.floor((c.t / 0.62) * 8));
    } else if (c && c.id === 'ult') {
      action = 'punch';
      frame = c.t < ULT_FLURRY ? 2 + (Math.floor(c.t * 30) % 3) : 4;
    } else if (this.dashT > 0 && this.isSlide) {
      // 슬라이딩: 낮게 웅크린 자세
      action = 'jump';
      frame = 6;
    } else if (this.dashT > 0) {
      action = 'run';
      frame = 3;
    } else if (this.atk) {
      action = 'punch';
      const st = STEPS[this.atk.step];
      frame = st.frames[Math.min(st.frames.length - 1, Math.floor((this.atk.t / st.dur) * st.frames.length))];
    } else if (p.moving > 0.05) {
      action = p.moving > 0.7 ? 'run' : 'walk';
      const sh = this.sheets[action];
      frame = sh ? Math.floor(p.animT * (action === 'run' ? 13 : 10)) % sh.frames : 0;
    } else {
      const sh = this.sheets.idle;
      frame = sh ? Math.floor(p.animT * 6) % sh.frames : 0;
    }
    const sheet = this.sheets[action] ?? this.sheets.idle;
    if (!sheet) return;
    if (!this.sheets[action]) void loadSheet(action).then((sh) => (this.sheets[action] = sh));
    this.lastRow = row;
    this.lastAction = this.sheets[action] ? action : 'idle';
    this.lastFrame = this.sheets[action] ? frame : 0;
    // 잔상 (돌진·필살)
    for (const g of this.ghosts) {
      const gs = this.sheets[g.action];
      if (!gs) continue;
      ctx.globalAlpha = (g.life / 0.22) * 0.45;
      ctx.drawImage(whiteOf(gs.img), g.frame * CELL, g.row * CELL, CELL, CELL, g.x - (CELL * HERO_SCALE) / 2, g.y - HERO_FOOT * HERO_SCALE, CELL * HERO_SCALE, CELL * HERO_SCALE);
    }
    ctx.globalAlpha = 1;
    if (p.invuln > 0 && this.dashT <= 0 && Math.floor(p.invuln * 20) % 2 === 0) ctx.globalAlpha = 0.45;
    ctx.imageSmoothingEnabled = false;
    const size = CELL * HERO_SCALE;
    ctx.drawImage(sheet.img, frame * CELL, row * CELL, CELL, CELL, p.x - size / 2, p.y - HERO_FOOT * HERO_SCALE, size, size);
    ctx.globalAlpha = 1;
    // 기 모으기 (제스처 모드): 단계마다 색이 바뀌는 고리 + 지금 나갈 기술 이름
    const ch = this.joy.charging;
    if (ch > 0) {
      const lv = CHARGE_LV.filter((t) => ch >= t).length;
      const nextT = CHARGE_LV[Math.min(lv, CHARGE_LV.length - 1)];
      const prevT = lv > 0 ? CHARGE_LV[lv - 1] : 0;
      const k = lv >= CHARGE_LV.length ? 1 : (ch - prevT) / (nextT - prevT);
      const colors = ['#9aa4b8', '#8fd3ff', '#ffb347', '#ff4d6d'];
      const names = ['', '장풍', '지진', this.cds.ult <= 0 ? '필살!' : '필살 (쿨타임)'];
      const cy = p.y - 30;
      ctx.lineWidth = 4;
      ctx.strokeStyle = 'rgba(0,0,0,0.4)';
      ctx.beginPath();
      ctx.arc(p.x, cy, 30, 0, Math.PI * 2);
      ctx.stroke();
      ctx.strokeStyle = colors[Math.min(lv + 1, 3)];
      ctx.beginPath();
      ctx.arc(p.x, cy, 30, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * Math.min(1, k));
      ctx.stroke();
      if (lv > 0) {
        ctx.fillStyle = colors[lv];
        ctx.globalAlpha = 0.25 + 0.15 * Math.sin(this.time * 20);
        ctx.beginPath();
        ctx.arc(p.x, cy, 22 + lv * 4, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1;
        ctx.textAlign = 'center';
        ctx.font = '900 13px system-ui, sans-serif';
        ctx.lineWidth = 3;
        ctx.strokeStyle = 'rgba(0,0,0,0.7)';
        ctx.strokeText(names[lv], p.x, cy - 40);
        ctx.fillStyle = colors[lv];
        ctx.fillText(names[lv], p.x, cy - 40);
      }
      if (Math.random() < 0.5) {
        const a = Math.random() * Math.PI * 2;
        this.part(p.x + Math.cos(a) * 40, cy + Math.sin(a) * 30, -Math.cos(a) * 90, -Math.sin(a) * 70, 0.3, colors[Math.min(lv + 1, 3)], 3, 0);
      }
    }
    // 반격 찬스: 몸에 파란 빛
    if (this.counterReady) {
      ctx.strokeStyle = 'rgba(143,211,255,0.9)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(p.x, p.y - 26, 24 + Math.sin(this.time * 20) * 2, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  /** 화면 전체: 마무리 타 속도선, 맞으면 빨간 테두리, 느려지면 파란 테두리 */
  private drawScreenFx() {
    const ctx = this.ctx;
    const cx = this.w / 2;
    const cy = this.h / 2;
    if (this.lines > 0) {
      ctx.strokeStyle = `rgba(255,255,255,${this.lines * 2})`;
      ctx.lineWidth = 2;
      for (let i = 0; i < 26; i++) {
        const a = Math.random() * Math.PI * 2;
        const r1 = Math.max(this.w, this.h) * (0.35 + Math.random() * 0.15);
        const r2 = r1 + 60 + Math.random() * 80;
        ctx.beginPath();
        ctx.moveTo(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1);
        ctx.lineTo(cx + Math.cos(a) * r2, cy + Math.sin(a) * r2);
        ctx.stroke();
      }
    }
    const edge = (color: string, k: number) => {
      const g = ctx.createRadialGradient(cx, cy, Math.min(this.w, this.h) * 0.35, cx, cy, Math.max(this.w, this.h) * 0.75);
      g.addColorStop(0, 'rgba(0,0,0,0)');
      g.addColorStop(1, color.replace('A', String(k)));
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, this.w, this.h);
    };
    if (this.hurtFlash > 0) edge('rgba(255,40,40,A)', this.hurtFlash * 1.6);
    if (this.slow > 0) edge('rgba(120,190,255,A)', 0.5);
  }

  private drawHud() {
    const ctx = this.ctx;
    const p = this.p;
    const top = 12 + (Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--sat')) || 0);
    // 체력
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.fillRect(12, top, 164, 16);
    ctx.fillStyle = p.hp / p.maxHp < 0.3 ? '#ff5c6c' : '#7cf2a0';
    ctx.fillRect(14, top + 2, (160 * Math.max(0, p.hp)) / p.maxHp, 12);
    ctx.fillStyle = '#fff';
    ctx.font = '800 11px system-ui, sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText(`HP ${Math.max(0, Math.ceil(p.hp))}`, 18, top + 12);
    if (this.run === 'horde') {
      const left = Math.max(0, Math.ceil(HORDE_SEC - this.time));
      ctx.fillText(`도파민 · 남은 ${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')} · 처치 ${this.kills}`, 12, top + 32);
    } else {
      const ctrl = this.mode === 'two' ? ' · 두 손' : this.mode === 'gesture' ? ' · 제스처' : this.mode === 'pilot' ? ' · 자동 이동' : this.mode === 'dodge' ? ' · 휙 회피' : ' · 자동';
      ctx.fillText(`도전 ${DIFFS[this.diff].name} · WAVE ${this.wave} · 처치 ${this.kills}${ctrl}`, 12, top + 32);
    }
    ctx.fillStyle = '#ffd23f';
    ctx.fillText(`🪙 ${Math.floor(this.gold)}${this.stars ? `  ⭐ ${this.stars}` : ''}`, 12, top + 48);
    // 연타 수
    if (this.hits >= 2) {
      ctx.textAlign = 'right';
      ctx.font = `900 ${26 + Math.min(14, this.hits)}px system-ui, sans-serif`;
      ctx.lineWidth = 4;
      ctx.strokeStyle = 'rgba(0,0,0,0.6)';
      ctx.strokeText(`${this.hits} HIT`, this.w - 16, top + 112);
      ctx.fillStyle = '#ffd23f';
      ctx.fillText(`${this.hits} HIT`, this.w - 16, top + 112);
    }
    if (this.bannerT > 0) {
      ctx.textAlign = 'center';
      ctx.font = '900 28px system-ui, sans-serif';
      ctx.globalAlpha = Math.min(1, this.bannerT * 2);
      ctx.lineWidth = 5;
      ctx.strokeStyle = 'rgba(0,0,0,0.6)';
      ctx.strokeText(this.banner, this.w / 2, this.h * 0.28);
      ctx.fillStyle = '#fff3d0';
      ctx.fillText(this.banner, this.w / 2, this.h * 0.28);
      ctx.globalAlpha = 1;
    }
    // 스킬 쿨타임 (한 손 모드: 아래 가운데에 작은 원)
    if (this.mode === 'one' || this.mode === 'gesture' || this.mode === 'dodge') {
      const list = HUD_SKILLS[this.mode === 'gesture' ? 'gesture' : 'one'];
      const n = list.length;
      const gap = 52;
      const by = this.h - 34 - (Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--sab')) || 0);
      list.forEach((id, i) => {
        const x = this.w / 2 + (i - (n - 1) / 2) * gap;
        const r = id === 'ult' ? 21 : 18;
        const cdk = this.cdRatio(id);
        ctx.fillStyle = cdk <= 0 ? (id === 'ult' ? 'rgba(214,64,46,0.85)' : 'rgba(40,60,100,0.85)') : 'rgba(0,0,0,0.55)';
        ctx.beginPath();
        ctx.arc(x, by, r, 0, Math.PI * 2);
        ctx.fill();
        if (cdk > 0) {
          ctx.fillStyle = 'rgba(255,255,255,0.18)';
          ctx.beginPath();
          ctx.moveTo(x, by);
          ctx.arc(x, by, r, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * (1 - cdk));
          ctx.fill();
        }
        ctx.strokeStyle = cdk <= 0 ? '#ffd23f' : 'rgba(255,255,255,0.3)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(x, by, r, 0, Math.PI * 2);
        ctx.stroke();
        ctx.fillStyle = '#fff';
        ctx.textAlign = 'center';
        ctx.font = '800 10px system-ui, sans-serif';
        ctx.fillText(SKILLS[id].short, x, by + 4);
      });
      // 휙 회피 모드: 스킬 줄 위에 회피 게이지
      if (this.mode === 'dodge') {
        const k = Math.max(0, this.dodgeCd / DODGE_CD);
        const w = 120;
        const x = this.w / 2 - w / 2;
        const y = by - 34;
        ctx.fillStyle = 'rgba(0,0,0,0.5)';
        ctx.fillRect(x, y, w, 8);
        ctx.fillStyle = k <= 0 ? '#8fd3ff' : 'rgba(143,211,255,0.45)';
        ctx.fillRect(x, y, w * (1 - k), 8);
        ctx.fillStyle = k <= 0 ? '#8fd3ff' : '#9aa4b8';
        ctx.font = '800 10px system-ui, sans-serif';
        ctx.fillText(k <= 0 ? '휙 = 회피 준비!' : '회피 충전 중', this.w / 2, y - 4);
      }
      if ((this.mode === 'gesture' || this.mode === 'dodge') && this.time < 10) {
        ctx.globalAlpha = Math.min(1, (10 - this.time) / 2);
        ctx.fillStyle = 'rgba(0,0,0,0.55)';
        const hint = this.mode === 'dodge' ? '끌기 이동 · 스킬은 자동 · 휙 = 회피 (1초)' : '톡 회오리 · 휙 슬라이딩 · 이어 붙이면 연계!';
        ctx.font = '700 12px system-ui, sans-serif';
        const tw = ctx.measureText(hint).width + 20;
        const hy = this.mode === 'dodge' ? by - 80 : by - 58;
        ctx.fillRect(this.w / 2 - tw / 2, hy, tw, 24);
        ctx.fillStyle = '#fff3d0';
        ctx.fillText(hint, this.w / 2, hy + 17);
        ctx.globalAlpha = 1;
      }
    }
    // 조이스틱
    const j = this.joy;
    if (j.active) {
      ctx.strokeStyle = 'rgba(255,255,255,0.35)';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(j.ox, j.oy, j.radius, 0, Math.PI * 2);
      ctx.stroke();
      const dx = j.x - j.ox;
      const dy = j.y - j.oy;
      const d = Math.min(j.radius, Math.hypot(dx, dy));
      const a = Math.atan2(dy, dx);
      ctx.fillStyle = 'rgba(255,255,255,0.5)';
      ctx.beginPath();
      ctx.arc(j.ox + Math.cos(a) * d, j.oy + Math.sin(a) * d, 22, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}
