import './style.css';
import { Game, SKILLS, type GameResult, type PlayMode, type RunKind, type SkillId } from './game';
import { loadTuning, openSettings, saveTuning } from './settings';
import { unlockAudio } from './sfx';
import {
  DIFFS, SKILL_UP_NAMES, STAT_NAMES, loadSave, skillCost, statCost, writeSave, type SkillUp, type StatUp,
} from './save';

// 컨트롤뱀서: 두 모드가 같은 성장을 쓴다.
// 🔥 도파민 모드 = 3분 동안 몰려오는 몹을 한 손 자동으로 쓸어 담기 → 골드
// ⚔️ 도전 모드 = 웨이브·보스·탄막, 조작 고르기(자동 · 제스처 · 두 손) · 난이도 → 골드 + 별
// 💪 성장 = 골드로 공격력·체력, 별로 스킬 강화 (두 모드 모두에 적용)

const root = document.getElementById('root')!;
const tuning = loadTuning();
const save = loadSave();
/** 마지막에 고른 도전 조작·난이도 (다시 하기용) */
let lastControl: PlayMode = 'one';
let lastRun: RunKind = 'horde';
let lastDiff = 0;
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
  const purse = el('div', 'purse', `🪙 ${save.gold}   ⭐ ${save.stars}`);
  const horde = el('button', 'btn primary big', '🔥 도파민 모드');
  horde.append(el('small', '', '3분 동안 몰려오는 몹을 쓸어 담기 · 스킬 자동 · 휙 = 회피 · 골드'));
  horde.addEventListener('click', () => startGame('dodge', 'horde', 0));
  const chal = el('button', 'btn big danger', '⚔️ 도전 모드');
  chal.append(el('small', '', '탄막·보스 · 조작과 난이도 고르기 · 골드 + 별'));
  chal.addEventListener('click', () => showChallenge());
  const grow = el('button', 'btn big', '💪 성장');
  grow.append(el('small', '', '골드로 공격력·체력 · 별로 스킬 강화'));
  grow.addEventListener('click', () => showGrowth(() => (purse.textContent = `🪙 ${save.gold}   ⭐ ${save.stars}`)));
  const set = el('button', 'btn', '⚙️ 설정');
  set.addEventListener('click', () => openSettings(tuning, () => {}));
  box.append(
    el('h1', '', '컨트롤뱀서'),
    purse,
    horde,
    chal,
    grow,
    set,
    el('p', 'build', `빌드 ${new Date(__BUILD_TIME__).toLocaleString('ko-KR')}`),
  );
  root.append(box);
}

/** 도전 모드: 난이도와 조작 고르기 */
function showChallenge() {
  const overlay = el('div', 'overlay');
  const modal = el('div', 'modal');
  let diff = lastDiff;
  const chips = el('div', 'viewer-acts');
  DIFFS.forEach((d, i) => {
    const b = el('button', 'chip' + (i === diff ? ' on' : ''), `${d.name} · 최고 WAVE ${save.best[i]}`);
    b.addEventListener('click', () => {
      diff = i;
      for (const x of chips.children) x.classList.toggle('on', x === b);
    });
    chips.append(b);
  });
  const go = (control: PlayMode) => {
    overlay.remove();
    startGame(control, 'challenge', diff);
  };
  const auto = el('button', 'btn primary', '자동 (한 손)');
  auto.append(el('small', '', '이동만 · 펀치·스킬 자동 (자동으로도 진행돼요)'));
  auto.addEventListener('click', () => go('one'));
  const dodge = el('button', 'btn', '휙 회피 (한 손)');
  dodge.append(el('small', '', '끌기 이동 · 펀치·스킬 전부 자동 · 휙 = 슬라이딩 회피 (1초 쿨타임)'));
  dodge.addEventListener('click', () => go('dodge'));
  const pilot = el('button', 'btn', '자동 이동 + 스킬 버튼');
  pilot.append(el('small', '', '알아서 쫓아가 때리고 탄도 조금 피함 · 스킬·회피만 버튼 (끌면 그동안 직접 이동)'));
  pilot.addEventListener('click', () => go('pilot'));
  const ges = el('button', 'btn', '제스처 (한 손)');
  ges.append(el('small', '', '톡 회오리 · 휙 슬라이딩 · 이어 붙이면 연계 (잘하면 더 빨리·더 많이)'));
  ges.addEventListener('click', () => go('gesture'));
  const two = el('button', 'btn', '두 손 (테스트)');
  two.append(el('small', '', '왼손 이동 · 오른손 버튼'));
  two.addEventListener('click', () => go('two'));
  const close = el('button', 'btn', '닫기');
  close.addEventListener('click', () => overlay.remove());
  modal.append(
    el('div', 'modal-title', '⚔️ 도전 모드'),
    el('div', 'section-title', '난이도 (높을수록 골드·별이 많아요 · 보스 잡으면 별)'),
    chips,
    el('div', 'section-title', '조작'),
    auto,
    dodge,
    pilot,
    ges,
    two,
    close,
  );
  overlay.append(modal);
  document.body.append(overlay);
}

/** 성장: 골드로 공격력·체력, 별로 스킬 */
function showGrowth(onChange: () => void) {
  const overlay = el('div', 'overlay');
  const modal = el('div', 'modal');
  const purse = el('div', 'purse');
  const list = el('div', 'grow-list');
  const render = () => {
    purse.textContent = `🪙 ${save.gold}   ⭐ ${save.stars}`;
    list.replaceChildren();
    for (const id of ['atk', 'hp'] as StatUp[]) {
      const lv = save.stat[id];
      const cost = statCost(lv);
      const row = el('div', 'grow-row');
      const info = el('div', 'grow-info');
      info.append(el('b', '', `${STAT_NAMES[id]} Lv ${lv}`), el('span', '', id === 'atk' ? `피해 +${lv * 12}% → +${(lv + 1) * 12}%` : `체력 +${lv * 10}% → +${(lv + 1) * 10}%`));
      const b = el('button', 'btn primary grow-btn', `🪙 ${cost}`);
      b.disabled = save.gold < cost;
      b.addEventListener('click', () => {
        if (save.gold < cost) return;
        save.gold -= cost;
        save.stat[id]++;
        writeSave(save);
        render();
        onChange();
      });
      row.append(info, b);
      list.append(row);
    }
    for (const id of ['spin', 'rush', 'slam', 'ult'] as SkillUp[]) {
      const lv = save.skill[id];
      const cost = skillCost(lv);
      const row = el('div', 'grow-row');
      const info = el('div', 'grow-info');
      info.append(el('b', '', `${SKILL_UP_NAMES[id]} Lv ${lv}`), el('span', '', `피해 +${lv * 15}% · 쿨타임 -${Math.min(40, lv * 5)}%`));
      const b = el('button', 'btn grow-btn star', `⭐ ${cost}`);
      b.disabled = save.stars < cost;
      b.addEventListener('click', () => {
        if (save.stars < cost) return;
        save.stars -= cost;
        save.skill[id]++;
        writeSave(save);
        render();
        onChange();
      });
      row.append(info, b);
      list.append(row);
    }
  };
  render();
  const close = el('button', 'btn', '닫기');
  close.addEventListener('click', () => overlay.remove());
  modal.append(el('div', 'modal-title', '💪 성장'), purse, el('div', 'section-title', '골드는 🔥도파민 모드에서, 별은 ⚔️도전 모드 보스에게서'), list, close);
  overlay.append(modal);
  document.body.append(overlay);
}

function startGame(mode: PlayMode, run: RunKind, diff: number) {
  lastControl = mode;
  lastRun = run;
  lastDiff = diff;
  root.className = 'game-root';
  root.replaceChildren();
  game = new Game(root, { control: mode, run, diff, save }, tuning, showResult);
  // 콘솔·테스트용
  (window as unknown as { cs: Game }).cs = game;
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
  // 자동 이동 켜고 끄기 (모든 모드)
  const autoBtn = el('button', 'auto-move-btn');
  const paintAuto = () => {
    autoBtn.textContent = `자동 이동 ${g.autoMoveOn ? 'ON' : 'OFF'}`;
    autoBtn.classList.toggle('on', g.autoMoveOn);
  };
  autoBtn.addEventListener('click', () => {
    g.autoMoveOn = !g.autoMoveOn;
    if (mode !== 'pilot') {
      tuning.autoMove = g.autoMoveOn;
      saveTuning(tuning);
    }
    paintAuto();
  });
  paintAuto();
  root.append(pause, quit, autoBtn);
  // 자동 이동 모드: 아래 스킬 줄 (엄지로 누르기 좋게)
  if (mode === 'pilot') {
    const bar = el('div', 'skill-bar');
    const items: { key: 'dash' | SkillId; label: string; cls: string }[] = [
      { key: 'dash', label: '회피', cls: 'sb-dash' },
      { key: 'spin', label: SKILLS.spin.short, cls: '' },
      { key: 'rush', label: SKILLS.rush.short, cls: '' },
      { key: 'slam', label: SKILLS.slam.short, cls: '' },
      { key: 'ult', label: SKILLS.ult.short, cls: 'sb-ult' },
    ];
    const btns = items.map((it) => {
      const b = el('button', `sb ${it.cls}`, it.label);
      b.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        g.press[it.key] = true;
      });
      bar.append(b);
      return { it, b };
    });
    root.append(bar);
    const tick = () => {
      if (!g.running) return;
      for (const { it, b } of btns) {
        if (it.key === 'dash') continue;
        const k = g.cdRatio(it.key);
        b.style.setProperty('--cd', String(k));
        b.classList.toggle('ready', k <= 0);
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }
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
  // 보상은 이기든 지든 챙긴다
  save.gold += r.gold;
  save.stars += r.stars;
  if (r.run === 'challenge') save.best[r.diff] = Math.max(save.best[r.diff], r.wave);
  writeSave(save);
  const overlay = el('div', 'overlay');
  const modal = el('div', 'modal');
  const again = el('button', 'btn primary', '다시 하기');
  const home = el('button', 'btn', '처음으로');
  again.addEventListener('click', () => {
    overlay.remove();
    startGame(lastControl, lastRun, lastDiff);
  });
  home.addEventListener('click', () => {
    overlay.remove();
    showTitle();
  });
  const sec = Math.floor(r.time);
  const title = r.run === 'horde' ? (r.win ? '🔥 3분 완주!' : '🔥 쓰러졌다…') : `⚔️ ${DIFFS[r.diff].name} · WAVE ${r.wave}`;
  modal.append(
    el('div', 'modal-title', title),
    el('p', 'result-line', `처치 ${r.kills} · 최고 연타 ${r.bestCombo} HIT · ${Math.floor(sec / 60)}분 ${sec % 60}초`),
    el('p', 'result-reward', `🪙 +${r.gold}${r.stars ? `   ⭐ +${r.stars}` : ''}`),
    el('p', 'result-line', `보유 🪙 ${save.gold} · ⭐ ${save.stars} — 💪 성장에서 강화하세요`),
    again,
    home,
  );
  overlay.append(modal);
  document.body.append(overlay);
}

showTitle();
