import fs from 'node:fs/promises';
import { eventIsCurrent } from '../site-data/events/upcoming-events-data.mjs';

const DATA_PATH = '_data/upcoming_events.json';
const UA = 'Mozilla/5.0 (compatible; MatlockFightCityForecast/1.0; +https://mmamatlock.com/)';
const TIMEOUT = 20000;

const clean = value => String(value || '').replace(/\s+/g, ' ').trim();
const clamp = (value, min, max) => Math.min(max, Math.max(min, Number(value) || 0));
const round = value => Number.isFinite(Number(value)) ? Math.round(Number(value)) : null;

const REGIONAL_CITIES = [
  ['Seattle',47.6062,-122.3321],['Portland',45.5234,-122.6762],['Spokane',47.6597,-117.4291],
  ['Boise',43.6135,-116.2034],['Idaho Falls',43.4666,-112.0341],['Helena',46.5927,-112.0361],
  ['Reno',39.4986,-119.7681],['Sacramento',38.5816,-121.4944],['San Francisco',37.7749,-122.4194],
  ['Fresno',36.7378,-119.7871],['Los Angeles',34.0522,-118.2437],['San Diego',32.7157,-117.1611],
  ['Las Vegas',36.1699,-115.1398],['Phoenix',33.4484,-112.0740],['Flagstaff',35.1983,-111.6513],
  ['Tucson',32.2226,-110.9747],['Salt Lake City',40.7608,-111.8910],['Ogden',41.2230,-111.9738],
  ['Provo',40.2338,-111.6585],['Logan',41.73698,-111.83384],['Park City',40.6461,-111.4980],
  ['Richfield',38.7725,-112.0841],['St. George',37.0965,-113.5684],['Grand Junction',39.0639,-108.5506],
  ['Denver',39.7392,-104.9903],['Cheyenne',41.1400,-104.8202],['Albuquerque',35.0844,-106.6504],
  ['Santa Fe',35.6870,-105.9378],['El Paso',31.7619,-106.4850],['Amarillo',35.2220,-101.8313],
  ['Dallas',32.7767,-96.7970],['Austin',30.2672,-97.7431],['San Antonio',29.4241,-98.4936],
  ['Houston',29.7604,-95.3698],['Oklahoma City',35.4676,-97.5164],['Tulsa',36.1540,-95.9928],
  ['Kansas City',39.0997,-94.5786],['Omaha',41.2565,-95.9345],['Wichita',37.6872,-97.3301],
  ['Minneapolis',44.9778,-93.2650],['Des Moines',41.5868,-93.6250],['St. Louis',38.6270,-90.1994],
  ['Chicago',41.8781,-87.6298],['Milwaukee',43.0389,-87.9065],['Detroit',42.3314,-83.0458],
  ['Indianapolis',39.7684,-86.1581],['Cincinnati',39.1031,-84.5120],['Cleveland',41.4993,-81.6944],
  ['Columbus',39.9612,-82.9988],['Pittsburgh',40.4406,-79.9959],['Nashville',36.1627,-86.7816],
  ['Louisville',38.2527,-85.7585],['Atlanta',33.7490,-84.3880],['Charlotte',35.2271,-80.8431],
  ['Raleigh',35.7796,-78.6382],['Washington DC',38.9072,-77.0369],['Baltimore',39.2904,-76.6122],
  ['Philadelphia',39.9526,-75.1652],['New York',40.7128,-74.0060],['Boston',42.3601,-71.0589],
  ['Buffalo',42.8864,-78.8784],['Syracuse',43.0481,-76.1474],['Orlando',28.5383,-81.3792],
  ['Tampa',27.9506,-82.4572],['Miami',25.7617,-80.1918],['Jacksonville',30.3322,-81.6557],
  ['New Orleans',29.9511,-90.0715],['Memphis',35.1495,-90.0490],['Birmingham',33.5186,-86.8104]
].map(([name, latitude, longitude]) => ({ name, latitude, longitude }));

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
  if (c === 3) return { label: 'Cloudy', icon: 'cloudy' };
  if ([45, 48].includes(c)) return { label: 'Fog', icon: 'fog' };
  if ([51, 53, 55, 56, 57].includes(c)) return { label: 'Drizzle', icon: 'rain' };
  if ([61, 63, 65, 66, 67].includes(c)) return { label: 'Rain', icon: 'rain' };
  if ([80, 81, 82].includes(c)) return { label: 'Showers', icon: 'showers' };
  if ([71, 73, 75, 77, 85, 86].includes(c)) return { label: c >= 75 ? 'Heavy Snow' : 'Snow', icon: 'snow' };
  if ([95, 96, 99].includes(c)) return { label: 'Thunderstorms', icon: 'thunderstorm' };
  return { label: 'Variable', icon: 'partlyCloudy' };
}

function compass(degrees) {
  const points = ['N','NNE','NE','ENE','E','ESE','SE','SSE','S','SSW','SW','WSW','W','WNW','NW','NNW'];
  return points[Math.round((((Number(degrees) || 0) % 360) / 22.5)) % 16];
}

function nearestHourly(hourly, timestamp, utcOffsetSeconds = 0) {
  const target = Date.parse(timestamp);
  let best = -1;
  let delta = Infinity;
  for (let i = 0; i < (hourly?.time || []).length; i += 1) {
    const wallClock = Date.parse(String(hourly.time[i]) + 'Z');
    const stamp = wallClock - (Number(utcOffsetSeconds) || 0) * 1000;
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

function moonPhaseForDate(isoDate) {
  const dayMs = 86400000;
  const synodicMonth = 29.53058867;
  // Known new moon near J2000: 2000-01-06 18:14 UTC.
  const epoch = Date.parse('2000-01-06T18:14:00Z');
  const target = Date.parse(`${isoDate}T12:00:00Z`);
  const age = ((target - epoch) / dayMs % synodicMonth + synodicMonth) % synodicMonth;
  const fraction = age / synodicMonth;

  if (fraction < .0625 || fraction >= .9375) return { label: 'New Moon', icon: 'New-Moon.gif' };
  if (fraction < .1875) return { label: 'Waxing Crescent', icon: 'New-Moon.gif' };
  if (fraction < .3125) return { label: 'First Quarter', icon: 'First-Quarter.gif' };
  if (fraction < .4375) return { label: 'Waxing Gibbous', icon: 'Full-Moon.gif' };
  if (fraction < .5625) return { label: 'Full Moon', icon: 'Full-Moon.gif' };
  if (fraction < .6875) return { label: 'Waning Gibbous', icon: 'Full-Moon.gif' };
  if (fraction < .8125) return { label: 'Last Quarter', icon: 'Last-Quarter.gif' };
  return { label: 'Waning Crescent', icon: 'New-Moon.gif' };
}

function formatSunTime(value, timezone) {
  if (!value) return '';
  // Open-Meteo returns local wall-clock timestamps because timezone=auto.
  const match = String(value).match(/T(\d{2}):(\d{2})/);
  if (!match) return '';
  let hour = Number(match[1]);
  const minute = match[2];
  const suffix = hour >= 12 ? 'PM' : 'AM';
  hour = hour % 12 || 12;
  return `${hour}:${minute} ${suffix}`;
}

function weatherStarMapCrop(latitude, longitude) {
  const imageWidth = 2550;
  const imageHeight = 1600;
  const cropHeight = 360;
  const cropWidth = cropHeight * (640 / 367);
  const centerX = (127.5 + Number(longitude)) * 41.775;
  const centerY = (50.5 - Number(latitude)) * 55.2;
  const sourceX = clamp(centerX - cropWidth / 2, 0, imageWidth - cropWidth);
  const sourceY = clamp(centerY - cropHeight / 2, 0, imageHeight - cropHeight);
  const maxLatitude = 50.5 - sourceY / 55.2;
  const minLatitude = 50.5 - (sourceY + cropHeight) / 55.2;
  const minLongitude = (((sourceX * -1) / 41.775) + 127.5) * -1;
  const maxLongitude = ((((sourceX + cropWidth) * -1) / 41.775) + 127.5) * -1;
  return {
    imageWidth,
    imageHeight,
    sourceX,
    sourceY,
    sourceWidth: cropWidth,
    sourceHeight: cropHeight,
    minLatitude,
    maxLatitude,
    minLongitude,
    maxLongitude
  };
}

function regionalDistance(a, b) {
  const latScale = 69;
  const lonScale = 69 * Math.cos(((Number(a.latitude) + Number(b.latitude)) / 2) * Math.PI / 180);
  const dy = (Number(a.latitude) - Number(b.latitude)) * latScale;
  const dx = (Number(a.longitude) - Number(b.longitude)) * lonScale;
  return Math.sqrt(dx * dx + dy * dy);
}

async function buildRegionalForecast(location, eventDate) {
  const lat = Number(location.latitude);
  const lon = Number(location.longitude);
  if (!(lat >= 24 && lat <= 50.5 && lon >= -127.5 && lon <= -66)) return null;

  const crop = weatherStarMapCrop(lat, lon);
  const eventCity = {
    name: clean(location.city) || 'Fight City',
    latitude: lat,
    longitude: lon,
    fightCity: true
  };

  const candidates = REGIONAL_CITIES
    .filter(city =>
      city.latitude >= crop.minLatitude && city.latitude <= crop.maxLatitude &&
      city.longitude >= crop.minLongitude && city.longitude <= crop.maxLongitude
    )
    .sort((a, b) => regionalDistance(a, eventCity) - regionalDistance(b, eventCity));

  const chosen = [eventCity];
  for (const city of candidates) {
    if (city.name.toLowerCase() === eventCity.name.toLowerCase()) continue;
    if (chosen.some(existing => regionalDistance(existing, city) < 55)) continue;
    chosen.push(city);
    if (chosen.length >= 7) break;
  }

  const rows = await Promise.all(chosen.map(async city => {
    try {
      const url = new URL('https://api.open-meteo.com/v1/forecast');
      url.searchParams.set('latitude', String(city.latitude));
      url.searchParams.set('longitude', String(city.longitude));
      url.searchParams.set('timezone', 'auto');
      url.searchParams.set('temperature_unit', 'fahrenheit');
      url.searchParams.set('start_date', eventDate);
      url.searchParams.set('end_date', eventDate);
      url.searchParams.set('daily', 'weather_code,temperature_2m_max,temperature_2m_min');
      const response = await fetchJson(url.href);
      const weatherCode = Number(response.daily?.weather_code?.[0]);
      return {
        ...city,
        high: round(response.daily?.temperature_2m_max?.[0]),
        low: round(response.daily?.temperature_2m_min?.[0]),
        weatherCode,
        condition: condition(weatherCode, 1),
        x: clamp((city.longitude - crop.minLongitude) / (crop.maxLongitude - crop.minLongitude) * 100, 8, 92),
        y: clamp((crop.maxLatitude - city.latitude) / (crop.maxLatitude - crop.minLatitude) * 100, 11, 89)
      };
    } catch (error) {
      console.warn(`Regional forecast unavailable for ${city.name}: ${error.message}`);
      return null;
    }
  }));

  const cities = rows.filter(Boolean);
  return cities.length < 2 ? null : {
    date: eventDate,
    day: new Intl.DateTimeFormat('en-US', {
      timeZone: 'UTC',
      weekday: 'long'
    }).format(new Date(`${eventDate}T12:00:00Z`)),
    basemapUrl: 'https://cdn.jsdelivr.net/gh/vbguyny/ws4kp@065688b6ee9a5aa93578e1e3e95b3ecce07d16ce/Images/Basemap2.png',
    crop,
    cities
  };
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
const fightIndex = nearestHourly(forecast.hourly, fightStart, forecast.utc_offset_seconds);
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
const regional = await buildRegionalForecast(location, event.date);
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
  version: 2,
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
  almanac: {
    date: event.date,
    sunrise: formatSunTime(fightDay?.sunrise, timezone),
    sunset: formatSunTime(fightDay?.sunset, timezone),
    moon: moonPhaseForDate(event.date)
  },
  daily: dailyRows.slice(0, 7),
  regional,
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
