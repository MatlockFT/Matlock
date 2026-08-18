/opt/homebrew/Library/Homebrew/cmd/shellenv.sh: line 18: /bin/ps: Operation not permitted
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const postsDirectory = join(root, '_posts');
const now = Date.now();
const published = [];

for (const filename of (await readdir(postsDirectory)).filter(
    file => file.endsWith('.md')
)) {
    const path = join(postsDirectory, filename);
    const markdown = await readFile(path, 'utf8');
    const frontmatter = markdown.match(/^---\n([\s\S]*?)\n---/);

    if (!frontmatter) {
        continue;
    }

    const yaml = frontmatter[1];
    const isDraft = /^published:\s*false\s*$/m.test(yaml);
    const scheduledValue = yaml.match(/^publish_at:\s*(.*?)\s*$/m)?.[1]
        ?.replace(/^['"]|['"]$/g, '');

    if (!isDraft || !scheduledValue) {
        continue;
    }

    const scheduledTime = Date.parse(scheduledValue);

    if (Number.isNaN(scheduledTime)) {
        throw new Error(`${filename}: invalid publish_at value ${scheduledValue}`);
    }

    if (scheduledTime > now) {
        continue;
    }

    const updatedYaml = yaml.replace(
        /^published:\s*false\s*$/m,
        'published: true'
    );
    const updatedMarkdown = markdown.replace(yaml, updatedYaml);

    await writeFile(path, updatedMarkdown);
    published.push(filename);
}

if (published.length === 0) {
    console.log('No scheduled articles are due.');
} else {
    console.log(`Published ${published.length} scheduled article(s):`);
    published.forEach(filename => console.log(`- ${filename}`));
}
