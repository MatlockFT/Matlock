import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const API="https://www.googleapis.com/youtube/v3";
const MAX_AGE_MS=48*60*60*1000;
const MAX_PER_CHANNEL=6;
let channels=[
  {name:"MMA Junkie",handle:"@MMAJunkieOfficial"},
  {name:"MMA Fighting",handle:"@MMAFighting"},
  {name:"UFC",handle:"@ufc"},
  {name:"PFL MMA",handle:"@PFLMMA"},
  {name:"ONE Championship",handle:"@ONEChampionship"}
];

async function broadcastControlConfig(){
  for(const path of ["assets/uploads/system/broadcast-control.json","assets/data/broadcast-control.json"]){
    try{return JSON.parse(await readFile(resolve(path),"utf8"))}catch{}
  }
  return{}
}

const broadcastControl=await broadcastControlConfig();
for(const channel of broadcastControl?.sources?.customVideoChannels||[]){
  const name=String(channel?.name||"").trim();
  const handle=String(channel?.handle||"").trim();
  if(!name||!/^@[A-Za-z0-9._-]+$/.test(handle)||channels.some(item=>item.name.toLowerCase()===name.toLowerCase()))continue;
  channels.push({name,handle});
}

function argumentValue(name){const i=process.argv.indexOf(name);return i>=0?process.argv[i+1]:""}
const destination=resolve(argumentValue("--output")||"assets/data/mma-videos.json");
const apiKey=process.env.YOUTUBE_API_KEY||"";

async function youtube(path,params){
  const url=new URL(API+"/"+path);
  Object.entries({...params,key:apiKey}).forEach(([k,v])=>url.searchParams.set(k,String(v)));
  const response=await fetch(url,{headers:{accept:"application/json"}});
  if(!response.ok)throw new Error("YouTube API "+response.status);
  return response.json();
}
function bestThumbnail(t={}){return t.maxres?.url||t.standard?.url||t.high?.url||t.medium?.url||t.default?.url||""}
function isoDurationSeconds(value=""){
  const m=value.match(/^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/);if(!m)return 0;
  return Number(m[1]||0)*3600+Number(m[2]||0)*60+Number(m[3]||0);
}
async function channelVideos(config){
  const channelData=await youtube("channels",{part:"snippet,contentDetails",forHandle:config.handle,maxResults:1});
  const channel=channelData.items?.[0];if(!channel)throw new Error("channel not found for "+config.handle);
  const playlistId=channel.contentDetails?.relatedPlaylists?.uploads;if(!playlistId)throw new Error("uploads playlist missing for "+config.handle);
  const playlist=await youtube("playlistItems",{part:"snippet,contentDetails",playlistId,maxResults:MAX_PER_CHANNEL});
  return (playlist.items||[]).map(item=>({
    videoId:item.contentDetails?.videoId||item.snippet?.resourceId?.videoId||"",
    title:item.snippet?.title||"",channel:config.name,channelId:channel.id,channelUrl:"https://www.youtube.com/"+config.handle,
    publishedAt:item.contentDetails?.videoPublishedAt||item.snippet?.publishedAt||"",thumbnail:bestThumbnail(item.snippet?.thumbnails)
  })).filter(v=>v.videoId&&v.title&&v.publishedAt);
}
async function enrichVideos(items){
  const ids=[...new Set(items.map(v=>v.videoId))];if(!ids.length)return items;
  const details=await youtube("videos",{part:"contentDetails,status,snippet",id:ids.join(","),maxResults:50});
  const map=new Map((details.items||[]).map(v=>[v.id,v]));
  return items.map(item=>{const d=map.get(item.videoId);return {...item,durationSeconds:isoDurationSeconds(d?.contentDetails?.duration||""),embeddable:d?.status?.embeddable!==false,liveBroadcastContent:d?.snippet?.liveBroadcastContent||"none"}})
}

let videos=[];const errors=[];
if(apiKey){
  for(const channel of channels){try{videos.push(...await channelVideos(channel))}catch(error){errors.push(channel.name+": "+error.message)}}
  try{videos=await enrichVideos(videos)}catch(error){errors.push("Video details: "+error.message)}
}else errors.push("YOUTUBE_API_KEY is not configured");

const cutoff=Date.now()-MAX_AGE_MS;
videos=videos.filter(v=>{const t=Date.parse(v.publishedAt);return Number.isFinite(t)&&t>=cutoff&&t<=Date.now()+5*60*1000&&v.embeddable!==false})
  .sort((a,b)=>b.publishedAt.localeCompare(a.publishedAt)).slice(0,30);

const output={version:2,generatedAt:new Date().toISOString(),maxAgeHours:48,channels:channels.map(c=>c.name),videos,...(errors.length?{warnings:errors}:{})};
await mkdir(dirname(destination),{recursive:true});await writeFile(destination,JSON.stringify(output,null,2)+"\n");
console.log("Wrote "+videos.length+" embeddable recent YouTube uploads to "+destination);if(errors.length)console.warn(errors.join("\n"));