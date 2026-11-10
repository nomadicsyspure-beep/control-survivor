import './style.css';
import { Game, SKILLS, type GameResult, type PlayMode, type SkillId } from './game';
import { loadTuning, openSettings } from './settings';
import { unlockAudio } from './sfx';

// 컨트롤뱀서: 손맛 시험장.
// 한 손 모드(기본) = 이동만, 펀치·장풍 자동. 두 손 모드(테스트) = 공격·회피·장풍 버튼.

const root = document.getElementById('root')!;
const tuning = loadTuning();
let game: Game | null = null;

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', text = '') => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text) e.textContent = text;
  return e;
};

window.addEventListener('pointerdown', () => unlockAudio(), { once: true });

function showTitle() {
  game?.destroy();
  game = null;
  root.className = 'title-root';
  root.replaceChildren();
  const box = el('div', 'title-screen');
  const one = el('button', 'btn primary big', '한 손 모드');
  one.append(el('small', '', '이동만 · 펀치와 장풍은 자동'));
  const two = el('button', 'btn big', '두 손 모드 (테스트)');
  two.append(el('small', '', '왼손 이동 · 오른손 공격 · 회피 · 장풍'));
  const ges = el('button', 'btn big', '제스처 모드 (한 손)');
  ges.append(el('small', '', '끌기 이동 · 톡 회오리 · 휙 슬라이딩 · 이어 붙이면 연계 기술'));
  ges.addEventListener('click', () => startGame('gesture'));
  one.addEventListener('click', () => startGame('one'));
  two.addEventListener('click', () => startGame('two'));
  const set = el('button', 'btn', '⚙️ 설정');
  set.addEventListener('click', () => openSettings(tuning, () => {}));
  box.append(
    el('h1', '', '컨트롤뱀서'),
    el('p', 'sub', '손맛 시험장'),
    one,
    ges,
    two,
    set,
    el('p', 'build', `빌드 ${new Date(__BUILD_TIME__).toLocaleString('ko-KR')}`),
  );
  root.append(box);
}

function startGame(mode: PlayMode) {
  root.className = 'game-root';
  root.replaceChildren();
  game = new Game(root, mode, tuning, showResult);
  const g = game;
  // 위: 일시정지(설정)
  const pause = el('button', 'icon-btn pause-btn', '⏸');
  pause.addEventListener('click', () => {
    g.paused = true;
    g.joy.release();
    openSettings(tuning, () => {
      g.paused = false;
    });
  });
  const quit = el('button', 'icon-btn quit-btn', '✕');
  quit.addEventListener('click', () => showTitle());
  root.append(pause, quit);
  // 두 손 모드: 오른손 버튼
  if (mode === 'two') {
    const pad = el('div', 'action-pad');
    const btn = (cls: string, label: string, key: 'attack' | 'dash' | 'wave' | SkillId) => {
      const b = el('button', `act ${cls}`, label);
      b.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        g.press[key] = true;
      });
      return b;
    };
    pad.append(btn('act-wave', '장풍', 'wave'), btn('act-dash', '회피', 'dash'), btn('act-atk', '공격', 'attack'));
    // 스킬 버튼 (쿨타임이 돌면 아래부터 차오른다)
    const skillBtns = (['spin', 'rush', 'slam', 'ult'] as SkillId[]).map((id) => {
      const b = btn(`act-skill act-${id}`, SKILLS[id].short, id);
      pad.append(b);
      return { id, b };
    });
    root.append(pad);
    const tick = () => {
      if (!g.running) return;
      for (const { id, b } of skillBtns) {
        const k = g.cdRatio(id);
        b.style.setProperty('--cd', String(k));
        b.classList.toggle('ready', k <= 0);
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }
  game.start();
}

function showResult(r: GameResult) {
  const overlay = el('div', 'overlay');
  const modal = el('div', 'modal');
  const again = el('button', 'btn primary', '다시 하기');
  const home = el('button', 'btn', '처음으로');
  const mode = game?.mode ?? 'one';
  again.addEventListener('click', () => {
    overlay.remove();
    startGame(mode);
  });
  home.addEventListener('click', () => {
    overlay.remove();
    showTitle();
  });
  const sec = Math.floor(r.time);
  modal.append(
    el('div', 'modal-title', '쓰러졌다…'),
    el('p', 'result-line', `WAVE ${r.wave} · 처치 ${r.kills}`),
    el('p', 'result-line', `최고 연타 ${r.bestCombo} HIT · ${Math.floor(sec / 60)}분 ${sec % 60}초`),
    again,
    home,
  );
  overlay.append(modal);
  document.body.append(overlay);
}

showTitle();
