/** A translucent, non-intercepting spotlight that follows scrolling, layout shifts and iframe content. */
export function spotlight(element: HTMLElement, title: string): () => void {
  const doc = element.ownerDocument;
  const win = doc.defaultView!;
  const box = doc.createElement('div');
  box.setAttribute('data-tour-overlay', '');
  box.setAttribute('aria-hidden', 'true');
  const accent = 'var(--primary, #10b981)';
  Object.assign(box.style, { position: 'fixed', pointerEvents: 'none', zIndex: '85', border: `2px solid ${accent}`,
    borderRadius: '12px', background: `color-mix(in srgb, ${accent} 14%, transparent)`, boxShadow: `0 0 0 4px color-mix(in srgb, ${accent} 12%, transparent), 0 8px 32px rgba(0,0,0,.18)`, boxSizing: 'border-box' });
  const label = doc.createElement('span');
  label.textContent = title.slice(0, 120);
  Object.assign(label.style, { position: 'absolute', left: '0', top: '0', transform: 'translateY(-100%)',
    padding: '5px 9px', background: 'var(--background, #0a0a0a)', color: 'var(--foreground, #ededed)', border: `1px solid ${accent}`, borderRadius: '6px', font: '600 12px/1.5 system-ui', maxWidth: 'min(320px,80vw)' });
  box.appendChild(label); doc.body.appendChild(box);
  // Scroll the parent frame into view too; the overlay stays inside its own viewport.
  (win.frameElement as HTMLElement | null)?.scrollIntoView({ block: 'center', behavior: 'instant' });
  // Long settings views should start at their heading, not halfway down the form.
  element.scrollIntoView({ block: element.getBoundingClientRect().height > win.innerHeight * 0.75 ? 'start' : 'center', inline: 'nearest', behavior: 'instant' });
  let frame = 0, ended = false;
  const update = () => {
    if (ended) return;
    if (!element.isConnected || !element.getClientRects().length || element.closest('[hidden],[aria-hidden="true"]')) { box.style.display = 'none'; }
    else {
      const rect = element.getBoundingClientRect();
      let top = Math.max(4, rect.top - 5), left = Math.max(4, rect.left - 5);
      let right = Math.min(win.innerWidth - 4, rect.right + 5), bottom = Math.min(win.innerHeight - 4, rect.bottom + 5);
      // Respect nested scroll-pane clipping (Reserve, inboxes and tables).
      for (let p = element.parentElement; p && p !== doc.body; p = p.parentElement) {
        const style = win.getComputedStyle(p);
        if (/(auto|scroll|hidden|clip)/.test(style.overflow + style.overflowY + style.overflowX)) {
          const r = p.getBoundingClientRect(); top = Math.max(top, r.top); bottom = Math.min(bottom, r.bottom); left = Math.max(left, r.left); right = Math.min(right, r.right);
        }
      }
      Object.assign(box.style, { display: right > left && bottom > top ? 'block' : 'none', top: `${top}px`, left: `${left}px`, width: `${Math.max(0, right - left)}px`, height: `${Math.max(0, bottom - top)}px` });
      label.style.transform = top < 40 ? 'none' : 'translateY(-100%)';
    }
    frame = win.requestAnimationFrame(update);
  };
  update();
  return () => { ended = true; win.cancelAnimationFrame(frame); box.remove(); };
}
