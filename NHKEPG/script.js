const statusEl = document.getElementById('status');
const summaryEl = document.getElementById('summary');
const guideEl = document.getElementById('guide');
const legendEl = document.getElementById('legend');
const groupFilterEl = document.getElementById('groupFilter');
const dateInput = document.getElementById('dateInput');
const reloadBtn = document.getElementById('reloadBtn');

const HOUR_HEIGHT = 228;
const DAY_MINUTES = 24 * 60;
const WINDOW_START_MINUTES = 5 * 60;
const WINDOW_END_MINUTES = WINDOW_START_MINUTES + DAY_MINUTES;
const WINDOW_DURATION_MINUTES = WINDOW_END_MINUTES - WINDOW_START_MINUTES;
const BS_BASE_AREA_ID = '130';
const MIN_PROGRAM_HEIGHT_1MIN = 62;
const MIN_PROGRAM_HEIGHT_5MIN = 50;
const MIN_PROGRAM_HEIGHT_10MIN = 36;
const MIN_PROGRAM_HEIGHT_DEFAULT = 30;
const PRE_ONE_MINUTE_CLEARANCE_PX = 10;
const JSON_CACHE_TTL_MS = 30 * 60 * 1000;
const JSON_CACHE_KEY_PREFIX = 'nhk_epg_json_cache:';

document.documentElement.style.setProperty('--hour-height', `${HOUR_HEIGHT}px`);

const GUIDE_GROUPS = [
  { key: 'general', label: '総合' },
  { key: 'etv', label: 'Eテレ' },
  { key: 'radioAm', label: 'ラジオAM' },
  { key: 'radioFm', label: 'ラジオFM' },
  { key: 'bs', label: 'BS' },
  { key: 'bs4k8k', label: '4K8K' }
];

const SERVICE_ORDER = {
  g1: 1,
  g2: 2,
  e1: 1,
  e2: 2,
  e3: 3,
  r1: 1,
  r2: 2,
  r3: 3,
  s1: 1,
  s2: 2,
  s3: 3,
  s4: 4,
  s5: 5,
  s6: 6
};

let latestChannels = [];
let latestDate = todayJst();
let latestFetchInfo = { success: 0, fail: 0 };

const CATEGORY_COLORS = [
  { label: 'ニュース/報道', key: 'cat-news' },
  { label: 'スポーツ', key: 'cat-sports' },
  { label: '情報/ワイドショー', key: 'cat-info' },
  { label: 'ドラマ', key: 'cat-drama' },
  { label: 'バラエティ', key: 'cat-variety' },
  { label: '音楽', key: 'cat-music' },
  { label: 'アニメ/特撮', key: 'cat-anime' },
  { label: 'ドキュメンタリー/教養', key: 'cat-documentary' },
  { label: '趣味/教育', key: 'cat-hobby' },
  { label: '福祉', key: 'cat-welfare' },
  { label: '映画', key: 'cat-cinema' },
  { label: 'その他', key: 'cat-other' }
];

function todayJst() {
  const now = new Date();
  const utc = now.getTime() + now.getTimezoneOffset() * 60000;
  const jst = new Date(utc + 9 * 60 * 60000);
  return jst.toISOString().slice(0, 10);
}

function toDateUrl(baseUrl, date) {
  const normalized = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
  return `${normalized}${date}.json`;
}

function resolveLocalJsonUrl(fileName) {
  return new URL(`./${fileName}`, window.location.href).toString();
}

function inferSourceTypeFromText(value) {
  const text = String(value ?? '').toLowerCase();
  return text.includes('radio') ? 'radio' : 'tv';
}

function normalizeEpgSources(epgConfig) {
  const normalized = [];

  const pushSource = (baseUrlValue, sourceTypeHint) => {
    const baseUrl = String(baseUrlValue ?? '').trim();
    if (!baseUrl) return;

    const sourceType = sourceTypeHint === 'radio' || sourceTypeHint === 'tv'
      ? sourceTypeHint
      : inferSourceTypeFromText(baseUrl);

    normalized.push({ baseUrl, sourceType });
  };

  if (Array.isArray(epgConfig)) {
    epgConfig.forEach((entry) => {
      if (typeof entry === 'string') {
        pushSource(entry, null);
      } else if (entry && typeof entry === 'object') {
        pushSource(entry.url ?? entry.baseUrl, entry.type);
      }
    });
  } else if (epgConfig && typeof epgConfig === 'object') {
    Object.entries(epgConfig).forEach(([groupKey, value]) => {
      const groupType = inferSourceTypeFromText(groupKey);
      if (Array.isArray(value)) {
        value.forEach((entry) => {
          if (typeof entry === 'string') {
            pushSource(entry, groupType);
          } else if (entry && typeof entry === 'object') {
            pushSource(entry.url ?? entry.baseUrl, entry.type || groupType);
          }
        });
      } else if (typeof value === 'string') {
        pushSource(value, groupType);
      }
    });
  }

  const unique = new Map();
  normalized.forEach((item) => {
    if (!unique.has(item.baseUrl)) {
      unique.set(item.baseUrl, item);
    }
  });

  return [...unique.values()];
}

function parseMinuteFromBaseDate(iso, baseDate) {
  if (!iso || !baseDate) return null;

  const eventDate = new Date(iso);
  const baseDateTime = new Date(`${baseDate}T00:00:00+09:00`);
  if (Number.isNaN(eventDate.getTime()) || Number.isNaN(baseDateTime.getTime())) return null;

  return Math.floor((eventDate.getTime() - baseDateTime.getTime()) / 60000);
}

function formatMinute(minute) {
  const normalized = Math.max(0, minute);
  const h = String(Math.floor(normalized / 60)).padStart(2, '0');
  const m = String(normalized % 60).padStart(2, '0');
  return `${h}:${m}`;
}

function normalizeEventWindow(startMinute, endMinute) {
  let normalizedStart = startMinute;
  let normalizedEnd = endMinute;

  if (normalizedEnd <= normalizedStart) {
    normalizedEnd += DAY_MINUTES;
  }

  return { normalizedStart, normalizedEnd };
}

function categoryClass(categoryName) {
  const value = categoryName || '';
  if (value.includes('ニュース') || value.includes('報道')) return 'cat-news';
  if (value.includes('スポーツ')) return 'cat-sports';
  if (value.includes('情報') || value.includes('ワイドショー')) return 'cat-info';
  if (value.includes('ドラマ')) return 'cat-drama';
  if (value.includes('バラエティ')) return 'cat-variety';
  if (value.includes('音楽')) return 'cat-music';
  if (value.includes('アニメ') || value.includes('特撮')) return 'cat-anime';
  if (value.includes('ドキュメンタリー') || value.includes('教養')) return 'cat-documentary';
  if (value.includes('趣味') || value.includes('教育')) return 'cat-hobby';
  if (value.includes('福祉')) return 'cat-welfare';
  if (value.includes('映画')) return 'cat-cinema';
  return 'cat-other';
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}

function normalizeProgramTitle(title) {
  return String(title ?? '')
    .normalize('NFKC')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function normalizeProgramDescription(description) {
  return String(description ?? '')
    .normalize('NFKC')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function isOneMinuteProgram(durationMinutes) {
  const minutes = Number(durationMinutes) || 0;
  return minutes > 0 && minutes <= 1;
}

function getMinimumProgramHeight(durationMinutes) {
  const minutes = Number(durationMinutes) || 0;
  if (isOneMinuteProgram(minutes)) return MIN_PROGRAM_HEIGHT_1MIN;
  if (minutes <= 5) return MIN_PROGRAM_HEIGHT_5MIN;
  if (minutes <= 10) return MIN_PROGRAM_HEIGHT_10MIN;
  return MIN_PROGRAM_HEIGHT_DEFAULT;
}

function setStatus(message) {
  statusEl.textContent = message;
}

function buildJsonCacheKey(url) {
  return `${JSON_CACHE_KEY_PREFIX}${url}`;
}

function readCachedJson(url) {
  try {
    const raw = localStorage.getItem(buildJsonCacheKey(url));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    const cachedAt = Number(parsed.cachedAt);
    if (!Number.isFinite(cachedAt)) return null;
    if (Date.now() - cachedAt > JSON_CACHE_TTL_MS) return null;
    return parsed.data;
  } catch {
    return null;
  }
}

function writeCachedJson(url, data) {
  try {
    localStorage.setItem(
      buildJsonCacheKey(url),
      JSON.stringify({ cachedAt: Date.now(), data })
    );
  } catch {
    // ignore quota or serialization errors
  }
}

async function fetchJsonWithTtlCache(url, options = {}) {
  const forceRefresh = Boolean(options.forceRefresh);
  if (!forceRefresh) {
    const cached = readCachedJson(url);
    if (cached != null) return cached;
  }

  const response = await fetch(url, { cache: forceRefresh ? 'no-store' : 'default' });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const data = await response.json();
  writeCachedJson(url, data);
  return data;
}

function renderLegend() {
  legendEl.innerHTML = CATEGORY_COLORS.map((item) => `
    <span class="legend-item">
      <span class="legend-chip ${item.key}"></span>${item.label}
    </span>
  `).join('');
}

function renderGroupFilter() {
  groupFilterEl.innerHTML = `
    <label for="groupSelect">表示区分</label>
    <select id="groupSelect" class="group-select">
      ${GUIDE_GROUPS.map((group) => `<option value="${group.key}">${group.label}</option>`).join('')}
    </select>
  `;
}

function getSelectedGroupKey() {
  const select = document.getElementById('groupSelect');
  if (!(select instanceof HTMLSelectElement)) return GUIDE_GROUPS[0].key;
  return select.value;
}

function getEventArrayFromChannelData(channelData) {
  if (!channelData || typeof channelData !== 'object') return [];
  const values = Object.values(channelData);
  for (const value of values) {
    if (!Array.isArray(value)) continue;
    const hasProgram = value.some((entry) => entry?.type === 'BroadcastEvent' && entry.startDate && entry.endDate);
    if (hasProgram) {
      return value.filter((entry) => entry?.type === 'BroadcastEvent' && entry.startDate && entry.endDate);
    }
  }
  return [];
}

function getGroupKey(serviceId, channelName, serviceName) {
  const sid = (serviceId || '').toLowerCase();
  const name = `${channelName || ''} ${serviceName || ''}`;
  const lowerName = name.toLowerCase();

  const looksLikeRadioId = sid.startsWith('r') || sid.startsWith('n');
  const looksLikeRadioName =
    name.includes('ラジオ') ||
    lowerName.includes('radio') ||
    /(^|\s)(r1|r2|nhk\s*fm)(\s|$)/i.test(lowerName) ||
    (name.includes('NHK') && (name.includes('第1') || name.includes('第2') || name.includes('ＦＭ') || name.includes('FM')));

  if (looksLikeRadioId || looksLikeRadioName) {
    const isFm = sid === 'r3' || lowerName.includes('fm') || name.includes('ＦＭ') || name.includes('FM');
    return isFm ? 'radioFm' : 'radioAm';
  }

  if (sid.startsWith('g')) return 'general';
  if (sid.startsWith('e')) return 'etv';
  if (sid.startsWith('b') || name.includes('4K') || name.includes('8K')) return 'bs4k8k';
  if (sid.startsWith('s')) return 'bs';
  return 'bs';
}

function extractChannelsFromResponse(data, sourceOrder, baseDate) {
  const channels = [];
  if (!data || typeof data !== 'object') return channels;

  for (const [serviceKey, serviceData] of Object.entries(data)) {
    if (!serviceData || typeof serviceData !== 'object') continue;

    const meta = serviceData.publishedOn?.[0];
    const idGroup = meta?.identifierGroup || {};
    const serviceId = idGroup.serviceId || serviceKey;
    const serviceName = idGroup.serviceName || serviceKey;
    const areaId = idGroup.areaId || '000';
    const channelName = meta?.broadcastDisplayName || idGroup.shortenedDisplayName || idGroup.serviceName || serviceKey;
    const groupKey = getGroupKey(serviceId, channelName, serviceName);
    const multiName = idGroup.multiChannelDisplayName || '';
    const normalizedServiceId = String(serviceId || '').toLowerCase();
    const isGeneralSub = normalizedServiceId.startsWith('g') && normalizedServiceId !== 'g1';
    const isEtvSub = normalizedServiceId.startsWith('e') && normalizedServiceId !== 'e1';
    const isSubChannel =
      /サブ|sub|マルチ/i.test(channelName) ||
      /サブ|sub|マルチ/i.test(multiName) ||
      isGeneralSub ||
      isEtvSub;

    const channelId = `${serviceId}-${areaId}`;
    const events = getEventArrayFromChannelData(serviceData).map((event) => {
      const startMinute = parseMinuteFromBaseDate(event.startDate, baseDate);
      const endMinute = parseMinuteFromBaseDate(event.endDate, baseDate);
      if (startMinute == null || endMinute == null) return null;

      const { normalizedStart, normalizedEnd } = normalizeEventWindow(startMinute, endMinute);

      const firstGenre = event.identifierGroup?.genre?.[0] || {};
      const category = firstGenre.name1 || 'その他';
      const episodeId =
        event.identifierGroup?.tvEpisodeId ||
        event.about?.identifierGroup?.tvEpisodeId ||
        '';

      return {
        title: event.name || '番組情報なし',
        description: event.description || '',
        category,
        episodeId,
        eventShareStatus: String(event.misc?.eventShareStatus || '').toLowerCase(),
        startMinute: normalizedStart,
        endMinute: normalizedEnd,
        duration: Math.max(5, normalizedEnd - normalizedStart)
      };
    }).filter(Boolean);

    channels.push({
      channelId,
      channelName,
      serviceId,
      serviceName,
      areaId,
      groupKey,
      isSubChannel,
      sourceOrder,
      events
    });
  }

  return channels;
}

function mergeChannels(channels) {
  const map = new Map();
  for (const channel of channels) {
    if (!map.has(channel.channelId)) {
      map.set(channel.channelId, {
        ...channel,
        events: [...channel.events]
      });
      continue;
    }

    const existing = map.get(channel.channelId);
    existing.events.push(...channel.events);
    existing.sourceOrder = Math.min(existing.sourceOrder, channel.sourceOrder);
  }

  for (const channel of map.values()) {
    channel.events.sort((a, b) => a.startMinute - b.startMinute);
  }

  return [...map.values()].sort((a, b) => {
    const groupDiff = GUIDE_GROUPS.findIndex((group) => group.key === a.groupKey) - GUIDE_GROUPS.findIndex((group) => group.key === b.groupKey);
    if (groupDiff !== 0) return groupDiff;

    const sourceDiff = a.sourceOrder - b.sourceOrder;
    if (sourceDiff !== 0) return sourceDiff;

    const areaCompare = a.areaId.localeCompare(b.areaId, 'ja', { numeric: true });
    if (areaCompare !== 0) return areaCompare;

    const aOrder = SERVICE_ORDER[a.serviceId] ?? 999;
    const bOrder = SERVICE_ORDER[b.serviceId] ?? 999;
    if (aOrder !== bOrder) return aOrder - bOrder;

    return a.serviceId.localeCompare(b.serviceId, 'ja', { numeric: true });
  });
}

function renderGuideSection(channels, date, title) {
  if (!channels.length) {
    return `
      <section class="guide-section">
        <div class="empty">番組データがありません。</div>
      </section>
    `;
  }

  const baseGuideHeight = (WINDOW_DURATION_MINUTES / 60) * HOUR_HEIGHT;
  const hourLines = Array.from({ length: 25 }, (_, index) => {
    const hour = WINDOW_START_MINUTES / 60 + index;
    const top = (index * 60 / 60) * HOUR_HEIGHT;
    return `
      <div class="hour-line" style="top:${top}px"></div>
      <div class="time-label" style="top:${top}px">${String(hour).padStart(2, '0')}:00</div>
    `;
  }).join('');

  const channelViewList = channels.map((channel, index) => {
    const prev = channels[index - 1];
    const isAreaStart = !prev || prev.areaId !== channel.areaId;
    return {
      ...channel,
      isAreaStart
    };
  });

  const pairIndexMap = new Map();
  for (let index = 1; index < channelViewList.length; index += 1) {
    const current = channelViewList[index];
    const prev = channelViewList[index - 1];
    if (!current.isSubChannel || prev.isSubChannel) continue;
    if (current.areaId !== prev.areaId) continue;
    pairIndexMap.set(index - 1, index);
    pairIndexMap.set(index, index - 1);
  }

  const mergedMainEventIndexMap = new Map();
  const mergedSubEventIndexMap = new Map();

  for (const [mainChannelIndex, subChannelIndex] of pairIndexMap.entries()) {
    if (mainChannelIndex > subChannelIndex) continue;

    const mainChannel = channelViewList[mainChannelIndex];
    const subChannel = channelViewList[subChannelIndex];
    const subTitleMap = new Map();

    subChannel.events.forEach((event, eventIndex) => {
      const key = normalizeProgramTitle(event.title);
      if (!key) return;
      if (!subTitleMap.has(key)) {
        subTitleMap.set(key, []);
      }
      subTitleMap.get(key).push({ event, eventIndex });
    });

    mainChannel.events.forEach((event, eventIndex) => {
      const key = normalizeProgramTitle(event.title);
      if (!key) return;

      const candidates = subTitleMap.get(key);
      if (!candidates || candidates.length === 0) return;

      const matchedCandidateIndex = candidates.findIndex(({ event: subEvent }) => {
        const mainEpisodeId = String(event.episodeId || '');
        const subEpisodeId = String(subEvent.episodeId || '');
        const overlapStart = Math.max(event.startMinute, subEvent.startMinute);
        const overlapEnd = Math.min(event.endMinute, subEvent.endMinute);
        if (overlapEnd <= overlapStart) return false;

        const overlapDuration = overlapEnd - overlapStart;
        const mainDuration = Math.max(1, event.endMinute - event.startMinute);
        const subDuration = Math.max(1, subEvent.endMinute - subEvent.startMinute);
        const shorterDuration = Math.min(mainDuration, subDuration);
        const startDiff = Math.abs(event.startMinute - subEvent.startMinute);
        const endDiff = Math.abs(event.endMinute - subEvent.endMinute);

        const isAlmostSameWindow = startDiff <= 2 && endDiff <= 2;
        const hasEnoughOverlap = overlapDuration >= shorterDuration * 0.95;

        const hasSameEpisodeId = mainEpisodeId && subEpisodeId && mainEpisodeId === subEpisodeId;
        if (hasSameEpisodeId) {
          return isAlmostSameWindow && hasEnoughOverlap;
        }

        const mainDescription = normalizeProgramDescription(event.description);
        const subDescription = normalizeProgramDescription(subEvent.description);
        const hasSameDescription = !!mainDescription && mainDescription === subDescription;
        const isSharedEvent = event.eventShareStatus === 'multiple' || subEvent.eventShareStatus === 'multiple';
        const isStrictSameWindow = startDiff <= 1 && endDiff <= 1;
        const hasVeryHighOverlap = overlapDuration >= shorterDuration * 0.98;

        return isStrictSameWindow && hasVeryHighOverlap && (isSharedEvent || hasSameDescription);
      });

      if (matchedCandidateIndex < 0) return;

      const [matchedSub] = candidates.splice(matchedCandidateIndex, 1);
      if (!matchedSub) return;

      if (!mergedMainEventIndexMap.has(mainChannelIndex)) {
        mergedMainEventIndexMap.set(mainChannelIndex, new Set());
      }
      if (!mergedSubEventIndexMap.has(subChannelIndex)) {
        mergedSubEventIndexMap.set(subChannelIndex, new Set());
      }

      mergedMainEventIndexMap.get(mainChannelIndex).add(eventIndex);
      mergedSubEventIndexMap.get(subChannelIndex).add(matchedSub.eventIndex);
    });
  }

  const headers = channelViewList.map((channel) => {
    const classes = ['channel-head'];
    if (channel.isSubChannel) classes.push('is-sub');
    if (channel.isAreaStart) classes.push('area-start');
    const subLabel = channel.isSubChannel ? '<span class="sub-chip">サブ</span>' : '<span class="main-chip">総合</span>';
    const titleLabel = channel.groupKey === 'general' ? `${subLabel}${channel.channelName}` : channel.channelName;
    return `<div class="${classes.join(' ')}">${titleLabel}</div>`;
  }).join('');

  let maxTimelineBottom = baseGuideHeight;

  const setbackBoundariesByChannelIndex = new Map();
  for (let channelIndex = 0; channelIndex < channelViewList.length; channelIndex += 1) {
    const channel = channelViewList[channelIndex];
    const mergedSubEventIndexes = mergedSubEventIndexMap.get(channelIndex) || new Set();
    const visibleEventIndexes = channel.events
      .map((_, index) => index)
      .filter((index) => !(channel.isSubChannel && mergedSubEventIndexes.has(index)));

    const boundaries = new Set();
    for (let pairIndex = 0; pairIndex < visibleEventIndexes.length - 1; pairIndex += 1) {
      const currentIndex = visibleEventIndexes[pairIndex];
      const nextIndex = visibleEventIndexes[pairIndex + 1];
      const currentEvent = channel.events[currentIndex];
      const nextEvent = channel.events[nextIndex];
      if (!currentEvent || !nextEvent) continue;

      const currentVisibleStart = Math.max(currentEvent.startMinute, WINDOW_START_MINUTES);
      const currentVisibleEnd = Math.min(currentEvent.endMinute, WINDOW_END_MINUTES);
      const nextVisibleStart = Math.max(nextEvent.startMinute, WINDOW_START_MINUTES);
      const nextVisibleEnd = Math.min(nextEvent.endMinute, WINDOW_END_MINUTES);

      if (currentVisibleEnd <= currentVisibleStart || nextVisibleEnd <= nextVisibleStart) continue;

      const nextVisibleDuration = nextVisibleEnd - nextVisibleStart;
      const nextStartsAt59 = ((nextVisibleStart % 60) + 60) % 60 === 59;
      const isAdjacent = Math.abs(currentVisibleEnd - nextVisibleStart) <= 1;

      if (isOneMinuteProgram(nextVisibleDuration) && nextStartsAt59 && isAdjacent) {
        boundaries.add(nextVisibleStart);
      }
    }

    setbackBoundariesByChannelIndex.set(channelIndex, boundaries);
  }

  for (const [mainChannelIndex, subChannelIndex] of pairIndexMap.entries()) {
    if (mainChannelIndex > subChannelIndex) continue;
    const mainBoundaries = setbackBoundariesByChannelIndex.get(mainChannelIndex) || new Set();
    const subBoundaries = setbackBoundariesByChannelIndex.get(subChannelIndex) || new Set();
    for (const boundaryMinute of mainBoundaries) {
      subBoundaries.add(boundaryMinute);
    }
    setbackBoundariesByChannelIndex.set(subChannelIndex, subBoundaries);
  }

  const columns = channelViewList.map((channel, channelIndex) => {
    const colClasses = ['channel-col'];
    if (channel.isSubChannel) colClasses.push('is-sub');
    if (channel.isAreaStart) colClasses.push('area-start');

    const mergedMainEventIndexes = mergedMainEventIndexMap.get(channelIndex) || new Set();
    const mergedSubEventIndexes = mergedSubEventIndexMap.get(channelIndex) || new Set();
    const setbackBoundaries = setbackBoundariesByChannelIndex.get(channelIndex) || new Set();
    const visualGap = 4;
    const oneMinuteStackGap = 2;
    const oneMinuteBottomByHour = new Map();
    let renderedMaxBottom = 0;

    const programs = channel.events.map((event, eventIndex) => {
      if (event.endMinute <= WINDOW_START_MINUTES || event.startMinute >= WINDOW_END_MINUTES) return '';

      if (channel.isSubChannel && mergedSubEventIndexes.has(eventIndex)) return '';

      const visibleStart = Math.max(event.startMinute, WINDOW_START_MINUTES);
      const visibleEnd = Math.min(event.endMinute, WINDOW_END_MINUTES);
      if (visibleEnd <= visibleStart) return '';
      const visibleDuration = visibleEnd - visibleStart;

      const rawTop = ((visibleStart - WINDOW_START_MINUTES) / 60) * HOUR_HEIGHT;
      const rawHeight = ((visibleEnd - visibleStart) / 60) * HOUR_HEIGHT;
      let top = rawTop;
      let height = Math.max(8, rawHeight - visualGap);
      const minVisualHeight = getMinimumProgramHeight(visibleDuration);
      const isOneMinute = isOneMinuteProgram(visibleDuration);
      const hourBucket = Math.floor((visibleStart - WINDOW_START_MINUTES) / 60);
      const hasSetbackAtStart = setbackBoundaries.has(visibleStart);
      const hasSetbackAtEnd = setbackBoundaries.has(visibleEnd);

      if (visibleDuration >= 60) {
        top = rawTop;
        height = rawHeight;
      }

      if (height < minVisualHeight) {
        height = minVisualHeight;
        top = rawTop;
      }

      if (hasSetbackAtStart) {
        top = Math.max(0, rawTop - PRE_ONE_MINUTE_CLEARANCE_PX);
      }

      if (hasSetbackAtEnd) {
        const trimmedHeight = Math.max(minVisualHeight, height - PRE_ONE_MINUTE_CLEARANCE_PX);
        height = Math.max(8, trimmedHeight);
      }

      if (isOneMinute) {
        const previousBottom = oneMinuteBottomByHour.get(hourBucket);
        if (Number.isFinite(previousBottom)) {
          top = Math.max(top, previousBottom + oneMinuteStackGap);
        }
      }

      if (top < 0) {
        top = 0;
      }

      const maxTop = Math.max(0, baseGuideHeight - height);
      if (top > maxTop) {
        top = maxTop;
      }
      if (!isOneMinute && top + height > baseGuideHeight) {
        height = Math.max(8, baseGuideHeight - top);
      }

      if (isOneMinute) {
        oneMinuteBottomByHour.set(hourBucket, top + height);
      }

      renderedMaxBottom = Math.max(renderedMaxBottom, top + height);

      const cls = categoryClass(event.category);
      const timeText = `${formatMinute(event.startMinute)} - ${formatMinute(event.endMinute)}`;
      let shouldSpanSub = !channel.isSubChannel && mergedMainEventIndexes.has(eventIndex);

      if (shouldSpanSub) {
        const pairedSubChannelIndex = pairIndexMap.get(channelIndex);
        if (typeof pairedSubChannelIndex === 'number') {
          const pairedSubChannel = channelViewList[pairedSubChannelIndex];
          const pairedMergedSubIndexes = mergedSubEventIndexMap.get(pairedSubChannelIndex) || new Set();

          const hasOverlappingSubOnlyEvent = pairedSubChannel.events.some((subEvent, subEventIndex) => {
            if (pairedMergedSubIndexes.has(subEventIndex)) return false;

            const overlapStart = Math.max(event.startMinute, subEvent.startMinute);
            const overlapEnd = Math.min(event.endMinute, subEvent.endMinute);
            if (overlapEnd > overlapStart) return true;

            const subVisibleStart = Math.max(subEvent.startMinute, WINDOW_START_MINUTES);
            const subVisibleEnd = Math.min(subEvent.endMinute, WINDOW_END_MINUTES);
            const subVisibleDuration = subVisibleEnd - subVisibleStart;
            const subStartsAt59 = ((subVisibleStart % 60) + 60) % 60 === 59;
            const isBoundaryAdjacent = Math.abs(event.endMinute - subEvent.startMinute) <= 1;

            return subVisibleEnd > subVisibleStart && isOneMinuteProgram(subVisibleDuration) && subStartsAt59 && isBoundaryAdjacent;
          });

          if (hasOverlappingSubOnlyEvent) {
            shouldSpanSub = false;
          }
        }
      }

      const extraClass = shouldSpanSub ? ' merged-main-sub' : '';
      const extraStyle = shouldSpanSub
        ? 'width: calc(var(--channel-width) * 2 - 8px); right:auto; z-index:25;'
        : '';
      const safeTitle = escapeHtml(event.title);
      const safeCategory = escapeHtml(event.category);
      const safeDescription = escapeHtml(event.description);
      const safeTimeText = escapeHtml(timeText);

      return `
        <article
          class="program ${cls}${extraClass}"
          style="top:${top}px;height:${height}px;${extraStyle}"
          title="${safeDescription}"
          data-base-height="${height}"
          data-title="${safeTitle}"
          data-time="${safeTimeText}"
          data-category="${safeCategory}"
          data-description="${safeDescription}"
        >
          <div class="program-time">${timeText}</div>
          <div class="program-title">${event.title}</div>
          <div class="program-category">${event.category}</div>
        </article>
      `;
    }).join('');

    if (renderedMaxBottom > 0) {
      maxTimelineBottom = Math.max(maxTimelineBottom, renderedMaxBottom);
    }

    return `<div class="${colClasses.join(' ')}">${programs}</div>`;
  }).join('');

  const guideHeight = Math.max(baseGuideHeight, Math.ceil(maxTimelineBottom + 8));

  return `
    <section class="guide-section">
      <div class="guide-scroll">
        <div class="guide-inner">
          <div class="head-row" style="grid-template-columns: var(--time-width) repeat(${channels.length}, var(--channel-width));">
            <div class="corner">${date}</div>
            ${headers}
          </div>

          <div class="timeline" style="grid-template-columns: var(--time-width) repeat(${channels.length}, var(--channel-width));height:${guideHeight}px;">
            <div class="time-column">${hourLines}</div>
            <div class="channels" style="grid-column:2 / -1;grid-template-columns: repeat(${channels.length}, var(--channel-width));height:${guideHeight}px;">
              ${columns}
            </div>
          </div>
        </div>
      </div>
    </section>
  `;
}

function renderGuidesByGroup(channels, date, selectedKey) {
  const groupMap = new Map();
  GUIDE_GROUPS.forEach((group) => groupMap.set(group.key, []));

  channels.forEach((channel) => {
    if (!groupMap.has(channel.groupKey)) {
      groupMap.set(channel.groupKey, []);
    }
    groupMap.get(channel.groupKey).push(channel);
  });

  const selectedGroup = GUIDE_GROUPS.find((group) => group.key === selectedKey) || GUIDE_GROUPS[0];
  let list = groupMap.get(selectedGroup.key) || [];
  if (selectedGroup.key === 'bs') {
    list = [...list, ...(groupMap.get('bs4k8k') || [])];
  }
  if (selectedGroup.key === 'bs' || selectedGroup.key === 'bs4k8k') {
    list = list.filter((channel) => channel.areaId === BS_BASE_AREA_ID);
  }
  const html = renderGuideSection(list, date, selectedGroup.label);

  guideEl.innerHTML = html;
}

function getChannelCountForGroup(channels, groupKey) {
  if (groupKey === 'bs') {
    return channels.filter((channel) => (channel.groupKey === 'bs' || channel.groupKey === 'bs4k8k') && channel.areaId === BS_BASE_AREA_ID).length;
  }
  if (groupKey === 'bs4k8k') {
    return channels.filter((channel) => channel.groupKey === 'bs4k8k' && channel.areaId === BS_BASE_AREA_ID).length;
  }
  return channels.filter((channel) => channel.groupKey === groupKey).length;
}

function renderCurrentView() {
  const selectedKey = getSelectedGroupKey();
  let effectiveKey = selectedKey;
  let count = getChannelCountForGroup(latestChannels, effectiveKey);

  if (count === 0) {
    if (getChannelCountForGroup(latestChannels, 'radioAm') > 0) {
      effectiveKey = 'radioAm';
    } else if (getChannelCountForGroup(latestChannels, 'radioFm') > 0) {
      effectiveKey = 'radioFm';
    } else {
      const firstAvailable = GUIDE_GROUPS.find((group) => getChannelCountForGroup(latestChannels, group.key) > 0);
      if (firstAvailable) {
        effectiveKey = firstAvailable.key;
      }
    }
    count = getChannelCountForGroup(latestChannels, effectiveKey);

    const select = document.getElementById('groupSelect');
    if (select instanceof HTMLSelectElement) {
      select.value = effectiveKey;
    }
  }

  renderGuidesByGroup(latestChannels, latestDate, effectiveKey);

  const selectedGroup = GUIDE_GROUPS.find((group) => group.key === effectiveKey) || GUIDE_GROUPS[0];
  summaryEl.textContent = `表示: ${selectedGroup.label} / チャンネル数: ${count} / 局順で表示`;
}

async function loadAndRender(forceRefresh = false) {
  const date = dateInput.value || todayJst();
  dateInput.value = date;
  const epgListUrl = resolveLocalJsonUrl('EPG.json');

  setStatus(forceRefresh ? 'URL一覧を強制再取得中...' : 'URL一覧を読み込み中...');
  summaryEl.textContent = '';

  let baseUrls = [];
  try {
    baseUrls = await fetchJsonWithTtlCache(epgListUrl, { forceRefresh });
  } catch (error) {
    guideEl.innerHTML = `<div class="error">EPG.jsonの読み込みに失敗しました: ${error.message}<br>URL: ${escapeHtml(epgListUrl)}</div>`;
    setStatus('読み込み失敗');
    return;
  }

  const epgSources = normalizeEpgSources(baseUrls);
  const requestTargets = epgSources.map((source, sourceOrder) => ({
    apiUrl: toDateUrl(source.baseUrl, date),
    sourceOrder,
    sourceType: source.sourceType
  }));

  const uniqueTargetsByUrl = new Map();
  requestTargets.forEach((target) => {
    if (!uniqueTargetsByUrl.has(target.apiUrl)) {
      uniqueTargetsByUrl.set(target.apiUrl, target);
    }
  });
  const finalTargets = [...uniqueTargetsByUrl.values()];

  if (finalTargets.length === 0) {
    guideEl.innerHTML = '<div class="error">EPG.jsonに有効なURLがありません。</div>';
    setStatus('読み込み失敗');
    return;
  }

  const radioTargetCount = finalTargets.filter((target) => target.sourceType === 'radio').length;
  const tvTargetCount = finalTargets.length - radioTargetCount;

  setStatus(`全局データ取得中... (${finalTargets.length}件 / Radio ${radioTargetCount} / TV ${tvTargetCount})`);

  const results = await Promise.allSettled(
    finalTargets.map((target) =>
      fetchJsonWithTtlCache(target.apiUrl, { forceRefresh })
    )
  );

  const okData = [];
  let successCount = 0;
  let failCount = 0;
  let radioSuccessCount = 0;
  let radioFailCount = 0;
  let tvSuccessCount = 0;
  let tvFailCount = 0;

  results.forEach((result, index) => {
    if (result.status === 'fulfilled') {
      successCount += 1;
      if (finalTargets[index].sourceType === 'radio') {
        radioSuccessCount += 1;
      } else {
        tvSuccessCount += 1;
      }
      okData.push({
        data: result.value,
        sourceOrder: finalTargets[index].sourceOrder
      });
    } else {
      failCount += 1;
      if (finalTargets[index].sourceType === 'radio') {
        radioFailCount += 1;
      } else {
        tvFailCount += 1;
      }
      console.warn('取得失敗:', finalTargets[index].apiUrl, result.reason);
    }
  });

  const allChannels = okData.flatMap(({ data, sourceOrder }) =>
    extractChannelsFromResponse(data, sourceOrder, date)
  );
  const mergedChannels = mergeChannels(allChannels);

  latestChannels = mergedChannels;
  latestDate = date;
  latestFetchInfo = { success: successCount, fail: failCount };

  renderCurrentView();
  setStatus(`取得完了: 成功 ${successCount}件 (Radio ${radioSuccessCount}/TV ${tvSuccessCount}) / 失敗 ${failCount}件 (Radio ${radioFailCount}/TV ${tvFailCount})`);
}

reloadBtn.addEventListener('click', () => {
  loadAndRender(true);
});

guideEl.addEventListener('click', (event) => {
  const target = event.target;
  if (!(target instanceof Element)) return;

  const clickedProgram = target.closest('.program');
  const activeProgram = guideEl.querySelector('.program.is-focused');

  if (!clickedProgram) {
    if (activeProgram) {
      activeProgram.classList.remove('is-focused');
      activeProgram.classList.remove('is-expanded');
      const baseHeight = Number(activeProgram.getAttribute('data-base-height'));
      if (!Number.isNaN(baseHeight) && baseHeight > 0) {
        activeProgram.style.height = `${baseHeight}px`;
      }
    }
    return;
  }

  if (activeProgram && activeProgram !== clickedProgram) {
    activeProgram.classList.remove('is-focused');
    activeProgram.classList.remove('is-expanded');
    const activeBaseHeight = Number(activeProgram.getAttribute('data-base-height'));
    if (!Number.isNaN(activeBaseHeight) && activeBaseHeight > 0) {
      activeProgram.style.height = `${activeBaseHeight}px`;
    }
  }

  clickedProgram.classList.add('is-focused');

  const titleEl = clickedProgram.querySelector('.program-title');
  const timeEl = clickedProgram.querySelector('.program-time');
  const categoryEl = clickedProgram.querySelector('.program-category');
  const baseHeight = Number(clickedProgram.getAttribute('data-base-height'));
  const currentHeight = clickedProgram.getBoundingClientRect().height;
  const desiredMinHeight = 200;
  let requiredHeight = currentHeight;

  if (titleEl instanceof HTMLElement) {
    const titleFullHeight = titleEl.scrollHeight;
    const timeHeight = timeEl instanceof HTMLElement ? timeEl.scrollHeight : 0;
    const categoryHeight = categoryEl instanceof HTMLElement ? categoryEl.scrollHeight : 0;
    requiredHeight = Math.max(requiredHeight, titleFullHeight + timeHeight + categoryHeight + 30, desiredMinHeight);
  }

  const fallbackHeight = !Number.isNaN(baseHeight) && baseHeight > 0 ? baseHeight : currentHeight;
  const nextHeight = Math.max(fallbackHeight, requiredHeight);

  clickedProgram.style.height = `${Math.ceil(nextHeight)}px`;
  if (nextHeight > fallbackHeight + 1) {
    clickedProgram.classList.add('is-expanded');
  } else {
    clickedProgram.classList.remove('is-expanded');
  }
});

groupFilterEl.addEventListener('change', (event) => {
  if (!(event.target instanceof HTMLSelectElement)) return;
  if (event.target.id !== 'groupSelect') return;
  renderCurrentView();
  setStatus(`表示更新: 成功 ${latestFetchInfo.success}件 / 失敗 ${latestFetchInfo.fail}件`);
});

document.addEventListener('wheel', (event) => {
  if (!(guideEl instanceof HTMLElement)) return;

  const maxScrollLeft = guideEl.scrollWidth - guideEl.clientWidth;
  if (maxScrollLeft <= 0) return;

  const pageCanScrollY = document.documentElement.scrollHeight > window.innerHeight + 1;
  let horizontalDelta = event.deltaX;

  if (horizontalDelta === 0 && (event.shiftKey || !pageCanScrollY)) {
    horizontalDelta = event.deltaY;
  }

  if (horizontalDelta === 0) return;

  const before = guideEl.scrollLeft;
  guideEl.scrollLeft += horizontalDelta;
  if (guideEl.scrollLeft !== before) {
    event.preventDefault();
  }
}, { passive: false });

dateInput.value = todayJst();
renderGroupFilter();
renderLegend();
loadAndRender();
