(() => {
  const app=document.querySelector('[data-broadcast-control-app]');if(!app)return;
  const authBase=String(app.dataset.authBase||'').replace(/\/$/,'');
  const connect=app.querySelector('[data-github-connect]');
  const dialog=app.querySelector('[data-auth-dialog]');
  const oauth=app.querySelector('[data-github-oauth]');
  const status=app.querySelector('[data-oauth-status]');
  const signout=app.querySelector('[data-github-signout]');
  const SESSION_ID_KEY='matlock-writer:server-session',SESSION_LOGIN_KEY='matlock-writer:server-login';
  let sessionId='',login='',popup=null;

  const localRead=k=>{try{return localStorage.getItem(k)||''}catch{return''}};
  const localWrite=(k,v)=>{try{v?localStorage.setItem(k,v):localStorage.removeItem(k)}catch{}};
  const setStatus=(m,state='')=>{if(status){status.textContent=m;status.dataset.state=state}};
  const setConnected=(name='GitHub user')=>{login=name;connect.textContent='GitHub ✓';connect.title='Connected as '+name;if(signout)signout.hidden=false;window.dispatchEvent(new CustomEvent('matlock-broadcast:auth',{detail:{login:name}}))};
  const clear=()=>{sessionId='';login='';connect.textContent='GitHub';connect.title='Connect GitHub';if(signout)signout.hidden=true};

  async function verifySession(id){
    if(!id||!authBase)return null;
    try{
      const r=await fetch(authBase+'/api/writer/session',{headers:{Accept:'application/json','X-Writer-Session':id},cache:'no-store',mode:'cors'});
      const d=await r.json().catch(()=>({}));return r.ok&&d.ok?d:null;
    }catch{return null}
  }
  async function restore(){
    const id=localRead(SESSION_ID_KEY);
    if(!id){setStatus('Sign in to apply changes live.');return}
    setStatus('Restoring GitHub session…','working');
    const s=await verifySession(id);
    if(!s){localWrite(SESSION_ID_KEY,'');localWrite(SESSION_LOGIN_KEY,'');setStatus('Your previous session expired. Sign in again.','error');return}
    sessionId=id;localWrite(SESSION_LOGIN_KEY,s.login||'GitHub user');setConnected(s.login||'GitHub user');setStatus('Signed in as '+(s.login||'GitHub user')+'.','success');
  }
  function beginOAuth(){
    if(!authBase){dialog.showModal();setStatus('Auth bridge unavailable.','error');return}
    const url=authBase+'/auth/github/start?origin='+encodeURIComponent(location.origin);
    popup=window.open(url,'matlock-broadcast-github-auth','popup=yes,width=720,height=820,resizable=yes,scrollbars=yes');
    if(!popup){dialog.showModal();setStatus('Popup blocked. Allow popups and try again.','error');return}
    setStatus('Waiting for GitHub authorization…','working');
  }
  connect.addEventListener('click',()=>dialog.showModal());
  oauth.addEventListener('click',beginOAuth);
  signout?.addEventListener('click',async()=>{
    const id=sessionId||localRead(SESSION_ID_KEY);
    if(id&&authBase){try{await fetch(authBase+'/api/writer/session',{method:'DELETE',headers:{'X-Writer-Session':id},mode:'cors'})}catch{}}
    localWrite(SESSION_ID_KEY,'');localWrite(SESSION_LOGIN_KEY,'');clear();location.reload();
  });
  window.addEventListener('message',event=>{
    let origin='';try{origin=new URL(authBase).origin}catch{}
    if(!origin||event.origin!==origin)return;
    const m=event.data;if(!m||m.type!=='matlock-writer-github-auth')return;
    if(popup&&!popup.closed)popup.close();popup=null;
    if(!m.ok||!m.sessionId){setStatus(m.error||'GitHub sign-in failed.','error');return}
    sessionId=m.sessionId;localWrite(SESSION_ID_KEY,m.sessionId);localWrite(SESSION_LOGIN_KEY,m.login||'GitHub user');setConnected(m.login||'GitHub user');setStatus('Signed in as '+(m.login||'GitHub user')+'.','success');if(dialog.open)dialog.close();
  });
  window.addEventListener('matlock-broadcast:auth-expired',()=>{
    localWrite(SESSION_ID_KEY,'');localWrite(SESSION_LOGIN_KEY,'');clear();setStatus('Your GitHub session expired. Sign in again.','error');
  });
  window.MatlockBroadcastAuth={isConnected:()=>Boolean(sessionId),getSessionId:()=>sessionId,getLogin:()=>login,open:()=>dialog.showModal(),authBase:()=>authBase};
  restore();
})();