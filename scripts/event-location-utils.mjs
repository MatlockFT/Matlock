const STATE_ENTRIES = [
  ['AL','Alabama'],['AK','Alaska'],['AZ','Arizona'],['AR','Arkansas'],['CA','California'],['CO','Colorado'],['CT','Connecticut'],['DE','Delaware'],['DC','District of Columbia'],['FL','Florida'],['GA','Georgia'],['HI','Hawaii'],['ID','Idaho'],['IL','Illinois'],['IN','Indiana'],['IA','Iowa'],['KS','Kansas'],['KY','Kentucky'],['LA','Louisiana'],['ME','Maine'],['MD','Maryland'],['MA','Massachusetts'],['MI','Michigan'],['MN','Minnesota'],['MS','Mississippi'],['MO','Missouri'],['MT','Montana'],['NE','Nebraska'],['NV','Nevada'],['NH','New Hampshire'],['NJ','New Jersey'],['NM','New Mexico'],['NY','New York'],['NC','North Carolina'],['ND','North Dakota'],['OH','Ohio'],['OK','Oklahoma'],['OR','Oregon'],['PA','Pennsylvania'],['RI','Rhode Island'],['SC','South Carolina'],['SD','South Dakota'],['TN','Tennessee'],['TX','Texas'],['UT','Utah'],['VT','Vermont'],['VA','Virginia'],['WA','Washington'],['WV','West Virginia'],['WI','Wisconsin'],['WY','Wyoming']
];

const STATE_BY_CODE = new Map(STATE_ENTRIES);
const STATE_BY_NAME = new Map(STATE_ENTRIES.map(([code, name]) => [name.toLowerCase(), code]));
const US_COUNTRIES = new Set(['us','usa','u s','u s a','united states','united states of america']);

const clean = value => String(value || '').replace(/\s+/g, ' ').trim();
const norm = value => clean(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

const CITY_COORDS = new Map(Object.entries({
  'las vegas|NV':[36.1699,-115.1398], 'new york|NY':[40.7128,-74.0060], 'tampa|FL':[27.9506,-82.4572],
  'miami|FL':[25.7617,-80.1918], 'newark|NJ':[40.7357,-74.1724], 'anaheim|CA':[33.8366,-117.9143],
  'los angeles|CA':[34.0522,-118.2437], 'chicago|IL':[41.8781,-87.6298], 'boston|MA':[42.3601,-71.0589],
  'salt lake city|UT':[40.7608,-111.8910], 'seattle|WA':[47.6062,-122.3321], 'nashville|TN':[36.1627,-86.7816],
  'denver|CO':[39.7392,-104.9903], 'houston|TX':[29.7604,-95.3698], 'dallas|TX':[32.7767,-96.7970],
  'austin|TX':[30.2672,-97.7431], 'phoenix|AZ':[33.4484,-112.0740], 'atlanta|GA':[33.7490,-84.3880],
  'philadelphia|PA':[39.9526,-75.1652], 'washington|DC':[38.9072,-77.0369]
}));

const VENUES = [
  { match:/\bt-mobile arena\b/i, city:'Las Vegas', state:'NV', country:'US', latitude:36.1029, longitude:-115.1784 },
  { match:/\bmadison square garden\b/i, city:'New York', state:'NY', country:'US', latitude:40.7505, longitude:-73.9934 },
  { match:/\bamalie arena\b/i, city:'Tampa', state:'FL', country:'US', latitude:27.9427, longitude:-82.4518 },
  { match:/\bkaseya center\b/i, city:'Miami', state:'FL', country:'US', latitude:25.7814, longitude:-80.1870 },
  { match:/\bprudential center\b/i, city:'Newark', state:'NJ', country:'US', latitude:40.7336, longitude:-74.1711 },
  { match:/\bhonda center\b/i, city:'Anaheim', state:'CA', country:'US', latitude:33.8078, longitude:-117.8765 },
  { match:/\bcrypto\.com arena\b/i, city:'Los Angeles', state:'CA', country:'US', latitude:34.0430, longitude:-118.2673 },
  { match:/\bunited center\b/i, city:'Chicago', state:'IL', country:'US', latitude:41.8807, longitude:-87.6742 },
  { match:/\btd garden\b/i, city:'Boston', state:'MA', country:'US', latitude:42.3662, longitude:-71.0621 },
  { match:/\bdelta center\b/i, city:'Salt Lake City', state:'UT', country:'US', latitude:40.7683, longitude:-111.9011 },
  { match:/\bclimate pledge arena\b/i, city:'Seattle', state:'WA', country:'US', latitude:47.6221, longitude:-122.3540 },
  { match:/\bbridgestone arena\b/i, city:'Nashville', state:'TN', country:'US', latitude:36.1592, longitude:-86.7785 },
  { match:/\bball arena\b/i, city:'Denver', state:'CO', country:'US', latitude:39.7487, longitude:-105.0077 },
  { match:/\btoyota center\b/i, city:'Houston', state:'TX', country:'US', latitude:29.7508, longitude:-95.3621 },
  { match:/\bamerican airlines center\b/i, city:'Dallas', state:'TX', country:'US', latitude:32.7905, longitude:-96.8103 },
  { match:/\b(?:meta |ufc )?apex\b/i, city:'Las Vegas', state:'NV', country:'US' }
];

export function normalizeState(value) {
  const text = clean(value).replace(/\d{5}(?:-\d{4})?$/, '').trim();
  const code = text.toUpperCase();
  if (STATE_BY_CODE.has(code)) return code;
  return STATE_BY_NAME.get(text.toLowerCase()) || '';
}

export function isUsCountry(value) {
  return US_COUNTRIES.has(norm(value));
}

export function explicitForeignCountry(event) {
  const value = clean(event?.country || event?.country_code || event?.countryCode);
  return Boolean(value && !isUsCountry(value));
}

export function venueRecord(value) {
  const venue = clean(value);
  if (!venue || /^venue tba$/i.test(venue)) return null;
  return VENUES.find(item => item.match.test(venue)) || null;
}

function parseUsLocation(value) {
  const text = clean(value).replace(/\s+[·|]\s+/g, ', ');
  if (!text) return null;
  const parts = text.split(',').map(clean).filter(Boolean);
  if (parts.length >= 2) {
    if (isUsCountry(parts.at(-1)) && parts.length >= 3) parts.pop();
    const state = normalizeState(parts.at(-1));
    if (state) {
      const city = clean(parts.at(-2));
      if (city && !STATE_BY_NAME.has(city.toLowerCase())) return { city, state };
    }
  }
  for (const [code, name] of STATE_ENTRIES) {
    const match = text.match(new RegExp(`(?:^|[·|,])\\s*([^·|,]{2,64}?)\\s*,?\\s*${name.replace(/ /g, '\\s+')}\\b`, 'i'));
    if (match) return { city: clean(match[1]), state: code };
  }
  return null;
}

export function haversineMiles(lat1, lon1, lat2, lon2) {
  const toRad = value => value * Math.PI / 180;
  const dLat = toRad(lat2 - lat1), dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 3958.7613 * 2 * Math.asin(Math.sqrt(a));
}

export function enrichLocationMetadata(source) {
  const event = { ...source };
  const foreign = explicitForeignCountry(event);
  const explicitState = normalizeState(event.state || event.state_code || event.stateCode);
  let city = clean(event.city);
  let state = explicitState;
  let country = clean(event.country || event.country_code || event.countryCode);
  let locationSource = clean(event.location_source);
  let precision = clean(event.location_precision);

  if (!foreign && (!city || !state)) {
    const parsed = parseUsLocation(event.location) || parseUsLocation(event.venue);
    if (parsed) {
      city ||= parsed.city;
      state ||= parsed.state;
      country ||= 'US';
      locationSource ||= clean(event.location) ? 'location-text' : 'venue-text';
      precision ||= 'city';
    }
  }

  const venue = !foreign ? venueRecord(event.venue) : null;
  if (venue) {
    city ||= venue.city;
    state ||= venue.state;
    country ||= venue.country;
    locationSource ||= 'venue-registry';
    precision ||= Number.isFinite(venue.latitude) ? 'venue' : 'city';
  }

  if (state && !country) country = 'US';
  if (city) event.city = city;
  if (state) {
    event.state = state;
    event.state_code = state;
  }
  if (country) event.country = isUsCountry(country) ? 'US' : country;
  if (city && state && isUsCountry(event.country)) event.location = `${city}, ${state}`;

  let latitude = Number(event.latitude ?? event.lat);
  let longitude = Number(event.longitude ?? event.lng);
  const hasCoordinates = Number.isFinite(latitude) && Number.isFinite(longitude);
  if (!hasCoordinates && venue && Number.isFinite(venue.latitude) && Number.isFinite(venue.longitude)) {
    latitude = venue.latitude;
    longitude = venue.longitude;
    precision = 'venue';
    locationSource = 'venue-registry';
  } else if (!hasCoordinates && city && state && isUsCountry(event.country)) {
    const point = CITY_COORDS.get(`${city.toLowerCase()}|${state}`);
    if (point) {
      [latitude, longitude] = point;
      precision ||= 'city';
      locationSource ||= 'city-registry';
    }
  } else if (hasCoordinates) {
    precision ||= 'source-coordinates';
    locationSource ||= 'source-coordinates';
  }

  if (Number.isFinite(latitude) && Number.isFinite(longitude)) {
    event.latitude = latitude;
    event.longitude = longitude;
  }
  if (locationSource) event.location_source = locationSource;
  if (precision) event.location_precision = precision;
  return event;
}

export function locationMismatch(event, thresholdMiles = 75) {
  const venue = venueRecord(event?.venue);
  if (!venue || !Number.isFinite(venue.latitude) || !Number.isFinite(venue.longitude)) return null;
  const latitude = Number(event?.latitude ?? event?.lat);
  const longitude = Number(event?.longitude ?? event?.lng);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  const miles = haversineMiles(latitude, longitude, venue.latitude, venue.longitude);
  if (miles <= thresholdMiles) return null;
  return { miles: Math.round(miles), expected_city: venue.city, expected_state: venue.state };
}

export const EVENT_LOCATION_UTILS_VERSION = 1;
