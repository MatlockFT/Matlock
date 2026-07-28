import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { extname, join, normalize, resolve, sep } from 'node:path';

const siteRoot = resolve(process.argv[2] || '_site');
const htmlFiles = [];
const failures = [];

function walk(directory) {
    for (const entry of readdirSync(directory)) {
        const path = join(directory, entry);

        if (statSync(path).isDirectory()) {
            walk(path);
        } else if (extname(path).toLowerCase() === '.html') {
            htmlFiles.push(path);
        }
    }
}

function stripSiteUrl(value) {
    try {
        const parsed = new URL(value);

        if (
            parsed.hostname === 'matlockfighttalk.com' ||
            parsed.hostname === 'www.matlockfighttalk.com'
        ) {
            return parsed.pathname;
        }
    } catch {
        return value;
    }

    return null;
}

function resolveTarget(sourceFile, rawValue) {
    let value = rawValue.trim();

    if (
        !value ||
        value.startsWith('#') ||
        /^(mailto:|tel:|data:|javascript:)/i.test(value)
    ) {
        return null;
    }

    if (/^https?:\/\//i.test(value)) {
        value = stripSiteUrl(value);

        if (value === null) {
            return null;
        }
    } else if (value.startsWith('//')) {
        return null;
    }

    value = value.split('#')[0].split('?')[0];

    if (!value) {
        return null;
    }

    try {
        value = decodeURIComponent(value);
    } catch {
        failures.push(
            `${sourceFile.slice(siteRoot.length + 1)} -> malformed URL: ${rawValue}`
        );

        return null;
    }

    let target = value.startsWith('/')
        ? join(siteRoot, value)
        : resolve(join(sourceFile, '..'), value);

    target = normalize(target);

    if (
        target !== siteRoot &&
        !target.startsWith(siteRoot + sep)
    ) {
        return null;
    }

    return target;
}

function targetExists(target) {
    if (existsSync(target) && !statSync(target).isDirectory()) {
        return true;
    }

    if (existsSync(target) && statSync(target).isDirectory()) {
        return existsSync(join(target, 'index.html'));
    }

    if (!extname(target)) {
        return (
            existsSync(`${target}.html`) ||
            existsSync(join(target, 'index.html'))
        );
    }

    return false;
}

if (!existsSync(siteRoot)) {
    console.error(`Site directory does not exist: ${siteRoot}`);
    process.exit(1);
}

walk(siteRoot);

const attributePattern = /\b(?:href|src)\s*=\s*["']([^"']+)["']/gi;

for (const file of htmlFiles) {
    const html = readFileSync(file, 'utf8');
    let match;

    while ((match = attributePattern.exec(html)) !== null) {
        const target = resolveTarget(file, match[1]);

        if (target && !targetExists(target)) {
            failures.push(
                `${file.slice(siteRoot.length + 1)} -> ${match[1]}`
            );
        }
    }
}

if (failures.length > 0) {
    console.error('Broken internal links or assets:');

    for (const failure of failures) {
        console.error(`- ${failure}`);
    }

    process.exit(1);
}

console.log(
    `Checked ${htmlFiles.length} HTML files; no broken internal links or assets found.`
);
