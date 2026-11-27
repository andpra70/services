import { useEffect, useState } from 'react';

export default function ImageThumbnail({ item, load, cacheKey = '' }) {
  const [state, setState] = useState({ url: '', error: false });

  useEffect(() => {
    let active = true;
    let objectUrl = '';
    setState({ url: '', error: false });
    load(item).then((result) => {
      objectUrl = result?.url || '';
      if (active) setState({ url: objectUrl, error: !objectUrl });
      else if (objectUrl) URL.revokeObjectURL(objectUrl);
    }).catch(() => { if (active) setState({ url: '', error: true }); });
    return () => { active = false; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [item.path, cacheKey]);

  if (state.url) return <img src={state.url} alt="" loading="lazy" />;
  return <span className="grid-file-icon" aria-hidden>{state.error ? '⚠' : '…'}</span>;
}
