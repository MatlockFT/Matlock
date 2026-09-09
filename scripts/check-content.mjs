import {
    existsSync,
    readFileSync,
    readdirSync,
    statSync
} from 'node:fs';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const postsDirectory = join(root, '_posts');
const manifestPath = join(root, '_data', 'responsive_images.yml');
const failures = [];
const warnings = [];

function frontmatterFor(file) {
    const markdown = readFileSync(file, 'utf8');
    const match = markdown.match(/^---\n([\s\S]*?)\n---/);

    if (!match) {
        failures.push(`${file}: missing YAML frontmatter`);
        return null;
    }

    return {
        markdown,
        yaml: match[1],
        body: markdown.slice(match[0].length).trim()
    };
}

function scalar(yaml, field) {
    const match = yaml.match(
        new RegExp(`^${field}:\\s*(.*?)\\s*$`, 'm')
    );

    return match
        ? match[1].replace(/^['"]|['"]$/g, '')
        : '';
}

function approximateWordCount(markdown) {
    return markdown
        .replace(/```[\s\S]*?```/g, ' ')
        .replace(/<[^>]+>/g, ' ')
        .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
        .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
        .replace(/https?:\/\/\S+/g, ' ')
        .replace(/[#>*_`~|\-]+/g, ' ')
        .split(/\s+/)
        .filter(Boolean)
        .length;
}

const manifest = existsSync(manifestPath)
    ? readFileSync(manifestPath, 'utf8')
    : '';

for (const filename of readdirSync(postsDirectory).filter(
    file => file.endsWith('.md')
)) {
    const path = join(postsDirectory, filename);
    const frontmatter = frontmatterFor(path);

    if (!frontmatter) {
        continue;
    }

    for (const field of [
        'layout',
        'title',
        'description',
        'date',
        'category',
        'author',
        'published'
    ]) {
        if (!scalar(frontmatter.yaml, field)) {
            failures.push(`${filename}: missing ${field}`);
        }
    }

    const published = scalar(frontmatter.yaml, 'published');
    const title = scalar(frontmatter.yaml, 'title');
    const description = scalar(frontmatter.yaml, 'description');
    const listingVisibility = scalar(frontmatter.yaml, 'listing_visibility');
    const publishAt = scalar(frontmatter.yaml, 'publish_at');

    if (!['true', 'false'].includes(published)) {
        failures.push(
            `${filename}: published must be explicitly true or false`
        );
    }

    if (
        listingVisibility &&
        ![
            'normal',
            'hide-home',
            'hide-breakdowns',
            'direct-only'
        ].includes(listingVisibility)
    ) {
        failures.push(
            `${filename}: listing_visibility has an unsupported value`
        );
    }

    if (publishAt && Number.isNaN(Date.parse(publishAt))) {
        failures.push(`${filename}: publish_at must be a valid date and time`);
    }

    if (publishAt && published === 'true') {
        warnings.push(
            `${filename}: publish_at is set but the article is already published`
        );
    }

    const imageBlock = frontmatter.yaml.match(
        /^image:\s*\n((?:^[ \t]+.*(?:\n|$))*)/m
    );

    if (!imageBlock) {
        failures.push(`${filename}: missing featured image`);
        continue;
    }

    const imagePath = imageBlock[1]
        .match(/^\s+path:\s*(.+?)\s*$/m)?.[1]
        ?.replace(/^['"]|['"]$/g, '');

    const imageAlt = imageBlock[1]
        .match(/^\s+alt:\s*(.+?)\s*$/m)?.[1]
        ?.replace(/^['"]|['"]$/g, '');

    if (!imagePath) {
        failures.push(`${filename}: featured image is missing its path`);
    } else {
        const localImage = join(root, imagePath.replace(/^\//, ''));

        if (!existsSync(localImage)) {
            failures.push(`${filename}: image does not exist: ${imagePath}`);
        }

        if (!manifest.includes(`${JSON.stringify(imagePath)}:`)) {
            failures.push(
                `${filename}: responsive variants missing for ${imagePath}`
            );
        }
    }

    if (!imageAlt) {
        failures.push(`${filename}: featured image is missing alt text`);
    }

    const typoPatterns = [
        [/\bfirst-titme\b/i, 'first-titme'],
        [/\bchanging directs\b/i, 'changing directs'],
        [/\bCub Swason\b/i, 'Cub Swason'],
        [/\bEverytime\b/, 'Everytime'],
        [/\bvarity\b/i, 'varity']
    ];

    for (const [pattern, label] of typoPatterns) {
        if (pattern.test(frontmatter.markdown)) {
            failures.push(`${filename}: possible typo “${label}”`);
        }
    }

    if (published !== 'true') {
        continue;
    }

    const wordCount = approximateWordCount(frontmatter.body);

    if (wordCount < 300) {
        warnings.push(
            `${filename}: published article is only about ${wordCount} words; review whether it provides enough original value`
        );
    }

    if (title.length > 80) {
        warnings.push(
            `${filename}: title is ${title.length} characters; consider shortening it for readability`
        );
    }

    if (description.length < 70) {
        warnings.push(
            `${filename}: description is only ${description.length} characters; make it more descriptive`
        );
    }

    if (description.length > 180) {
        warnings.push(
            `${filename}: description is ${description.length} characters; consider tightening it`
        );
    }

    if (/^#\s+\S/m.test(frontmatter.body)) {
        warnings.push(
            `${filename}: body contains an H1; the post layout already supplies the page H1`
        );
    }

    if (/\b(?:TODO|TBD|lorem ipsum)\b/i.test(frontmatter.body)) {
        warnings.push(
            `${filename}: possible unfinished placeholder text found`
        );
    }

    const genericAltPattern =
        /!\[(?:image(?:\.png)?|img|photo|screenshot)?\]\([^)]+\)/gi;

    if (genericAltPattern.test(frontmatter.body)) {
        warnings.push(
            `${filename}: one or more inline images use generic alt text`
        );
    }

    const commonQualityTypos = [
        [/\bwrestelr\b/i, 'wrestelr'],
        [/\bprevelant\b/i, 'prevelant'],
        [/\bdesparate\b/i, 'desparate'],
        [/\binterseting\b/i, 'interseting'],
        [/\bits worth noting\b/i, 'its worth noting'],
        [/\bprioritise\b/i, 'prioritise (American English: prioritize)']
    ];

    for (const [pattern, label] of commonQualityTypos) {
        if (pattern.test(frontmatter.body)) {
            warnings.push(`${filename}: review “${label}”`);
        }
    }
}

const generatedDirectory = join(root, 'assets', 'generated', 'posts');

if (existsSync(generatedDirectory)) {
    for (const filename of readdirSync(generatedDirectory)) {
        const path = join(generatedDirectory, filename);
        const size = statSync(path).size;

        if (size > 500 * 1024) {
            failures.push(
                `${filename}: responsive image exceeds 500 KB`
            );
        }
    }
}

const cmsConfig = readFileSync(join(root, '.pages.yml'), 'utf8');

if (!/name:\s*published[\s\S]*?default:\s*false/.test(cmsConfig)) {
    failures.push(
        '.pages.yml: new posts must default to published: false'
    );
}

for (const warning of warnings) {
    console.warn(`Warning: ${warning}`);
}

if (failures.length > 0) {
    console.error('Content quality failures:');

    for (const failure of failures) {
        console.error(`- ${failure}`);
    }

    process.exit(1);
}

console.log(
    `Content checks passed with ${warnings.length} editorial warning${warnings.length === 1 ? '' : 's'}.`
);
