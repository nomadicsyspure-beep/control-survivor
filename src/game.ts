import { CELL, loadSheet, type HeroAction, type Sheet } from './hero';
import { Joystick } from './input';
import { sfx } from './sfx';
import { FX, MON, monFrames, ready, whiteOf } from './sprites';
import type { Tuning } from './settings';

// 손맛 시험장: 격투 소년 하나, 적은 수의 단단한 몹(역할이 있다), 5웨이브마다 보스.
// 한 손 모드: 이동만 — 펀치 콤보와 장풍은 자동. 두 손 모드(테스트): 공격·회피·장풍 버튼.
// 타격감: 히트스톱 · 화면 흔들림 · 하얀 번쩍임 · 밀려남 · 경직 · 찌그러짐 · 불꽃 · 마무리 타는 속도선과 화면 당김.

export type PlayMode = 'one' | 'two';

/** 화면의 짧은 변에 보이는 세계 크기 (세로·가로 어느 쪽이든 위험 거리가 같게) */
const VIEW = 340;
/** 주인공 그림 크기 배율 (96px 칸 → 세계 단위) */
const HERO_SCALE = 1.0;
/** 칸 안에서 발이 닿는 높이 */
const HERO_FOOT = 92;

const ROW_OF_DIR8 = [2, 1, 0, 7, 6, 5, 4, 3]; // 각도 8칸(E, SE, S, SW, W, NW, N, NE) → 시트 행(S, SE, E, NE, N, NW, W, SW)

/** 콤보 단계: 길이, 맞는 순간, 쓸 프레임, 사거리, 피해, 밀어내기, 경직, 히트스톱, 흔들림 */
const STEPS = [
  { dur: 0.2, hitAt: 0.12, frames: [0, 1, 2], reach: 50, dmg: 10, knock: 220, stun: 0.18, stop: 0.045, shake: 3, poise: 10, lunge: 0 },
  { dur: 0.2, hitAt: 0.08, frames: [3, 4, 5], reach: 52, dmg: 13, knock: 260, stun: 0.22, stop: 0.055, shake: 4, poise: 14, lunge: 0 },
  { dur: 0.32, hitAt: 0.15, frames: [1, 2, 3, 4, 4, 5], reach: 66, dmg: 26, knock: 560, stun: 0.5, stop: 0.11, shake: 10, poise: 30, lunge: 260 },
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
}

interface Bullet { x: number; y: number; vx: number; vy: number; r: number; dmg: number; life: number; boss: boolean }
interface Orb { x: number; y: number; vx: number; vy: number; life: number; hit: Set<Enemy> }
interface Particle { x: number; y: number; vx: number; vy: number; life: number; max: number; color: string; size: number; grav: number }
interface Text { x: number; y: number; text: string; color: string; size: number; life: number; max: number }
interface Spr { name: string; x: number; y: number; size: number; life: number; max: number; rot: number }
interface Ring { x: number; y: number; r: number; life: number; max: number; color: string }
interface Lane { x1: number; y1: number; x2: number; y2: number; w: number; t: number; max: number }

export interface GameResult {
  wave: number;
  kills: number;
  bestCombo: number;
  time: number;
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
  readonly press = { attack: false, dash: false, wave: false };

  constructor(host: HTMLElement, readonly mode: PlayMode, private readonly tuning: Tuning, private readonly onEnd: (r: GameResult) => void) {
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'game-canvas';
    host.append(this.canvas);
    this.ctx = this.canvas.getContext('2d')!;
    this.joy = new Joystick(host);
    this.joy.leftOnly = mode === 'two';
    for (const a of ['idle', 'walk', 'run', 'punch'] as HeroAction[]) void loadSheet(a).then((s) => (this.sheets[a] = s));
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
    this.nextWave();
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
    const d = 280 + Math.random() * 60;
    const k = 1 + (this.wave - 1) * 0.12;
    const base: Record<Kind, [number, number, number, number, number]> = {
      // r, hp, speed, dmg, poise
      slime: [12, 36, 72, 8, 20],
      bat: [11, 28, 95, 7, 16],
      golem: [17, 120, 46, 14, 70],
      boss: [32, 900, 52, 18, 220],
    };
    const [r, hp, speed, dmg, poise] = base[kind];
    this.enemies.push({
      kind, x: this.p.x + Math.cos(a) * d, y: this.p.y + Math.sin(a) * d, r, hp: hp * k, maxHp: hp * k, speed, dmg: dmg * (1 + (this.wave - 1) * 0.06),
      vx: 0, vy: 0, flash: 0, stun: 0, poise, maxPoise: poise, broken: 0, sq: 0, cd: 1.5 + Math.random() * 1.5, cast: 0, dashT: 0, dx: 0, dy: 0,
      pat: 0, volN: 0, volT: 0, phase: Math.random() * 6, dead: false,
    });
  }

  // ---------------- 갱신 ----------------

  private update(real: number) {
    // 히트스톱: 세상은 멈추고 흔들림만 줄어든다
    if (this.stop > 0) {
      this.stop -= real;
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

    this.updatePlayer(dt);
    this.updateEnemies(dt);
    this.updateShots(dt);
    this.updateFx(dt);

    // 다음 웨이브: 거의 다 잡았거나 오래 걸리면
    this.waveT += dt;
    const alive = this.enemies.filter((e) => !e.dead).length;
    const bossAlive = this.enemies.some((e) => !e.dead && e.kind === 'boss');
    if (!bossAlive && (alive <= 1 || this.waveT > 22)) this.nextWave();

    // 카메라
    this.camX += (this.p.x - this.camX) * Math.min(1, 8 * dt);
    this.camY += (this.p.y - this.camY) * Math.min(1, 8 * dt);
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
    const mv = this.joy.move;
    const ml = Math.hypot(mv.x, mv.y);
    p.moving = ml;

    // 두 손 모드 버튼 (키보드 J·K·L도)
    const two = this.mode === 'two';
    const wantAtk = two && (this.press.attack || this.joy.pressed('j'));
    const wantDash = two && (this.press.dash || this.joy.pressed('k'));
    const wantWave = two && (this.press.wave || this.joy.pressed('l'));
    this.press.attack = this.press.dash = this.press.wave = false;

    // 회피 (두 손 모드)
    if (wantDash && this.dashCd <= 0 && this.dashT <= 0) {
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
      p.x += this.dashX * DASH_SPEED * dt;
      p.y += this.dashY * DASH_SPEED * dt;
      if (Math.random() < 0.7) this.part(p.x, p.y - 4, 0, 0, 0.25, 'rgba(220,235,255,0.7)', 5, 0);
      p.fx = this.dashX;
      p.fy = this.dashY;
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
      const autoGo = !two && far && Math.hypot(far.x - p.x, far.y - p.y) > 110;
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
      if (cos < Math.cos((70 * Math.PI) / 180) && d > e.r + 6) continue;
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
    const v = Math.round(dmg * brokenMul * (crit ? 2 : 1) * (0.9 + Math.random() * 0.2));
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
        this.text(e.x, e.y - e.r * 2.6, '무너짐!', '#ffd23f', e.kind === 'boss' ? 22 : 16);
        this.ring(e.x, e.y - e.r * 0.6, e.r * 2.4, 0.35, '#ffd23f');
        this.stop = Math.max(this.stop, 0.08 * this.tuning.hitstop);
      }
    }
    this.text(hx, hy - 14, String(v), crit ? '#ffb347' : '#ffffff', crit ? 20 + power * 2 : 13 + power * 2);
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

  private hurtPlayer(dmg: number, fx: number, fy: number) {
    const p = this.p;
    if (p.invuln > 0 || p.dead) return;
    p.hp -= dmg;
    p.invuln = 0.7;
    const dx = p.x - fx;
    const dy = p.y - fy;
    const d = Math.hypot(dx, dy) || 1;
    p.kx = (dx / d) * 260;
    p.ky = (dy / d) * 260;
    this.shake = Math.max(this.shake, 6 * this.tuning.shake);
    this.hurtFlash = 0.35;
    this.text(p.x, p.y - 56, `-${Math.round(dmg)}`, '#ff6b6b', 15);
    this.atk = null;
    sfx.hurt();
    if (p.hp <= 0) {
      p.dead = true;
      this.banner = '쓰러졌다…';
      this.bannerT = 99;
      setTimeout(() => {
        this.running = false;
        this.onEnd({ wave: this.wave, kills: this.kills, bestCombo: this.bestCombo, time: this.time });
      }, 1200);
    }
  }

  private updateEnemies(dt: number) {
    const p = this.p;
    for (const e of this.enemies) {
      if (e.dead) continue;
      e.flash -= dt;
      e.sq = Math.max(0, e.sq - 6 * dt);
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
        if (e.cd <= 0 && e.kind !== 'slime' && d < 300) {
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
      if (d < e.r + p.r && e.stun <= 0) this.hurtPlayer(e.dmg, e.x, e.y);
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
      for (const k of spread) this.shoot(e.x, e.y - 8, a + k, 190, e.dmg, false);
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
        for (let i = 0; i < n; i++) this.shoot(e.x, e.y - 10, a + (i / (n - 1) - 0.5) * 0.7, 220, e.dmg * 0.6, true);
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
            this.shoot(e.x, e.y - 10, off + (i / n) * Math.PI * 2, 150, e.dmg * 0.6, true);
            this.shoot(e.x, e.y - 10, off + ((i + 0.5) / n) * Math.PI * 2, 105, e.dmg * 0.6, true);
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
        if (Math.hypot(e.x - o.x, e.y - e.r * 0.5 - o.y) > e.r + 10) continue;
        o.hit.add(e);
        const sp = Math.hypot(o.vx, o.vy) || 1;
        this.damage(e, WAVE_DMG, o.vx / sp, o.vy / sp, 200 * this.tuning.knock, 0.15, 8, 1, o.x, o.y);
        this.stop = Math.max(this.stop, 0.03 * this.tuning.hitstop);
        this.shake = Math.max(this.shake, 2 * this.tuning.shake);
        o.life = 0;
        break;
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
    const s = this.scale * (1 + this.zoom * 0.04);
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

    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.drawScreenFx();
    this.drawHud();
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
      const y = e.y + e.r * 0.3 - dh;
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
    const row = ROW_OF_DIR8[k];
    if (this.dashT > 0) {
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
    if (p.invuln > 0 && this.dashT <= 0 && Math.floor(p.invuln * 20) % 2 === 0) ctx.globalAlpha = 0.45;
    ctx.imageSmoothingEnabled = false;
    const size = CELL * HERO_SCALE;
    ctx.drawImage(sheet.img, frame * CELL, row * CELL, CELL, CELL, p.x - size / 2, p.y - HERO_FOOT * HERO_SCALE, size, size);
    ctx.globalAlpha = 1;
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
    ctx.fillText(`WAVE ${this.wave} · 처치 ${this.kills}${this.mode === 'two' ? ' · 두 손 (테스트)' : ''}`, 12, top + 32);
    // 연타 수
    if (this.hits >= 2) {
      ctx.textAlign = 'right';
      ctx.font = `900 ${26 + Math.min(14, this.hits)}px system-ui, sans-serif`;
      ctx.lineWidth = 4;
      ctx.strokeStyle = 'rgba(0,0,0,0.6)';
      ctx.strokeText(`${this.hits} HIT`, this.w - 16, top + 70);
      ctx.fillStyle = '#ffd23f';
      ctx.fillText(`${this.hits} HIT`, this.w - 16, top + 70);
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
