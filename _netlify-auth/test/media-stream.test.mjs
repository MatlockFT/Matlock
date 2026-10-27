import test from 'node:test';
import assert from 'node:assert/strict';
import { uploadAsset, chunkStream } from '../netlify/functions/writer-media-process-background.mjs';

test('Netlify streams a 200 MiB staged video to GitHub with exact bytes and bounded chunk reads',async()=>{
 const fileSize=200*1024**2, chunkBytes=3500000, chunkCount=Math.ceil(fileSize/chunkBytes);
 let read=0,received=0,largest=0;
 const store={async get(){const bytes=Math.min(chunkBytes,fileSize-read);read+=bytes;largest=Math.max(largest,bytes);return new Uint8Array(bytes).buffer;}};
 const original=globalThis.fetch;
 globalThis.fetch=async(url,options)=>{
  assert.equal(url,'https://uploads.github.com/test?name=large.mp4');
  assert.equal(Number(options.headers['Content-Length']),fileSize);
  const reader=options.body.getReader();
  for(;;){const part=await reader.read();if(part.done)break;received+=part.value.length;}
  return Response.json({id:123,size:received,browser_download_url:'https://github.com/MatlockFT/Matlock/releases/download/test/large.mp4'},{status:201});
 };
 try{const asset=await uploadAsset('fake_server_token',{upload_url:'https://uploads.github.com/test{?name,label}'},store,'scope','upload',{assetName:'large.mp4',fileSize,fileType:'video/mp4',chunkCount});assert.equal(asset.size,fileSize);assert.equal(received,fileSize);assert.ok(largest<=3500000);}finally{globalThis.fetch=original;}
});
test('a missing staged part fails instead of silently publishing a truncated file',async()=>{
 const stream=chunkStream({async get(){return null;}},'scope','upload',1);
 await assert.rejects(new Response(stream).arrayBuffer(),/Missing staged media chunk/);
});
