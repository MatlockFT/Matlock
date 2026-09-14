const targets = [
  {
    label: 'Bellator 29 contemporary poster image',
    url: 'https://3.bp.blogspot.com/_CidG1Uy6Fvg/TIUeZgFRXCI/AAAAAAAABLc/-sA84ePwKvc/s640/bell.jpeg-001-001.jpg'
  },
  {
    label: 'Pancrase Blow 7 official archive main artwork',
    url: 'https://www.pancrase.co.jp/tourarchive/2006/0916/img/main.jpg'
  }
];

for (const target of targets) {
  console.log(`\n=== ${target.label} ===`);
  try {
    const response = await fetch(target.url, {
      redirect: 'follow',
      signal: AbortSignal.timeout(20000),
      headers: {
        'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/152 Safari/537.36 MMA-Matlock-Poster-Probe/5.0',
        accept: 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8'
      }
    });
    const type = response.headers.get('content-type') || '';
    const length = response.headers.get('content-length') || '';
    const bytes = response.ok ? (await response.arrayBuffer()).byteLength : 0;
    console.log(`HTTP ${response.status} -> ${response.url}`);
    console.log(`content-type=${type || '(missing)'} content-length=${length || '(missing)'} bytes=${bytes}`);
    if (!response.ok || !type.toLowerCase().startsWith('image/') || bytes < 5000) process.exitCode = 1;
  } catch (error) {
    console.log(`FETCH ERROR: ${error?.name}: ${error?.message}`);
    process.exitCode = 1;
  }
}
