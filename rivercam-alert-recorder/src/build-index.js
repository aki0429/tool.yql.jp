import fs from 'node:fs/promises';
import path from 'node:path';
import { loadConfig, ROOT, writeJsonAtomic } from './core.js';

export async function buildIndex() {
  const config=await loadConfig(), main=path.resolve(ROOT,config.mainDirectory), municipalities=[];
  for (const cityEntry of await fs.readdir(main,{withFileTypes:true}).catch(()=>[])) {
    if (!cityEntry.isDirectory()) continue; const cityPath=path.join(main,cityEntry.name), cameras=[];
    for (const cameraEntry of await fs.readdir(cityPath,{withFileTypes:true}).catch(()=>[])) {
      if (!cameraEntry.isDirectory()) continue; const cameraPath=path.join(cityPath,cameraEntry.name);
      const files=(await fs.readdir(cameraPath).catch(()=>[])).filter(f=>/\.(jpe?g|png|webp|avif)$/i.test(f)).sort().reverse();
      let metadata={}; try{metadata=JSON.parse(await fs.readFile(path.join(cameraPath,'camera.json'),'utf8'))}catch{}
      if(files.length)cameras.push({...metadata,directory:cameraEntry.name,count:files.length,latest:files[0],files});
    }
    if(cameras.length) municipalities.push({name:cityEntry.name,cameras});
  }
  const index={generatedAt:new Date().toISOString(),municipalities};
  await writeJsonAtomic(path.join(main,'index.json'),index); return index;
}
if (process.argv[1]===import.meta.filename) buildIndex().then(x=>console.log(`indexed ${x.municipalities.length} municipalities`));
