let cameras = [];
let checkedFrames = [];
const $ = id => document.getElementById(id);

async function init() {
  cameras = await fetch('/api/cameras').then(response => response.json());
  const northToSouth = ['北海道','青森県','岩手県','宮城県','秋田県','山形県','福島県','茨城県','栃木県','群馬県','埼玉県','千葉県','東京都','神奈川県','新潟県','富山県','石川県','福井県','山梨県','長野県','岐阜県','静岡県','愛知県','三重県','滋賀県','京都府','大阪府','兵庫県','奈良県','和歌山県','鳥取県','島根県','岡山県','広島県','山口県','徳島県','香川県','愛媛県','高知県','福岡県','佐賀県','長崎県','熊本県','大分県','宮崎県','鹿児島県','沖縄県'];
  const available = new Set(cameras.map(camera => camera.prefecture).filter(Boolean));
  const prefectures = northToSouth.filter(name => name === '北海道' ? [...available].some(value => value.startsWith('北海道')) : available.has(name));
  for (const name of prefectures) $('prefecture').add(new Option(name, name));
  setDefaultTimes();
  bind();
  await loadWarningLog();
  $('status').textContent = `${cameras.length.toLocaleString()}台 / 過去画像は最大30日前まで / 警報ログ30日保存`;
}

function bind() {
  $('prefecture').onchange = updateMunicipalities;
  $('municipality').onchange = renderCameras;
  $('history-check').onclick = checkHistory;
  $('history-export').onclick = exportHistory;
  $('history-slider').oninput = event => showHistoryFrame(Number(event.target.value));
  $('zip-export').onclick = exportMunicipalityZip;
  for (const button of document.querySelectorAll('.period-picker button')) button.onclick = () => setHistoryPeriod(Number(button.dataset.hours), button);
  for (const id of ['history-camera', 'history-start', 'history-end', 'history-interval']) {
    $(id).addEventListener('change', resetHistoryCheck);
  }
}

function localDateTimeValue(date) {
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}

function setDefaultTimes() {
  const end = new Date();
  end.setMinutes(Math.floor(end.getMinutes() / 10) * 10, 0, 0);
  $('history-end').value = localDateTimeValue(end);
  $('history-start').value = localDateTimeValue(new Date(end.getTime() - 6 * 3600000));
  $('zip-time').value = localDateTimeValue(end);
  for (const input of [$('history-start'), $('history-end'), $('zip-time')]) {
    input.min = localDateTimeValue(new Date(end.getTime() - 30 * 86400000));
    input.max = localDateTimeValue(end);
  }
}

function setHistoryPeriod(hours, selectedButton) {
  const end = new Date();
  end.setMinutes(Math.floor(end.getMinutes() / 5) * 5, 0, 0);
  $('history-end').value = localDateTimeValue(end);
  $('history-start').value = localDateTimeValue(new Date(end.getTime() - hours * 3600000));
  for (const button of document.querySelectorAll('.period-picker button')) button.classList.toggle('active', button === selectedButton);
  resetHistoryCheck();
  if ($('history-camera').value) checkHistory();
}

function updateMunicipalities() {
  const prefecture = $('prefecture').value;
  const names = [...new Set(cameras.filter(camera => prefecture === '北海道' ? camera.prefecture.startsWith('北海道') : camera.prefecture === prefecture).map(camera => camera.municipality))].sort((a, b) => a.localeCompare(b, 'ja'));
  $('municipality').innerHTML = '<option value="">選択してください</option>';
  for (const name of names) $('municipality').add(new Option(name, name));
  $('municipality').disabled = !prefecture;
  $('camera-list').innerHTML = '';
  $('zip-export').disabled = true;
}

function selectedMunicipalityCameras() {
  const prefecture = $('prefecture').value;
  return cameras.filter(camera => (prefecture === '北海道' ? camera.prefecture.startsWith('北海道') : camera.prefecture === prefecture) && camera.municipality === $('municipality').value);
}

function renderCameras() {
  const list = selectedMunicipalityCameras(), root = $('camera-list');
  root.innerHTML = '';
  $('zip-export').disabled = !list.length;
  for (const camera of list) {
    const button = document.createElement('button');
    button.className = 'card';
    button.innerHTML = `<img loading="lazy" src="/api/current/${camera.id}" alt="${camera.name}"><div><strong>${camera.name}</strong><small>ID: ${camera.id}</small></div>`;
    button.onclick = () => selectCamera(camera);
    root.append(button);
  }
}

function selectCamera(camera) {
  const select = $('history-camera');
  select.innerHTML = '';
  select.add(new Option(`${camera.prefecture} / ${camera.municipality} / ${camera.name}`, camera.id));
  select.value = camera.id;
  resetHistoryCheck();
  document.querySelectorAll('.history-export')[1].scrollIntoView({ behavior: 'smooth' });
  checkHistory();
}

function resetHistoryCheck() {
  $('history-export').disabled = true;
  $('history-preview').hidden = true;
  $('history-status').textContent = '過去画像を再確認してください';
  checkedFrames = [];
}

function historyRequest() {
  return {
    cameraId: $('history-camera').value,
    start: $('history-start').value,
    end: $('history-end').value,
    intervalMinutes: Number($('history-interval').value),
    fps: Number($('history-fps').value),
    format: $('history-format').value
  };
}

async function checkHistory() {
  const status = $('history-status');
  $('history-check').disabled = true;
  $('history-export').disabled = true;
  status.textContent = '過去画像を確認しています…';
  try {
    const response = await fetch('/api/history/check', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(historyRequest()) });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || `HTTP ${response.status}`);
    checkedFrames = result.frames || [];
    status.textContent = `${result.requested}時点中 ${result.available}枚を確認`;
    $('history-export').disabled = !result.available;
    $('history-preview').hidden = !result.available;
    if (result.available) {
      $('history-slider').max = result.available - 1;
      $('history-slider').value = result.available - 1;
      showHistoryFrame(result.available - 1);
    }
  } catch (error) { status.textContent = `確認失敗: ${error.message}`; }
  finally { $('history-check').disabled = false; }
}

function showHistoryFrame(index) {
  const frame = checkedFrames[index];
  if (!frame) return;
  $('history-image').src = `/api/history/image?cameraId=${encodeURIComponent($('history-camera').value)}&stamp=${frame}`;
  $('history-time').textContent = `${index + 1} / ${checkedFrames.length}　${frame.slice(0, 4)}-${frame.slice(4, 6)}-${frame.slice(6, 8)} ${frame.slice(8, 10)}:${frame.slice(10, 12)}`;
}

async function downloadResponse(response, fallbackName) {
  if (!response.ok) throw new Error((await response.text()) || `HTTP ${response.status}`);
  const blob = await response.blob(), url = URL.createObjectURL(blob), link = document.createElement('a');
  link.href = url;
  const match = response.headers.get('content-disposition')?.match(/filename="?([^";]+)"?/i);
  link.download = match?.[1] || fallbackName;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

async function exportHistory() {
  const button = $('history-export'), status = $('history-status'), request = historyRequest();
  button.disabled = true; status.textContent = '書き出しています…';
  try {
    const response = await fetch('/api/history/export', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(request) });
    await downloadResponse(response, `${request.cameraId}.${request.format}`);
    status.textContent = '書き出しが完了しました';
  } catch (error) { status.textContent = `書き出し失敗: ${error.message}`; }
  finally { button.disabled = false; }
}

async function exportMunicipalityZip() {
  const button = $('zip-export'), status = $('zip-status');
  button.disabled = true; status.textContent = '全カメラを取得しています…';
  try {
    const response = await fetch('/api/municipality/zip', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ prefecture: $('prefecture').value, municipality: $('municipality').value, time: $('zip-time').value }) });
    await downloadResponse(response, `${$('prefecture').value}_${$('municipality').value}.zip`);
    status.textContent = 'ZIP保存が完了しました';
  } catch (error) { status.textContent = `ZIP失敗: ${error.message}`; }
  finally { button.disabled = false; }
}

function warningRegionCameras(region) {
  const normalized = value => String(value || '').normalize('NFKC').replace(/[ 　]/g, '').replace(/^.+郡(?=.+[町村]$)/, '');
  const target = normalized(region.name);
  const prefix = String(region.code || '').slice(0, 2);
  return cameras.filter(camera => {
    const municipality = normalized(camera.municipality);
    const codeMatches = !prefix || String(camera.municipalityCode || '').startsWith(prefix) || String(camera.prefectureCode || '').padStart(2, '0').startsWith(prefix);
    return codeMatches && (municipality === target || municipality.startsWith(target) || target.startsWith(municipality));
  });
}

function showWarningRegionCameras(region) {
  const matches = warningRegionCameras(region), root = $('warning-camera-list');
  $('warning-camera-result').hidden = false;
  $('warning-camera-title').textContent = `${region.name} / ${region.label}（${matches.length}台）`;
  root.innerHTML = '';
  if (!matches.length) { root.textContent = '対応する河川カメラはありません。'; return; }
  for (const camera of matches) {
    const button = document.createElement('button');
    button.className = 'card';
    button.innerHTML = `<img loading="lazy" src="/api/current/${camera.id}" alt="${camera.name}"><div><strong>${camera.name}</strong><small>${camera.prefecture} ${camera.municipality} / ID: ${camera.id}</small></div>`;
    button.onclick = () => selectCamera(camera);
    root.append(button);
  }
  $('warning-camera-result').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

async function loadWarningLog() {
  const logs = await fetch('/api/warnings').then(response => response.json()).catch(() => []), root = $('warning-log');
  if (!logs.length) { root.textContent = '記録はまだありません'; return; }
  root.innerHTML = '';
  for (const log of logs.slice().reverse()) {
    const details = document.createElement('details'), summary = document.createElement('summary'), regions = document.createElement('div');
    summary.textContent = `${new Date(log.at).toLocaleString('ja-JP')}　${log.active.length}地域`;
    regions.className = 'warning-regions';
    if (!log.active.length) regions.textContent = '対象なし';
    for (const item of log.active) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'warning-region';
      button.textContent = `${item.name}: ${item.label}`;
      button.onclick = () => showWarningRegionCameras(item);
      regions.append(button);
    }
    details.append(summary, regions); root.append(details);
  }
}

init().catch(error => $('status').textContent = `エラー: ${error.message}`);
