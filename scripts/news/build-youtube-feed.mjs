import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const API="https://www.googleapis.com/youtube/v3";
const MAX_AGE_MS=48*60*60*1000;
const MAX_PER_CHANNEL=5;
const channels=[
  {name:"MMA Junkie",handle:"@MMAJunkieOfficial"},
  {name:"MMA Fighting",handle:"@MMAFighting"},
  {name:"UFC",handle:"@ufc"},
  {name:"PFL MMA",handle:"@PFLMMA"},
  {name:"ONE Championship",handle:"@ONEChampionship"}
];

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

function bestThumbnail(thumbnails={}){
  return thumbnails.maxres?.url||thumbnails.standard?.url||thumbnails.high?.url||thumbnails.medium?.url||thumbnails.default?.url||"";
}

async function channelVideos(config){
  const channelData=await youtube("channels",{part:"snippet,contentDetails",forHandle:config.handle,maxResults:1});
  const channel=channelData.items?.[0];
  if(!channel)throw new Error("channel not found for "+config.handle);
  const playlistId=channel.contentDetails?.relatedPlaylists?.uploads;
  if(!playlistId)throw new Error("uploads playlist missing for "+config.handle);
  const playlist=await youtube("playlistItems",{part:"snippet,contentDetails",playlistId,maxResults:MAX_PER_CHANNEL});
  return (playlist.items||[]).map(item=>({
    videoId:item.contentDetails?.videoId||item.snippet?.resourceId?.videoId||"",
    title:item.snippet?.title||"",
    channel:config.name,
    channelId:channel.id,
    channelUrl:"https://www.youtube.com/"+config.handle,
    publishedAt:item.contentDetails?.videoPublishedAt||item.snippet?.publishedAt||"",
    thumbnail:bestThumbnail(item.snippet?.thumbnails)
  })).filter(v=>v.videoId&&v.title&&v.publishedAt);
}

let videos=[];
const errors=[];
if(apiKey){
  for(const channel of channels){
    try{videos.push(...await channelVideos(channel))}
    catch(error){errors.push(channel.name+": "+error.message)}
  }
}else{
  errors.push("YOUTUBE_API_KEY is not configured");
}

const cutoff=Date.now()-MAX_AGE_MS;
videos=videos
  .filter(v=>{const t=Date.parse(v.publishedAt);return Number.isFinite(t)&&t>=cutoff&&t<=Date.now()+5*60*1000})
  .sort((a,b)=>b.publishedAt.localeCompare(a.publishedAt))
  .slice(0,30);

const output={version:1,generatedAt:new Date().toISOString(),maxAgeHours:48,channels:channels.map(c=>c.name),videos,...(errors.length?{warnings:errors}:{})};
await mkdir(dirname(destination),{recursive:true});
await writeFile(destination,JSON.stringify(output,null,2)+"\n");
console.log("Wrote "+videos.length+" recent YouTube uploads to "+destination);
if(errors.length)console.warn(errors.join("\n"));
