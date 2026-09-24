import fs from 'node:fs/promises';
import path from 'node:path';
import yaml from 'js-yaml';

const DATA_PATH = path.resolve('_data/mma_yellow_pages.yml');
const failures = [];

const normalize = value => String(value || '').trim().toLocaleLowerCase('en-US');

let data;
try {
  data = yaml.load(await fs.readFile(DATA_PATH, 'utf8'));
} catch (error) {
  console.error(`Could not read MMA Yellow Pages data: ${error.message}`);
  process.exit(1);
}

const categories = Array.isArray(data?.categories) ? data.categories : [];
if (!categories.length) failures.push('No Yellow Pages categories found.');

const ids = new Set();
for (const category of categories) {
  const label = category?.title || category?.id || 'Unnamed category';

  if (!category?.id) failures.push(`${label}: missing id.`);
  if (!category?.letter) failures.push(`${label}: missing letter.`);
  if (!category?.title) failures.push(`${label}: missing title.`);

  if (category?.id) {
    if (ids.has(category.id)) failures.push(`${label}: duplicate id ${category.id}.`);
    ids.add(category.id);
  }

  const listings = Array.isArray(category?.listings) ? category.listings : [];
  if (!listings.length) failures.push(`${label}: no listings.`);

  const names = listings.map(item => String(item?.name || '').trim());
  const expected = [...names].sort((a, b) => a.localeCompare(b, 'en-US', { sensitivity: 'base' }));

  if (names.some((name, index) => name !== expected[index])) {
    failures.push(`${label}: listings are not alphabetical.`);
  }

  for (const listing of listings) {
    const item = listing?.name || 'Unnamed listing';
    if (!String(listing?.name || '').trim()) failures.push(`${label}: listing missing name.`);
    if (!/^https:\/\//i.test(String(listing?.url || ''))) failures.push(`${label} / ${item}: URL must use https.`);
    if (!String(listing?.type || '').trim()) failures.push(`${label} / ${item}: missing type.`);
    if (!String(listing?.description || '').trim()) failures.push(`${label} / ${item}: missing description.`);
  }
}

const categoryTitles = categories.map(category => String(category?.title || '').trim());
const sortedCategories = [...categoryTitles].sort((a, b) => a.localeCompare(b, 'en-US', { sensitivity: 'base' }));
if (categoryTitles.some((title, index) => title !== sortedCategories[index])) {
  failures.push('Yellow Pages categories are not alphabetical.');
}

if (failures.length) {
  console.error(`MMA Yellow Pages validation failed with ${failures.length} issue(s):`);
  failures.forEach(failure => console.error(`- ${failure}`));
  process.exit(1);
}

const listingCount = categories.reduce((total, category) => total + category.listings.length, 0);
console.log(`MMA Yellow Pages valid: ${categories.length} categories, ${listingCount} listings, alphabetical and complete.`);
