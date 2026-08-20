import fs from 'node:fs/promises';
import path from 'node:path';

export const ROOT = path.resolve(import.meta.dirname, '..');
export async function loadConfig() {
  const file = process.env.RECORDER_CONFIG || path.join(ROOT, 'config.json');
  try { return JSON.parse(await fs.readFile(file, 'utf8')); }
  catch { return JSON.parse(await fs.readFile(path.join(ROOT, 'config.example.json'), 'utf8')); }
}
export const safeName = value => String(value || '名称不明').normalize('NFKC').replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').replace(/[. ]+$/g, '').slice(0, 100) || '名称不明';
export async function fetchJson(url, timeout=20000) {
  const response = await fetch(url, { signal: AbortSignal.timeout(timeout), headers: { 'user-agent': 'rivercam-alert-recorder/1.0' } });
  if (!response.ok) throw new Error(`${url} HTTP ${response.status}`);
  return response.json();
}
export async function mapLimit(items, limit, worker) {
  let cursor=0; const results=[];
  await Promise.all(Array.from({length:Math.min(limit,items.length)}, async()=>{ while(cursor<items.length){ const i=cursor++; try{results[i]=await worker(items[i],i)}catch(e){results[i]={error:e.message}} } }));
  return results;
}
const isActiveWarning = warning => !/解除|発表警報・注意報はなし/.test(String(warning?.status || ''));
const hasProperty = (warning, pattern) => (warning?.properties || []).some(property => pattern.test(String(property?.type || '')));

export function warningDetails(warnings=[]) {
  const active = warnings.filter(isActiveWarning);
  let rainLevel = 0;
  let landslideLevel = 0;

  for (const warning of active) {
    const code = String(warning.code || '');
    const explicitLevel = Number(warning.level) || 0;
    const text = `${warning.name || ''} ${warning.status || ''}`;
    const landslide = hasProperty(warning, /土砂災害/) || /土砂災害/.test(text);
    const rain = hasProperty(warning, /大雨|浸水/) || (!landslide && ['10', '03', '33'].includes(code));

    // 気象庁防災情報XMLコード: 33=大雨特別警報、03=大雨警報、
    // 10=大雨注意報、49=土砂災害警戒情報（レベル4相当）。
    if (rain && (code === '33' || explicitLevel >= 5)) rainLevel = Math.max(rainLevel, 5);
    else if (rain && code === '03') rainLevel = Math.max(rainLevel, 3);
    else if (rain && code === '10') rainLevel = Math.max(rainLevel, 2);

    if ((code === '33' && landslide) || /土砂災害特別警報/.test(text)) landslideLevel = Math.max(landslideLevel, 5);
    else if (code === '49' || explicitLevel === 4 || /土砂災害警戒情報|土砂災害危険警報/.test(text)) landslideLevel = Math.max(landslideLevel, 4);
    else if (code === '03' && landslide) landslideLevel = Math.max(landslideLevel, 3);
    else if ((code === '10' || code === '29') && landslide) landslideLevel = Math.max(landslideLevel, 2);
  }

  const labels = [];
  if (rainLevel) labels.push(({ 2: '大雨注意報', 3: '大雨警報', 5: '大雨特別警報' })[rainLevel]);
  if (landslideLevel) labels.push(({ 2: '土砂災害注意報', 3: '土砂災害警報', 4: '土砂災害危険警報', 5: '土砂災害特別警報' })[landslideLevel]);
  return {
    level: Math.max(rainLevel, landslideLevel),
    label: labels.length ? labels.join('・') : '発表なし',
    rainLevel,
    landslideLevel
  };
}
export function warningLevel(warnings=[]) { return warningDetails(warnings).level; }
export function warningLabel(_level, warnings=[]) { return warningDetails(warnings).label; }
export async function writeJsonAtomic(file, value) {
  await fs.mkdir(path.dirname(file), {recursive:true}); const tmp=`${file}.tmp-${process.pid}`;
  await fs.writeFile(tmp, JSON.stringify(value,null,2)); await fs.rename(tmp,file);
}
