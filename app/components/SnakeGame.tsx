'use client';

import { useEffect, useRef, useState, useCallback } from 'react';

const COLS = 24;
const ROWS = 14;
const INITIAL_SPEED = 260;

type Dir = 'UP' | 'DOWN' | 'LEFT' | 'RIGHT';
type Point = { x: number; y: number };

function rand(max: number) {
  return Math.floor(Math.random() * max);
}

function spawnFood(snake: Point[]): Point {
  let f: Point;
  do {
    f = { x: rand(COLS), y: rand(ROWS) };
  } while (snake.some(s => s.x === f.x && s.y === f.y));
  return f;
}

export default function SnakeGame() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  // cell size derived from container width
  const cellRef = useRef(16);

  const stateRef = useRef({
    snake: [{ x: 10, y: 7 }],
    dir: 'RIGHT' as Dir,
    nextDir: 'RIGHT' as Dir,
    food: { x: 15, y: 7 },
    score: 0,
    dead: false,
    started: false,
  });
  const rafRef = useRef<number>(0);
  const lastTickRef = useRef(0);
  const [score, setScore] = useState(0);
  const [dead, setDead] = useState(false);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const s = stateRef.current;
    const CELL = cellRef.current;
    const W = canvas.width;
    const H = canvas.height;

    ctx.fillStyle = '#09090b';
    ctx.fillRect(0, 0, W, H);

    // grid dots
    ctx.fillStyle = '#27272a';
    for (let x = 0; x < COLS; x++) {
      for (let y = 0; y < ROWS; y++) {
        ctx.fillRect(x * CELL + CELL / 2 - 1, y * CELL + CELL / 2 - 1, 2, 2);
      }
    }

    // food
    ctx.fillStyle = '#f43f5e';
    ctx.beginPath();
    ctx.arc(
      s.food.x * CELL + CELL / 2,
      s.food.y * CELL + CELL / 2,
      CELL / 2 - 2,
      0, Math.PI * 2
    );
    ctx.fill();

    // snake
    s.snake.forEach((seg, i) => {
      const isHead = i === 0;
      ctx.fillStyle = isHead ? '#ffffff' : `rgba(255,255,255,${0.9 - i * (0.7 / s.snake.length)})`;
      const r = isHead ? 4 : 3;
      const px = seg.x * CELL + 1;
      const py = seg.y * CELL + 1;
      const size = CELL - 2;
      ctx.beginPath();
      ctx.roundRect(px, py, size, size, r);
      ctx.fill();
    });

    if (!s.started) {
      ctx.fillStyle = 'rgba(0,0,0,0.55)';
      ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 14px monospace';
      ctx.textAlign = 'center';
      ctx.fillText('Press arrow keys or WASD to start', W / 2, H / 2 - 8);
      ctx.fillStyle = '#71717a';
      ctx.font = '11px monospace';
      ctx.fillText('play while waiting for WordGod to cook', W / 2, H / 2 + 12);
    }

    if (s.dead) {
      ctx.fillStyle = 'rgba(0,0,0,0.65)';
      ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = '#f87171';
      ctx.font = 'bold 16px monospace';
      ctx.textAlign = 'center';
      ctx.fillText('Game Over', W / 2, H / 2 - 10);
      ctx.fillStyle = '#a1a1aa';
      ctx.font = '11px monospace';
      ctx.fillText(`Score: ${s.score}  —  Press R to restart`, W / 2, H / 2 + 12);
    }
  }, []);

  const tick = useCallback((ts: number) => {
    const s = stateRef.current;
    if (!s.started || s.dead) {
      draw();
      rafRef.current = requestAnimationFrame(tick);
      return;
    }

    const elapsed = ts - lastTickRef.current;
    const speed = Math.max(120, INITIAL_SPEED - s.score * 4);

    if (elapsed >= speed) {
      lastTickRef.current = ts;
      s.dir = s.nextDir;

      const head = s.snake[0];
      let nx = head.x;
      let ny = head.y;
      if (s.dir === 'UP')    ny -= 1;
      if (s.dir === 'DOWN')  ny += 1;
      if (s.dir === 'LEFT')  nx -= 1;
      if (s.dir === 'RIGHT') nx += 1;

      if (nx < 0 || nx >= COLS || ny < 0 || ny >= ROWS) {
        s.dead = true;
        setDead(true);
        draw();
        rafRef.current = requestAnimationFrame(tick);
        return;
      }

      if (s.snake.some(seg => seg.x === nx && seg.y === ny)) {
        s.dead = true;
        setDead(true);
        draw();
        rafRef.current = requestAnimationFrame(tick);
        return;
      }

      const ate = nx === s.food.x && ny === s.food.y;
      const newSnake = [{ x: nx, y: ny }, ...s.snake];
      if (!ate) newSnake.pop();
      s.snake = newSnake;

      if (ate) {
        s.score += 1;
        s.food = spawnFood(s.snake);
        setScore(s.score);
      }
    }

    draw();
    rafRef.current = requestAnimationFrame(tick);
  }, [draw]);

  const restart = useCallback(() => {
    const s = stateRef.current;
    s.snake = [{ x: 10, y: 7 }];
    s.dir = 'RIGHT';
    s.nextDir = 'RIGHT';
    s.food = spawnFood(s.snake);
    s.score = 0;
    s.dead = false;
    s.started = true;
    lastTickRef.current = 0;
    setScore(0);
    setDead(false);
  }, []);

  // Resize canvas to fill wrapper width
  useEffect(() => {
    const wrap = wrapRef.current;
    const canvas = canvasRef.current;
    if (!wrap || !canvas) return;

    const resize = () => {
      const w = wrap.clientWidth;
      const cell = Math.floor(w / COLS);
      cellRef.current = cell;
      canvas.width = cell * COLS;
      canvas.height = cell * ROWS;
      draw();
    };

    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(wrap);
    return () => ro.disconnect();
  }, [draw]);

  useEffect(() => {
    stateRef.current.food = spawnFood(stateRef.current.snake);
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [tick]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const s = stateRef.current;
      const key = e.key.toLowerCase();

      if (key === 'r' && s.dead) { restart(); return; }

      const OPPOSITE: Record<Dir, Dir> = { UP: 'DOWN', DOWN: 'UP', LEFT: 'RIGHT', RIGHT: 'LEFT' };
      let d: Dir | null = null;
      if (key === 'arrowup'    || key === 'w') d = 'UP';
      if (key === 'arrowdown'  || key === 's') d = 'DOWN';
      if (key === 'arrowleft'  || key === 'a') d = 'LEFT';
      if (key === 'arrowright' || key === 'd') d = 'RIGHT';

      if (d && d !== OPPOSITE[s.dir]) {
        if (!s.started) { s.started = true; }
        s.nextDir = d;
        e.preventDefault();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [restart]);

  return (
    <div className="flex flex-col gap-2 mt-4 w-full">
      <div className="flex items-center justify-between w-full px-1">
        <span className="text-[10px] text-zinc-600 font-mono uppercase tracking-widest">Snake</span>
        <span className="text-[10px] text-zinc-500 font-mono">Score: <span className="text-white">{score}</span></span>
      </div>
      <div ref={wrapRef} className="w-full">
        <canvas
          ref={canvasRef}
          className="rounded-xl border border-zinc-800 block w-full"
        />
      </div>
      {dead && (
        <button
          onClick={restart}
          className="text-xs font-mono text-zinc-400 hover:text-white border border-zinc-700 hover:border-zinc-500 px-3 py-1.5 rounded-lg transition-colors self-center"
        >
          Restart (R)
        </button>
      )}
      <p className="text-[9px] text-zinc-700 font-mono text-center">Arrow keys / WASD · R to restart</p>
    </div>
  );
}
