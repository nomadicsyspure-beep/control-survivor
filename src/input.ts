// 입력: 플로팅 조이스틱(누른 자리에 생긴다) + PC 확인용 WASD/방향키.
// 한 손 모드: 화면 아무 데나. 두 손 모드: 화면 왼쪽 절반만 조이스틱 (오른쪽은 버튼).

export interface Vec {
  x: number;
  y: number;
}

/** 제스처 (제스처 모드): 톡 = 짧게 누르고 떼기 · 휙 = 빠르게 짧게 긋기 · 기 모으기 = 제자리에서 꾹 눌렀다 떼기 */
export type Gesture = { type: 'tap' } | { type: 'flick'; dx: number; dy: number } | { type: 'charge'; t: number };

/** 제스처 판정 기준 */
const TAP_MS = 200;
const TAP_MOVE = 12;
const FLICK_MS = 230;
const FLICK_DIST = 45;
/** 이만큼 안 움직이고 누르고 있으면 기 모으기 */
export const CHARGE_START = 0.28;
const CHARGE_MOVE = 16;

export class Joystick {
  active = false;
  ox = 0;
  oy = 0;
  x = 0;
  y = 0;
  readonly radius = 56;
  private id = -1;
  private keys = new Set<string>();
  /** 조이스틱을 받을 영역 (두 손 모드는 왼쪽 절반) */
  leftOnly = false;
  /** 제스처를 읽을지 (제스처 모드) */
  gestures = false;
  /** 꾹 눌러 기 모으기 (지금은 끔: 연계로 바꿈) */
  chargeOn = false;
  private downAt = 0;
  private maxMove = 0;
  private queue: Gesture[] = [];

  constructor(el: HTMLElement) {
    el.addEventListener('pointerdown', (e) => {
      if (this.active) return;
      if (this.leftOnly && e.clientX > window.innerWidth / 2) return;
      // 버튼 위를 누른 건 무시
      if ((e.target as HTMLElement).closest('button')) return;
      this.active = true;
      this.id = e.pointerId;
      this.ox = this.x = e.clientX;
      this.oy = this.y = e.clientY;
      this.downAt = performance.now();
      this.maxMove = 0;
    });
    window.addEventListener('pointermove', (e) => {
      if (!this.active || e.pointerId !== this.id) return;
      this.x = e.clientX;
      this.y = e.clientY;
      this.maxMove = Math.max(this.maxMove, Math.hypot(this.x - this.ox, this.y - this.oy));
    });
    const up = (e: PointerEvent) => {
      if (e.pointerId !== this.id) return;
      if (this.gestures) {
        const ms = performance.now() - this.downAt;
        const dx = this.x - this.ox;
        const dy = this.y - this.oy;
        const d = Math.hypot(dx, dy);
        if (this.charging > 0) this.queue.push({ type: 'charge', t: this.charging });
        else if (ms < TAP_MS && this.maxMove < TAP_MOVE) this.queue.push({ type: 'tap' });
        else if (ms < FLICK_MS && d > FLICK_DIST) this.queue.push({ type: 'flick', dx: dx / d, dy: dy / d });
      }
      this.release();
    };
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
    window.addEventListener('keydown', (e) => this.keys.add(e.key.toLowerCase()));
    window.addEventListener('keyup', (e) => this.keys.delete(e.key.toLowerCase()));
  }

  release() {
    this.active = false;
    this.id = -1;
  }

  /** 기 모으는 중이면 모은 시간(초), 아니면 0. 제자리에서 꾹 누르고 있을 때만 */
  get charging() {
    if (!this.gestures || !this.chargeOn || !this.active || this.maxMove > CHARGE_MOVE) return 0;
    const t = (performance.now() - this.downAt) / 1000;
    return t >= CHARGE_START ? t - CHARGE_START : 0;
  }

  /** 쌓인 제스처를 꺼낸다 */
  takeGestures() {
    const q = this.queue;
    this.queue = [];
    return q;
  }

  /** 키보드로 움직이는 중인지 */
  get keyMoving() {
    const k = this.keys;
    return k.has('w') || k.has('a') || k.has('s') || k.has('d') || k.has('arrowup') || k.has('arrowdown') || k.has('arrowleft') || k.has('arrowright');
  }

  /** 이동 입력 (길이 0~1) */
  get move(): Vec {
    const k = this.keys;
    const kx = (k.has('d') || k.has('arrowright') ? 1 : 0) - (k.has('a') || k.has('arrowleft') ? 1 : 0);
    const ky = (k.has('s') || k.has('arrowdown') ? 1 : 0) - (k.has('w') || k.has('arrowup') ? 1 : 0);
    if (kx || ky) {
      const l = Math.hypot(kx, ky);
      return { x: kx / l, y: ky / l };
    }
    if (!this.active) return { x: 0, y: 0 };
    // 기 모으는 중엔 제자리
    if (this.charging > 0) return { x: 0, y: 0 };
    const dx = this.x - this.ox;
    const dy = this.y - this.oy;
    const d = Math.hypot(dx, dy);
    if (d < 6) return { x: 0, y: 0 };
    const m = Math.min(1, d / this.radius);
    return { x: (dx / d) * m, y: (dy / d) * m };
  }

  /** 키보드 버튼 (두 손 모드 PC 확인용): J 공격 · K 회피 · L 장풍 */
  pressed(key: string) {
    return this.keys.has(key);
  }
}
