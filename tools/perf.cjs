// 성능 측정: 도파민 모드 후반(몹 최대)을 저사양 폰처럼 CPU 4배 느리게 해서 4초 동안 잰다.
// 쓰는 법: npm run build && npm run preview (다른 창) → node tools/perf.cjs
// 기준(docs/PERF.md): FPS 55 이상, 느린 프레임(p95) 28ms 이하, 한 프레임 JS(update+draw) 6ms 이하.
const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch(); const errs = [];
  const pg = await b.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  pg.on('pageerror', (e) => errs.push(e.message));
  await pg.addInitScript(() => { localStorage.setItem('control-survivor.settings.v1', JSON.stringify({ ultStyle: 'none', noCd: false, slowBullets: false, autoMove: true, hitstop: 1, shake: 1, knock: 1 })); });
  await pg.goto(process.env.PERF_URL || 'http://localhost:4173/'); await pg.waitForTimeout(400);
  await pg.click('text=🔥 도파민 모드'); await pg.waitForTimeout(1500);
  // 후반으로 감기: 시간 140초, 몹 가득
  await pg.evaluate(() => { const g = window.cs; g.time = 140; g.p.invuln = 1e9; });
  await pg.waitForTimeout(6000);
  const cdp = await pg.context().newCDPSession(pg);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  const res = await pg.evaluate(() => new Promise((res) => {
    const g = window.cs; const P = Object.getPrototypeOf(g);
    const acc = {}; const wrap = (n) => { const f = P[n]; g[n] = function (...a) { const t = performance.now(); const r = f.apply(this, a); acc[n] = (acc[n] || 0) + performance.now() - t; return r; }; };
    ['update', 'draw', 'updateEnemies', 'updatePlayer', 'updateFx', 'updateShots', 'updateHorde', 'drawHud', 'drawEnemy', 'drawHero', 'drawGround', 'drawScreenFx'].forEach(wrap);
    let n = 0; const t0 = performance.now(); const frames = [];
    let last = t0;
    const f = () => { const now = performance.now(); frames.push(now - last); last = now; n++; if (now - t0 < 4000) requestAnimationFrame(f); else {
      frames.sort((a, b) => a - b);
      const out = { fps: (n / 4).toFixed(1), p95ms: frames[Math.floor(frames.length * 0.95)].toFixed(1), enemies: g.enemies.length, parts: g.parts.length, texts: g.texts.length, sprs: g.sprs.length, perFrameMs: {} };
      for (const k in acc) out.perFrameMs[k] = (acc[k] / n).toFixed(2);
      res(out); } };
    requestAnimationFrame(f);
  }));
  console.log(JSON.stringify(res, null, 1), errs);
  await b.close();
})();
