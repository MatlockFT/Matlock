import fs from 'node:fs/promises';

const policy = JSON.parse(await fs.readFile('.repository-policy.json', 'utf8'));
const config = await fs.readFile('_config.yml', 'utf8');
const errors = [];

function requireString(value, label) {
  if (typeof value !== 'string' || !value.trim()) errors.push(label + ' must be a non-empty string.');
}

function requireBoolean(value, label) {
  if (typeof value !== 'boolean') errors.push(label + ' must be a boolean.');
}

async function requirePath(path, label) {
  const stat = await fs.stat(path).catch(() => null);
  if (!stat) errors.push(label + ' does not exist: ' + path);
}

if (Number(policy.version) !== 1) errors.push('Policy version must be 1.');
if (Number(policy.modernizationStage) !== 1) errors.push('Policy modernizationStage must be 1 during Stage 1.');

requireBoolean(policy.principles?.preserveExistingPublicPaths, 'preserveExistingPublicPaths');
requireBoolean(policy.principles?.noCosmeticMoves, 'noCosmeticMoves');
requireBoolean(policy.principles?.newContentFollowsPolicy, 'newContentFollowsPolicy');
requireBoolean(policy.principles?.generatedOutputIsReproducible, 'generatedOutputIsReproducible');
requireBoolean(policy.principles?.videosStayOutOfGitHistory, 'videosStayOutOfGitHistory');

requireString(policy.content?.postsRoot, 'content.postsRoot');
requireString(policy.content?.permalink, 'content.permalink');
requireString(policy.media?.legacyUploadRoot, 'media.legacyUploadRoot');
requireString(policy.media?.futureArticleUploadRoot, 'media.futureArticleUploadRoot');
requireString(policy.media?.generatedRoot, 'media.generatedRoot');
requireString(policy.media?.runtimeDataRoot, 'media.runtimeDataRoot');
requireString(policy.media?.videoBackend, 'media.videoBackend');

if (policy.media?.videoBackend !== 'github-releases') {
  errors.push('media.videoBackend must remain github-releases.');
}

if (!String(policy.media?.futureArticleUploadRoot || '').startsWith(String(policy.media?.legacyUploadRoot || '') + '/')) {
  errors.push('Future article uploads must remain beneath the existing uploads root.');
}

const distinctRoots = [
  policy.media?.futureArticleUploadRoot,
  policy.media?.generatedRoot,
  policy.media?.runtimeDataRoot
].filter(Boolean);
if (new Set(distinctRoots).size !== distinctRoots.length) {
  errors.push('Article uploads, generated assets and runtime data must use distinct roots.');
}

const configuredPermalink = config.match(/^permalink:\s*(.+?)\s*$/m)?.[1]?.trim().replace(/^['"]|['"]$/g, '') || '';
if (configuredPermalink !== policy.content?.permalink) {
  errors.push('Jekyll permalink does not match repository policy.');
}

for (const [path, label] of [
  [policy.content?.postsRoot, 'Posts root'],
  [policy.media?.legacyUploadRoot, 'Legacy upload root'],
  [policy.media?.generatedRoot, 'Generated asset root'],
  [policy.media?.runtimeDataRoot, 'Runtime data root'],
  [policy.code?.layoutsRoot, 'Layouts root'],
  [policy.code?.includesRoot, 'Includes root'],
  [policy.code?.jekyllDataRoot, 'Jekyll data root'],
  [policy.code?.scriptsRoot, 'Scripts root'],
  [policy.code?.backendRoot, 'Backend root'],
  [policy.code?.workflowsRoot, 'Workflows root']
]) {
  if (path) await requirePath(path, label);
}

if (!Array.isArray(policy.code?.plannedScriptGroups) || policy.code.plannedScriptGroups.length < 5) {
  errors.push('plannedScriptGroups must define the future script domains.');
}

if (!Array.isArray(policy.protectedPaths) || !policy.protectedPaths.length) {
  errors.push('protectedPaths must be a non-empty array.');
} else {
  for (const protectedPath of policy.protectedPaths) {
    await requirePath(protectedPath, 'Protected path');
  }
}

if (policy.legacyExceptions?.versionedRootPagesAllowedUntilStage !== 7) {
  errors.push('Versioned root page exception must remain scheduled for Stage 7.');
}
if (policy.legacyExceptions?.currentFlatScriptLayoutAllowedUntilStage !== 5) {
  errors.push('Flat script layout exception must remain scheduled for Stage 5.');
}
if (policy.legacyExceptions?.currentWorkflowLayoutAllowedUntilStage !== 6) {
  errors.push('Workflow-layout exception must remain scheduled for Stage 6.');
}

if (errors.length) {
  console.error('Repository policy check failed:');
  for (const error of errors) console.error('- ' + error);
  process.exit(1);
}

console.log('Repository policy OK: Stage 1 organization contract is internally consistent.');
