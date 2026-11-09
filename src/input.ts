// 입력: 플로팅 조이스틱(누른 자리에 생긴다) + PC 확인용 WASD/방향키.
// 한 손 모드: 화면 아무 데나. 두 손 모드: 화면 왼쪽 절반만 조이스틱 (오른쪽은 버튼).

export interface Vec {
  x: number;
  y: number;
}

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
    });
    window.addEventListener('pointermove', (e) => {
      if (!this.active || e.pointerId !== this.id) return;
      this.x = e.clientX;
      this.y = e.clientY;
    });
    const up = (e: PointerEvent) => {
      if (e.pointerId === this.id) this.release();
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
