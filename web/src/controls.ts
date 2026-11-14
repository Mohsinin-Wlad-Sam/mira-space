// Smooth, cursor-anchored wheel/trackpad zoom for Aladin (its native wheel zoom jumps ~2x per notch).
// Exponential approach to a target FoV each frame; the sky point under the cursor stays under the cursor.
export type ZoomOpts = { speed: number; toCursor: boolean };

export function smoothZoom(al: any, host: HTMLElement, opts: ZoomOpts, onChange?: () => void) {
  let target = 0, raf = 0, mx = 0, my = 0, last = 0;
  const MIN = 0.003, MAX = 200;
  const step = (now: number) => {
    const fov = al.getFov()[0];
    const k = 1 - Math.pow(0.0005, Math.min(0.05, (now - (last || now - 16)) / 1000));   // frame-rate independent easing (~0.15 at 60 fps)
    last = now;
    let next = Math.exp(Math.log(fov) + (Math.log(target) - Math.log(fov)) * k);
    if (Math.abs(Math.log(next / target)) < 0.002) next = target;
    let anchor: any = null;
    if (opts.toCursor) try { anchor = al.pix2world(mx, my); } catch { /* */ }
    al.setFoV(next);
    if (anchor && isFinite(anchor[0])) {
      try {
        const p = al.world2pix(anchor[0], anchor[1]);
        if (p && isFinite(p[0])) {
          const r = host.getBoundingClientRect(); const c = al.pix2world(r.width / 2 + (p[0] - mx), r.height / 2 + (p[1] - my));
          if (c && isFinite(c[0])) al.gotoRaDec(c[0], c[1]);
        }
      } catch { /* */ }
    }
    onChange?.();
    raf = next === target ? 0 : requestAnimationFrame(step);
  };
  // window-level capture runs before any of Aladin's own wheel listeners (which would zoom a second time)
  window.addEventListener("wheel", (e) => {
    if (!host.contains(e.target as Node)) return;
    e.preventDefault(); e.stopImmediatePropagation();
    if (!e.isTrusted) return;   // Aladin re-dispatches synthetic copies of wheel events: block them, count each real one once
    const r = host.getBoundingClientRect(); mx = e.clientX - r.left; my = e.clientY - r.top;
    const fov = al.getFov()[0]; if (!raf) target = fov;
    // normalise lines/pages to pixels; trackpads send many small deltas, mice ~100 per notch
    const dy = e.deltaMode === 1 ? e.deltaY * 33 : e.deltaMode === 2 ? e.deltaY * 600 : e.deltaY;
    target = Math.min(MAX, Math.max(MIN, target * Math.exp(dy * 0.0016 * opts.speed)));
    if (!raf) { last = 0; raf = requestAnimationFrame(step); }
  }, { capture: true, passive: false });
  return { cancel() { cancelAnimationFrame(raf); raf = 0; } };
}

// Tap detection that does not interfere with Aladin's drag/pinch handling
export function onTap(host: HTMLElement, cb: (x: number, y: number, ev: PointerEvent) => void, onHover?: (x: number, y: number) => void) {
  let sx = 0, sy = 0, t0 = 0, id = -1, moved = false, pointers = 0;
  host.addEventListener("pointerdown", (e) => { pointers++; if (pointers > 1) { id = -1; return; } id = e.pointerId; sx = e.clientX; sy = e.clientY; t0 = performance.now(); moved = false; }, true);
  host.addEventListener("pointermove", (e) => {
    if (e.pointerId === id && Math.hypot(e.clientX - sx, e.clientY - sy) > 7) moved = true;
    if (onHover && e.pointerType === "mouse" && e.buttons === 0) { const r = host.getBoundingClientRect(); onHover(e.clientX - r.left, e.clientY - r.top); }
  }, true);
  const up = (e: PointerEvent) => {
    pointers = Math.max(0, pointers - 1);
    if (e.pointerId !== id) return; id = -1;
    if (!moved && performance.now() - t0 < 600) { const r = host.getBoundingClientRect(); cb(e.clientX - r.left, e.clientY - r.top, e); }
  };
  host.addEventListener("pointerup", up, true);
  host.addEventListener("pointercancel", () => { pointers = Math.max(0, pointers - 1); id = -1; }, true);
}
