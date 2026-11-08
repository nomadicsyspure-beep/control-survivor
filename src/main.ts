import './style.css';

// 컨트롤뱀서 시작판: 지금은 제목 화면만. 기획이 정해지면 여기서부터 만든다.
const root = document.getElementById('root')!;
const screen = document.createElement('div');
screen.className = 'title-screen';
const title = document.createElement('h1');
title.textContent = '컨트롤뱀서';
const sub = document.createElement('p');
sub.textContent = '준비 중';
const build = document.createElement('p');
build.textContent = `빌드 ${new Date(__BUILD_TIME__).toLocaleString('ko-KR')}`;
screen.append(title, sub, build);
root.append(screen);
