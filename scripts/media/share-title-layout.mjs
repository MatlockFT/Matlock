const clean = value => String(value || '').replace(/\s+/g, ' ').trim();
const weakWord = /^(?:A|AN|AND|AT|BY|FOR|FROM|IN|OF|ON|OR|THE|TO|VS\.?|WITH)$/i;

export function textUnits(value) {
  let width = 0;
  for (const character of String(value || '')) {
    if (/\s/.test(character)) width += 0.52;
    else if (/[I1.,'’!:;|]/.test(character)) width += 0.48;
    else if (/[MW@%&#]/.test(character)) width += 1.24;
    else if (/[()\[\]{}\/-]/.test(character)) width += 0.72;
    else width += 1;
  }
  return width;
}

export function balancedWrap(text, maxUnits, maxLines = 3) {
  const sourceWords = clean(text).split(' ').filter(Boolean);
  if (!sourceWords.length) return [];

  const capacity = maxUnits * 1.08;
  const words = [...sourceWords];
  let clipped = false;
  while (words.length > 1 && textUnits(words.join(' ')) > capacity * maxLines) {
    words.pop();
    clipped = true;
  }
  if (clipped) words[words.length - 1] = `${words.at(-1).replace(/[\s,.;:-]+$/, '')}…`;

  const whole = words.join(' ');
  if (textUnits(whole) <= maxUnits) return [whole];

  const candidates = [];
  const collect = (start, lines) => {
    if (start >= words.length) {
      if (lines.length <= maxLines) candidates.push(lines);
      return;
    }
    if (lines.length >= maxLines) return;

    for (let end = start + 1; end <= words.length; end += 1) {
      const line = words.slice(start, end).join(' ');
      if (textUnits(line) > capacity && end > start + 1) break;
      collect(end, [...lines, line]);
    }
  };
  collect(0, []);

  const colonIndex = words.findIndex(word => /[:;—–]$/.test(word));
  const subtitleStart = colonIndex >= 0 ? colonIndex + 1 : -1;
  const subtitle = subtitleStart > 0 ? words.slice(subtitleStart).join(' ') : '';
  const protectSubtitle = subtitle && textUnits(subtitle) <= maxUnits * 1.03;

  const score = lines => {
    const widths = lines.map(textUnits);
    const target = widths.reduce((sum, width) => sum + width, 0) / widths.length;
    let value = lines.length * 18;

    widths.forEach(width => {
      value += (width - target) ** 2;
      if (width > maxUnits) value += (width - maxUnits) ** 2 * 24;
    });

    const finalWords = lines.at(-1).split(' ').filter(Boolean);
    if (finalWords.length === 1 && words.length > 2) value += 10000;
    if (finalWords.length === 2 && widths.at(-1) < Math.max(...widths) * 0.38) value += 2400;
    if (widths.at(-1) < Math.max(...widths) * 0.48) value += 3200;

    lines.forEach((line, index) => {
      const lineWords = line.split(' ').filter(Boolean);
      const firstWord = lineWords[0] || '';
      const finalWord = lineWords.at(-1) || '';
      if (index < lines.length - 1 && lineWords.length === 1 && !/[:;—–]$/.test(line)) value += 8000;
      if (index > 0 && weakWord.test(firstWord)) value += 900;
      if (index < lines.length - 1 && weakWord.test(finalWord)) value += 1200;
      if (index < lines.length - 1 && /[:;—–]$/.test(line)) value -= 520;
      if (index < lines.length - 1 && /\bVS\.?$/i.test(line)) value += 1600;
    });

    if (protectSubtitle) {
      const subtitleLine = lines.findIndex(line => line.split(' ').includes(words[subtitleStart]));
      if (subtitleLine < 0 || lines.slice(subtitleLine).join(' ') !== subtitle) value += 7200;
    }

    return value;
  };

  return candidates.sort((first, second) => score(first) - score(second))[0] || [whole];
}
