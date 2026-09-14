const targets = [
  {
    label: 'Bellator 99 modern Tapology CDN',
    url: 'https://images.tapology.com/poster_images/19438/profile/Bellator_99_Poster.jpg?1379101839'
  },
  {
    label: 'WSOF 5 modern Tapology CDN',
    url: 'https://images.tapology.com/poster_images/19388/profile/World_Series_of_Fighting_5_Poster.jpg?1376880235'
  },
  {
    label: 'WSOF 13 modern Tapology CDN',
    url: 'https://images.tapology.com/poster_images/25740/profile/WSOF_13_Moraes_vs._Bollinger_Poster.png?1410621128'
  },
  {
    label: 'WSOF 13 original S3 asset',
    url: 'https://s3.amazonaws.com/tapology-images/poster_images/25740/profile/WSOF_13_Moraes_vs._Bollinger_Poster.png?1410621128'
  },
  {
    label: 'Bellator 161 Bellator-supplied MMAWeekly asset',
    url: 'https://www.mmaweekly.com/.image/w_3840%2Cq_auto%3Agood%2Cc_limit/MTk4NTI0MjM5NjU3MDUyMDcx/bellator-161-kongo-vs-johnson-fight-poster.jpg'
  }
];

async function probe(target) {
  console.log(`\n=== ${target.label} ===`);
  try {
    const response = await fetch(target.url, {
      redirect: 'follow',
      signal: AbortSignal.timeout(20000),
      headers: {
        'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/152 Safari/537.36 MMA-Matlock-Poster-Probe/3.0',
        accept: 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8'
      }
    });
    const type = response.headers.get('content-type') || '';
    const length = response.headers.get('content-length') || '';
    const bytes = response.ok ? (await response.arrayBuffer()).byteLength : 0;
    console.log(`HTTP ${response.status} -> ${response.url}`);
    console.log(`content-type=${type || '(missing)'} content-length=${length || '(missing)'} bytes=${bytes}`);
    if (!response.ok) process.exitCode = 1;
    if (response.ok && !type.toLowerCase().startsWith('image/')) {
      console.log('ERROR: endpoint did not return an image');
      process.exitCode = 1;
    }
    if (response.ok && bytes < 5000) {
      console.log('ERROR: image payload is suspiciously small');
      process.exitCode = 1;
    }
  } catch (error) {
    console.log(`FETCH ERROR: ${error?.name}: ${error?.message}`);
    process.exitCode = 1;
  }
}

for (const target of targets) await probe(target);
