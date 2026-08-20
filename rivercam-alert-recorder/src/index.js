import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import os from 'node:os';
import { loadConfig, ROOT, safeName, fetchJson, mapLimit, warningDetails, writeJsonAtomic } from './core.js';
import { buildIndex } from './build-index.js';

const config=await loadConfig(), main=path.resolve(ROOT,config.mainDirectory), publicDir=path.join(ROOT,'public');
let cameras=[], areaMap={}, active=new Map(), running=false, lastPoll=null;
const lastCapture = new Map();
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
      const record={...camera,municipalityCode:'',municipalityCodes:[],municipality,prefecture:o.prefNm||'',prefectureCode:o.prefCd||'',imageUrl:o.currProvUrl||o.currentUrl||info.currProvUrl||info.archiveList?.[0]?.arcUrl||''};
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
async function encodeAvifAtCrf(input,output,crf,maxWidth){
  await new Promise((resolve,reject)=>{
    const scale=`scale='min(iw,${maxWidth})':-2:flags=lanczos`;
    const ffmpeg=spawn('ffmpeg',['-hide_banner','-loglevel','error','-y','-i','pipe:0','-map_metadata','-1','-frames:v','1','-vf',scale,'-c:v','libaom-av1','-still-picture','1','-usage','allintra','-crf',String(crf),'-b:v','0','-cpu-used','6','-row-mt','1','-pix_fmt','yuv420p','-f','avif',output],{stdio:['pipe','ignore','pipe']});
    let error='';ffmpeg.stderr.on('data',chunk=>error+=chunk);ffmpeg.on('error',reject);ffmpeg.on('close',code=>code===0?resolve():reject(new Error(`ffmpeg ${code}: ${error.trim()}`)));ffmpeg.stdin.end(input);
  });
  return (await fs.stat(output)).size;
}
async function encodeAvif(input,output){
  const preferredCrf=Math.max(20,Math.min(60,Number(config.avifCrf)||46));
  const maximumCrf=Math.max(preferredCrf,Math.min(63,Number(config.avifMaximumCrf)||52));
  const maxWidth=Math.max(320,Number(config.maxImageWidth)||960);
  const crfs=[preferredCrf,Math.min(preferredCrf+4,maximumCrf),maximumCrf].filter((value,index,array)=>array.indexOf(value)===index);
  const widths=[maxWidth,800,640,512,480].filter((width,index,array)=>width<=maxWidth&&array.indexOf(width)===index).sort((a,b)=>b-a);
  let crf=crfs[0],usedMaxWidth=widths[0],outputBytes=Infinity,bestBytes=Infinity,bestFile=`${output}.best`;
  outer: for(const width of widths){
    for(const candidate of crfs){
      const bytes=await encodeAvifAtCrf(input,output,candidate,width);
      if(bytes<bestBytes){bestBytes=bytes;crf=candidate;usedMaxWidth=width;await fs.copyFile(output,bestFile)}
      if(bytes<=input.length){outputBytes=bytes;crf=candidate;usedMaxWidth=width;break outer}
    }
  }
  if(!Number.isFinite(outputBytes)){outputBytes=bestBytes;await fs.copyFile(bestFile,output)}
  await fs.unlink(bestFile).catch(()=>{});
  const probe=spawn('ffprobe',['-v','error','-select_streams','v:0','-show_entries','stream=codec_name,width,height:format_tags=major_brand','-of','json',output],{stdio:['ignore','pipe','pipe']});
  let stdout='',stderr='';probe.stdout.on('data',chunk=>stdout+=chunk);probe.stderr.on('data',chunk=>stderr+=chunk);
  const [code]=await once(probe,'close');
  let result,stream;try{result=JSON.parse(stdout);stream=result.streams?.[0]}catch{}
  if(code!==0||stream?.codec_name!=='av1'||result?.format?.tags?.major_brand!=='avif'||!stream.width||!stream.height)throw new Error(`AVIF validation failed: ${stderr.trim()||stdout}`);
  return {codec:stream.codec_name,width:stream.width,height:stream.height,crf,usedMaxWidth,inputBytes:input.length,outputBytes};
}
async function captureCamera(camera,warning){
  const city=safeName(camera.municipality),cam=safeName(camera.name),dir=path.join(main,city,cam);await fs.mkdir(dir,{recursive:true});
  const response=await fetch(camera.imageUrl,{signal:AbortSignal.timeout(20000),headers:{'user-agent':'rivercam-alert-recorder/1.0'}});if(!response.ok)throw Error(`image HTTP ${response.status}`);
  const contentType=response.headers.get('content-type')||'';if(!contentType.startsWith('image/'))throw Error(`not image: ${contentType}`);
  const stamp=new Date().toISOString().replace(/[:.]/g,'-'),input=Buffer.from(await response.arrayBuffer());
  if((config.imageFormat||'avif').toLowerCase()==='avif'){
    const output=path.join(dir,`${stamp}_L${warning.level}.avif`),temporary=`${output}.tmp.avif`;
    try{
      const encoded=await encodeAvif(input,temporary);await fs.rename(temporary,output);
      console.log(`avif ${camera.id}: ${encoded.width}x${encoded.height} crf${encoded.crf}, ${encoded.inputBytes} -> ${encoded.outputBytes} bytes (${Math.round(encoded.outputBytes/encoded.inputBytes*100)}%)`);
    }catch(error){await fs.unlink(temporary).catch(()=>{});throw error}
  }else{
    const ext=contentType.includes('png')?'png':contentType.includes('webp')?'webp':'jpg';await fs.writeFile(path.join(dir,`${stamp}_L${warning.level}.${ext}`),input);
  }
  await writeJsonAtomic(path.join(dir,'camera.json'),{id:camera.id,name:camera.name,municipality:camera.municipality,municipalityCode:camera.municipalityCode,lat:camera.lat,lng:camera.lng,imageUrl:camera.imageUrl,imageFormat:config.imageFormat||'avif',lastWarning:warning});
}
async function pruneExpiredImages(){
  if(!config.retentionDays || config.retentionDays<=0)return 0;
  const cutoff=Date.now()-config.retentionDays*86400000;let removed=0;
  for(const city of await fs.readdir(main,{withFileTypes:true}).catch(()=>[])){
    if(!city.isDirectory())continue;const cityPath=path.join(main,city.name);
    for(const camera of await fs.readdir(cityPath,{withFileTypes:true}).catch(()=>[])){
      if(!camera.isDirectory())continue;const cameraPath=path.join(cityPath,camera.name);
      for(const file of await fs.readdir(cameraPath,{withFileTypes:true}).catch(()=>[])){
        if(!file.isFile()||!/^\d{4}-\d{2}-\d{2}T.*\.(jpe?g|png|webp|avif)$/i.test(file.name))continue;
        const stat=await fs.stat(path.join(cameraPath,file.name));
        if(stat.mtimeMs<cutoff){await fs.unlink(path.join(cameraPath,file.name));removed++}
      }
    }
  }
  if(removed)console.log(`retention: removed ${removed} images older than ${config.retentionDays} days`);
  return removed;
}
async function poll(){if(running)return;running=true;try{
  const warnings=currentWarnings(await fetchJson('https://www.jma.go.jp/bosai/warning/data/r8/map.json'));lastPoll=new Date().toISOString();
  for(const [code,w] of warnings){if(w.level>=config.minimumStartLevel)active.set(code,w);else if(w.level<config.stopBelowLevel)active.delete(code);}
  for(const code of [...active.keys()])if(!warnings.has(code))active.delete(code);
  const cameraWarning=camera=>(camera.municipalityCodes?.length?camera.municipalityCodes:[camera.municipalityCode]).map(code=>active.get(code)).filter(Boolean).sort((a,b)=>b.level-a.level)[0];
  const targets=cameras.filter(camera=>cameraWarning(camera));
  const captureDue=targets.filter(camera=>Date.now()-(lastCapture.get(camera.id)||0)>=config.captureIntervalSeconds*1000);
  await mapLimit(captureDue,config.captureConcurrency,async camera=>{
    await captureCamera(camera,cameraWarning(camera));
    lastCapture.set(camera.id,Date.now());
  });
  await pruneExpiredImages();
  const allWarningLevels=[...warnings.values()].filter(w=>w.level>0);
  await writeJsonAtomic(path.join(main,'status.json'),{updatedAt:lastPoll,dataSource:'https://www.jma.go.jp/bosai/warning/data/r8/map.json',warningLevels:allWarningLevels,activeWarnings:[...active.values()],targetCameras:targets.length,captureIntervalSeconds:config.captureIntervalSeconds,retentionDays:config.retentionDays});await buildIndex();
  console.log(`${lastPoll}: rain/landslide=${allWarningLevels.length}, recording=${active.size}, targets=${targets.length}, captured=${captureDue.length}`);
}catch(e){console.error('poll failed',e)}finally{running=false}}
function historyDate(value){const date=new Date(value);if(!value||Number.isNaN(date.getTime()))throw new Error('日時が不正です');return date}
function historyStamp(date){const parts=new Intl.DateTimeFormat('ja-JP',{timeZone:'Asia/Tokyo',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(date);const get=type=>parts.find(part=>part.type===type)?.value;return `${get('year')}${get('month')}${get('day')}${get('hour')}${get('minute')}`}
function historyPlan(body){
  const cameraId=String(body.cameraId||'');if(!/^\d{6,15}$/.test(cameraId)||!cameras.some(camera=>camera.id===cameraId))throw new Error('カメラを選択してください');
  const start=historyDate(body.start),end=historyDate(body.end),interval=Number(body.intervalMinutes);
  if(![5,10,30,60].includes(interval)||end<start)throw new Error('期間または間隔が不正です');
  if(end-start>7*86400000)throw new Error('一度に指定できる期間は7日までです');
  const dates=[];for(let time=start.getTime();time<=end.getTime();time+=interval*60000)dates.push(new Date(time));
  if(dates.length>2016)throw new Error('指定枚数が多すぎます');
  return {cameraId,dates,fps:Number(body.fps),format:String(body.format||'mp4')};
}
async function fetchHistoryFrame(cameraId,date){
  const stamp=historyStamp(date),url=`https://cam.river.go.jp/cam/history/${stamp}/${cameraId}.jpg`;
  const response=await fetch(url,{signal:AbortSignal.timeout(15000),headers:{'user-agent':'Mozilla/5.0 (RiverCam history exporter)','referer':'https://www.river.go.jp/'}});
  if(!response.ok||!(response.headers.get('content-type')||'').startsWith('image/'))return null;
  return {stamp,url,buffer:Buffer.from(await response.arrayBuffer())};
}
async function availableHistory(plan,includeBuffers=false){
  const results=await mapLimit(plan.dates,4,date=>fetchHistoryFrame(plan.cameraId,date)),available=results.filter(item=>item&&!item.error);
  if(!includeBuffers)for(const item of available)delete item.buffer;
  return available;
}
async function historyCheck(req,res){try{const plan=historyPlan(await readRequestJson(req)),available=await availableHistory(plan);const value={requested:plan.dates.length,available:available.length,first:available[0]?.stamp||null,last:available.at(-1)?.stamp||null};const body=JSON.stringify(value);res.writeHead(200,{'content-type':'application/json; charset=utf-8','content-length':Buffer.byteLength(body),'cache-control':'no-store'}).end(body)}catch(error){const body=JSON.stringify({error:error.message});res.writeHead(400,{'content-type':'application/json; charset=utf-8'}).end(body)}}
async function historyExport(req,res){let temporaryDirectory;try{
  const plan=historyPlan(await readRequestJson(req));if(!Number.isInteger(plan.fps)||plan.fps<1||plan.fps>10)throw new Error('再生速度は1～10枚/秒です');if(!['mp4','gif'].includes(plan.format))throw new Error('形式が不正です');
  const frames=await availableHistory(plan,true);if(!frames.length)throw new Error('指定期間の過去画像がありません');
  temporaryDirectory=await fs.mkdtemp(path.join(os.tmpdir(),'rivercam-history-'));
  for(const [index,frame] of frames.entries())await fs.writeFile(path.join(temporaryDirectory,`${String(index).padStart(6,'0')}.jpg`),frame.buffer);
  const output=path.join(temporaryDirectory,`export.${plan.format}`),input=path.join(temporaryDirectory,'%06d.jpg');
  const args=plan.format==='mp4'
    ?['-hide_banner','-loglevel','error','-y','-framerate',String(plan.fps),'-i',input,'-vf','scale=trunc(iw/2)*2:trunc(ih/2)*2:flags=lanczos,format=yuv420p','-c:v','libx264','-preset','medium','-crf','20','-movflags','+faststart',output]
    :['-hide_banner','-loglevel','error','-y','-framerate',String(plan.fps),'-i',input,'-vf',`fps=${plan.fps},split[s0][s1];[s0]palettegen=max_colors=256:stats_mode=diff[p];[s1][p]paletteuse=dither=sierra2_4a`,'-loop','0',output];
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
      // CRF 20は閲覧用AVIFからの再圧縮による劣化を抑えつつ、実用的な容量にする。
      const ffmpeg=spawn('ffmpeg',['-hide_banner','-loglevel','error','-y','-f','concat','-safe','0','-i',concatFile,'-vf',`fps=${fps},scale=trunc(iw/2)*2:trunc(ih/2)*2:flags=lanczos,format=yuv420p`,'-c:v','libx264','-preset','medium','-crf','20','-movflags','+faststart',output],{stdio:['ignore','ignore','pipe']});
      let error='';ffmpeg.stderr.on('data',chunk=>error+=chunk);ffmpeg.on('error',reject);ffmpeg.on('close',code=>code===0?resolve():reject(new Error(`ffmpeg ${code}: ${error.trim()}`)));
    });
    const stat=await fs.stat(output),downloadName=encodeURIComponent(`${city}_${camera}_${fps}fps.mp4`);
    res.writeHead(200,{'content-type':'video/mp4','content-length':stat.size,'content-disposition':`attachment; filename*=UTF-8''${downloadName}`,'cache-control':'no-store'});
    const stream=(await import('node:fs')).createReadStream(output);stream.pipe(res);await once(stream,'close');
  }catch(error){if(!res.headersSent)res.writeHead(400,{'content-type':'text/plain; charset=utf-8'});res.end(`Export failed: ${error.message}`)}
  finally{if(temporaryDirectory)await fs.rm(temporaryDirectory,{recursive:true,force:true}).catch(()=>{})}
}
function serve(req,res){
  if(req.method==='GET'&&req.url==='/api/cameras'){const list=cameras.map(({id,name,municipality})=>({id,name,municipality})).sort((a,b)=>`${a.municipality}${a.name}`.localeCompare(`${b.municipality}${b.name}`,'ja'));const body=JSON.stringify(list);res.writeHead(200,{'content-type':'application/json; charset=utf-8','content-length':Buffer.byteLength(body),'cache-control':'no-cache'}).end(body);return}
  if(req.method==='POST'&&req.url==='/api/history/check'){historyCheck(req,res);return}
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
http.createServer(serve).listen(config.port,'0.0.0.0',()=>console.log(`viewer: http://0.0.0.0:${config.port}`));
refreshMaster().then(async()=>{
  await poll();
  setInterval(poll,config.warningPollSeconds*1000);
  setInterval(refreshMaster,config.cameraIndexRefreshHours*3600000);
}).catch(error=>console.error('initialization failed',error));
