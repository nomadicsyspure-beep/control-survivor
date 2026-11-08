import { defineConfig } from 'vite';

// 상대 경로로 빌드해서 GitHub Pages(/control-survivor/) 같은 하위 경로에서도 그대로 동작하게 한다.
export default defineConfig({
  base: './',
  // 설정 창에 빌드 시각을 보여 줘서 지금 받은 버전이 최신인지 알 수 있게 한다
  define: {
    __BUILD_TIME__: JSON.stringify(new Date().toISOString()),
  },
});
