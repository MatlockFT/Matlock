import { extname } from 'node:path';

const ARTICLE_SOURCE_RE = /^\/?assets\/uploads\/articles\/(\d{4})\/(\d{2})\/([a-z0-9][a-z0-9-]*)\/([^/]+)$/i;

function sanitizeStem(value) {
  return String(value || '')
    .replace(/[^a-zA-Z0-9_-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase() || 'image';
}

export function articleMediaIdentity(sourcePath) {
  const match = String(sourcePath || '').match(ARTICLE_SOURCE_RE);
  if (!match) return null;

  return {
    year: match[1],
    month: match[2],
    slug: match[3].toLowerCase(),
    filename: match[4]
  };
}

export function responsiveOutputPlan(sourcePath) {
  const normalized = String(sourcePath || '').startsWith('/')
    ? String(sourcePath)
    : '/' + String(sourcePath || '');

  const identity = articleMediaIdentity(normalized);
  const extension = extname(normalized);
  const basename = normalized.split('/').pop() || 'image';
  const fileStem = sanitizeStem(extension ? basename.slice(0, -extension.length) : basename);

  if (identity) {
    const relativeDirectory = `assets/generated/posts/${identity.year}/${identity.month}/${identity.slug}`;
    return {
      mode: 'article',
      relativeDirectory,
      publicDirectory: '/' + relativeDirectory,
      stem: fileStem,
      identity
    };
  }

  const legacyStem = normalized
    .slice(1, extension ? -extension.length : undefined)
    .replace(/^assets\//, '')
    .replaceAll('/', '-');

  return {
    mode: 'legacy',
    relativeDirectory: 'assets/generated/posts',
    publicDirectory: '/assets/generated/posts',
    stem: sanitizeStem(legacyStem),
    identity: null
  };
}

export function isTrackedVideoPath(filePath) {
  return /\.(?:mp4|webm|m4v|mov|avi|mkv)$/i.test(String(filePath || ''));
}
