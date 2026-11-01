/* Browser-to-Drive workspace replication.
 * Uses the site's existing Google Identity OAuth access token. Only the dedicated,
 * private Drive JSON file created by this app is read/written.
 * Never use the reporting spreadsheet as a source of editable local sessions.
 */
(() => {
  'use strict';
  const FILE_NAME = 'copper47-workspace-sync-v1.json';
  const META_KEY = 'copper47.cloud.v1';
  const FORMAT = 'copper47.cloud.v1';
  const API = 'https://www.googleapis.com/drive/v3/files';
  const UPLOAD = 'https://www.googleapis.com/upload/drive/v3/files';
  const POLL_MS = 30000;
  let working = false, applying = false, generation = 0, pending = null, fileId = '', lastOk = 0;
  let baselineState = readJSON(META_KEY) || {fileId:'',signatures:{}};
  if (!baselineState || typeof baselineState !== 'object' ||
      !baselineState.signatures || typeof baselineState.signatures !== 'object') {
    baselineState = {fileId:'',signatures:{}};
  }

  const status = (heading, message) => {
    $('cloudStatus').textContent = heading;
    $('cloudMessage').textContent = message;
    $('cloudSyncNow').disabled = !driveReady() || working;
  };
  const editable = () => !focusMode && !running && !editingFightId &&
    $('scoreOverlay').classList.contains('hidden') &&
    $('finishOverlay').classList.contains('hidden') &&
    $('editFightOverlay').classList.contains('hidden');
  const schedule = (ms = 3500) => {
    clearTimeout(pending);
    if (!driveReady() || !editable()) return;
    pending = setTimeout(() => {pending=null;sync(false)}, ms);
  };
  const signature = item => {
    const s = JSON.stringify(item);
    let a = 2166136261, b = 2971215073;
    for (let i=0; i<s.length; i++) {
      a = Math.imul(a ^ s.charCodeAt(i), 16777619);
      b = Math.imul(b ^ s.charCodeAt(i), 2246822519);
    }
    return s.length+':'+(a>>>0).toString(16)+':'+(b>>>0).toString(16);
  };
  const fingerprints = events => Object.fromEntries(events.map(e=>[e.id,signature(e)]));
  const same = (a,b) => JSON.stringify(a)===JSON.stringify(b);
  const localWorkspace = () => ({
    version:2,selected:null,events:data.events,
    masterSheetId:data.masterSheetId||null,
    ...(data.masterSyncedAt?{masterSyncedAt:data.masterSyncedAt}:{})
  });
  const parseRemote = text => {
    const payload = JSON.parse(text);
    if (!payload || payload.format!==FORMAT || !payload.workspace)
      throw Error('The remote workspace has an unrecognized format; nothing was overwritten.');
    const w = validate(payload.workspace);
    upgradeCornerLayout(w);
    return w;
  };
  const decodeError = async response => {
    let message = '';
    try {message=(await response.json())?.error?.message||''}catch {}
    if(response.status===401){driveToken='';driveExpires=0;updateDriveUI()}
    throw Error(message||'Google Drive request failed (HTTP '+response.status+').');
  };
  async function request(url,opts={}) {
    if (!driveReady()) throw Error('Google connection expired. Reconnect Google to continue syncing.');
    const response = await fetch(url, {
      ...opts, headers:{Authorization:'Bearer '+driveToken,...opts.headers}
    });
    if(!response.ok)await decodeError(response);
    return response;
  }
  async function discover() {
    const q = new URLSearchParams({
      q:"name = '"+FILE_NAME+"' and trashed = false",
      fields:'nextPageToken,files(id,name,mimeType,modifiedTime,version)',
      pageSize:'100'
    });
    const all=[];
    do {
      const result=await (await request(API+'?'+q.toString())).json();
      all.push(...(result.files||[]).filter(f=>f.mimeType==='application/json'));
      if(all.length>1)throw Error('Multiple workspace backup files exist in Drive. Move or rename extra copies before syncing.');
      if(!result.nextPageToken)break;
      q.set('pageToken',result.nextPageToken);
    }while(true);
    return all[0]||null;
  }
  async function readCloud(id) {
    const [raw,meta] = await Promise.all([
      request(API+'/'+encodeURIComponent(id)+'?alt=media'),
      request(API+'/'+encodeURIComponent(id)+'?fields=id,version,modifiedTime')
    ]);
    return {workspace:parseRemote(await raw.text()),version:(await meta.json()).version};
  }
  async function versionOf(id) {
    return (await (await request(API+'/'+encodeURIComponent(id)+'?fields=version')).json()).version;
  }
  async function writeCloud(id,workspace) {
    const body = JSON.stringify({format:FORMAT,updatedAt:new Date().toISOString(),workspace});
    if(body.length>4500000)throw Error('Workspace exceeds 4.5 MB. Export JSON and reduce old observations before Drive sync.');
    if(id) {
      return (await (await request(UPLOAD+'/'+encodeURIComponent(id)+'?uploadType=media&fields=id,version',{
        method:'PATCH',headers:{'Content-Type':'application/json'},body
      })).json()).id;
    }
    const boundary = 'workspace'+Math.random().toString(36).slice(2);
    const multipart = '--'+boundary+'\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n'+
      JSON.stringify({name:FILE_NAME,mimeType:'application/json',description:'Private workspace backup for cross-device event sync'})+
      '\r\n--'+boundary+'\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n'+
      body+'\r\n--'+boundary+'--';
    const out = await (await request(UPLOAD+'?uploadType=multipart&fields=id,version',{
      method:'POST',headers:{'Content-Type':'multipart/related; boundary='+boundary},
      body:multipart
    })).json();
    if(!out.id)throw Error('Google Drive did not return a backup file ID.');
    return out.id;
  }
  function copyEvent(e) {
    const next=JSON.parse(JSON.stringify(e));
    next.id=uid();
    next.name=(String(e.name||'Untitled event').slice(0,158)+' (conflict copy)');
    for(const f of next.fights)f.id=uid();
    return next;
  }
  function reconcile(local,remote,base) {
    const l=new Map(local.events.map(e=>[e.id,e]));
    const r=new Map(remote.events.map(e=>[e.id,e]));
    const events=[],seen=new Set([...r.keys(),...l.keys()]);
    let conflicts=0,selectedCopy=null;
    for(const id of seen) {
      const le=l.get(id),re=r.get(id);
      const ls=le?signature(le):null,rs=re?signature(re):null;
      const before=Object.prototype.hasOwnProperty.call(base,id)?base[id]:undefined;
      if(ls===rs){if(le)events.push(le);continue;}
      if(before!==undefined){
        if(ls===before){if(re)events.push(re);continue;}
        if(rs===before){if(le)events.push(le);continue;}
      } else if(!le||!re) {
        events.push(le||re);continue;
      }
      // Both devices changed the same ID (or deletion conflicts with an edit).
      // Keep the cloud record and preserve the independent local work as a copy.
      if(re)events.push(re);
      if(le){
        const copy=copyEvent(le);
        events.push(copy);conflicts++;
        if(data.selected===id)selectedCopy=copy.id;
      }
      if(!le&&re)conflicts++;
    }
    if(events.length>200)throw Error('Merge would exceed the 200-event limit. Export both copies before retrying.');
    const workspace={
      version:2,selected:null,events,
      masterSheetId:local.masterSheetId||remote.masterSheetId||null,
      ...(local.masterSyncedAt||remote.masterSyncedAt?
        {masterSyncedAt:local.masterSyncedAt||remote.masterSyncedAt}:{})
    };
    validate(workspace);
    return {workspace,conflicts,selectedCopy};
  }
  function applyWorkspace(workspace,selectedCopy) {
    const current=localWorkspace();
    if(same(current,workspace))return;
    const selection=selectedCopy||data.selected;
    applying=true;
    try {
      data.events=workspace.events;
      data.masterSheetId=workspace.masterSheetId;
      if(workspace.masterSyncedAt)data.masterSyncedAt=workspace.masterSyncedAt;
      else delete data.masterSyncedAt;
      data.selected=data.events.some(e=>e.id===selection)?selection:(data.events[0]?.id||null);
      if(!persist())throw Error('Local browser save failed. Your cloud backup was not changed.');
      renderDashboard();
    } finally {applying=false;}
  }
  function markSynced(id,events) {
    baselineState={fileId:id,signatures:fingerprints(events)};
    try{localStorage.setItem(META_KEY,JSON.stringify(baselineState))}catch{}
    fileId=id;lastOk=Date.now();
  }
  async function sync(manual=false) {
    if(working)return;
    if(!driveReady()){status('Not connected','Connect Google to continue cross-device sync.');return;}
    if(!editable()){
      if(manual)toast('Return to the event list to sync changes safely.');
      return;
    }
    if(!manual&&document.activeElement?.matches('input,textarea,select')){schedule(4000);return;}
    working=true;clearTimeout(pending);pending=null;
    $('cloudSyncNow').disabled=true;
    status('Syncing','Checking Google Drive and merging changes…');
    try {
      // Refuse to overwrite while the user is recording or editing on this page.
      for(let attempt=0;attempt<3;attempt++) {
        const startGeneration=generation;
        const listing=await discover();
        const remoteId=listing?.id||'';
        if(remoteId!==baselineState.fileId)baselineState={fileId:remoteId,signatures:{}};
        const remote=remoteId?await readCloud(remoteId):
          {workspace:{version:2,selected:null,events:[],masterSheetId:null},version:null};
        if(startGeneration!==generation || !editable()) {schedule(4000);return;}
        const merged=reconcile(localWorkspace(),remote.workspace,baselineState.signatures);
        // Ensure a device that is already editing did not change after the merge.
        if(startGeneration!==generation || !editable()) {schedule(4000);return;}
        if(remoteId) {
          const latestVersion=await versionOf(remoteId);
          if(String(latestVersion)!==String(remote.version))continue;
        }
        if(startGeneration!==generation || !editable()) {schedule(4000);return;}
        const uploadNeeded=!remoteId||!same(remote.workspace,merged.workspace);
        const resultingId=uploadNeeded?await writeCloud(remoteId,merged.workspace):remoteId;
        applyWorkspace(merged.workspace,merged.selectedCopy);
        markSynced(resultingId,merged.workspace.events);
        const stamp=new Date(lastOk).toLocaleString();
        status('Synced',merged.conflicts?
          'Synced '+stamp+'. '+merged.conflicts+' conflicting event(s) kept as separate copies; review them before deleting anything.':
          'Synced '+stamp+' · '+merged.workspace.events.length+' event(s) in Google Drive.');
        if(merged.conflicts)toast('Different edits found. A conflict copy was kept to protect your scores.');
        else if(manual)toast('All events are synced with Google Drive.');
        return;
      }
      throw Error('Drive changed during sync. Try Sync now again; local records are safe.');
    } catch(err) {
      status('Sync error',err.message+'. Local records remain available. Export backup before clearing browser data.');
      if(manual)toast('Drive sync failed: '+err.message);
    } finally {
      working=false;$('cloudSyncNow').disabled=!driveReady();
      updateDriveUI();
    }
  }
  window.copperCloud = {
    busy:()=>working,
    connected:()=>{status('Connected','Loading and merging your Google Drive workspace…');sync(true);},
    disconnected:()=>{clearTimeout(pending);pending=null;status('Not connected','Local records remain on this computer. Connect Google to sync again.');},
    changed:()=>{if(applying)return;generation++;schedule();},
    dashboard:()=>{if(driveReady())schedule(1200);},
    sync:()=>sync(true),
    resetBaseline:()=>{
      baselineState={fileId:baselineState.fileId,signatures:{}};
      try{localStorage.setItem(META_KEY,JSON.stringify(baselineState))}catch{}
    }
  };
  $('cloudSyncNow').onclick=()=>sync(true);
  setInterval(()=>{
    if(!driveReady()){
      if(lastOk&&$('cloudStatus').textContent!=='Not connected'){
        status('Reconnect Google','Google authorization expired. Reconnect to resume syncing; your local data is safe.');
      }
      return;
    }
    if(editable()&&!working)sync(false);
  },POLL_MS);
})();
