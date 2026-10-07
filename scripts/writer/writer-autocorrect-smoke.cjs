const fs = require('node:fs');
const assert = require('node:assert/strict');

global.window = global;
const dic = fs.readFileSync('assets/data/autocorrect/en-US.dic', 'utf8');
const aff = fs.readFileSync('assets/data/autocorrect/en-US.aff', 'utf8');

global.fetch = async url => ({
  ok: true,
  text: async () => String(url).includes('.dic') ? dic : aff
});

const source = fs.readFileSync('assets/writer-autocorrect-engine.js', 'utf8');
// The engine is intentionally an IIFE browser asset.
eval(source);

(async () => {
  const engine = global.MatlockAutocorrectEngine.create();
  await engine.init({ dicUrl: 'local.dic', affUrl: 'local.aff' });
  engine.addWords(['takedown', 'takedowns', 'southpaw', 'groundandpound', 'counterstriker'], { domain: true });
  engine.addName('Ryuho Miyaguchi');

  const expected = new Map([
    ['thier', 'their'],
    ['Thier', 'Their'],
    ['freind', 'friend'],
    ['recieve', 'receive'],
    ['becuase', 'because'],
    ['woudl', 'would'],
    ['figther', 'fighter'],
    ['tkaedown', 'takedown'],
    ['strikng', 'striking'],
    ['Miyaguhci', 'Miyaguchi']
  ]);

  assert.ok(engine.words.size > 100000, 'smart lexicon should contain more than 100k generated forms');

  for (const [input, output] of expected) {
    const result = engine.suggest(input);
    assert.equal(result?.replacement, output, input + ' should correct to ' + output);
    assert.equal(result?.confidence, 'high', input + ' should be a high-confidence correction');
  }

  assert.equal(engine.suggest('their'), null, 'correct words must be left alone');
  assert.equal(engine.suggest('fighter'), null, 'known MMA vocabulary must be left alone');

  console.log('Writer smart autocorrect smoke passed with', engine.words.size, 'dictionary forms.');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
