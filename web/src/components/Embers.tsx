import { useEffect, useRef } from 'react';

interface Mote {
  x: number;
  y: number;
  radius: number;
  rise: number;
  sway: number;
  hue: number;
  glow: number;
}

/** Slow sparks drifting up the screen, like embers over a burning camp. */
export function Embers() {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    let width = 0;
    let height = 0;
    let frame = 0;
    const resize = () => {
      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      width = window.innerWidth;
      height = window.innerHeight;
      canvas.width = width * ratio;
      canvas.height = height * ratio;
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    };
    const spawn = (anywhere: boolean): Mote => ({
      x: Math.random() * width,
      y: anywhere ? Math.random() * height : height + 12,
      radius: 0.6 + Math.random() * 1.7,
      rise: 0.15 + Math.random() * 0.5,
      sway: Math.random() * Math.PI * 2,
      hue: 16 + Math.random() * 28,
      glow: 0.35 + Math.random() * 0.55,
    });

    resize();
    const motes = Array.from({ length: 44 }, () => spawn(true));
    const tick = () => {
      ctx.clearRect(0, 0, width, height);
      ctx.globalCompositeOperation = 'lighter';
      for (let i = 0; i < motes.length; i++) {
        const mote = motes[i];
        mote.y -= mote.rise;
        mote.sway += 0.012;
        mote.x += Math.sin(mote.sway) * 0.35;
        const flicker = 0.55 + 0.45 * Math.sin(mote.sway * 3.1);
        // A window of no height (hidden, or being resized) would divide by zero and stop the loop.
        const fade = height > 0 ? Math.min(1, mote.y / (height * 0.3) + 0.1) : 0;
        const alpha = Math.max(0, mote.glow * flicker * fade);
        const reach = mote.radius * 5;
        const paint = ctx.createRadialGradient(mote.x, mote.y, 0, mote.x, mote.y, reach);
        paint.addColorStop(0, `hsla(${mote.hue}, 100%, 72%, ${alpha})`);
        paint.addColorStop(1, 'hsla(18, 100%, 50%, 0)');
        ctx.fillStyle = paint;
        ctx.beginPath();
        ctx.arc(mote.x, mote.y, reach, 0, Math.PI * 2);
        ctx.fill();
        if (mote.y < -20) motes[i] = spawn(false);
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    window.addEventListener('resize', resize);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('resize', resize);
    };
  }, []);

  return <canvas ref={ref} className="embers" aria-hidden="true" />;
}
