import fs from 'node:fs/promises';
import { eventIsCurrent } from '../site-data/events/upcoming-events-data.mjs';

const DATA_PATH = '_data/upcoming_events.json';
const UA = 'Mozilla/5.0 (compatible; MatlockFightCityForecast/1.0; +https://mmamatlock.com/)';
const TIMEOUT = 20000;

const clean = value => String(value || '').replace(/\s+/g, ' ').trim();
const clamp = (value, min, max) => Math.min(max, Math.max(min, Number(value) || 0));
const round = value => Number.isFinite(Number(value)) ? Math.round(Number(value)) : null;

async function fetchJson(url) {
  const response = await fetch(url, {
    headers: { 'user-agent': UA, accept: 'application/json,*/*' },
    signal: AbortSignal.timeout(TIMEOUT)
  });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
  return response.json();
}

async function fetchText(url) {
  const response = await fetch(url, {
    headers: { 'user-agent': UA, accept: 'text/html,application/xhtml+xml' },
    signal: AbortSignal.timeout(TIMEOUT),
    redirect: 'follow'
  });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
  return response.text();
}

function jsonLdNodes(html) {
  const nodes = [];
  const push = value => {
    if (!value) return;
    if (Array.isArray(value)) return value.forEach(push);
    if (typeof value !== 'object') return;
    if (Array.isArray(value['@graph'])) value['@graph'].forEach(push);
    nodes.push(value);
  };
  for (const match of String(html || '').matchAll(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try { push(JSON.parse(match[1])); } catch {}
  }
  return nodes;
}

function eventLocationFromHtml(html, date) {
  const candidates = jsonLdNodes(html).filter(node => /(?:Event|SportsEvent)/i.test(String(node?.['@type'] || '')));
  const node = candidates.find(row => String(row?.startDate || '').slice(0, 10) === date) || candidates[0];
  const raw = Array.isArray(node?.location) ? node.location[0] : node?.location;
  if (!raw || typeof raw !== 'object') return null;
  const address = raw.address && typeof raw.address === 'object' ? raw.address : {};
  const geo = raw.geo && typeof raw.geo === 'object' ? raw.geo : {};
  return {
    venue: clean(raw.name),
    city: clean(address.addressLocality),
    state: clean(address.addressRegion),
    country: clean(typeof address.addressCountry === 'string' ? address.addressCountry : address.addressCountry?.name),
    latitude: Number(geo.latitude),
    longitude: Number(geo.longitude)
  };
}

async function resolveEventLocation(event) {
  let location = {
    venue: clean(event.venue),
    city: clean(event.city),
    state: clean(event.state || event.state_code),
    country: clean(event.country),
    latitude: Number(event.latitude),
    longitude: Number(event.longitude)
  };

  if ((!location.city || !Number.isFinite(location.latitude) || !Number.isFinite(location.longitude)) && /^https?:\/\//i.test(event.official_url || '')) {
    try {
      const official = eventLocationFromHtml(await fetchText(event.official_url), event.date);
      if (official) {
        location = {
          venue: official.venue || location.venue,
          city: official.city || location.city,
          state: official.state || location.state,
          country: official.country || location.country,
          latitude: Number.isFinite(official.latitude) ? official.latitude : location.latitude,
          longitude: Number.isFinite(official.longitude) ? official.longitude : location.longitude
        };
      }
    } catch (error) {
      console.warn(`Fight City location source unavailable: ${error.message}`);
    }
  }

  if (!location.city && event.id === 'ufc-332-2026-10-03-fight-card') {
    location = { ...location, venue: 'Delta Center', city: 'Salt Lake City', state: 'UT', country: 'United States' };
  }

  if (!location.city && /meta apex/i.test(location.venue)) {
    location = { ...location, city: 'Las Vegas', state: 'NV', country: 'United States' };
  }

  if ((!Number.isFinite(location.latitude) || !Number.isFinite(location.longitude)) && location.city) {
    try {
      const query = [location.city, location.state, location.country].filter(Boolean).join(', ');
      const geo = await fetchJson(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(query)}&count=5&language=en&format=json`);
      const rows = Array.isArray(geo?.results) ? geo.results : [];
      const stateNorm = location.state.toLowerCase();
      const best = rows.find(row => !stateNorm || String(row.admin1 || '').toLowerCase().includes(stateNorm) || String(row.admin1 || '').toLowerCase().startsWith(stateNorm))
        || rows[0];
      if (best) {
        location.latitude = Number(best.latitude);
        location.longitude = Number(best.longitude);
        location.country = location.country || clean(best.country);
      }
    } catch (error) {
      console.warn(`Fight City geocoding unavailable: ${error.message}`);
    }
  }

  if (!Number.isFinite(location.latitude) || !Number.isFinite(location.longitude)) throw new Error('Fight City event location could not be resolved.');
  return location;
}

function easternOffsetForDate(isoDate) {
  const anchor = new Date(`${isoDate}T12:00:00Z`);
  const label = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    timeZoneName: 'shortOffset'
  }).formatToParts(anchor).find(part => part.type === 'timeZoneName')?.value || '';
  const match = label.match(/GMT([+-])(\d{1,2})(?::(\d{2}))?/i);
  if (!match) return '-04:00';
  return `${match[1]}${String(Number(match[2])).padStart(2, '0')}:${String(Number(match[3] || 0)).padStart(2, '0')}`;
}

function eventStartIso(event) {
  const main = (event.sections || []).find(section => section.kind === 'main');
  const match = String(main?.time || '').match(/(\d{1,2})(?::(\d{2}))?\s*([AP]M)\s*ET/i);
  if (!match) return `${event.date}T20:00:00${easternOffsetForDate(event.date)}`;
  let hour = Number(match[1]) % 12;
  if (match[3].toUpperCase() === 'PM') hour += 12;
  return `${event.date}T${String(hour).padStart(2, '0')}:${String(Number(match[2] || 0)).padStart(2, '0')}:00${easternOffsetForDate(event.date)}`;
}

function condition(code, isDay = 1) {
  const c = Number(code);
  if (c === 0) return { label: isDay ? 'Sunny' : 'Clear', icon: isDay ? 'sunny' : 'clear' };
  if ([1, 2].includes(c)) return { label: 'Partly Cloudy', icon: 'partlyCloudy' };
  if (c === 3 || [45, 48].includes(c)) return { label: c === 3 ? 'Cloudy' : 'Fog', icon: 'cloudy' };
  if ([51, 53, 55, 56, 57].includes(c)) return { label: 'Drizzle', icon: 'rain' };
  if ([61, 63, 65, 66, 67, 80, 81, 82].includes(c)) return { label: c >= 80 ? 'Showers' : 'Rain', icon: 'rain' };
  if ([71, 73, 75, 77, 85, 86].includes(c)) return { label: c >= 75 ? 'Heavy Snow' : 'Snow', icon: 'snow' };
  if ([95, 96, 99].includes(c)) return { label: 'Thunderstorms', icon: 'thunderstorm' };
  return { label: 'Variable', icon: 'partlyCloudy' };
}

function compass(degrees) {
  const points = ['N','NNE','NE','ENE','E','ESE','SE','SSE','S','SSW','SW','WSW','W','WNW','NW','NNW'];
  return points[Math.round((((Number(degrees) || 0) % 360) / 22.5)) % 16];
}

function nearestHourly(hourly, timestamp) {
  const target = Date.parse(timestamp);
  let best = -1;
  let delta = Infinity;
  for (let i = 0; i < (hourly?.time || []).length; i += 1) {
    const stamp = Date.parse(hourly.time[i]);
    const d = Math.abs(stamp - target);
    if (d < delta) { delta = d; best = i; }
  }
  return best;
}

function periodName(iso, timezone) {
  const d = new Date(iso);
  return new Intl.DateTimeFormat('en-US', { timeZone: timezone, weekday: 'long' }).format(d).toUpperCase();
}

function formatLocalTime(iso, timezone) {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short'
  }).format(new Date(iso)).toUpperCase();
}

function narrativeFightDay(event, daily, fightHour) {
  const cond = condition(daily.weatherCode, 1);
  const wind = fightHour?.windSpeed != null ? `${compass(fightHour.windDirection)} WINDS ${Math.max(1, round(fightHour.windSpeed))} MPH` : '';
  const rain = daily.precipProbability != null ? `CHANCE OF PRECIPITATION ${round(daily.precipProbability)} PERCENT` : '';
  return [
    `${periodName(`${event.date}T12:00:00Z`, daily.timezone)}...${cond.label.toUpperCase()}.`,
    daily.high != null ? `HIGH ${round(daily.high)}.` : '',
    wind ? `${wind}.` : '',
    rain ? `${rain}.` : ''
  ].filter(Boolean).join(' ');
}

const raw = JSON.parse(await fs.readFile(DATA_PATH, 'utf8'));
const events = Array.isArray(raw?.events) ? raw.events : Array.isArray(raw) ? raw : [];
const now = new Date();
const candidates = events
  .filter(event => event?.promotion_key === 'ufc' && eventIsCurrent(event, now))
  .sort((a, b) => String(a.date).localeCompare(String(b.date)) || String(a.id).localeCompare(String(b.id)));

if (!candidates.length) throw new Error('No current upcoming UFC event found for Fight City Forecast.');

const event = candidates[0];
const location = await resolveEventLocation(event);
const forecastUrl = new URL('https://api.open-meteo.com/v1/forecast');
forecastUrl.searchParams.set('latitude', String(location.latitude));
forecastUrl.searchParams.set('longitude', String(location.longitude));
forecastUrl.searchParams.set('timezone', 'auto');
forecastUrl.searchParams.set('temperature_unit', 'fahrenheit');
forecastUrl.searchParams.set('wind_speed_unit', 'mph');
forecastUrl.searchParams.set('precipitation_unit', 'inch');
forecastUrl.searchParams.set('forecast_days', '10');
forecastUrl.searchParams.set('current', [
  'temperature_2m','relative_humidity_2m','apparent_temperature','is_day','precipitation',
  'weather_code','cloud_cover','pressure_msl','wind_speed_10m','wind_direction_10m','wind_gusts_10m'
].join(','));
forecastUrl.searchParams.set('hourly', [
  'temperature_2m','relative_humidity_2m','dew_point_2m','precipitation_probability','precipitation',
  'weather_code','visibility','pressure_msl','wind_speed_10m','wind_direction_10m','wind_gusts_10m'
].join(','));
forecastUrl.searchParams.set('daily', [
  'weather_code','temperature_2m_max','temperature_2m_min','precipitation_probability_max',
  'precipitation_sum','sunrise','sunset','wind_speed_10m_max','wind_gusts_10m_max','wind_direction_10m_dominant'
].join(','));

const forecast = await fetchJson(forecastUrl.href);
const timezone = clean(forecast.timezone) || 'UTC';
const currentCode = condition(forecast.current?.weather_code, forecast.current?.is_day);
const fightStart = eventStartIso(event);
const fightIndex = nearestHourly(forecast.hourly, fightStart);
const eventDayIndex = (forecast.daily?.time || []).indexOf(event.date);
const dailyRows = (forecast.daily?.time || []).map((date, i) => ({
  date,
  day: periodName(`${date}T12:00:00Z`, timezone).slice(0, 3),
  weatherCode: Number(forecast.daily.weather_code?.[i]),
  condition: condition(forecast.daily.weather_code?.[i], 1),
  high: round(forecast.daily.temperature_2m_max?.[i]),
  low: round(forecast.daily.temperature_2m_min?.[i]),
  precipProbability: round(forecast.daily.precipitation_probability_max?.[i]),
  precip: Number(forecast.daily.precipitation_sum?.[i] ?? 0),
  windMax: round(forecast.daily.wind_speed_10m_max?.[i]),
  gustMax: round(forecast.daily.wind_gusts_10m_max?.[i]),
  windDirection: round(forecast.daily.wind_direction_10m_dominant?.[i]),
  sunrise: forecast.daily.sunrise?.[i] || '',
  sunset: forecast.daily.sunset?.[i] || ''
}));

const fightDay = eventDayIndex >= 0 ? dailyRows[eventDayIndex] : dailyRows[0];
fightDay.timezone = timezone;
const fightHour = fightIndex >= 0 ? {
  time: forecast.hourly.time[fightIndex],
  temperature: round(forecast.hourly.temperature_2m?.[fightIndex]),
  humidity: round(forecast.hourly.relative_humidity_2m?.[fightIndex]),
  dewpoint: round(forecast.hourly.dew_point_2m?.[fightIndex]),
  precipProbability: round(forecast.hourly.precipitation_probability?.[fightIndex]),
  weatherCode: Number(forecast.hourly.weather_code?.[fightIndex]),
  condition: condition(forecast.hourly.weather_code?.[fightIndex], 1),
  visibilityMiles: round((Number(forecast.hourly.visibility?.[fightIndex]) || 0) / 1609.344),
  pressure: Number(forecast.hourly.pressure_msl?.[fightIndex]),
  windSpeed: round(forecast.hourly.wind_speed_10m?.[fightIndex]),
  windDirection: round(forecast.hourly.wind_direction_10m?.[fightIndex]),
  windGust: round(forecast.hourly.wind_gusts_10m?.[fightIndex])
} : null;

let radar = null;
try {
  const maps = await fetchJson('https://api.rainviewer.com/public/weather-maps.json');
  const latest = maps?.radar?.past?.at?.(-1) || maps?.radar?.past?.[maps.radar.past.length - 1];
  if (latest?.path && maps?.host) {
    radar = {
      generatedAt: maps.generated ? new Date(maps.generated * 1000).toISOString() : '',
      frameTime: latest.time ? new Date(latest.time * 1000).toISOString() : '',
      tileUrl: `${maps.host}${latest.path}/512/5/${location.latitude}/${location.longitude}/2/0_1.png`,
      attribution: 'RainViewer'
    };
  }
} catch (error) {
  console.warn(`Fight City radar unavailable: ${error.message}`);
}

const current = {
  observedAt: forecast.current?.time || new Date().toISOString(),
  temperature: round(forecast.current?.temperature_2m),
  feelsLike: round(forecast.current?.apparent_temperature),
  humidity: round(forecast.current?.relative_humidity_2m),
  weatherCode: Number(forecast.current?.weather_code),
  condition: currentCode,
  cloudCover: round(forecast.current?.cloud_cover),
  pressure: Number(forecast.current?.pressure_msl),
  windSpeed: round(forecast.current?.wind_speed_10m),
  windDirection: round(forecast.current?.wind_direction_10m),
  windGust: round(forecast.current?.wind_gusts_10m),
  precipitation: Number(forecast.current?.precipitation ?? 0)
};

const output = {
  version: 1,
  generatedAt: new Date().toISOString(),
  event: {
    id: event.id,
    promotion: event.promotion || 'UFC',
    title: event.title,
    date: event.date,
    venue: location.venue || event.venue,
    city: location.city,
    state: location.state,
    country: location.country,
    latitude: location.latitude,
    longitude: location.longitude,
    timezone,
    startIso: fightStart,
    startLocal: formatLocalTime(fightStart, timezone)
  },
  current,
  fightDay: {
    ...fightDay,
    atEvent: fightHour,
    narrative: narrativeFightDay(event, fightDay, fightHour)
  },
  daily: dailyRows.slice(0, 7),
  radar,
  source: {
    forecast: 'Open-Meteo',
    radar: radar ? 'RainViewer' : ''
  }
};

const destination = process.argv.includes('--output')
  ? process.argv[process.argv.indexOf('--output') + 1]
  : 'assets/data/fight-city-weather.json';
await fs.writeFile(destination, JSON.stringify(output, null, 2) + '\n', 'utf8');
console.log(`Fight City Forecast: ${output.event.promotion} ${output.event.title} — ${output.event.city}, ${output.event.state || output.event.country}`);
