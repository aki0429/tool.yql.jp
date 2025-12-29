const JSON_URL = 'streams.json';
const LS_KEY = 'yt_streams';

let streams = [];
let activeTimers = [];

// ---- util ----
function getYTId(url) {
  if (!url) return null;
  const m = url.match(/(?:v=|youtu\.be\/|embed\/|live\/)([a-zA-Z0-9_-]+)/);
  return m ? m[1] : (url.length === 11 ? url : null);
}

function createEmbedUrl(id) {
  return `https://www.youtube.com/embed/${id}?autoplay=1&mute=1&playsinline=1&rel=0&vq=medium`;
}

const loadLocal = () => JSON.parse(localStorage.getItem(LS_KEY) || '[]');
const saveLocal = v => localStorage.setItem(LS_KEY, JSON.stringify(v));

// ---- init ----
fetch(JSON_URL)
  .then(r => r.json())
  .catch(() => [])
  .then(j => {
    const processed = (j || []).map(s => {
      if (s.type === 'youtube' && !s.embed) {
        s.embed = createEmbedUrl(getYTId(s.url));
      }
      return s;
    });
    streams = processed.concat(loadLocal());
    renderList();
  });

// ---- UI ----
function renderList() {
  const list = document.getElementById('list');
  list.innerHTML = '';
  streams.forEach(s => {
    const d = document.createElement('div');
    d.className = 'item';
    d.innerHTML = `
      <label>
        <input type="checkbox" value="${s.id}">
        <span>${s.name}</span>
        <small style="color:#666">(${s.type})</small>
      </label>`;
    list.appendChild(d);
  });
}

function addNewStream() {
  const name = document.getElementById('ytName').value || 'New Stream';
  const url = document.getElementById('ytUrl').value;
  if (!url) return;

  let item = { id: 'st_' + Date.now(), name, url };
  const ytId = getYTId(url);

  if (ytId) {
    item.type = 'youtube';
    item.embed = createEmbedUrl(ytId);
  } else {
    item.type = url.includes('.m3u8') ? 'hls' : (url.includes('.cgi') ? 'cgi' : 'video');
  }

  const local = loadLocal();
  local.push(item);
  saveLocal(local);

  streams.push(item);
  renderList();
  document.getElementById('ytUrl').value = '';
}

document.getElementById('selectAllBtn').onclick = () => {
  const c = document.querySelectorAll('#list input');
  const all = [...c].every(x => x.checked);
  c.forEach(x => x.checked = !all);
};

document.getElementById('fsBtn').onclick = () => {
  document.fullscreenElement
    ? document.exitFullscreen()
    : document.documentElement.requestFullscreen();
};

// ---- start ----
function start(split){
  const ids=[...document.querySelectorAll('#list input:checked')].map(i=>i.value);
  if(ids.length === 0) return alert('配信を選択してください');

  document.getElementById('select').style.display='none';
  document.getElementById('view').style.display='block';
  document.getElementById('fsBtn').style.display='block';

  activeTimers.forEach(t => clearInterval(t));
  activeTimers = [];

  const grid = document.getElementById('grid');
  let cols, rows, isL6 = false;
  if(split===6){ cols=3; rows=3; isL6=true; }
  else { cols=Math.ceil(Math.sqrt(split)); rows=Math.ceil(split/cols); }

  grid.style.gridTemplateColumns=`repeat(${cols},1fr)`;
  grid.style.gridTemplateRows=`repeat(${rows},1fr)`;
  grid.innerHTML='';

  for(let i=0; i<(isL6 ? 6 : split); i++){
    const s=streams.find(x=>x.id===ids[i]);
    const cell = document.createElement('div');
    cell.className = 'cell';
    if(isL6 && i===0) cell.classList.add('main');

    const label = document.createElement('div');
    label.className = 'label';

    const error = document.createElement('div');
    error.className = 'error';

    // ---- 未選択マス（カラーバー代替） ----
    if(!s){
      const img=document.createElement('img');
      img.src='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';
      cell.appendChild(img);
      error.textContent = 'NO SOURCE';
      error.style.display = 'flex';
    }

    // ---- YouTube ----
    else if(s.type==='youtube'){
      const f=document.createElement('iframe');
      f.src=s.embed;
      f.allow='autoplay; encrypted-media; picture-in-picture';
      cell.appendChild(f);
      label.textContent = s.name;
    }

    // ---- CGI ----
    else if(s.type==='cgi'){
      const img = document.createElement('img');
      const update = () => {
        img.src = `proxy.php?url=${encodeURIComponent(s.url)}&_t=${Date.now()}`;
      };
      update();
      activeTimers.push(setInterval(update, 1000));
      cell.appendChild(img);
      label.textContent = s.name;
    }

    // ---- VIDEO / HLS ----
    else {
      const v = document.createElement('video');
      v.muted = true;
      v.autoplay = true;
      v.playsInline = true;

      const vSrc = `proxy.php?url=${encodeURIComponent(s.url)}`;

      if (s.url.includes('.m3u8')) {
        if (Hls.isSupported()) {
          const hls = new Hls({
            xhrSetup: function(xhr) {
              xhr.withCredentials = false;
            }
          });
          hls.loadSource(vSrc);
          hls.attachMedia(v);
        } else if (v.canPlayType('application/vnd.apple.mpegurl')) {
          v.src = vSrc;
        }
      } else {
        v.src = vSrc;
      }

      v.onerror = () => {
        error.textContent = 'VIDEO ERROR';
        error.style.display = 'flex';
      };
      v.onplaying = () => {
        error.style.display = 'none';
      };

      cell.appendChild(v);
      label.textContent = s.name;
    }

    cell.appendChild(error);
    cell.appendChild(label);
    grid.appendChild(cell);
  }
}
