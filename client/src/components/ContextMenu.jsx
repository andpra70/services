import { useEffect, useRef } from 'react';

export default function ContextMenu({ menu, onClose }) {
  const ref = useRef(null);

  useEffect(() => {
    if (!menu) return undefined;
    const close = (event) => {
      if (event.type === 'keydown' && event.key !== 'Escape') return;
      if (event.type === 'pointerdown' && ref.current?.contains(event.target)) return;
      onClose();
    };
    window.addEventListener('pointerdown', close);
    window.addEventListener('keydown', close);
    window.addEventListener('blur', onClose);
    return () => {
      window.removeEventListener('pointerdown', close);
      window.removeEventListener('keydown', close);
      window.removeEventListener('blur', onClose);
    };
  }, [menu, onClose]);

  useEffect(() => {
    if (!menu || !ref.current) return;
    const bounds = ref.current.getBoundingClientRect();
    ref.current.style.left = `${Math.max(8, Math.min(menu.x, window.innerWidth - bounds.width - 8))}px`;
    ref.current.style.top = `${Math.max(8, Math.min(menu.y, window.innerHeight - bounds.height - 8))}px`;
    ref.current.focus();
  }, [menu]);

  if (!menu) return null;
  return (
    <div ref={ref} className="context-menu" role="menu" tabIndex={-1} style={{ left: menu.x, top: menu.y }} onContextMenu={(event) => event.preventDefault()}>
      {menu.actions.map((action) => action.separator
        ? <hr key={action.id} />
        : <button key={action.id} type="button" role="menuitem" className={action.danger ? 'danger' : ''} disabled={action.disabled} onClick={() => { onClose(); action.run(); }}><span aria-hidden>{action.icon}</span>{action.label}</button>)}
    </div>
  );
}
