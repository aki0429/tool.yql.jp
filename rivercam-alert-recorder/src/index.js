import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import os from 'node:os';
import { loadConfig, ROOT, safeName, fetchJson, mapLimit, warningDetails, writeJsonAtomic } from './core.js';
import { buildIndex } from './build-index.js';

const config=await loadConfig(), main=path.resolve(ROOT,config.mainDirectory), publicDir=path.join(ROOT,'public'), warningLogFile=path.join(main,'warning-log.json'), attributionFont=path.join(ROOT,'assets','NotoSansCJKjp-Regular.otf');
const ffmpegEscape=value=>String(value||'').replaceAll('\\','\\\\').replaceAll(':','\\:').replaceAll("'","\\'").replaceAll('%','\\%');
function attributionFilterFor(camera){
  const place=[camera.prefecture,camera.municipality].filter(Boolean).join(' '),river=camera.riverName?`（${camera.riverName}）`:'',detail=`${place} / ${camera.name}${river}`;
  return `drawtext=fontfile=${attributionFont}:text='提供\\：国土交通省':fontcolor=white:fontsize=h/28:x=w-tw-18:y=h-th-h/30-27:box=1:boxcolor=black@0.62:boxborderw=9,drawtext=fontfile=${attributionFont}:text='${ffmpegEscape(detail)}':fontcolor=white:fontsize=h/38:x=w-tw-18:y=h-th-13:box=1:boxcolor=black@0.62:boxborderw=7`;
}
let cameras=[], areaMap={}, active=new Map(), running=false, lastPoll=null, warningLog=[];
const exportJobs=new Map();
function normalizeMunicipalityName(value){
  return String(value||'').normalize('NFKC').replace(/[ 　]/g,'').replace(/^.+郡(?=.+[町村]$)/,'').replace(/^.+振興局(?=.+[市町村区]$)/,'');
}
function municipalityCandidates(prefecturePrefix,municipality){
  const source=normalizeMunicipalityName(municipality),entries=Object.entries(areaMap.class20s||{}).filter(([code])=>code.startsWith(prefecturePrefix));
  const exact=entries.filter(([,area])=>normalizeMunicipalityName(area.name)===source);
  if(exact.length)return exact;
  // 札幌市・仙台市・日光市等は、気象庁側で「○○市東部」「○○市西部」や
  // 行政区に分割される。元データが市までの場合は全分割区域を関連付ける。
  const related=entries.filter(([,area])=>{
    const target=normalizeMunicipalityName(area.name);
    return target.startsWith(source)||source.endsWith(target)||target.endsWith(source);
  });
  return related;
}
function assignMunicipalityCodes(camera){
  let rawPrefix=String(camera.prefectureCode||camera.prefCd||'').replace(/\D/g,'');
  if(!rawPrefix&&String(camera.prefecture||'').startsWith('北海道'))rawPrefix='01';
  const prefix=rawPrefix.length===2?rawPrefix:rawPrefix.padStart(4,'0').slice(0,2);
  return municipalityCandidates(prefix,camera.municipality).map(([code])=>code);
}
function assignMunicipalityCode(camera){return assignMunicipalityCodes(camera)[0]||''}
async function refreshMaster(){
  areaMap=await fetchJson('https://www.jma.go.jp/bosai/common/const/area.json');
  const list=await fetchJson(`${config.rivercamBaseUrl}/camera_index.json`);
  cameras=(list.cameras||[]).map(([id,name,lat,lng])=>({id:String(id),name,lat,lng}));
  // camera_indexは軽量版で市区町村を持たないため、個別masterを初回だけ並列取得して保存する。
  const masterFile=path.join(ROOT,'cache','camera-master.json'); let master={};
  try{master=JSON.parse(await fs.readFile(masterFile,'utf8'))}catch{}
  const missing=cameras.filter(c=>!master[c.id]);
  let completed=0;
  await mapLimit(missing,config.captureConcurrency,async camera=>{
    try{
      // tool側PHPを約2万回経由せず、国交省の公式masterを直接取得する。
      const info=await fetchJson(`https://www.river.go.jp/kawabou/file/files/master/obs/scam/${camera.id}.json`);
      const o=info.obsInfo||info;
      // river.go.jpのtwnCdと気象庁の市区町村コードは体系が違うため、
      // 都道府県コード先頭2桁＋市区町村名で気象庁class20コードへ対応付ける。
      const municipality=o.twnNm||'地域不明';
      const record={...camera,municipalityCode:'',municipalityCodes:[],municipality,prefecture:o.prefNm||'',prefectureCode:o.prefCd||'',riverName:o.rvrNm||'',imageUrl:o.currProvUrl||o.currentUrl||info.currProvUrl||info.archiveList?.[0]?.arcUrl||''};
      record.municipalityCodes=assignMunicipalityCodes(record);record.municipalityCode=record.municipalityCodes[0]||'';master[camera.id]=record;
    }catch(e){console.warn('master',camera.id,e.message)}
    completed++;
    if(completed%100===0){await writeJsonAtomic(masterFile,master);console.log(`master progress: ${completed}/${missing.length}`)}
  });
  // area.json更新や旧版の完全一致失敗を反映するため、取得済み全件も毎回再割当てする。
  let mapped=0,unmapped=0;
  for(const camera of Object.values(master)){
    if(!camera.prefectureCode&&camera.prefecture){camera.prefectureCode=Object.entries(areaMap.offices||{}).find(([,office])=>office.name?.startsWith(camera.prefecture.replace(/県|府$/,'')))?.[0]?.slice(0,2)||''}
    camera.municipalityCodes=assignMunicipalityCodes(camera);camera.municipalityCode=camera.municipalityCodes[0]||'';camera.municipalityCode?mapped++:unmapped++;
  }
  await writeJsonAtomic(masterFile,master); cameras=Object.values(master).filter(c=>c.imageUrl&&c.municipalityCode);
  console.log(`camera master: mapped=${mapped}, unmapped=${unmapped}, usable=${cameras.length}`);
}
async function ensureCameraDetails(camera){
  if(!camera||camera.riverName)return camera;
  try{
    const info=await fetchJson(`${config.rivercamBaseUrl}/proxy.php?cam_id=${encodeURIComponent(camera.id)}`),o=info.obsInfo||info;
    camera.riverName=o.rvrNm||o.riverName||'';
    camera.prefecture=camera.prefecture||o.prefNm||'';camera.municipality=camera.municipality||o.twnNm||'';
  }catch(error){console.warn(`camera details ${camera.id}: ${error.message}`)}
  return camera;
}
function currentWarnings(payload){
  const result=new Map();
  for(const report of payload||[]){
    // 2026年移行後のr8形式。全国mapは地域ごとの最新発表を収録する。
    const areas=report.warning?.class20Items||[];
    for(const area of areas){
      const code=String(area.areaCode),previous=result.get(code),warnings=[...(previous?.warnings||[]),...(area.kinds||[])];
      const details=warningDetails(warnings),name=areaMap.class20s?.[code]?.name||code;
      result.set(code,{code,name,...details,warnings,reportDatetime:report.reportDatetime,publishingOffice:report.publishingOffice||''});
    }
  }
  return result;
}
async function appendWarningLog(warnings){
  const now=new Date(),cutoff=now.getTime()-30*86400000;
  warningLog=warningLog.filter(entry=>new Date(entry.at).getTime()>=cutoff);
  const activeWarnings=[...warnings.values()].filter(item=>item.level>=config.minimumStartLevel).map(({code,name,level,label,rainLevel,landslideLevel,reportDatetime,publishingOffice})=>({code,name,level,label,rainLevel,landslideLevel,reportDatetime,publishingOffice}));
  const signature=JSON.stringify(activeWarnings.map(item=>[item.code,item.level,item.label]).sort());
  if(signature!==warningLog.at(-1)?.signature)warningLog.push({at:now.toISOString(),signature,active:activeWarnings});
  await writeJsonAtomic(warningLogFile,warningLog);
}
async function deleteStoredImages(){
  let removed=0;
  for(const city of await fs.readdir(main,{withFileTypes:true}).catch(()=>[])){if(!city.isDirectory())continue;const cityPath=path.join(main,city.name);for(const camera of await fs.readdir(cityPath,{withFileTypes:true}).catch(()=>[])){if(!camera.isDirectory())continue;const cameraPath=path.join(cityPath,camera.name);for(const file of await fs.readdir(cameraPath,{withFileTypes:true}).catch(()=>[])){if(file.isFile()&&/\.(jpe?g|png|webp|avif)$/i.test(file.name)){await fs.unlink(path.join(cameraPath,file.name));removed++}}}}
  if(removed)console.log(`removed ${removed} obsolete stored images`);
  return removed;
}
async function poll(){if(running)return;running=true;try{
  const warnings=currentWarnings(await fetchJson('https://www.jma.go.jp/bosai/warning/data/r8/map.json'));lastPoll=new Date().toISOString();
  for(const [code,w] of warnings){if(w.level>=config.minimumStartLevel)active.set(code,w);else if(w.level<config.stopBelowLevel)active.delete(code);}
  for(const code of [...active.keys()])if(!warnings.has(code))active.delete(code);
  await appendWarningLog(warnings);
  const allWarningLevels=[...warnings.values()].filter(w=>w.level>0);
  await writeJsonAtomic(path.join(main,'status.json'),{updatedAt:lastPoll,dataSource:'https://www.jma.go.jp/bosai/warning/data/r8/map.json',warningLevels:allWarningLevels,activeWarnings:[...active.values()],warningLogRetentionDays:30,storedImages:false});
  console.log(`${lastPoll}: rain/landslide=${allWarningLevels.length}, active=${active.size}, warningLog=${warningLog.length}`);
}catch(e){console.error('poll failed',e)}finally{running=false}}
function historyDate(value){const date=new Date(value);if(!value||Number.isNaN(date.getTime()))throw new Error('日時が不正です');return date}
function historyStamp(date){const parts=new Intl.DateTimeFormat('ja-JP',{timeZone:'Asia/Tokyo',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(date);const get=type=>parts.find(part=>part.type===type)?.value;return `${get('year')}${get('month')}${get('day')}${get('hour')}${get('minute')}`}
function historyPlan(body){
  const cameraId=String(body.cameraId||'');if(!/^\d{6,15}$/.test(cameraId)||!cameras.some(camera=>camera.id===cameraId))throw new Error('カメラを選択してください');
  const start=historyDate(body.start),end=historyDate(body.end),interval=Number(body.intervalMinutes);
  if(![5,10,30,60].includes(interval)||end<start)throw new Error('期間または間隔が不正です');
  if(start.getTime()<Date.now()-30*86400000)throw new Error('過去画像は30日前まで指定できます');
  if(end-start>30*86400000)throw new Error('一度に指定できる期間は30日までです');
  const dates=[];for(let time=start.getTime();time<=end.getTime();time+=interval*60000)dates.push(new Date(time));
  if(dates.length>8640)throw new Error('指定枚数が多すぎます');
  return {cameraId,dates,fps:Number(body.fps),format:String(body.format||'mp4')};
}
function historyCameraKey(cameraId){
  const camera=cameras.find(item=>item.id===String(cameraId));if(!camera)throw new Error('Camera not found');
  // 一部カメラは観測所IDではなく、現在画像URLの cctv_* ファイル名を履歴でも使用する。
  const fileName=path.basename(new URL(camera.imageUrl).pathname).replace(/\.[^.]+$/,'');
  return fileName.startsWith('cctv_')?fileName:camera.id;
}
async function fetchHistoryFrame(cameraId,date){
  const stamp=historyStamp(date),key=historyCameraKey(cameraId),url=`https://cam.river.go.jp/cam/history/${stamp}/${key}.jpg`;
  const response=await fetch(url,{signal:AbortSignal.timeout(15000),headers:{'user-agent':'Mozilla/5.0 (RiverCam history exporter)','referer':'https://www.river.go.jp/'}});
  if(!response.ok||!(response.headers.get('content-type')||'').startsWith('image/'))return null;
  return {stamp,url,buffer:Buffer.from(await response.arrayBuffer())};
}
async function availableHistory(plan,includeBuffers=false){
  const results=await mapLimit(plan.dates,4,date=>fetchHistoryFrame(plan.cameraId,date)),available=results.filter(item=>item&&!item.error);
  if(!includeBuffers)for(const item of available)delete item.buffer;
  return available;
}
async function historyCheck(req,res){try{const plan=historyPlan(await readRequestJson(req)),available=await availableHistory(plan);const value={requested:plan.dates.length,available:available.length,first:available[0]?.stamp||null,last:available.at(-1)?.stamp||null,frames:available.map(item=>item.stamp)};const body=JSON.stringify(value);res.writeHead(200,{'content-type':'application/json; charset=utf-8','content-length':Buffer.byteLength(body),'cache-control':'no-store'}).end(body)}catch(error){const body=JSON.stringify({error:error.message});res.writeHead(400,{'content-type':'application/json; charset=utf-8'}).end(body)}}
async function currentImage(res,cameraId){try{const camera=cameras.find(item=>item.id===cameraId);if(!camera)throw new Error('Camera not found');const response=await fetch(camera.imageUrl,{signal:AbortSignal.timeout(15000),headers:{'user-agent':'Mozilla/5.0 (RiverCam viewer)','referer':'https://www.river.go.jp/'}});if(!response.ok)throw new Error(`Image HTTP ${response.status}`);const body=Buffer.from(await response.arrayBuffer());res.writeHead(200,{'content-type':response.headers.get('content-type')||'image/jpeg','content-length':body.length,'cache-control':'no-cache'}).end(body)}catch(error){res.writeHead(404,{'content-type':'text/plain; charset=utf-8'}).end(error.message)}}
async function historyImage(res,url){try{const cameraId=url.searchParams.get('cameraId')||'',stamp=url.searchParams.get('stamp')||'';if(!/^\d{6,15}$/.test(cameraId)||!/^\d{12}$/.test(stamp)||!cameras.some(item=>item.id===cameraId))throw new Error('Invalid request');const key=historyCameraKey(cameraId),response=await fetch(`https://cam.river.go.jp/cam/history/${stamp}/${key}.jpg`,{signal:AbortSignal.timeout(15000),headers:{'user-agent':'Mozilla/5.0 (RiverCam viewer)','referer':'https://www.river.go.jp/'}});if(!response.ok)throw new Error('Image not found');const body=Buffer.from(await response.arrayBuffer());res.writeHead(200,{'content-type':'image/jpeg','content-length':body.length,'cache-control':'private, max-age=300'}).end(body)}catch(error){res.writeHead(404,{'content-type':'text/plain; charset=utf-8'}).end(error.message)}}
async function runFfmpeg(args){await new Promise((resolve,reject)=>{const ffmpeg=spawn('ffmpeg',args,{stdio:['ignore','ignore','pipe']});let error='';ffmpeg.stderr.on('data',chunk=>error+=chunk);ffmpeg.on('error',reject);ffmpeg.on('close',code=>code===0?resolve():reject(new Error(`ffmpeg ${code}: ${error.trim()}`)))})}
function videoArgs(input,output,fps,format,camera){const attribution=attributionFilterFor(camera);return format==='mp4'
  ?['-hide_banner','-loglevel','error','-y','-framerate',String(fps),'-i',input,'-vf',`scale=trunc(iw/2)*2:trunc(ih/2)*2:flags=lanczos,${attribution},format=yuv420p`,'-c:v','libx264','-preset','medium','-crf','26','-movflags','+faststart',output]
  :['-hide_banner','-loglevel','error','-y','-framerate',String(fps),'-i',input,'-vf',`fps=${fps},${attribution},split[s0][s1];[s0]palettegen=max_colors=256:stats_mode=diff[p];[s1][p]paletteuse=dither=sierra2_4a`,'-loop','0',output]}
async function municipalityZip(req,res){let temporaryDirectory,output;try{
  const body=await readRequestJson(req),prefecture=String(body.prefecture||''),municipality=String(body.municipality||''),requestedIds=Array.isArray(body.cameraIds)?[...new Set(body.cameraIds.map(String))]:[];
  if(requestedIds.length>100)throw new Error('一度に保存できるカメラは100台までです');
  const selected=requestedIds.length?requestedIds.map(id=>cameras.find(item=>item.id===id)).filter(Boolean):cameras.filter(item=>(prefecture==='北海道'?item.prefecture.startsWith('北海道'):item.prefecture===prefecture)&&item.municipality===municipality);
  if(!selected.length)throw new Error(requestedIds.length?'有効なカメラがありません':'市区町村のカメラがありません');
  const samplePlan=historyPlan({...body,cameraId:selected[0].id}),fps=samplePlan.fps,format=samplePlan.format;
  if(!Number.isInteger(fps)||fps<1||fps>10)throw new Error('再生速度は1～10枚/秒です');if(!['mp4','gif'].includes(format))throw new Error('形式が不正です');
  if(selected.length*samplePlan.dates.length>20000)throw new Error('全カメラの処理量が多すぎます。期間を短くするか取得間隔を長くしてください');
  temporaryDirectory=await fs.mkdtemp(path.join(os.tmpdir(),'rivercam-zip-'));const encodedDirectory=path.join(temporaryDirectory,'encoded');await fs.mkdir(encodedDirectory);const results=[];
  await mapLimit(selected,1,async camera=>{const work=path.join(temporaryDirectory,`work-${camera.id}`);await fs.mkdir(work);try{
    await ensureCameraDetails(camera);
    const frames=(await mapLimit(samplePlan.dates,4,date=>fetchHistoryFrame(camera.id,date))).filter(item=>item&&!item.error);
    if(!frames.length){results.push({id:camera.id,name:camera.name,status:'画像なし'});return}
    for(const [index,frame] of frames.entries())await fs.writeFile(path.join(work,`${String(index).padStart(6,'0')}.jpg`),frame.buffer);
    const fileName=`${safeName(camera.name)}_${camera.id}_${historyStamp(samplePlan.dates[0])}-${historyStamp(samplePlan.dates.at(-1))}.${format}`,target=path.join(encodedDirectory,fileName);
    await runFfmpeg(videoArgs(path.join(work,'%06d.jpg'),target,fps,format,camera));results.push({id:camera.id,name:camera.name,status:'成功',frames:frames.length,file:fileName});
  }catch(error){results.push({id:camera.id,name:camera.name,status:'失敗',error:error.message})}finally{await fs.rm(work,{recursive:true,force:true})}});
  if(!results.some(item=>item.status==='成功'))throw new Error('エンコードできるカメラがありません');
  await fs.writeFile(path.join(encodedDirectory,'結果.json'),JSON.stringify({prefecture:prefecture||null,municipality:municipality||null,selection:requestedIds.length?'slideshow':'municipality',start:body.start,end:body.end,intervalMinutes:body.intervalMinutes,fps,format,cameras:results},null,2));
  output=path.join(os.tmpdir(),`rivercam-${process.pid}-${Date.now()}.zip`);const script='import os,sys,zipfile\nout,folder=sys.argv[1:3]\nwith zipfile.ZipFile(out,"w",zipfile.ZIP_DEFLATED) as z:\n for name in os.listdir(folder): z.write(os.path.join(folder,name),name)\n';await new Promise((resolve,reject)=>{const zip=spawn('python3',['-c',script,output,encodedDirectory]);let error='';zip.stderr.on('data',chunk=>error+=chunk);zip.on('error',reject);zip.on('close',code=>code===0?resolve():reject(new Error(`zip ${code}: ${error.trim()}`)))});
  const stat=await fs.stat(output),name=encodeURIComponent(requestedIds.length?`rivercam-slideshow_${format}.zip`:`${prefecture}_${municipality}_${format}.zip`);res.writeHead(200,{'content-type':'application/zip','content-length':stat.size,'content-disposition':`attachment; filename*=UTF-8''${name}`,'cache-control':'no-store'});const stream=(await import('node:fs')).createReadStream(output);stream.pipe(res);await once(stream,'close');
}catch(error){if(!res.headersSent)res.writeHead(400,{'content-type':'text/plain; charset=utf-8'});res.end(`ZIP failed: ${error.message}`)}finally{if(output)await fs.unlink(output).catch(()=>{});if(temporaryDirectory)await fs.rm(temporaryDirectory,{recursive:true,force:true}).catch(()=>{})}}
async function buildCameraZip(body,update){
  let temporaryDirectory,output;
  try{
    const prefecture=String(body.prefecture||''),municipality=String(body.municipality||''),requestedIds=Array.isArray(body.cameraIds)?[...new Set(body.cameraIds.map(String))]:[];
    if(requestedIds.length>100)throw new Error('一度に保存できるカメラは100台までです');
    const selected=requestedIds.length?requestedIds.map(id=>cameras.find(item=>item.id===id)).filter(Boolean):cameras.filter(item=>(prefecture==='北海道'?item.prefecture.startsWith('北海道'):item.prefecture===prefecture)&&item.municipality===municipality);
    if(!selected.length)throw new Error(requestedIds.length?'有効なカメラがありません':'市区町村のカメラがありません');
    const samplePlan=historyPlan({...body,cameraId:selected[0].id}),fps=samplePlan.fps,format=samplePlan.format;
    if(!Number.isInteger(fps)||fps<1||fps>10)throw new Error('再生速度は1～10枚/秒です');if(!['mp4','gif'].includes(format))throw new Error('形式が不正です');
    if(selected.length*samplePlan.dates.length>20000)throw new Error('処理量が多すぎます。期間を短くするか取得間隔を長くしてください');
    temporaryDirectory=await fs.mkdtemp(path.join(os.tmpdir(),'rivercam-job-'));const encodedDirectory=path.join(temporaryDirectory,'encoded');await fs.mkdir(encodedDirectory);const results=[];let completed=0;
    update({phase:'encoding',total:selected.length,completed:0,current:'画像を取得しています'});
    // カメラ2台を並行処理し、各ffmpegは2スレッドでエンコードする。
    await mapLimit(selected,2,async camera=>{const work=path.join(temporaryDirectory,`work-${camera.id}`);await fs.mkdir(work);try{
      update({current:`${camera.name} の画像を取得中`});await ensureCameraDetails(camera);
      const frames=(await mapLimit(samplePlan.dates,4,date=>fetchHistoryFrame(camera.id,date))).filter(item=>item&&!item.error);
      if(!frames.length){results.push({id:camera.id,name:camera.name,status:'画像なし'});return}
      for(const [index,frame] of frames.entries())await fs.writeFile(path.join(work,`${String(index).padStart(6,'0')}.jpg`),frame.buffer);
      const fileName=`${safeName(camera.name)}_${camera.id}_${historyStamp(samplePlan.dates[0])}-${historyStamp(samplePlan.dates.at(-1))}.${format}`,target=path.join(encodedDirectory,fileName);
      update({current:`${camera.name} をエンコード中`});
      const args=videoArgs(path.join(work,'%06d.jpg'),target,fps,format,camera);if(format==='mp4')args.splice(args.indexOf('-preset'),0,'-threads','2');
      await runFfmpeg(args);results.push({id:camera.id,name:camera.name,status:'成功',frames:frames.length,file:fileName});
    }catch(error){results.push({id:camera.id,name:camera.name,status:'失敗',error:error.message})}finally{await fs.rm(work,{recursive:true,force:true});completed++;update({completed,current:`${camera.name} 完了`})}});
    if(!results.some(item=>item.status==='成功'))throw new Error('エンコードできるカメラがありません');
    await fs.writeFile(path.join(encodedDirectory,'結果.json'),JSON.stringify({prefecture:prefecture||null,municipality:municipality||null,selection:requestedIds.length?'slideshow':'municipality',start:body.start,end:body.end,intervalMinutes:body.intervalMinutes,fps,format,cameras:results},null,2));
    update({phase:'zipping',current:'ZIPを作成しています'});output=path.join(os.tmpdir(),`rivercam-job-${process.pid}-${Date.now()}.zip`);const script='import os,sys,zipfile\nout,folder=sys.argv[1:3]\nwith zipfile.ZipFile(out,"w",zipfile.ZIP_DEFLATED) as z:\n for name in os.listdir(folder): z.write(os.path.join(folder,name),name)\n';await new Promise((resolve,reject)=>{const zip=spawn('python3',['-c',script,output,encodedDirectory]);let error='';zip.stderr.on('data',chunk=>error+=chunk);zip.on('error',reject);zip.on('close',code=>code===0?resolve():reject(new Error(`zip ${code}: ${error.trim()}`)))});
    const name=requestedIds.length?`rivercam-slideshow_${format}.zip`:`${prefecture}_${municipality}_${format}.zip`;
    return {output,name,results};
  }finally{if(temporaryDirectory)await fs.rm(temporaryDirectory,{recursive:true,force:true}).catch(()=>{})}
}
function createExportJob(body){
  const id=`${Date.now().toString(36)}-${crypto.randomUUID()}`,job={id,state:'queued',phase:'queued',createdAt:new Date().toISOString(),completed:0,total:0,current:'処理待ち',error:null,output:null,name:null};exportJobs.set(id,job);
  const update=value=>Object.assign(job,value,{updatedAt:new Date().toISOString()});
  setImmediate(async()=>{try{update({state:'running'});const result=await buildCameraZip(body,update);update({state:'done',phase:'done',current:'完了',output:result.output,name:result.name,success:result.results.filter(item=>item.status==='成功').length})}catch(error){update({state:'error',phase:'error',current:'失敗',error:error.message})}});
  return job;
}
setInterval(async()=>{const cutoff=Date.now()-2*3600000;for(const [id,job] of exportJobs)if(new Date(job.createdAt).getTime()<cutoff){if(job.output)await fs.unlink(job.output).catch(()=>{});exportJobs.delete(id)}},10*60000).unref();
async function historyExport(req,res){let temporaryDirectory;try{
  const plan=historyPlan(await readRequestJson(req));if(!Number.isInteger(plan.fps)||plan.fps<1||plan.fps>10)throw new Error('再生速度は1～10枚/秒です');if(!['mp4','gif'].includes(plan.format))throw new Error('形式が不正です');
  const frames=await availableHistory(plan,true);if(!frames.length)throw new Error('指定期間の過去画像がありません');
  await ensureCameraDetails(cameras.find(item=>item.id===plan.cameraId));
  temporaryDirectory=await fs.mkdtemp(path.join(os.tmpdir(),'rivercam-history-'));
  for(const [index,frame] of frames.entries())await fs.writeFile(path.join(temporaryDirectory,`${String(index).padStart(6,'0')}.jpg`),frame.buffer);
  const output=path.join(temporaryDirectory,`export.${plan.format}`),input=path.join(temporaryDirectory,'%06d.jpg');
  const camera=cameras.find(item=>item.id===plan.cameraId),args=videoArgs(input,output,plan.fps,plan.format,camera);
  await new Promise((resolve,reject)=>{const ffmpeg=spawn('ffmpeg',args,{stdio:['ignore','ignore','pipe']});let error='';ffmpeg.stderr.on('data',chunk=>error+=chunk);ffmpeg.on('error',reject);ffmpeg.on('close',code=>code===0?resolve():reject(new Error(`ffmpeg ${code}: ${error.trim()}`)))});
  const stat=await fs.stat(output),type=plan.format==='mp4'?'video/mp4':'image/gif';res.writeHead(200,{'content-type':type,'content-length':stat.size,'content-disposition':`attachment; filename="${plan.cameraId}_${plan.fps}fps.${plan.format}"`,'cache-control':'no-store'});const stream=(await import('node:fs')).createReadStream(output);stream.pipe(res);await once(stream,'close');
}catch(error){if(!res.headersSent)res.writeHead(400,{'content-type':'text/plain; charset=utf-8'});res.end(`Export failed: ${error.message}`)}finally{if(temporaryDirectory)await fs.rm(temporaryDirectory,{recursive:true,force:true}).catch(()=>{})}}
async function readRequestJson(req,limit=1024*1024){
  const chunks=[];let size=0;
  for await(const chunk of req){size+=chunk.length;if(size>limit)throw new Error('Request too large');chunks.push(chunk)}
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}
async function exportVideo(req,res){
  let temporaryDirectory;
  try{
    const body=await readRequestJson(req),fps=Number(body.fps);
    if(!Number.isInteger(fps)||fps<1||fps>10)throw new Error('fps must be between 1 and 10');
    if(!Array.isArray(body.files)||!body.files.length||body.files.length>5000)throw new Error('Invalid frame list');
    const city=safeName(body.city),camera=safeName(body.camera),cameraDirectory=path.resolve(main,city,camera);
    if(!cameraDirectory.startsWith(main+path.sep))throw new Error('Invalid camera');
    temporaryDirectory=await fs.mkdtemp(path.join(os.tmpdir(),'rivercam-export-'));
    const concatFile=path.join(temporaryDirectory,'frames.txt'),output=path.join(temporaryDirectory,'export.mp4');
    const lines=[];
    for(const [index,name] of body.files.entries()){
      const fileName=path.basename(String(name));
      if(fileName!==name||!/\.(avif|webp|jpe?g|png)$/i.test(fileName))throw new Error('Invalid frame name');
      const source=path.resolve(cameraDirectory,fileName);
      if(!source.startsWith(cameraDirectory+path.sep))throw new Error('Invalid frame path');
      await fs.access(source);
      const extension=path.extname(fileName),frame=path.join(temporaryDirectory,`${String(index).padStart(6,'0')}${extension}`);
      await fs.symlink(source,frame);
      lines.push(`file '${frame.replaceAll("'","'\\''")}'`,`duration ${1/fps}`);
    }
    lines.push(lines[lines.length-2]);
    await fs.writeFile(concatFile,lines.join('\n'));
    await new Promise((resolve,reject)=>{
      // CRF 26で画質とファイル容量のバランスを取る。
      const attribution=attributionFilterFor({prefecture:'',municipality:city,name:camera,riverName:''});
      const ffmpeg=spawn('ffmpeg',['-hide_banner','-loglevel','error','-y','-f','concat','-safe','0','-i',concatFile,'-vf',`fps=${fps},scale=trunc(iw/2)*2:trunc(ih/2)*2:flags=lanczos,${attribution},format=yuv420p`,'-c:v','libx264','-preset','medium','-crf','26','-movflags','+faststart',output],{stdio:['ignore','ignore','pipe']});
      let error='';ffmpeg.stderr.on('data',chunk=>error+=chunk);ffmpeg.on('error',reject);ffmpeg.on('close',code=>code===0?resolve():reject(new Error(`ffmpeg ${code}: ${error.trim()}`)));
    });
    const stat=await fs.stat(output),downloadName=encodeURIComponent(`${city}_${camera}_${fps}fps.mp4`);
    res.writeHead(200,{'content-type':'video/mp4','content-length':stat.size,'content-disposition':`attachment; filename*=UTF-8''${downloadName}`,'cache-control':'no-store'});
    const stream=(await import('node:fs')).createReadStream(output);stream.pipe(res);await once(stream,'close');
  }catch(error){if(!res.headersSent)res.writeHead(400,{'content-type':'text/plain; charset=utf-8'});res.end(`Export failed: ${error.message}`)}
  finally{if(temporaryDirectory)await fs.rm(temporaryDirectory,{recursive:true,force:true}).catch(()=>{})}
}
function serve(req,res){
  const url=new URL(req.url,'http://localhost');
  if(req.method==='GET'&&url.pathname==='/api/cameras'){const list=cameras.map(({id,name,municipality,prefecture,municipalityCode,prefectureCode})=>({id,name,municipality,prefecture,municipalityCode,prefectureCode})).sort((a,b)=>`${a.prefecture}${a.municipality}${a.name}`.localeCompare(`${b.prefecture}${b.municipality}${b.name}`,'ja'));const body=JSON.stringify(list);res.writeHead(200,{'content-type':'application/json; charset=utf-8','content-length':Buffer.byteLength(body),'cache-control':'no-cache'}).end(body);return}
  if(req.method==='GET'&&url.pathname==='/api/warnings'){const body=JSON.stringify(warningLog.map(({signature,...entry})=>entry));res.writeHead(200,{'content-type':'application/json; charset=utf-8','content-length':Buffer.byteLength(body),'cache-control':'no-cache'}).end(body);return}
  if(req.method==='GET'&&url.pathname.startsWith('/api/current/')){currentImage(res,url.pathname.split('/').pop());return}
  if(req.method==='GET'&&url.pathname==='/api/history/image'){historyImage(res,url);return}
  if(req.method==='POST'&&(url.pathname==='/api/municipality/zip'||url.pathname==='/api/cameras/zip')){readRequestJson(req).then(body=>{const job=createExportJob(body),response=JSON.stringify({jobId:job.id});res.writeHead(202,{'content-type':'application/json; charset=utf-8','content-length':Buffer.byteLength(response),'cache-control':'no-store'}).end(response)}).catch(error=>res.writeHead(400,{'content-type':'application/json; charset=utf-8'}).end(JSON.stringify({error:error.message})));return}
  if(req.method==='GET'&&url.pathname.startsWith('/api/export-jobs/')){const parts=url.pathname.split('/').filter(Boolean),job=exportJobs.get(parts[2]);if(!job){res.writeHead(404,{'content-type':'application/json; charset=utf-8'}).end(JSON.stringify({error:'ジョブがありません'}));return}if(parts[3]==='download'){if(job.state!=='done'||!job.output){res.writeHead(409,{'content-type':'text/plain; charset=utf-8'}).end('まだ完了していません');return}fs.stat(job.output).then(stat=>{res.writeHead(200,{'content-type':'application/zip','content-length':stat.size,'content-disposition':`attachment; filename*=UTF-8''${encodeURIComponent(job.name)}`,'cache-control':'no-store'});(async()=>{const stream=(await import('node:fs')).createReadStream(job.output);stream.pipe(res)})()}).catch(()=>res.writeHead(404).end());return}const {output,...status}=job,response=JSON.stringify(status);res.writeHead(200,{'content-type':'application/json; charset=utf-8','content-length':Buffer.byteLength(response),'cache-control':'no-store'}).end(response);return}
  if(req.method==='POST'&&url.pathname==='/api/history/check'){historyCheck(req,res);return}
  if(req.method==='POST'&&req.url==='/api/history/export'){historyExport(req,res);return}
  if(req.method==='POST'&&req.url==='/api/export'){exportVideo(req,res);return}
  let requested;
  try{requested=decodeURIComponent(new URL(req.url,'http://localhost').pathname)}catch{res.writeHead(400).end('Bad URL');return}
  if(requested==='/')requested='/index.html';
  const archive=requested.startsWith('/archive/'),base=path.resolve(archive?main:publicDir);
  const relative=archive?requested.slice('/archive/'.length):requested.replace(/^\/+/,''),file=path.resolve(base,relative);
  // URLデコード後に検査し、..や絶対パスによる公開ディレクトリ外への脱出を拒否する。
  if(file!==base&&!file.startsWith(base+path.sep)){res.writeHead(403).end();return}
  fs.readFile(file).then(body=>{const ext=path.extname(file).toLowerCase();const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json; charset=utf-8','.jpg':'image/jpeg','.jpeg':'image/jpeg','.png':'image/png','.webp':'image/webp','.avif':'image/avif'};res.writeHead(200,{'content-type':types[ext]||'application/octet-stream','content-length':body.length,'cache-control':archive?'public, max-age=300':'no-cache','x-content-type-options':'nosniff'});res.end(body)}).catch(()=>res.writeHead(404,{'content-type':'text/plain; charset=utf-8'}).end('Not found'))
}
await fs.mkdir(main,{recursive:true});
try{warningLog=JSON.parse(await fs.readFile(warningLogFile,'utf8'))}catch{warningLog=[]}
await deleteStoredImages();
http.createServer(serve).listen(config.port,'0.0.0.0',()=>console.log(`viewer: http://0.0.0.0:${config.port}`));
refreshMaster().then(async()=>{
  await poll();
  setInterval(poll,config.warningPollSeconds*1000);
  setInterval(refreshMaster,config.cameraIndexRefreshHours*3600000);
}).catch(error=>console.error('initialization failed',error));
