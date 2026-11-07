/* Automatic, conservative master-sheet archive when workspace sync is healthy.
 * Does not create a new master automatically or overwrite remote newer data.
 * The editable workspace remains local-first and Cloud Drive JSON is authoritative.
 */
(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const ENABLE_KEY = 'copper47.autoMaster.enabled.v1';
  const SIG_KEY = 'copper47.autoMaster.lastSignature.v1';
  const DEFAULT_IDLE_MS = 45000;
  const RETRY_MS = 5 * 60 * 1000;
  let timer = null;
  let archiveRunning = false;
  let lastAttempt = 0;
  const checkbox = $('autoMasterArchive');
  const indicator = $('autoMasterStatus');
  const read = (key, fallback) => {
    try { const value = localStorage.getItem(key); return value === null ? fallback : value } catch {return fallback}
  };
  const enabled = () => !!checkbox?.checked;
  const safeToArchive = () => enabled() && !!data.masterSheetId && driveReady() &&
    !focusMode && !running && !driveBusy && !archiveRunning &&
    $('dashboard') && !$('dashboard').classList.contains('hidden') &&
    document.visibilityState !== 'hidden' &&
    $('cloudStatus').textContent === 'Synced' && !!window.copperCloud?.upToDate?.();
  // Ignore sync timestamps in the fingerprint, otherwise successful archive
  // writes would indefinitely schedule themselves again.
  function signature() {
    const events = data.events.map(event => {
      const e = {...event};
      delete e.masterSyncedAt;
      delete e.sheetSyncedAt;
      return e;
    });
    const raw = JSON.stringify({
      masterSheetId: data.masterSheetId || '',
      removedEvents: data.removedEvents || {},
      events
    });
    let hash = 2166136261;
    for (let i=0;i<raw.length;i++) hash = Math.imul(hash ^ raw.charCodeAt(i),16777619);
    return (data.masterSheetId || '')+':'+raw.length+':'+(hash>>>0).toString(16);
  }
  const storedSignature = () => read(SIG_KEY,'');
  function status(message) {
    if (indicator) indicator.textContent = message;
  }
  function queue(ms=DEFAULT_IDLE_MS) {
    clearTimeout(timer);timer=null;
    if (!enabled()) {status('Automatic spreadsheet archiving is off.');return}
    if (!data.masterSheetId) {status('First link or create a master spreadsheet with Sync all events.');return}
    if (!driveReady()) {status('Connect Google to resume automatic archive updates.');return}
    if ($('cloudStatus').textContent !== 'Synced' || !window.copperCloud?.upToDate?.()) {
      status('Waiting for the editable workspace to finish syncing.');
      return;
    }
    if (signature() === storedSignature()) {
      status('Master spreadsheet is up to date.');
      return;
    }
    status('Changes pending · automatically updating after the workspace is idle.');
    timer=setTimeout(archiveIfReady,ms);
  }
  async function archiveIfReady() {
    timer=null;
    if (!safeToArchive()) return;
    if (Date.now()-lastAttempt<RETRY_MS && $('autoMasterStatus')?.dataset.retry === 'true') return;
    if (signature() === storedSignature()) {
      status('Master spreadsheet is up to date.');
      return;
    }
    archiveRunning=true;
    lastAttempt=Date.now();
    indicator.dataset.retry='';
    status('Updating master spreadsheet…');
    try {
      // The auto=true mode must never show a destructive overwrite confirmation.
      const success=await syncEvents(true,true);
      if (!success) throw Error('Automatic archive did not complete.');
      const verified=signature();
      try {localStorage.setItem(SIG_KEY,verified)} catch {}
      status('Master spreadsheet synced automatically.');
    } catch(error) {
      indicator.dataset.retry='true';
      status('Archive needs attention: '+String(error.message || error)+'. Use Sync all events to review.');
    } finally {
      archiveRunning=false;
    }
  }
  function markArchived() {
    try {localStorage.setItem(SIG_KEY,signature())} catch {}
    indicator.dataset.retry='';
    status('Master spreadsheet is up to date.');
  }
  checkbox.checked=read(ENABLE_KEY,'true') !== 'false';
  checkbox.addEventListener('change',() => {
    try {localStorage.setItem(ENABLE_KEY, checkbox.checked?'true':'false')} catch {}
    indicator.dataset.retry='';
    queue(1500);
  });
  document.addEventListener('visibilitychange',()=>{
    if (document.visibilityState==='visible') queue(15000);
  });
  window.copperAutoArchive = {
    changed:()=>queue(DEFAULT_IDLE_MS),
    cloudReady:()=>queue(15000),
    dashboard:()=>queue(15000),
    markArchived,
    enabled,
    flush:archiveIfReady
  };
  queue();
})();