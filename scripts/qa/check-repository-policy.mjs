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
const stage = Number(policy.modernizationStage);
if (!Number.isInteger(stage) || stage < 1 || stage > 10) {
  errors.push('Policy modernizationStage must be an integer from 1 through 10.');
}

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
requireString(policy.media?.generatedArticleRoot, 'media.generatedArticleRoot');
requireString(policy.media?.generatedArticlePattern, 'media.generatedArticlePattern');
requireString(policy.media?.runtimeDataRoot, 'media.runtimeDataRoot');
requireString(policy.media?.videoBackend, 'media.videoBackend');
requireString(policy.media?.sourceImageRole, 'media.sourceImageRole');
requireString(policy.media?.generatedImageRole, 'media.generatedImageRole');
requireString(policy.media?.videoStorageRule, 'media.videoStorageRule');

requireString(policy.code?.writerSourceRoot, 'code.writerSourceRoot');
requireString(policy.code?.writerBundle, 'code.writerBundle');
requireString(policy.code?.writerSourceModel, 'code.writerSourceModel');
requireString(policy.code?.writerBuildCommand, 'code.writerBuildCommand');

if (policy.media?.videoBackend !== 'github-releases') {
  errors.push('media.videoBackend must remain github-releases.');
}

if (policy.media?.videoStorageRule !== 'release-assets-only') {
  errors.push('media.videoStorageRule must remain release-assets-only.');
}
if (policy.media?.sourceImageRole !== 'authored-source') {
  errors.push('media.sourceImageRole must remain authored-source.');
}
if (policy.media?.generatedImageRole !== 'rebuildable-derivative') {
  errors.push('media.generatedImageRole must remain rebuildable-derivative.');
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

if (!String(policy.media?.generatedArticleRoot || '').startsWith(String(policy.media?.generatedRoot || '') + '/')) {
  errors.push('Generated article variants must remain beneath the generated asset root.');
}
if (policy.media?.generatedArticlePattern !== 'assets/generated/posts/YYYY/MM/article-slug/') {
  errors.push('Generated article pattern must remain assets/generated/posts/YYYY/MM/article-slug/.');
}

const configuredPermalink = config.match(/^permalink:\s*(.+?)\s*$/m)?.[1]?.trim().replace(/^['"]|['"]$/g, '') || '';
if (configuredPermalink !== policy.content?.permalink) {
  errors.push('Jekyll permalink does not match repository policy.');
}

if (!/^exclude:\s*$[\s\S]*?^\s+-\s+_writer\s*$/m.test(config)) {
  errors.push('Jekyll must explicitly exclude _writer source modules from the published site.');
}

for (const [path, label] of [
  [policy.content?.postsRoot, 'Posts root'],
  [policy.media?.legacyUploadRoot, 'Legacy upload root'],
  [policy.media?.generatedRoot, 'Generated asset root'],
  [policy.media?.generatedArticleRoot, 'Generated article root'],
  [policy.media?.runtimeDataRoot, 'Runtime data root'],
  [policy.code?.layoutsRoot, 'Layouts root'],
  [policy.code?.includesRoot, 'Includes root'],
  [policy.code?.jekyllDataRoot, 'Jekyll data root'],
  [policy.code?.scriptsRoot, 'Scripts root'],
  [policy.code?.writerSourceRoot, 'Writer source root'],
  [policy.code?.writerBundle, 'Writer public bundle'],
  [policy.code?.backendRoot, 'Backend root'],
  [policy.code?.workflowsRoot, 'Workflows root']
]) {
  if (path) await requirePath(path, label);
}

const expectedScriptGroups = ['writer', 'media', 'matchmaker', 'news', 'history', 'site-data', 'qa'];
if (JSON.stringify(policy.code?.scriptGroups) !== JSON.stringify(expectedScriptGroups)) {
  errors.push('code.scriptGroups must define the Stage 5 script domains in canonical order.');
}
const expectedSiteDataGroups = ['events', 'ufc', 'live'];
if (JSON.stringify(policy.code?.siteDataGroups) !== JSON.stringify(expectedSiteDataGroups)) {
  errors.push('code.siteDataGroups must define events, ufc and live.');
}

const expectedWorkflowFamilies = ['site', 'writer', 'matchmaker', 'history', 'events', 'ufc', 'live', 'news', 'publishing', 'cms'];
if (JSON.stringify(policy.code?.workflowFamilies) !== JSON.stringify(expectedWorkflowFamilies)) {
  errors.push('code.workflowFamilies must define the Stage 6 workflow responsibility groups in canonical order.');
}

const expectedConsolidatedWorkflows = {
  writer: '.github/workflows/writer-quality.yml',
  siteBrowser: '.github/workflows/site-browser-quality.yml',
  matchmaker: '.github/workflows/update-matchmaker.yml'
};
if (JSON.stringify(policy.code?.consolidatedWorkflows) !== JSON.stringify(expectedConsolidatedWorkflows)) {
  errors.push('code.consolidatedWorkflows must define the Stage 6 canonical workflow owners.');
} else {
  for (const [owner, workflowPath] of Object.entries(expectedConsolidatedWorkflows)) {
    await requirePath(workflowPath, 'Consolidated workflow ' + owner);
  }
}

if (!Array.isArray(policy.protectedPaths) || !policy.protectedPaths.length) {
  errors.push('protectedPaths must be a non-empty array.');
} else {
  for (const protectedPath of policy.protectedPaths) {
    await requirePath(protectedPath, 'Protected path');
  }
}

if (policy.code?.writerSourceModel !== 'ordered-build-time-concatenation') {
  errors.push('Writer source model must remain ordered-build-time-concatenation during the staged refactor.');
}
if (policy.code?.writerBundle !== 'assets/writer.js') {
  errors.push('Writer public bundle must remain assets/writer.js.');
}
if (policy.code?.writerBuildCommand !== 'npm run build:frontend') {
  errors.push('Writer build command must remain npm run build:frontend.');
}

if (policy.legacyExceptions?.versionedRootPagesAllowedUntilStage !== 7) {
  errors.push('Versioned root page exception must remain scheduled for Stage 7.');
}
if (policy.legacyExceptions?.currentFlatScriptLayoutAllowedUntilStage !== 5) {
  errors.push('Flat script layout exception must remain scheduled for Stage 5.');
}
if (stage >= 6 && Object.prototype.hasOwnProperty.call(policy.legacyExceptions || {}, 'currentWorkflowLayoutAllowedUntilStage')) {
  errors.push('Workflow-layout legacy exception must be retired at Stage 6.');
}

if (errors.length) {
  console.error('Repository policy check failed:');
  for (const error of errors) console.error('- ' + error);
  process.exit(1);
}

console.log(`Repository policy OK: modernization Stage ${stage} contract is internally consistent.`);
