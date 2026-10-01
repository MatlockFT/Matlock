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

  const WEATHERSTAR_ICON_BASE = 'https://cdn.jsdelivr.net/gh/vbguyny/ws4kp@065688b6ee9a5aa93578e1e3e95b3ecce07d16ce/Images/2/';
  const WEATHERSTAR_ICONS = {
    clear: 'Clear.gif',
    sunny: 'Sunny.gif',
    cloudy: 'Cloudy.gif',
    fog: 'Fog.gif',
    partlyCloudy: 'Partly-Cloudy.gif',
    rain: 'Rain.gif',
    showers: 'Shower.gif',
    thunderstorm: 'Thunderstorm.gif',
    snow: 'Heavy-Snow.gif'
  };

  function iconSvg(name, large = false) {
    const file = WEATHERSTAR_ICONS[name] || WEATHERSTAR_ICONS.partlyCloudy;
    return '<img class="mfc-wx-icon' + (large ? ' is-large' : '') + '" src="' + WEATHERSTAR_ICON_BASE + file + '" alt="">';
  }

  function moonIcon(file) {
    const safe = ['New-Moon.gif', 'First-Quarter.gif', 'Full-Moon.gif', 'Last-Quarter.gif'].includes(file)
      ? file
      : 'New-Moon.gif';
    return '<img class="mfc-wx-moon" src="' + WEATHERSTAR_ICON_BASE + safe + '" alt="">';
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

  function regionalScreen() {
    const regional = data.regional;
    if (!regional?.crop || !Array.isArray(regional.cities) || regional.cities.length < 2) return extendedScreen();

    const crop = regional.crop;
    const mapWidth = Number(crop.imageWidth) / Number(crop.sourceWidth) * 100;
    const mapHeight = Number(crop.imageHeight) / Number(crop.sourceHeight) * 100;
    const mapLeft = -Number(crop.sourceX) / Number(crop.sourceWidth) * 100;
    const mapTop = -Number(crop.sourceY) / Number(crop.sourceHeight) * 100;

    const cities = regional.cities.map(city => {
      const fightClass = city.fightCity ? ' is-fight-city' : '';
      return '<div class="mfc-wx-map-city' + fightClass + '" style="left:' + Number(city.x).toFixed(2) + '%;top:' + Number(city.y).toFixed(2) + '%">'
        + '<span class="mfc-wx-map-city-name">' + esc(city.name) + '</span>'
        + '<span class="mfc-wx-map-city-weather">'
        + '<b>' + whole(city.high) + '°</b>'
        + iconSvg(city.condition?.icon || 'partlyCloudy')
        + '</span>'
        + '</div>';
    }).join('');

    return '<div class="mfc-wx-page mfc-wx-regional">'
      + '<div class="mfc-wx-page-title">Forecast For ' + esc(String(regional.day || 'Fight Day')) + '</div>'
      + eventLine()
      + '<div class="mfc-wx-regional-map">'
      + '<img class="mfc-wx-regional-basemap" src="' + esc(regional.basemapUrl || '') + '" alt="" '
      + 'style="width:' + mapWidth.toFixed(3) + '%;height:' + mapHeight.toFixed(3) + '%;left:' + mapLeft.toFixed(3) + '%;top:' + mapTop.toFixed(3) + '%">'
      + cities
      + '</div>'
      + '<div class="mfc-wx-regional-footer">FIGHT DAY REGIONAL OUTLOOK</div>'
      + '</div>';
  }

  function almanacScreen() {
    const row = data.almanac || {};
    return '<div class="mfc-wx-page mfc-wx-almanac">'
      + '<div class="mfc-wx-page-title">Almanac</div>'
      + eventLine()
      + '<div class="mfc-wx-almanac-grid">'
      + '<div class="mfc-wx-sun-data"><p>SUNRISE: <b>' + esc(row.sunrise || '—') + '</b></p>'
      + '<p>SUNSET: <b>' + esc(row.sunset || '—') + '</b></p>'
      + '<p class="mfc-wx-almanac-note">FIGHT DAY · ' + esc(data.event?.city || '') + '</p></div>'
      + '<div class="mfc-wx-moon-data"><strong>MOON DATA:</strong>'
      + moonIcon(row.moon?.icon)
      + '<span>' + esc(row.moon?.label || 'Moon Phase') + '</span></div>'
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
    const middle = data?.regional?.cities?.length >= 2
      ? ['current', 'fightday', 'extended', 'regional', 'almanac']
      : ['current', 'fightday', 'extended', 'almanac'];
    return data?.radar?.tileUrl ? [...middle, 'radar'] : middle;
  }

  function pageFor(name) {
    if (name === 'fightday') return fightDayScreen();
    if (name === 'extended') return extendedScreen();
    if (name === 'regional') return regionalScreen();
    if (name === 'almanac') return almanacScreen();
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