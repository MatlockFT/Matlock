/* Matlock Writer smart autocorrect engine.
 * Uses the local dictionary-en Hunspell word list and affix rules.
 * No article text leaves the browser.
 */
(function (global) {
  'use strict';

  const LETTERS = 'abcdefghijklmnopqrstuvwxyz';
  const VOWELS = new Set(['a','e','i','o','u']);
  const KEYBOARD = {
    q:'wa',w:'qase',e:'wsdr',r:'edft',t:'rfgy',y:'tghu',u:'yhji',i:'ujko',o:'iklp',p:'ol',
    a:'qwsz',s:'awedxz',d:'serfcx',f:'drtgvc',g:'ftyhbv',h:'gyujnb',j:'huikmn',k:'jiolm',l:'kop',
    z:'asx',x:'zsdc',c:'xdfv',v:'cfgb',b:'vghn',n:'bhjm',m:'njk'
  };
  const COMMON = (
    'the be to of and a in that have i it for not on with he as you do at this but his by from ' +
    'they we say her she or an will my one all would there their what so up out if about who get ' +
    'which go me when make can like time no just him know take people into year your good some could ' +
    'them see other than then now look only come its over think also back after use two how our work ' +
    'first well way even new want because these give day most us is are was were been being has had ' +
    'does did should would could must might may very really still much more less better best before ' +
    'against between under around through while where why again another same right left fight fighter ' +
    'fighters win wins won loss losses round rounds decision submission knockout striking grappling ' +
    'wrestling punch punches kick kicks takedown takedowns clinch pressure counter range pace power'
  ).split(/\s+/);

  function norm(value) {
    return String(value || '').normalize('NFKC').replace(/[’]/g, "'").toLowerCase();
  }

  function preserveCase(source, target) {
    if (!target) return '';
    if (source.length > 1 && source === source.toUpperCase()) return target.toUpperCase();
    if (/^[A-ZÀ-ÖØ-Þ]/u.test(source)) return target.charAt(0).toUpperCase() + target.slice(1);
    return target;
  }

  function limitedDistance(a, b, limit) {
    a = norm(a);
    b = norm(b);
    if (Math.abs(a.length - b.length) > limit) return limit + 1;
    const previous = new Array(b.length + 1);
    const current = new Array(b.length + 1);
    for (let j = 0; j <= b.length; j++) previous[j] = j;

    let prevPrevious = null;
    for (let i = 1; i <= a.length; i++) {
      current[0] = i;
      let rowMin = current[0];
      for (let j = 1; j <= b.length; j++) {
        const cost = a[i - 1] === b[j - 1] ? 0 : 1;
        let value = Math.min(
          previous[j] + 1,
          current[j - 1] + 1,
          previous[j - 1] + cost
        );
        if (
          prevPrevious &&
          i > 1 &&
          j > 1 &&
          a[i - 1] === b[j - 2] &&
          a[i - 2] === b[j - 1]
        ) {
          value = Math.min(value, prevPrevious[j - 2] + cost);
        }
        current[j] = value;
        if (value < rowMin) rowMin = value;
      }
      if (rowMin > limit) return limit + 1;
      prevPrevious = previous.slice();
      for (let j = 0; j <= b.length; j++) previous[j] = current[j];
    }
    return previous[b.length];
  }

  function adjacentTransposition(source, target) {
    if (source.length !== target.length) return false;
    let first = -1;
    let second = -1;
    for (let i = 0; i < source.length; i++) {
      if (source[i] === target[i]) continue;
      if (first < 0) first = i;
      else if (second < 0) second = i;
      else return false;
    }
    return first >= 0 && second === first + 1 &&
      source[first] === target[second] && source[second] === target[first];
  }

  function keyboardAdjacent(a, b) {
    a = norm(a);
    b = norm(b);
    return Boolean(KEYBOARD[a] && KEYBOARD[a].includes(b));
  }

  function parseAff(text) {
    const groups = new Map();
    const reps = [];
    const special = { onlyInCompound:'', noSuggest:'' };
    const lines = String(text || '').split(/\r?\n/);

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line || line.startsWith('#')) continue;
      const parts = line.split(/\s+/);

      if (parts[0] === 'ONLYINCOMPOUND') {
        special.onlyInCompound = parts[1] || '';
        continue;
      }
      if (parts[0] === 'NOSUGGEST') {
        special.noSuggest = parts[1] || '';
        continue;
      }
      if (parts[0] === 'REP' && parts.length >= 3) {
        reps.push([parts[1].replace(/_/g,' '), parts[2].replace(/_/g,' ')]);
        continue;
      }
      if ((parts[0] === 'PFX' || parts[0] === 'SFX') && parts.length === 4 && /^\d+$/.test(parts[3])) {
        const type = parts[0];
        const flag = parts[1];
        const group = { type, flag, cross: parts[2] === 'Y', rules:[] };
        const count = Number(parts[3]);
        for (let n = 0; n < count && i + 1 < lines.length; n++) {
          i++;
          const detail = lines[i].trim().split(/\s+/);
          if (detail.length < 5) continue;
          let add = detail[3] === '0' ? '' : detail[3];
          const slash = add.indexOf('/');
          if (slash >= 0) add = add.slice(0, slash);
          const strip = detail[2] === '0' ? '' : detail[2];
          const condition = detail[4] || '.';
          let regex = null;
          try {
            regex = new RegExp(type === 'PFX' ? '^' + condition : condition + '$', 'i');
          } catch {}
          group.rules.push({ strip, add, condition, regex });
        }
        groups.set(type + ':' + flag, group);
      }
    }
    return { groups, reps, special };
  }

  function applyAffix(word, group) {
    const output = [];
    if (!group) return output;
    for (const rule of group.rules) {
      if (rule.regex && !rule.regex.test(word)) continue;
      if (group.type === 'PFX') {
        if (rule.strip && !word.toLowerCase().startsWith(rule.strip.toLowerCase())) continue;
        const stem = rule.strip ? word.slice(rule.strip.length) : word;
        output.push(rule.add + stem);
      } else {
        if (rule.strip && !word.toLowerCase().endsWith(rule.strip.toLowerCase())) continue;
        const stem = rule.strip ? word.slice(0, -rule.strip.length) : word;
        output.push(stem + rule.add);
      }
    }
    return output;
  }

  class SmartAutocorrect {
    constructor() {
      this.ready = false;
      this.words = new Set();
      this.canonical = new Map();
      this.noSuggest = new Set();
      this.firstBuckets = new Map();
      this.lastBuckets = new Map();
      this.commonRank = new Map();
      this.domainWords = new Set();
      this.personalWords = new Set();
      this.correctionCounts = new Map();
      this.aff = null;
      COMMON.forEach((word, index) => this.commonRank.set(word, Math.max(1, 45 - Math.floor(index / 6))));
    }

    async init(options) {
      options = options || {};
      const dicUrl = options.dicUrl || '/assets/data/autocorrect/en-US.dic';
      const affUrl = options.affUrl || '/assets/data/autocorrect/en-US.aff';
      const [dicResponse, affResponse] = await Promise.all([
        fetch(dicUrl, { cache:'force-cache' }),
        fetch(affUrl, { cache:'force-cache' })
      ]);
      if (!dicResponse.ok || !affResponse.ok) throw new Error('Autocorrect dictionary could not be loaded.');
      const [dicText, affText] = await Promise.all([dicResponse.text(), affResponse.text()]);
      this.aff = parseAff(affText);
      this.buildDictionary(dicText);
      this.ready = true;
      return this;
    }

    addWord(value, options) {
      options = options || {};
      const raw = String(value || '').trim();
      if (!raw) return;
      const key = norm(raw);
      if (!/^[a-z][a-z'.-]*$/i.test(key)) return;
      if (!this.words.has(key)) {
        this.words.add(key);
        this.indexWord(key);
      }
      if (!this.canonical.has(key) || options.preferCanonical) this.canonical.set(key, raw);
      if (options.domain) this.domainWords.add(key);
      if (options.personal) this.personalWords.add(key);
    }

    addWords(values, options) {
      for (const value of values || []) this.addWord(value, options);
    }

    addName(value) {
      const parts = String(value || '').match(/[\p{L}\p{M}'’.-]+/gu) || [];
      for (const part of parts) this.addWord(part, { domain:true, preferCanonical:true });
    }

    learnCorrection(from, to) {
      const key = norm(from) + '\u0000' + norm(to);
      this.correctionCounts.set(key, (this.correctionCounts.get(key) || 0) + 1);
    }

    indexWord(word) {
      if (!word || word.length > 28) return;
      const firstKey = word[0] + ':' + word.length;
      const lastKey = word[word.length - 1] + ':' + word.length;
      if (!this.firstBuckets.has(firstKey)) this.firstBuckets.set(firstKey, []);
      if (!this.lastBuckets.has(lastKey)) this.lastBuckets.set(lastKey, []);
      this.firstBuckets.get(firstKey).push(word);
      this.lastBuckets.get(lastKey).push(word);
    }

    buildDictionary(dicText) {
      const lines = String(dicText || '').split(/\r?\n/);
      const firstLineIsCount = /^\d+$/.test((lines[0] || '').trim());
      const start = firstLineIsCount ? 1 : 0;
      const groups = this.aff.groups;
      const onlyInCompound = this.aff.special.onlyInCompound;
      const noSuggestFlag = this.aff.special.noSuggest;

      for (let i = start; i < lines.length; i++) {
        let line = lines[i].trim();
        if (!line) continue;
        line = line.replace(/\\\//g, '\u0001');
        const slash = line.indexOf('/');
        const stemRaw = (slash < 0 ? line : line.slice(0, slash)).replace(/\u0001/g, '/');
        const flags = slash < 0 ? '' : line.slice(slash + 1).split(/\s+/)[0];
        const stem = norm(stemRaw);
        if (!stem || /\s/.test(stem)) continue;

        const onlyCompound = onlyInCompound && flags.includes(onlyInCompound);
        const blockedSuggestion = noSuggestFlag && flags.includes(noSuggestFlag);
        if (!onlyCompound) this.addWord(stemRaw);
        if (blockedSuggestion) this.noSuggest.add(stem);

        const prefixes = [];
        const suffixes = [];
        for (const flag of flags) {
          const p = groups.get('PFX:' + flag);
          const s = groups.get('SFX:' + flag);
          if (p) prefixes.push(p);
          if (s) suffixes.push(s);
        }

        const prefixForms = [];
        const suffixForms = [];
        for (const group of prefixes) {
          for (const form of applyAffix(stemRaw, group)) {
            this.addWord(form);
            prefixForms.push({ form, group });
          }
        }
        for (const group of suffixes) {
          for (const form of applyAffix(stemRaw, group)) {
            this.addWord(form);
            suffixForms.push({ form, group });
          }
        }

        for (const p of prefixForms) {
          if (!p.group.cross) continue;
          for (const sGroup of suffixes) {
            if (!sGroup.cross) continue;
            for (const form of applyAffix(p.form, sGroup)) this.addWord(form);
          }
        }
        for (const s of suffixForms) {
          if (!s.group.cross) continue;
          for (const pGroup of prefixes) {
            if (!pGroup.cross) continue;
            for (const form of applyAffix(s.form, pGroup)) this.addWord(form);
          }
        }
      }
    }

    isKnown(value) {
      return this.words.has(norm(value));
    }

    candidateScore(source, candidate, meta) {
      const s = norm(source);
      const c = norm(candidate);
      let score = 0;
      const distance = meta.distance == null ? limitedDistance(s, c, 2) : meta.distance;

      if (meta.type === 'transpose') score += 150;
      else if (meta.type === 'rep') score += 132;
      else if (meta.type === 'delete-extra') score += 118;
      else if (meta.type === 'insert-missing') score += 114;
      else if (meta.type === 'replace') score += 106;
      else score += distance === 1 ? 100 : 66;

      if (s[0] === c[0]) score += 12;
      if (s[s.length - 1] === c[c.length - 1]) score += 10;
      if (Math.abs(s.length - c.length) === 0) score += 4;
      if (this.domainWords.has(c)) score += 34;
      if (this.personalWords.has(c)) score += 45;
      score += this.commonRank.get(c) || 0;

      const learned = this.correctionCounts.get(s + '\u0000' + c) || 0;
      score += Math.min(30, learned * 8);

      if (meta.type === 'replace' && meta.from && meta.to && keyboardAdjacent(meta.from, meta.to)) score += 18;
      if (meta.type === 'delete-extra' && meta.removed && meta.neighbor === meta.removed) score += 14;
      if (meta.type === 'replace' && meta.from && meta.to && VOWELS.has(meta.from) && VOWELS.has(meta.to)) score += 3;
      if (this.noSuggest.has(c)) score -= 1000;
      return score;
    }

    oneEditCandidates(source) {
      const s = norm(source);
      const found = new Map();
      const consider = (candidate, meta) => {
        const c = norm(candidate);
        if (!c || c === s || !this.words.has(c) || this.noSuggest.has(c)) return;
        const score = this.candidateScore(s, c, { ...meta, distance:1 });
        const old = found.get(c);
        if (!old || score > old.score) found.set(c, { word:c, score, distance:1, reason:meta.type });
      };

      for (let i = 0; i < s.length; i++) {
        const candidate = s.slice(0, i) + s.slice(i + 1);
        consider(candidate, {
          type:'delete-extra',
          removed:s[i],
          neighbor:s[i - 1] || s[i + 1] || ''
        });
      }
      for (let i = 0; i < s.length - 1; i++) {
        if (s[i] === s[i + 1]) continue;
        const candidate = s.slice(0, i) + s[i + 1] + s[i] + s.slice(i + 2);
        consider(candidate, { type:'transpose' });
      }
      for (let i = 0; i < s.length; i++) {
        for (const letter of LETTERS) {
          if (letter === s[i]) continue;
          const candidate = s.slice(0, i) + letter + s.slice(i + 1);
          consider(candidate, { type:'replace', from:s[i], to:letter });
        }
      }
      for (let i = 0; i <= s.length; i++) {
        for (const letter of LETTERS) {
          const candidate = s.slice(0, i) + letter + s.slice(i);
          consider(candidate, { type:'insert-missing', to:letter });
        }
      }

      if (this.aff) {
        for (const pair of this.aff.reps) {
          const from = norm(pair[0]);
          const to = norm(pair[1]);
          if (!from || !to) continue;
          let index = s.indexOf(from);
          let guard = 0;
          while (index >= 0 && guard++ < 4) {
            const candidate = s.slice(0, index) + to + s.slice(index + from.length);
            if (this.words.has(candidate)) {
              const distance = limitedDistance(s, candidate, 2);
              const score = this.candidateScore(s, candidate, { type:'rep', distance });
              const old = found.get(candidate);
              if (!old || score > old.score) found.set(candidate, { word:candidate, score, distance, reason:'rep' });
            }
            index = s.indexOf(from, index + 1);
          }
        }
      }

      return [...found.values()].sort((a,b) => b.score - a.score || a.word.localeCompare(b.word));
    }

    nearbyCandidates(source) {
      const s = norm(source);
      const pool = new Set();
      for (let len = Math.max(2, s.length - 2); len <= s.length + 2; len++) {
        const first = this.firstBuckets.get(s[0] + ':' + len) || [];
        const last = this.lastBuckets.get(s[s.length - 1] + ':' + len) || [];
        for (const word of first) {
          pool.add(word);
          if (pool.size >= 4500) break;
        }
        if (pool.size < 4500) {
          for (const word of last) {
            pool.add(word);
            if (pool.size >= 4500) break;
          }
        }
      }

      const found = [];
      for (const candidate of pool) {
        if (candidate === s || this.noSuggest.has(candidate)) continue;
        const distance = limitedDistance(s, candidate, 2);
        if (distance > 2) continue;
        const score = this.candidateScore(s, candidate, { type:'nearby', distance });
        found.push({ word:candidate, score, distance, reason:'distance-' + distance });
      }
      found.sort((a,b) => b.score - a.score || a.distance - b.distance || a.word.localeCompare(b.word));
      return found.slice(0, 12);
    }

    suggest(value, options) {
      options = options || {};
      const source = norm(value);
      if (!source || source.length < 3 || source.length > 28) return null;
      if (this.words.has(source)) return null;
      if (/^\d/.test(source) || /^[a-z]\d/i.test(source)) return null;

      let candidates = this.oneEditCandidates(source);
      if (!candidates.length && source.length >= 5) candidates = this.nearbyCandidates(source);
      if (!candidates.length) return null;

      const best = candidates[0];
      const second = candidates[1];
      const margin = second ? best.score - second.score : 999;
      const isTransposition = best.reason === 'transpose' || adjacentTransposition(source, best.word);
      const strongOneEdit = best.distance === 1 && best.score >= 112 && (margin >= 7 || isTransposition);
      const strongTwoEdit = best.distance === 2 && source.length >= 6 && best.score >= 90 && margin >= 12;
      const domainStrong = this.domainWords.has(best.word) && best.score >= 92 && margin >= 6;

      if (!(strongOneEdit || strongTwoEdit || domainStrong)) {
        return { replacement:'', confidence:'low', candidates:candidates.slice(0,5) };
      }

      let confidence = 'medium';
      if (isTransposition || best.score >= 145 || margin >= 25) confidence = 'high';
      if (best.distance === 2 && confidence === 'high' && !this.domainWords.has(best.word)) confidence = 'medium';

      return {
        replacement: preserveCase(String(value), this.canonical.get(best.word) || best.word),
        normalized: best.word,
        confidence,
        score: best.score,
        margin,
        reason: best.reason,
        candidates:candidates.slice(0,5)
      };
    }
  }

  global.MatlockAutocorrectEngine = {
    create: function () { return new SmartAutocorrect(); },
    version: '2.0.0'
  };
})(window);
