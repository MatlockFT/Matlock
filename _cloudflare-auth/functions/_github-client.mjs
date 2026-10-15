import { REPO_FULL_NAME } from './_github-auth.mjs';

export function githubHeaders(token, extra = {}) {
  return {
    Accept: 'application/vnd.github+json',
    Authorization: `Bearer ${token}`,
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'MMA-Matlock-Writer',
    ...extra
  };
}

export async function githubFetchUrl(token, url, options = {}) {
  return fetch(url, {
    ...options,
    headers: githubHeaders(token, options.headers || {}),
    cache: 'no-store'
  });
}

export async function githubRepoFetch(token, path, options = {}) {
  return githubFetchUrl(
    token,
    `https://api.github.com/repos/${REPO_FULL_NAME}${path}`,
    options
  );
}

export async function githubJson(token, path, options = {}) {
  const response = await githubRepoFetch(token, path, options);
  const data = response.status === 204 ? null : await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data?.message || `${response.status} ${response.statusText}`);
    error.status = response.status;
    error.data = data;
    throw error;
  }
  return data;
}
