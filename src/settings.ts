import { ACTIONS, CELL, DIR_NAMES, drawFrame, loadSheet, type HeroAction } from './hero';

// 설정: 손맛 수치(히트스톱·화면 흔들림·밀려남)와 캐릭터 보기. 수치는 이 기기에 저장한다.

/** 필살기 연출: 컷인 · 줌인 · 영역 전개 · 암전 · 없음 · 랜덤(돌아가며) */
export type UltStyle = 'cutin' | 'zoom' | 'domain' | 'blackout' | 'none' | 'random';
export const ULT_STYLES: [UltStyle, string][] = [
  ['cutin', '컷인'], ['zoom', '줌인'], ['domain', '영역 전개'], ['blackout', '암전'], ['none', '없음'], ['random', '돌아가며'],
];

export interface Tuning {
  /** 필살기 연출 */
  ultStyle: UltStyle;
  /** 테스트: 스킬·필살기 쿨타임 없애기 */
  noCd: boolean;
  /** 도움: 적 탄 느리게 (×0.75) */
  slowBullets: boolean;
  /** 자동 이동 켜 두기 (게임 안 버튼으로 바꾼다. 자동 이동 + 스킬 버튼 조작은 늘 켜고 시작) */
  autoMove: boolean;
  /** 가볍게 모드: 해상도 1배, 파티클 적게 (느린 폰용) */
  lite: boolean;
  /** 성능 표시 (FPS · 프레임 ms) */
  showFps: boolean;
  /** 맞힌 순간 멈춤 배율 */
  hitstop: number;
  /** 화면 흔들림 배율 */
  shake: number;
  /** 적이 밀려나는 거리 배율 */
  knock: number;
}

const KEY = 'control-survivor.settings.v1';
export const DEFAULT_TUNING: Tuning = { ultStyle: 'cutin', noCd: false, slowBullets: false, autoMove: false, lite: false, showFps: false, hitstop: 1, shake: 1, knock: 1 };

export function loadTuning(): Tuning {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { ...DEFAULT_TUNING, ...(JSON.parse(raw) as Partial<Tuning>) };
  } catch {
    // 저장소를 못 쓰면 기본값
  }
  return { ...DEFAULT_TUNING };
}

export function saveTuning(t: Tuning) {
  try {
    localStorage.setItem(KEY, JSON.stringify(t));
  } catch {
    // 무시
  }
}

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', text = '') => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text) e.textContent = text;
  return e;
};

/** 캐릭터 보기: 동작 버튼 + 방향 돌리기. 창이 닫히면 멈춘다 */
function heroViewer() {
  const box = el('div', 'viewer');
  const canvas = el('canvas', 'viewer-canvas');
  const scale = 3;
  canvas.width = CELL * scale;
  canvas.height = CELL * scale;
  const label = el('div', 'viewer-label');
  let action: HeroAction = 'idle';
  let dir = 0;
  let spin = true;
  let t0 = performance.now();
  let raf = 0;

  const draw = async () => {
    const def = ACTIONS.find((a) => a.id === action)!;
    const sheet = await loadSheet(action);
    const ctx = canvas.getContext('2d')!;
    const now = performance.now();
    // 저절로 돌리기: 2초마다 다음 방향
    if (spin && now - t0 > 2000) {
      t0 = now;
      dir = (dir + 1) % 8;
    }
    const f = Math.floor(((now / 1000) * def.fps) % sheet.frames);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    // 발밑 그림자
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.beginPath();
    ctx.ellipse(canvas.width / 2, canvas.height - 14, 46, 12, 0, 0, Math.PI * 2);
    ctx.fill();
    drawFrame(ctx, sheet, dir, f, 0, 0, scale);
    label.textContent = `${def.name} · ${DIR_NAMES[dir]} · ${sheet.frames}프레임${spin ? ' · 자동 회전' : ''}`;
    if (box.isConnected) raf = requestAnimationFrame(() => void draw());
  };

  const acts = el('div', 'viewer-acts');
  for (const a of ACTIONS) {
    const b = el('button', 'chip', a.name);
    b.addEventListener('click', () => {
      action = a.id;
      for (const x of acts.children) x.classList.toggle('on', x === b);
    });
    if (a.id === action) b.classList.add('on');
    acts.append(b);
  }
  const rot = el('div', 'viewer-rot');
  const left = el('button', 'chip', '◀');
  const spinBtn = el('button', 'chip on', '자동 회전');
  const right = el('button', 'chip', '▶');
  left.addEventListener('click', () => {
    spin = false;
    spinBtn.classList.remove('on');
    dir = (dir + 1) % 8;
  });
  right.addEventListener('click', () => {
    spin = false;
    spinBtn.classList.remove('on');
    dir = (dir + 7) % 8;
  });
  spinBtn.addEventListener('click', () => {
    spin = !spin;
    spinBtn.classList.toggle('on', spin);
    t0 = performance.now();
  });
  rot.append(left, spinBtn, right);
  box.append(canvas, label, acts, rot);
  requestAnimationFrame(() => void draw());
  return { box, stop: () => cancelAnimationFrame(raf) };
}

function slider(name: string, value: number, onChange: (v: number) => void) {
  const row = el('label', 'slider-row');
  const title = el('span', 'slider-name', name);
  const val = el('b', 'slider-val', `×${value.toFixed(1)}`);
  const input = el('input');
  input.type = 'range';
  input.min = '0';
  input.max = '3';
  input.step = '0.1';
  input.value = String(value);
  input.addEventListener('input', () => {
    const v = Number(input.value);
    val.textContent = `×${v.toFixed(1)}`;
    onChange(v);
  });
  row.append(title, input, val);
  return row;
}

/** 설정 창 (캐릭터 보기 + 손맛 수치). 닫을 때 onClose */
export function openSettings(tuning: Tuning, onClose: () => void) {
  const overlay = el('div', 'overlay');
  const modal = el('div', 'modal');
  const viewer = heroViewer();
  const tune = el('div', 'tune');
  tune.append(
    el('div', 'section-title', '손맛 조절'),
    slider('히트스톱 (맞힌 순간 멈춤)', tuning.hitstop, (v) => {
      tuning.hitstop = v;
      saveTuning(tuning);
    }),
    slider('화면 흔들림', tuning.shake, (v) => {
      tuning.shake = v;
      saveTuning(tuning);
    }),
    slider('적 밀려남', tuning.knock, (v) => {
      tuning.knock = v;
      saveTuning(tuning);
    }),
  );
  // 필살기 연출 고르기 + 쿨타임 없애기 (테스트)
  const ult = el('div', 'tune');
  const chips = el('div', 'viewer-acts');
  for (const [id, name] of ULT_STYLES) {
    const b = el('button', 'chip' + (tuning.ultStyle === id ? ' on' : ''), name);
    b.addEventListener('click', () => {
      tuning.ultStyle = id;
      saveTuning(tuning);
      for (const x of chips.children) x.classList.toggle('on', x === b);
    });
    chips.append(b);
  }
  const noCd = el('button', 'chip' + (tuning.noCd ? ' on' : ''), `쿨타임 없애기 (테스트): ${tuning.noCd ? 'ON' : 'OFF'}`);
  noCd.addEventListener('click', () => {
    tuning.noCd = !tuning.noCd;
    saveTuning(tuning);
    noCd.classList.toggle('on', tuning.noCd);
    noCd.textContent = `쿨타임 없애기 (테스트): ${tuning.noCd ? 'ON' : 'OFF'}`;
  });
  const slow = el('button', 'chip' + (tuning.slowBullets ? ' on' : ''), `도움: 적 탄 느리게 ${tuning.slowBullets ? 'ON' : 'OFF'}`);
  slow.addEventListener('click', () => {
    tuning.slowBullets = !tuning.slowBullets;
    saveTuning(tuning);
    slow.classList.toggle('on', tuning.slowBullets);
    slow.textContent = `도움: 적 탄 느리게 ${tuning.slowBullets ? 'ON' : 'OFF'}`;
  });
  const toggle = (key: 'lite' | 'showFps', label: string) => {
    const b = el('button', 'chip' + (tuning[key] ? ' on' : ''), `${label} ${tuning[key] ? 'ON' : 'OFF'}`);
    b.addEventListener('click', () => {
      tuning[key] = !tuning[key];
      saveTuning(tuning);
      b.classList.toggle('on', tuning[key]);
      b.textContent = `${label} ${tuning[key] ? 'ON' : 'OFF'}`;
    });
    return b;
  };
  ult.append(
    el('div', 'section-title', '필살기 연출 (백열권)'), chips, noCd,
    el('div', 'section-title', '도움'), slow,
    el('div', 'section-title', '성능 (가볍게 모드는 다음 판부터)'), toggle('lite', '가볍게 모드'), toggle('showFps', '성능 표시'),
  );
  const close = el('button', 'btn primary', '닫기');
  const done = () => {
    viewer.stop();
    overlay.remove();
    onClose();
  };
  close.addEventListener('click', done);
  modal.append(el('div', 'modal-title', '⚙️ 설정'), el('div', 'section-title', '캐릭터'), viewer.box, ult, tune, close);
  overlay.append(modal);
  document.body.append(overlay);
}
