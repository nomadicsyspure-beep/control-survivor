// 렉 테스트 맵(몹 300·500·1000) FPS 재기. 쓰는 법: npm run build && npm run preview → node tools/perf-stress.cjs [CPU배율=4]
const { chromium } = require('playwright');
(async () => {
  const rate = Number(process.argv[2] || 4);
  const b = await chromium.launch();
  for (const n of [300, 500, 1000]) {
    const pg = await b.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
    await pg.addInitScript(() => { localStorage.setItem('control-survivor.settings.v1', JSON.stringify({ ultStyle: 'none', autoMove: true })); });
    await pg.goto(process.env.PERF_URL || 'http://localhost:4173/'); await pg.waitForTimeout(400);
    await pg.click(`text=🧪 ${n}마리`); await pg.waitForTimeout(5000);
    const cdp = await pg.context().newCDPSession(pg);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate });
    const r = await pg.evaluate(() => new Promise((res) => {
      const fr = []; const t0 = performance.now(); let last = t0;
      const f = () => { const now = performance.now(); fr.push(now - last); last = now; if (now - t0 < 4000) requestAnimationFrame(f); else { fr.sort((a, b) => a - b); res({ fps: (fr.length / 4).toFixed(1), p95ms: fr[Math.floor(fr.length * 0.95)].toFixed(1), enemies: window.cs.enemies.length }); } };
      requestAnimationFrame(f);
    }));
    console.log(n, JSON.stringify(r));
    await pg.close();
  }
  await b.close();
})();
