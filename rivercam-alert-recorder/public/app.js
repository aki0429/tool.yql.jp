let data;
let selectedFiles = [];
let selectedCamera = null;

const $ = id => document.getElementById(id);
const enc = value => value.split('/').map(encodeURIComponent).join('/');

async function init() {
  const [index, status] = await Promise.all([
    fetch('/archive/index.json').then(response => response.json()),
    fetch('/archive/status.json').then(response => response.json()).catch(() => ({}))
  ]);
  data = index;
  $('status').textContent = `索引更新 ${new Date(index.generatedAt).toLocaleString('ja-JP')} / 警報地域 ${status.activeWarnings?.length || 0} / 対象カメラ ${status.targetCameras || 0}`;
  for (const city of index.municipalities) $('city').add(new Option(city.name, city.name));
  bind();
  render();
}

function bind() {
  for (const id of ['city', 'camera', 'date']) {
    $(id).addEventListener('change', () => {
      if (id === 'city') updateCameras();
      render();
    });
  }
  $('latest').onclick = () => { $('date').value = ''; render(); };
  $('close').onclick = () => $('viewer').close();
  $('slider').oninput = event => showFrame(Number(event.target.value));
  $('export-video').onclick = exportVideo;
}

function updateCameras() {
  const city = data.municipalities.find(item => item.name === $('city').value);
  $('camera').innerHTML = '<option value="">全カメラ</option>';
  for (const camera of city?.cameras || []) $('camera').add(new Option(camera.name || camera.directory, camera.directory));
}

function filteredFiles(camera) {
  const date = $('date').value;
  return date ? camera.files.filter(file => file.startsWith(date)) : camera.files;
}

function render() {
  const root = $('content');
  root.innerHTML = '';
  for (const city of data.municipalities) {
    if ($('city').value && city.name !== $('city').value) continue;
    const cameras = city.cameras.filter(camera =>
      (!$('camera').value || camera.directory === $('camera').value) && filteredFiles(camera).length
    );
    if (!cameras.length) continue;

    const section = document.createElement('section');
    section.className = 'city';
    section.innerHTML = `<h2>${city.name}</h2><div class="grid"></div>`;
    for (const camera of cameras) {
      const files = filteredFiles(camera);
      const button = document.createElement('button');
      button.className = 'card';
      button.innerHTML = `<img loading="lazy" src="/archive/${enc(`${city.name}/${camera.directory}/${files[0]}`)}"><div><strong>${camera.name || camera.directory}</strong><small>${files.length}枚 / ${files[0]}</small></div>`;
      button.onclick = () => openViewer(city, camera, files);
      section.querySelector('.grid').append(button);
    }
    root.append(section);
  }
}

function openViewer(city, camera, files) {
  selectedFiles = files.map(file => ({
    url: `/archive/${enc(`${city.name}/${camera.directory}/${file}`)}`,
    name: file
  })).reverse();
  selectedCamera = { city: city.name, directory: camera.directory, name: camera.name || camera.directory };
  $('title').textContent = `${city.name} / ${selectedCamera.name}`;
  $('slider').max = selectedFiles.length - 1;
  $('slider').value = selectedFiles.length - 1;
  $('export-status').textContent = '';
  showFrame(selectedFiles.length - 1);
  $('viewer').showModal();
}

function showFrame(index) {
  const frame = selectedFiles[index];
  if (!frame) return;
  $('image').src = frame.url;
  $('time').textContent = `${index + 1} / ${selectedFiles.length}　${frame.name}`;
}

async function exportVideo() {
  if (!selectedCamera || !selectedFiles.length) return;
  const button = $('export-video');
  const status = $('export-status');
  button.disabled = true;
  status.textContent = '動画を作成しています…';
  try {
    const response = await fetch('/api/export', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        city: selectedCamera.city,
        camera: selectedCamera.directory,
        files: selectedFiles.map(frame => frame.name),
        fps: Number($('export-fps').value)
      })
    });
    if (!response.ok) throw new Error((await response.text()) || `HTTP ${response.status}`);
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${selectedCamera.city}_${selectedCamera.name}_${$('export-fps').value}fps.mp4`.replace(/[\\/:*?"<>|]/g, '_');
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
    status.textContent = '書き出しが完了しました';
  } catch (error) {
    status.textContent = `失敗: ${error.message}`;
  } finally {
    button.disabled = false;
  }
}

init().catch(error => $('status').textContent = `エラー: ${error.message}`);
