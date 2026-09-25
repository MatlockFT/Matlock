(() => {
  const app=document.querySelector('[data-broadcast-control-app]');if(!app)return;
  const authBase=String(app.dataset.authBase||'').replace(/\/$/,'');
  const repo=app.dataset.repo||'MatlockFT/Matlock';
  const connect=app.querySelector('[data-github-connect]');
  const dialog=app.querySelector('[data-auth-dialog]');
  const oauth=app.querySelector('[data-github-oauth]');
  const status=app.querySelector('[data-oauth-status]');
  const token=app.querySelector('[data-github-token]');
  const authorize=app.querySelector('[data-github-authorize]');
  const signout=app.querySelector('[data-github-signout]');
  const SESSION_ID_KEY='matlock-writer:server-session',SESSION_LOGIN_KEY='matlock-writer:server-login',PAT_KEY='matlock-broadcast:pat-session';
  let credential='',login='',popup=null;

  const localRead=k=>{try{return localStorage.getItem(k)||''}catch{return''}};
  const localWrite=(k,v)=>{try{v?localStorage.setItem(k,v):localStorage.removeItem(k)}catch{}};
  const sessionRead=k=>{try{return sessionStorage.getItem(k)||''}catch{return''}};
  const sessionWrite=(k,v)=>{try{v?sessionStorage.setItem(k,v):sessionStorage.removeItem(k)}catch{}};
  const setStatus=(m,state='')=>{if(status){status.textContent=m;status.dataset.state=state}};
  const setConnected=(name='GitHub user')=>{login=name;connect.textContent='GitHub ✓';connect.title='Connected as '+name;if(signout)signout.hidden=false;window.dispatchEvent(new CustomEvent('matlock-broadcast:auth',{detail:{login:name}}))};
  const clear=()=>{credential='';login='';connect.textContent='GitHub';connect.title='Connect GitHub';if(signout)signout.hidden=true};

  async function verifySession(id){
    if(!id||!authBase)return null;
    try{
      const r=await fetch(authBase+'/api/writer/session',{headers:{Accept:'application/json','X-Writer-Session':id},cache:'no-store',mode:'cors'});
      const d=await r.json().catch(()=>({}));return r.ok&&d.ok?d:null;
    }catch{return null}
  }
  async function githubFetch(path,options={},requireAuth=true){
    if(requireAuth&&!credential)throw new Error('Sign in with GitHub first.');
    const method=options.method||'GET';let response;
    if(credential.startsWith('session:')){
      const id=credential.slice(8);
      response=await fetch(authBase+'/api/writer/github?path='+encodeURIComponent(path),{...options,method,mode:'cors',headers:{Accept:'application/json','X-Writer-Session':id,...(options.headers||{})}});
    }else{
      const headers={Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28',...(options.headers||{})};
      if(credential)headers.Authorization='Bearer '+credential;
      response=await fetch('https://api.github.com/repos/'+repo+path,{...options,method,headers});
    }
    if(!response.ok){
      const d=await response.json().catch(()=>({}));
      if(response.status===401){clear();window.dispatchEvent(new CustomEvent('matlock-broadcast:auth-expired'))}
      throw new Error(d.message||d.error||response.status+' '+response.statusText);
    }
    return response.status===204?null:response.json();
  }
  async function connectCredential(value,name=''){
    credential=value;
    try{
      const info=await githubFetch('',{},true);
      setConnected(name||info.owner?.login||'GitHub user');
      token.value='';if(dialog.open)dialog.close();setStatus('Connected.','success');
    }catch(e){credential='';setStatus(e.message,'error');throw e}
  }
  async function restore(){
    const id=localRead(SESSION_ID_KEY);
    if(id){
      setStatus('Restoring GitHub session…','working');
      const s=await verifySession(id);
      if(s){credential='session:'+id;localWrite(SESSION_LOGIN_KEY,s.login||'GitHub user');setConnected(s.login||'GitHub user');setStatus('Signed in as '+(s.login||'GitHub user')+'.','success');return}
      localWrite(SESSION_ID_KEY,'');localWrite(SESSION_LOGIN_KEY,'');
    }
    const pat=sessionRead(PAT_KEY);if(pat)connectCredential(pat).catch(()=>sessionWrite(PAT_KEY,''));
    else setStatus('Sign in to apply changes live.');
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
  authorize.addEventListener('click',async()=>{const v=token.value.trim();if(!v)return;sessionWrite(PAT_KEY,v);await connectCredential(v).catch(()=>{})});
  signout?.addEventListener('click',async()=>{
    const id=localRead(SESSION_ID_KEY);
    if(id&&authBase){try{await fetch(authBase+'/api/writer/session',{method:'DELETE',headers:{'X-Writer-Session':id},mode:'cors'})}catch{}}
    localWrite(SESSION_ID_KEY,'');localWrite(SESSION_LOGIN_KEY,'');sessionWrite(PAT_KEY,'');clear();location.reload();
  });
  window.addEventListener('message',async event=>{
    let origin='';try{origin=new URL(authBase).origin}catch{}
    if(!origin||event.origin!==origin)return;
    const m=event.data;if(!m||m.type!=='matlock-writer-github-auth')return;
    if(popup&&!popup.closed)popup.close();popup=null;
    if(!m.ok||!m.sessionId){setStatus(m.error||'GitHub sign-in failed.','error');return}
    localWrite(SESSION_ID_KEY,m.sessionId);localWrite(SESSION_LOGIN_KEY,m.login||'GitHub user');sessionWrite(PAT_KEY,'');
    credential='session:'+m.sessionId;setConnected(m.login||'GitHub user');setStatus('Signed in as '+(m.login||'GitHub user')+'.','success');if(dialog.open)dialog.close();
  });
  window.MatlockBroadcastAuth={githubFetch,isConnected:()=>Boolean(credential),getLogin:()=>login,open:()=>dialog.showModal()};
  restore();
})();