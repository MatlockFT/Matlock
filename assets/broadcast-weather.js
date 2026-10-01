(() => {
  const root = document.querySelector('[data-mfc-root]');
  if (!root) return;

  const weather = root.querySelector('[data-mfc-weather]');
  const screen = root.querySelector('[data-mfc-weather-screen]');
  const source = root.querySelector('[data-mfc-weather-source]');
  if (!weather || !screen) return;

  const DATA_URLS = [
    'https://raw.githubusercontent.com/MatlockFT/Matlock/live-news-data/fight-city-weather.json',
    '/assets/data/fight-city-weather.json'
  ];
  const REFRESH_MS = 5 * 60 * 1000;

  let data = null;
  let lastLoadedAt = 0;
  let loading = null;
  let renderKey = '';

  const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[char]));

  const n = value => Number.isFinite(Number(value)) ? Number(value) : null;
  const whole = value => n(value) == null ? '—' : String(Math.round(Number(value)));
  const compass = degrees => {
    const points = ['N','NNE','NE','ENE','E','ESE','SE','SSE','S','SSW','SW','WSW','W','WNW','NW','NNW'];
    return points[Math.round((((Number(degrees) || 0) % 360) / 22.5)) % 16];
  };

  function iconSvg(name, large = false) {
    const cls = large ? 'mfc-wx-icon is-large' : 'mfc-wx-icon';
    const cloud = '<path d="M27 54c-10 0-17-6-17-15 0-8 6-14 15-15 3-11 12-17 23-17 11 0 20 6 24 17 9 1 15 7 15 15 0 9-7 15-17 15H27Z" fill="#d8d8d4" stroke="#101018" stroke-width="4"/><path d="M23 38c8-2 12-7 14-15 7 3 10 7 12 13 7-4 14-5 22-2" fill="none" stroke="#f2f2ef" stroke-width="3" opacity=".8"/>';
    const sun = '<circle cx="48" cy="38" r="14" fill="#ffd21b" stroke="#101018" stroke-width="4"/><g stroke="#101018" stroke-width="4"><path d="M48 10v11M48 55v11M20 38h11M65 38h11M28 18l8 8M60 50l8 8M28 58l8-8M60 26l8-8"/></g>';
    const rain = '<g stroke="#101018" stroke-width="5"><path d="M31 60l-7 18" stroke="#3e9be8"/><path d="M48 60l-7 18" stroke="#3e9be8"/><path d="M65 60l-7 18" stroke="#3e9be8"/></g>';
    const snow = '<g fill="#eaf5ff" stroke="#101018" stroke-width="2"><text x="24" y="79" font-size="24" font-family="Arial">✱</text><text x="55" y="73" font-size="20" font-family="Arial">✱</text></g>';
    const bolt = '<path d="M53 55 42 75h10l-5 17 21-26H57l8-11Z" fill="#ffd51f" stroke="#101018" stroke-width="3"/>';
    const stars = '<circle cx="27" cy="24" r="3" fill="#fff"/><circle cx="68" cy="18" r="2.5" fill="#fff"/><path d="M48 11a22 22 0 1 0 20 31A26 26 0 0 1 48 11Z" fill="#f4f2de" stroke="#101018" stroke-width="4"/>';
    let body = cloud;
    if (name === 'sunny') body = sun;
    else if (name === 'clear') body = stars;
    else if (name === 'partlyCloudy') body = sun + '<g transform="translate(7 14)">' + cloud + '</g>';
    else if (name === 'rain') body = cloud + rain;
    else if (name === 'thunderstorm') body = cloud + rain + bolt;
    else if (name === 'snow') body = cloud + snow;
    return '<svg class="' + cls + '" viewBox="0 0 96 96" aria-hidden="true">' + body + '</svg>';
  }

  function weatherLabel(row) {
    return row?.condition?.label || 'Variable';
  }

  function eventLine() {
    if (!data?.event) return '';
    const event = data.event;
    const place = [event.city, event.state || event.country].filter(Boolean).join(', ');
    return '<div class="mfc-wx-eventline"><strong>' + esc(event.promotion || 'UFC') + ' ' + esc(event.title || '') + '</strong><span>' + esc(event.venue || place) + '</span></div>';
  }

  function currentScreen() {
    const row = data.current || {};
    return '<div class="mfc-wx-page mfc-wx-current">'
      + '<div class="mfc-wx-page-title">Current Conditions</div>'
      + eventLine()
      + '<div class="mfc-wx-current-grid">'
      + '<div class="mfc-wx-current-left"><div class="mfc-wx-big-temp">' + whole(row.temperature) + '°</div>'
      + '<div class="mfc-wx-condition">' + esc(weatherLabel(row)) + '</div>'
      + iconSvg(row.condition?.icon || 'partlyCloudy', true)
      + '<div class="mfc-wx-wind">WIND ' + esc(compass(row.windDirection)) + ' ' + whole(row.windSpeed) + '</div></div>'
      + '<div class="mfc-wx-current-right">'
      + '<p>HUMIDITY: <b>' + whole(row.humidity) + '%</b></p>'
      + '<p>FEELS LIKE: <b>' + whole(row.feelsLike) + '°</b></p>'
      + '<p>PRESSURE: <b>' + (n(row.pressure) == null ? '—' : (Number(row.pressure) * 0.02953).toFixed(2) + ' IN.') + '</b></p>'
      + '<p>CLOUD COVER: <b>' + whole(row.cloudCover) + '%</b></p>'
      + '<p>WIND GUST: <b>' + whole(row.windGust) + ' MPH</b></p>'
      + '</div></div></div>';
  }

  function fightDayScreen() {
    const day = data.fightDay || {};
    const hour = day.atEvent || {};
    const event = data.event || {};
    const when = event.date ? new Intl.DateTimeFormat('en-US', {
      weekday: 'long', month: 'short', day: 'numeric', timeZone: event.timezone || 'UTC'
    }).format(new Date(event.date + 'T12:00:00Z')).toUpperCase() : 'FIGHT DAY';
    return '<div class="mfc-wx-page mfc-wx-fightday">'
      + '<div class="mfc-wx-page-title">Forecast For ' + esc(when) + '</div>'
      + eventLine()
      + '<div class="mfc-wx-fightday-main">'
      + '<div class="mfc-wx-fightday-icon">' + iconSvg(day.condition?.icon || 'partlyCloudy', true) + '</div>'
      + '<div class="mfc-wx-fightday-copy"><div class="mfc-wx-fightday-condition">' + esc(weatherLabel(day)) + '</div>'
      + '<div class="mfc-wx-hi-lo"><span>HIGH <b>' + whole(day.high) + '°</b></span><span>LOW <b>' + whole(day.low) + '°</b></span></div>'
      + '<p>' + esc(day.narrative || '') + '</p></div></div>'
      + '<div class="mfc-wx-fight-time"><span>MAIN CARD ' + esc(event.startLocal || '') + '</span>'
      + '<b>' + whole(hour.temperature) + '° · ' + esc(hour.condition?.label || weatherLabel(day)) + '</b>'
      + '<span>PRECIP ' + whole(hour.precipProbability ?? day.precipProbability) + '% · WIND ' + esc(compass(hour.windDirection ?? day.windDirection)) + ' ' + whole(hour.windSpeed ?? day.windMax) + ' MPH</span></div>'
      + '</div>';
  }

  function extendedScreen() {
    const rows = (data.daily || []).slice(0, 5);
    return '<div class="mfc-wx-page mfc-wx-extended">'
      + '<div class="mfc-wx-page-title">Extended Forecast</div>'
      + eventLine()
      + '<div class="mfc-wx-days">'
      + rows.map(row => '<div class="mfc-wx-day' + (row.date === data.event?.date ? ' is-fight-day' : '') + '">'
        + '<strong>' + esc(row.date === data.event?.date ? 'FIGHT DAY' : row.day) + '</strong>'
        + iconSvg(row.condition?.icon || 'partlyCloudy')
        + '<span class="mfc-wx-day-condition">' + esc(row.condition?.label || '') + '</span>'
        + '<span class="mfc-wx-day-temp"><b>' + whole(row.high) + '°</b> / ' + whole(row.low) + '°</span>'
        + '<small>' + whole(row.precipProbability) + '% PRECIP</small>'
        + '</div>').join('')
      + '</div></div>';
  }

  function radarScreen() {
    const radar = data.radar;
    if (!radar?.tileUrl) return fightDayScreen();
    const stamp = radar.frameTime ? new Date(radar.frameTime).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : '';
    return '<div class="mfc-wx-page mfc-wx-radar">'
      + '<div class="mfc-wx-page-title">Current Radar</div>'
      + eventLine()
      + '<div class="mfc-wx-radar-map"><div class="mfc-wx-radar-grid"></div><img src="' + esc(radar.tileUrl) + '" alt="">'
      + '<div class="mfc-wx-radar-city"><i></i>' + esc(data.event?.city || 'FIGHT CITY') + '</div>'
      + '<div class="mfc-wx-radar-key"><span>LIGHT</span><b></b><b></b><b></b><b></b><span>HEAVY</span></div></div>'
      + '<div class="mfc-wx-radar-time">RADAR ' + esc(stamp) + '</div></div>';
  }

  function pageNames() {
    return data?.radar?.tileUrl
      ? ['current', 'fightday', 'extended', 'radar']
      : ['current', 'fightday', 'extended'];
  }

  function pageFor(name) {
    if (name === 'fightday') return fightDayScreen();
    if (name === 'extended') return extendedScreen();
    if (name === 'radar') return radarScreen();
    return currentScreen();
  }

  async function load(force = false) {
    if (loading) return loading;
    if (!force && data && Date.now() - lastLoadedAt < REFRESH_MS) return data;
    loading = (async () => {
      let error = null;
      for (const base of DATA_URLS) {
        try {
          const url = base + (base.includes('?') ? '&' : '?') + 't=' + Math.floor(Date.now() / REFRESH_MS);
          const response = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(8000) });
          if (!response.ok) throw new Error('Weather data ' + response.status);
          const next = await response.json();
          if (!next?.event || !next?.current || !next?.fightDay) throw new Error('Weather data incomplete');
          data = next;
          lastLoadedAt = Date.now();
          renderKey = '';
          return data;
        } catch (e) { error = e; }
      }
      throw error || new Error('Fight City Forecast unavailable');
    })().finally(() => { loading = null; });
    return loading;
  }

  function show(item, position) {
    weather.hidden = false;
    load().catch(() => {});

    if (!data) {
      screen.innerHTML = '<div class="mfc-weather-loading">FIGHT CITY FORECAST<br>LOADING LOCAL WEATHER...</div>';
      source.textContent = '';
      return;
    }

    const pages = pageNames();
    const duration = Math.max(1, Number(item?.duration) || 48);
    const local = Math.max(0, Number(position?.local) || 0);
    const index = Math.min(pages.length - 1, Math.floor((local / duration) * pages.length));
    const name = pages[index];
    const key = [data.generatedAt, data.event?.id, name].join('|');

    if (key !== renderKey) {
      renderKey = key;
      screen.innerHTML = pageFor(name);
      source.textContent = 'FORECAST: OPEN-METEO' + (name === 'radar' && data.radar ? ' · RADAR: RAINVIEWER' : '');
    }
  }

  function hide() {
    weather.hidden = true;
  }

  load().catch(() => {});
  window.setInterval(() => load(true).catch(() => {}), REFRESH_MS);

  window.matlockFightCityWeather = { show, hide, refresh: () => load(true), get data() { return data; } };
})();