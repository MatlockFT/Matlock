(() => {
  const root = document.querySelector('[data-live-writer-public]');
  if (!root) return;

  const FEED = 'https://raw.githubusercontent.com/MatlockFT/Matlock/main/assets/uploads/runtime/live-writer.json';
  const title = root.querySelector('[data-live-public-title]');
  const status = root.querySelector('[data-live-public-status]');
  const meta = root.querySelector('[data-live-public-meta]');
  const body = root.querySelector('[data-live-public-body]');
  const error = root.querySelector('[data-live-public-error]');
  let timer = 0;
  let lastVersion = -1;
  let stopped = false;

  function formatTime(value) {
    if (!value) return '';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    return new Intl.DateTimeFormat(undefined, {
      hour: 'numeric',
      minute: '2-digit',
      second: '2-digit'
    }).format(date);
  }

  function render(live) {
    if (!live) return;
    const version = Number(live.version || 0);
    if (version !== lastVersion) {
      lastVersion = version;
      title.textContent = live.title || 'Live notes';
      document.title = (live.title || 'Live notes') + ' — MMA Matlock';

      if (live.html) {
        body.innerHTML = live.html;
      } else if (live.text) {
        const paragraph = document.createElement('p');
        paragraph.textContent = live.text;
        body.replaceChildren(paragraph);
      } else {
        body.innerHTML = '<p class="live-writer-empty">No live notes yet.</p>';
      }
    }

    status.dataset.state = live.active ? 'live' : 'ended';
    status.textContent = live.active ? 'LIVE' : (live.version ? 'ENDED' : 'OFFLINE');

    const time = formatTime(live.updatedAt);
    if (live.active) meta.textContent = time ? 'Updating live · Last change ' + time : 'Updating live';
    else if (live.version) meta.textContent = time ? 'Last updated ' + time : 'Live session ended';
    else meta.textContent = 'No live writing session is active.';

    root.dataset.active = live.active ? 'true' : 'false';
    if (error) error.hidden = true;
  }

  function nextDelay(live) {
    if (document.hidden) return 15000;
    return live?.active ? 2500 : 6000;
  }

  async function poll() {
    if (stopped) return;
    let live = null;
    try {
      const response = await fetch(FEED + '?v=' + Date.now(), {
        method: 'GET',
        mode: 'cors',
        cache: 'no-store',
        headers: { Accept: 'application/json' }
      });
      if (response.status === 404) {
        live = { active:false, title:'Live notes', html:'', text:'', version:0, updatedAt:null };
      } else {
        if (!response.ok) throw new Error('Live feed unavailable.');
        live = await response.json();
      }
      render(live);
    } catch {
      if (error) {
        error.textContent = 'Live updates temporarily unavailable. Retrying automatically.';
        error.hidden = false;
      }
    } finally {
      window.clearTimeout(timer);
      timer = window.setTimeout(poll, nextDelay(live));
    }
  }

  document.addEventListener('visibilitychange', () => {
    window.clearTimeout(timer);
    timer = window.setTimeout(poll, document.hidden ? 3000 : 50);
  });

  window.addEventListener('beforeunload', () => {
    stopped = true;
    window.clearTimeout(timer);
  });

  poll();
})();