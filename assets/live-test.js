(() => {
  const root=document.querySelector('[data-live-test]');
  if(!root)return;

  const video=root.querySelector('[data-live-video]');
  const status=root.querySelector('[data-live-status]');
  const detail=root.querySelector('[data-live-detail]');
  const audio=root.querySelector('[data-live-audio]');
  const params=new URLSearchParams(location.search);
  const source=params.get('src')||root.dataset.streamUrl;

  let hls=null;
  let retryTimer=0;
  let retryDelay=1500;

  const setState=(live,message)=>{
    root.classList.toggle('is-live',Boolean(live));
    status.textContent=message;
  };

  const clearRetry=()=>{
    if(retryTimer)window.clearTimeout(retryTimer);
    retryTimer=0;
  };

  const scheduleRetry=()=>{
    clearRetry();
    setState(false,'Reconnecting…');
    retryTimer=window.setTimeout(()=>{
      retryDelay=Math.min(15000,Math.round(retryDelay*1.6));
      start();
    },retryDelay);
  };

  const bindVideoEvents=()=>{
    video.addEventListener('playing',()=>{
      retryDelay=1500;
      setState(true,'Live');
    });
    video.addEventListener('waiting',()=>{
      if(!video.paused)setState(false,'Buffering…');
    });
    video.addEventListener('stalled',()=>setState(false,'Reconnecting…'));
    video.addEventListener('error',()=>scheduleRetry());
  };

  const destroyHls=()=>{
    clearRetry();
    if(hls){
      try{hls.destroy()}catch{}
      hls=null;
    }
    video.removeAttribute('src');
    try{video.load()}catch{}
  };

  const startNative=()=>{
    destroyHls();
    video.src=source;
    const play=video.play();
    if(play?.catch)play.catch(()=>{});
  };

  const startHlsJs=()=>{
    destroyHls();
    hls=new window.Hls({
      lowLatencyMode:true,
      backBufferLength:30,
      liveSyncDurationCount:3,
      liveMaxLatencyDurationCount:8
    });

    hls.on(window.Hls.Events.MEDIA_ATTACHED,()=>hls.loadSource(source));
    hls.on(window.Hls.Events.MANIFEST_PARSED,()=>{
      const play=video.play();
      if(play?.catch)play.catch(()=>{});
    });
    hls.on(window.Hls.Events.ERROR,(_event,data)=>{
      if(!data?.fatal)return;

      if(data.type===window.Hls.ErrorTypes.NETWORK_ERROR){
        try{hls.startLoad()}catch{}
        scheduleRetry();
        return;
      }

      if(data.type===window.Hls.ErrorTypes.MEDIA_ERROR){
        try{hls.recoverMediaError();return}catch{}
      }

      scheduleRetry();
    });

    hls.attachMedia(video);
  };

  const start=()=>{
    clearRetry();
    setState(false,'Connecting…');

    if(video.canPlayType('application/vnd.apple.mpegurl')){
      startNative();
      return;
    }

    if(window.Hls?.isSupported()){
      startHlsJs();
      return;
    }

    setState(false,'HLS unsupported');
    detail.textContent='This browser cannot play the HLS test stream.';
  };

  audio.addEventListener('click',()=>{
    video.muted=!video.muted;
    audio.textContent=video.muted?'Turn sound on':'Mute';
    if(!video.paused){
      const play=video.play();
      if(play?.catch)play.catch(()=>{});
    }
  });

  bindVideoEvents();
  start();

  window.addEventListener('beforeunload',destroyHls,{once:true});
})();
