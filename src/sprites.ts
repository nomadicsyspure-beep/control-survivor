// 몬스터·이펙트 그림 (rabbit 저장소에서 가져온 것). 몬스터는 가로 띠 = 정사각 프레임 여러 장.

const monFiles = import.meta.glob<string>('./assets/mon/*.png', { eager: true, query: '?url', import: 'default' });
const fxFiles = import.meta.glob<string>('./assets/fx/*.png', { eager: true, query: '?url', import: 'default' });

const base = (p: string) => p.split('/').pop()!.replace(/\.png$/, '');

function load(url: string) {
  const img = new Image();
  img.src = url;
  return img;
}

export const ready = (img: HTMLImageElement | undefined): img is HTMLImageElement => !!img && img.complete && img.naturalWidth > 0;

export const MON: Record<string, HTMLImageElement> = {};
export const FX: Record<string, HTMLImageElement> = {};
for (const [p, u] of Object.entries(monFiles)) MON[base(p)] = load(u);
for (const [p, u] of Object.entries(fxFiles)) FX[base(p)] = load(u);

/** 몬스터 띠의 프레임 수 (정사각 프레임) */
export const monFrames = (img: HTMLImageElement) => Math.max(1, Math.round(img.naturalWidth / img.naturalHeight));

// 맞으면 하얗게 번쩍: 그림마다 하얀 실루엣을 한 번 만들어 둔다
const whiteCache = new Map<HTMLImageElement, HTMLCanvasElement>();
export function whiteOf(img: HTMLImageElement) {
  let c = whiteCache.get(img);
  if (!c) {
    c = document.createElement('canvas');
    c.width = img.naturalWidth;
    c.height = img.naturalHeight;
    const x = c.getContext('2d')!;
    x.drawImage(img, 0, 0);
    x.globalCompositeOperation = 'source-in';
    x.fillStyle = '#fff';
    x.fillRect(0, 0, c.width, c.height);
    whiteCache.set(img, c);
  }
  return c;
}
