# 작업 규칙

- 변경을 마치면 묻지 말고 바로 사이트에 반영한다: 작업 브랜치에 커밋·푸시 → PR 생성 → `main`에 머지.
  `main`에 들어가면 GitHub Actions가 자동으로 GitHub Pages(https://nomadicsyspure-beep.github.io/control-survivor/)에 배포한다.
- 머지 전에 `npm run build`가 통과해야 한다.
- 배포 확인은 두 단계 모두: main의 "Deploy to GitHub Pages" + gh-pages의 "pages build and deployment".
- 답변은 한국어로.
- 이전 게임(병아리 용사)은 `nomadicsyspure-beep/rabbit` 저장소에 그대로 있다. 그림·코드는 필요한 것만 골라 가져온다.
- 렉 안 걸리는 게 1순위: 몹·이펙트·기술을 늘리는 변경은 `node tools/perf.cjs`로 전후를 재서 PR에 적고, 기준(docs/PERF.md)을 넘으면 성능부터 고친다.
