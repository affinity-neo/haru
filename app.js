import { naturalParse } from './date-parser.js';

const STORE_KEY = 'haru-items-v1';
const FIREBASE_KEY = 'haru-firebase-v1';
const GOOGLE_KEY = 'haru-google-v1';
const categories = ['업무', '개인', '건강', '가족', '학습', '기타'];
const priorities = { high: '높음', normal: '보통', low: '낮음' };
const weekdays = ['일', '월', '화', '수', '목', '금', '토'];
let items = loadItems();
let view = location.hash.slice(1) || 'calendar';
let calendarMode = 'week';
let autoScrollWeek = true;
let calendarDate = parseDate(todayKey());
let filter = 'open', categoryFilter = 'all', search = '', sortMode = 'date';
let firebase = null, user = null, remoteReady = false, unsubscribeRemote = null;
let googleToken = null, nowDateKey = todayKey(), undoStack = [], dirtyIds = new Set(), lastSaved = new Map(items.map(x => [x.id, x.updatedAt || 0]));
let collapsedCategories = new Set(), quickCategory = 'auto';

function loadItems() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORE_KEY) || '[]');
    return Array.isArray(saved) ? saved.map(normalizeItem) : [];
  } catch { return []; }
}
function normalizeItem(item) {
  const type = ['event', 'routine'].includes(item.type) ? item.type : 'task';
  const copy = { ...item, type, category: item.category || guessCategory(item.title || '') };
  if (type === 'task') {
    copy.subtasks = Array.isArray(item.subtasks) ? item.subtasks.map(s => ({ id: s.id || uid(), title: String(s.title || ''), done: !!s.done, createdAt: s.createdAt || Date.now(), updatedAt: s.updatedAt || item.updatedAt || Date.now() })) : [];
    copy.plannedDate ??= item.date || null;
    copy.dueDate ??= null;
    delete copy.date;
  } else if (type === 'event') {
    copy.eventDate ??= item.date || null;
    delete copy.date;
  }
  return copy;
}
function saveItems() {
  let localSaved = true;
  try { localStorage.setItem(STORE_KEY, JSON.stringify(items)); }
  catch { localSaved = false; }
  for (const item of items) {
    if ((item.updatedAt || 0) > (lastSaved.get(item.id) || 0)) {
      dirtyIds.add(item.id);
      lastSaved.set(item.id, item.updatedAt || 0);
    }
  }
  render();
  if (firebase && user && remoteReady) syncWrite();
  if (!localSaved) { setSync('storage-error'); toast('브라우저 저장 공간이 부족해 변경을 기기에 저장하지 못했어요.'); }
  return localSaved;
}
function checkpoint() {
  undoStack.push(JSON.stringify(items));
  if (undoStack.length > 50) undoStack.shift();
  updateUndoButton();
}
function undo() {
  const previous = undoStack.pop();
  if (!previous) return;
  const restored = JSON.parse(previous);
  const old = new Map(restored.map(x => [x.id, x]));
  const current = new Map(items.map(x => [x.id, x]));
  const stamp = Date.now();
  const sameContent = (a, b) => { const aa={...a},bb={...b};delete aa.updatedAt;delete bb.updatedAt;return JSON.stringify(aa)===JSON.stringify(bb); };
  for (const [id, currentItem] of current) {
    const before=old.get(id);
    if (!before) old.set(id, { ...currentItem, deleted: true, updatedAt: stamp });
    else if (!sameContent(before,currentItem)) old.set(id,{...before,updatedAt:stamp});
  }
  items = [...old.values()];
  saveItems();
  toast('방금 변경을 되돌렸어요');
  updateUndoButton();
}
function updateUndoButton() {
  const button = document.getElementById('undoButton');
  if (button) { button.disabled = !undoStack.length; button.title = undoStack.length ? `되돌리기 · ${undoStack.length}` : '되돌릴 변경 없음'; }
}
function tasks() { return items.filter(x => x.type === 'task' && !x.deleted); }
function events() { return items.filter(x => x.type === 'event' && !x.deleted); }
function routines() { return items.filter(x => x.type === 'routine' && !x.deleted); }
function dateKey(d) { return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; }
function parseDate(s) { if (!s) return null; const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d, 12); }
function todayKey() {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date()).map(x => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}`;
}
function uid() { return crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`; }
function esc(s = '') { return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function fmtDate(key, options = { month: 'short', day: 'numeric', weekday: 'short' }) { return key ? new Intl.DateTimeFormat('ko-KR', options).format(parseDate(key)) : '미정'; }
function clockMinutes(time) { const [h, m] = String(time || '0:0').split(':').map(Number); return h * 60 + (m || 0); }
function toTime(minutes) { return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`; }
function guessCategory(title = '') {
  if (/병원|진료|치과|치료|운동|검진|약|산책|건강|요가|헬스/.test(title)) return '건강';
  if (/가족|아이|부모|생일|장보기|저녁|식사|약속/.test(title)) return '가족';
  if (/공부|학습|책|강의|수업|시험|과제/.test(title)) return '학습';
  if (/집|청소|세탁|은행|택배|예약|개인/.test(title)) return '개인';
  if (/회의|미팅|보고서|업무|회사|고객|프로젝트|메일|기획|작업/.test(title)) return '업무';
  return '기타';
}
function toast(message) { const el = document.createElement('div'); el.className = 'toast'; el.textContent = message; document.getElementById('toastRegion').append(el); setTimeout(() => el.remove(), 2600); }
function priorityBadge(priority) { return `<span class="priority ${priority || 'normal'}">${priorities[priority] || priorities.normal}</span>`; }
function taskCard(task, compact = false) {
  const overdue = task.dueDate && task.dueDate < todayKey() && !task.done;
  const dateLabel = task.plannedDate ? `${task.plannedDate === todayKey() ? '오늘' : fmtDate(task.plannedDate, { month: 'numeric', day: 'numeric' })}${task.start ? ` ${task.start}` : ''}` : '';
  const rightDate = task.dueDate ? `<span class="task-due ${overdue ? 'overdue' : ''}">${overdue ? '기한 지남' : `마감 ${fmtDate(task.dueDate, { month: 'numeric', day: 'numeric' })}`}</span>` : dateLabel ? `<span class="task-due">${dateLabel}</span>` : '';
  return `<article class="task-card ${compact ? 'compact' : ''} ${task.done ? 'is-done' : ''}" draggable="true" data-drag-task="${esc(task.id)}">
    <button class="check ${task.done ? 'checked' : ''}" data-complete="${esc(task.id)}" aria-label="완료 처리">${task.done ? '✓' : ''}</button>
    <button class="task-card-main" data-edit-task="${esc(task.id)}"><strong>${esc(task.title)}</strong></button>${rightDate}${task.plannedDate && task.dueDate ? `<span class="task-execution">실행 ${fmtDate(task.plannedDate, { month: 'numeric', day: 'numeric' })}${task.start ? ` ${task.start}` : ''}</span>` : ''}${priorityBadge(task.priority)}</article>`;
}
function pageHead(title, subtitle = '', extra = '') { return `<div class="page-heading"><div><h1>${title}</h1>${subtitle && title === '대시보드' ? `<p>${subtitle}</p>` : ''}</div>${extra}</div>`; }
function quickInput() { return `<form class="quick-input-wrap" id="quickForm"><div class="quick-composer"><textarea id="quickText" aria-label="자연어 입력" placeholder="할 일을 입력하세요. 날짜와 시간은 입력 중에 인식됩니다." rows="2"></textarea><div class="quick-composer-actions"><label class="quick-category-wrap"><span>분류</span><select id="quickCategory" class="quick-category"><option value="auto" ${quickCategory==='auto'?'selected':''}>자동</option>${categories.map(c=>`<option value="${esc(c)}" ${quickCategory===c?'selected':''}>${esc(c)}</option>`).join('')}</select></label><button class="button button-light voice-button" type="button" id="voiceInput" aria-label="음성 입력">🎙</button><button class="button button-primary">추가</button></div></div><div id="parsePreview" class="parse-preview" hidden></div></form>`; }
function visibleTasks(mode) {
  let list = tasks();
  if (mode === 'today') list = list.filter(x => x.plannedDate === todayKey());
  if (mode === 'someday') list = list.filter(x => !x.plannedDate);
  if (search) list = list.filter(x => x.title.toLocaleLowerCase().includes(search.toLocaleLowerCase()) || (x.subtasks || []).some(s => s.title.toLocaleLowerCase().includes(search.toLocaleLowerCase())));
  if (categoryFilter !== 'all') list = list.filter(x => x.category === categoryFilter);
  if (filter === 'open') list = list.filter(x => !x.done);
  if (filter === 'done') list = list.filter(x => x.done);
  return list.sort((a, b) => sortMode === 'priority'
    ? ['high', 'normal', 'low'].indexOf(a.priority) - ['high', 'normal', 'low'].indexOf(b.priority)
    : (a.plannedDate || '9999').localeCompare(b.plannedDate || '9999') || (a.dueDate || '9999').localeCompare(b.dueDate || '9999'));
}
function renderBoard(mode) {
  const labels = { all: ['전체 업무', ''], today: ['오늘 할 일', ''], someday: ['언젠가', ''] };
  const [title, subtitle] = labels[mode]; const list = visibleTasks(mode);
  const grouped = categories.map(category => {
    const group = list.filter(x => (x.category || '기타') === category);
    if (!group.length) return '';
    const collapsed = collapsedCategories.has(category);
    return `<section class="category-group"><button class="category-group-heading" data-toggle-category="${esc(category)}"><span class="category-dot cat-${categories.indexOf(category)}"></span><strong>${esc(category)}</strong><span class="group-count">${group.length}</span><span class="group-chevron ${collapsed ? 'collapsed' : ''}">⌄</span></button>${collapsed ? '' : `<div class="task-list">${group.map(x => taskCard(x)).join('')}</div>`}</section>`;
  }).join('');
  return `${pageHead(title, subtitle, `<span class="heading-meta">${list.length}개</span>`)}${quickInput()}
  <section class="board-surface"><div class="board-toolbar"><input class="search-input" id="searchInput" placeholder="업무 검색" value="${esc(search)}">
  <select id="categoryFilter" class="select-field"><option value="all">모든 분류</option>${categories.map(c => `<option ${categoryFilter === c ? 'selected' : ''}>${c}</option>`).join('')}</select>
  <select id="sortSelect" class="select-field"><option value="date" ${sortMode === 'date' ? 'selected' : ''}>실행일순</option><option value="priority" ${sortMode === 'priority' ? 'selected' : ''}>우선순위순</option></select>
  <div class="filter-tabs"><button data-filter="all" class="${filter === 'all' ? 'active' : ''}">모두</button><button data-filter="open" class="${filter === 'open' ? 'active' : ''}">진행 중</button><button data-filter="done" class="${filter === 'done' ? 'active' : ''}">완료</button></div></div>
  <div class="task-groups">${list.length ? grouped : `<div class="empty-state"><strong>${mode === 'someday' ? '날짜 미정 업무가 없어요' : '표시할 업무가 없어요'}</strong></div>`}</div></section>`;
}
function renderDashboard() {
  const today = todayKey(), todayTasks = tasks().filter(x => x.plannedDate === today), due = tasks().filter(x => x.dueDate === today && x.plannedDate !== today && !x.done), done = todayTasks.filter(x => x.done), todayEvents = events().filter(x => eventOccurs(x, today));
  const weekEnd = parseDate(today); weekEnd.setDate(weekEnd.getDate() + 6); const weekEndKey=dateKey(weekEnd);
  const weekTasks = tasks().filter(x => x.plannedDate >= today && x.plannedDate <= weekEndKey && !x.done);
  const weekEntries=[...weekTasks.map(x=>({...x,entryType:'task',entryDate:x.plannedDate})),...Array.from({length:7},(_,i)=>{const d=parseDate(today);d.setDate(d.getDate()+i);const key=dateKey(d);return events().filter(x=>eventOccurs(x,key)).map(x=>({...x,entryType:'event',entryDate:key}))}).flat()].sort((a,b)=>a.entryDate.localeCompare(b.entryDate)||(a.start||'').localeCompare(b.start||'')).slice(0,8);
  const high = tasks().filter(x => x.priority === 'high' && !x.done).slice(0, 4);
  return `${pageHead('대시보드', fmtDate(today, { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' }))}
  <div class="summary-row"><div class="card summary-stat"><span>남은 업무</span><strong>${todayTasks.filter(x => !x.done).length}</strong></div><div class="card summary-stat"><span>오늘 일정</span><strong>${todayEvents.length}</strong></div><div class="card summary-stat"><span>완료한 업무</span><strong>${done.length}</strong></div></div>
  ${smartPlanCard()}<div class="dashboard-grid"><section class="card"><div class="card-title"><h2>오늘 하기로 한 일</h2><a href="#today" data-view="today">모두 보기</a></div>${todayTasks.length ? todayTasks.map(x => taskCard(x, true)).join('') : '<div class="empty-state">오늘 실행하기로 정한 업무가 없어요.</div>'}${due.length ? `<div class="due-notice"><b>오늘 마감</b>${due.map(x => `<p>${esc(x.title)}</p>`).join('')}</div>` : ''}</section>
  <div class="stack"><section class="card"><div class="card-title"><h2>오늘의 일정</h2><a href="#calendar" data-view="calendar">캘린더</a></div>${todayEvents.length ? todayEvents.sort((a,b)=>(a.start||'').localeCompare(b.start||'')).map(eventRow).join('') : '<div class="empty-state">오늘 일정이 없어요.</div>'}</section>
  <section class="card"><div class="card-title"><h2>이번 주 일정과 업무</h2><span>${weekEntries.length}개 항목</span></div>${weekEntries.length ? weekEntries.map(x=>x.entryType==='event'?eventRow(x,fmtDate(x.entryDate,{month:'numeric',day:'numeric'})):taskCard(x,true)).join('') : '<div class="empty-state">이번 주 일정과 계획이 비어 있어요.</div>'}</section>
  <section class="card"><div class="card-title"><h2>우선순위 높음</h2></div>${high.length ? high.map(taskCard).join('') : '<div class="empty-state">높은 우선순위의 미완료 업무가 없어요.</div>'}</section></div></div>`;
}
function eventRow(event, dateLabel='') { return `<button class="event-row" data-edit-event="${esc(event.id)}"><span>${dateLabel||event.start||'종일'}</span><i></i><strong>${esc(event.title)}</strong>${dateLabel&&event.start?`<small>${event.start}</small>`:''}</button>`; }
function eventOccurs(event,key) { if(event.eventDate===key)return true;if(!event.eventDate||event.eventDate>key)return false;const day=parseDate(key).getDay();if(event.repeat==='daily')return true;if(event.repeat==='weekly')return day===parseDate(event.eventDate).getDay()||((event.repeatDays||[]).includes(day));return false; }
function smartPlanCard() { const count = tasks().filter(x => !x.done && !x.start).length; return `<section class="card smart-card"><h2>빈 시간에 업무 배치</h2><button class="button button-primary" id="smartPlan">${count ? `일정 추천 · ${count}` : '추천할 업무 없음'}</button></section>`; }
function suggestSchedule() {
  const queue = tasks().filter(x => !x.done && !x.start).sort((a,b) => ['high','normal','low'].indexOf(a.priority)-['high','normal','low'].indexOf(b.priority));
  const changes=[], base=parseDate(todayKey()), blocks=[];
  for(let i=0;i<14;i++){const d=new Date(base);d.setDate(d.getDate()+i);const key=dateKey(d);for(const x of events().filter(e=>eventOccurs(e,key)&&e.start))blocks.push({date:key,start:clockMinutes(x.start),end:clockMinutes(x.end||x.start)+(x.end?0:Number(x.duration)||60)});for(const x of routines().filter(r=>routineOccurs(r,key)&&r.start))blocks.push({date:key,start:clockMinutes(x.start),end:clockMinutes(x.start)+(Number(x.duration)||15)});for(const x of tasks().filter(t=>t.plannedDate===key&&t.start))blocks.push({date:key,start:clockMinutes(x.start),end:clockMinutes(x.end||x.start)+(x.end?0:Number(x.duration)||60)})}
  for (const task of queue) {
    const duration = Math.max(15, Math.min(240, Number(task.duration) || 45));
    for (let dayOffset=0; dayOffset<14; dayOffset++) {
      const date = new Date(base); date.setDate(date.getDate()+dayOffset); const key=dateKey(date);
      if (task.plannedDate && task.plannedDate !== key) continue;
      if (task.dueDate && task.dueDate < key) continue;
      const clock=koreaClock();
      const from = dayOffset === 0 ? Math.max(9*60, Math.ceil((clock.hour*60+clock.minute+15)/15)*15) : 9*60;
      let found=false;
      for (let minute=from; minute+duration<=18*60; minute+=15) {
        if (blocks.some(b=>b.date===key && minute<b.end && minute+duration>b.start)) continue;
        changes.push({task,key,start:toTime(minute),end:toTime(minute+duration),duration});
        blocks.push({date:key,start:minute,end:minute+duration}); found=true; break;
      }
      if (found) break;
    }
  }
  if (changes.length) { checkpoint(); const stamp=Date.now(); for(const c of changes)Object.assign(c.task,{plannedDate:c.key,start:c.start,end:c.end,duration:c.duration,updatedAt:stamp}); saveItems(); toast(`${changes.length}개 업무를 배치했어요`); } else toast('배치할 빈 시간이 없어요. 실행일 또는 예상 시간을 조정해 주세요.');
}
function monthMarkup() {
  const y=calendarDate.getFullYear(),m=calendarDate.getMonth(),first=new Date(y,m,1),begin=new Date(y,m,1-first.getDay()); let html='<div class="month-grid">'+weekdays.map(d=>`<div class="month-head">${d}</div>`).join('');
  for(let i=0;i<42;i++){const d=new Date(begin);d.setDate(begin.getDate()+i);const key=dateKey(d),dayEvents=events().filter(x=>eventOccurs(x,key)),dayTasks=tasks().filter(x=>x.plannedDate===key),dayRoutines=routines().filter(x=>routineOccurs(x,key)),all=[...dayEvents.map(x=>({...x,calendarType:'event'})),...dayTasks.map(x=>({...x,calendarType:'task'})),...dayRoutines.map(x=>({...x,calendarType:'routine'}))];html+=`<div class="month-cell ${d.getMonth()!==m?'other-month':''} ${key===todayKey()?'is-today':''}" data-drop-date="${key}"><span class="date-num">${d.getDate()}</span>${all.slice(0,4).map(x=>`<button class="month-item ${x.calendarType}" data-${x.calendarType==='event'?'edit-event':x.calendarType==='task'?'edit-task':'edit-routine'}="${esc(x.id)}">${x.start?x.start+' ':''}${esc(x.title)}</button>`).join('')}${all.length>4?`<button class="month-more" data-more-date="${key}">+${all.length-4} 더 보기</button>`:''}</div>`}
  return `<div class="month-grid-wrap">${html}</div>`;
}
function routineOccurs(routine, date) { return Array.isArray(routine.days) && routine.days.includes(parseDate(date).getDay()); }
function weekMarkup() {
  const start=new Date(calendarDate);start.setDate(start.getDate()-start.getDay());const dates=Array.from({length:7},(_,i)=>{const d=new Date(start);d.setDate(d.getDate()+i);return dateKey(d)});const firstHour=6,lastHour=24,px=46;
  let html=`<div class="week-grid" style="--hours:${lastHour-firstHour};--hour-height:${px}px"><div class="time-axis"><div class="axis-heading">GMT+9</div>${Array.from({length:lastHour-firstHour},(_,i)=>`<div class="time-label">${i+firstHour}:00</div>`).join('')}</div>`;
  for(const key of dates){const dayEvents=events().filter(x=>eventOccurs(x,key)),dayTasks=tasks().filter(x=>x.plannedDate===key),dayRoutines=routines().filter(x=>routineOccurs(x,key));const today=key===todayKey();
    html+=`<section class="week-day ${today?'today-column':''}" data-day="${key}"><header class="week-day-head ${today?'is-today':''}"><small>${weekdays[parseDate(key).getDay()]}</small><strong>${parseDate(key).getDate()}</strong></header><div class="all-day-lane" data-drop-date="${key}">${[...dayEvents.filter(x=>!x.start).map(x=>({...x,k:'event'})),...dayTasks.filter(x=>!x.start).map(x=>({...x,k:'task'}))].map(x=>`<button class="lane-item ${x.k}" data-${x.k==='event'?'edit-event':'edit-task'}="${esc(x.id)}">${esc(x.title)}</button>`).join('')}</div><div class="day-time-grid" data-day-grid="${key}" data-drop-date="${key}">${Array.from({length:lastHour-firstHour},(_,i)=>`<div class="week-slot" data-drop-date="${key}" data-drop-time="${String(i+firstHour).padStart(2,'0')}:00"></div>`).join('')}
      ${[...dayEvents.filter(x=>x.start).map(x=>({...x,k:'event'})),...dayTasks.filter(x=>x.start).map(x=>({...x,k:'task'})),...dayRoutines.filter(x=>x.start).map(x=>({...x,k:'routine'}))].map(x=>calendarBlock(x,firstHour,px)).join('')}
      </div></section>`;
  }
  if(dates.includes(todayKey()))html+=nowMarker(firstHour,px);
  html+='</div>';
  return `<div class="week-scroll">${html}</div>`;
}
function calendarBlock(x, firstHour, px) {
  const start=clockMinutes(x.start),duration=Number(x.duration)|| (x.end?clockMinutes(x.end)-start:60),top=(start-firstHour*60)/60*px,height=Math.max(30,duration/60*px);
  if(top<0 || top>18*px) return '';
  const type=x.k==='event'?'event':x.k==='task'?'task':'routine';
  return `<button class="time-block ${type}" style="top:${top}px;height:${height}px" data-${type==='event'?'edit-event':type==='task'?'edit-task':'edit-routine'}="${esc(x.id)}" ${type==='routine'?'':'draggable="true" data-calendar-drag="'+esc(x.id)+'"'}><strong>${esc(x.title)}</strong><small>${x.start}${x.end?`–${x.end}`:''}</small></button>`;
}
function nowMarker(firstHour,px) {
  const part=koreaClock(),minute=part.hour*60+part.minute,top=(minute-firstHour*60)/60*px;
  if(top<0||top>18*px)return '';
  return `<div class="now-marker" style="top:${76+top}px"><span>${part.hour}:${part.minute}</span></div>`;
}
function koreaClock(){const p=Object.fromEntries(new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Seoul',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(new Date()).map(x=>[x.type,x.value]));return{hour:Number(p.hour),minute:Number(p.minute)}}
function updateNowMarker(){const marker=document.querySelector('.now-marker');if(!marker)return;const p=koreaClock(),top=76+((p.hour*60+p.minute-360)/60)*46;if(top<76||top>76+18*46){marker.remove();return}marker.style.top=`${top}px`;const label=marker.querySelector('span');if(label)label.textContent=`${String(p.hour).padStart(2,'0')}:${String(p.minute).padStart(2,'0')}`}
function scrollCalendarToNow(){const el=document.querySelector('.week-scroll');if(!el)return;const p=koreaClock(),top=76+((p.hour*60+p.minute-360)/60)*46;el.scrollTop=Math.max(0,top-140)}
function calendarSidebar() {
  const open=tasks().filter(x=>!x.done).sort((a,b)=>['high','normal','low'].indexOf(a.priority)-['high','normal','low'].indexOf(b.priority)||(a.plannedDate||'9999').localeCompare(b.plannedDate||'9999'));
  return `<aside class="calendar-side"><section class="calendar-side-section"><div class="side-section-head"><h2>할 일</h2><span>${open.length}</span></div><div class="draggable-task-list">${open.length?open.map(x=>taskCard(x,true)).join(''):'<div class="empty-state">남은 업무가 없어요.</div>'}</div><button class="text-button" id="sideAddTask">＋ 업무 추가</button></section>
  <section class="calendar-side-section routines-panel"><div class="side-section-head"><h2>루틴</h2><button class="text-button" id="addRoutine">＋ 추가</button></div>${routines().length?routines().map(r=>`<button class="routine-row" data-edit-routine="${esc(r.id)}"><span class="routine-check">↻</span><span><strong>${esc(r.title)}</strong><small>${(r.days||[]).map(d=>weekdays[d]).join(' · ')}${r.start?` · ${r.start}`:''}</small></span></button>`).join(''):'<div class="empty-state">루틴 없음</div>'}</section></aside>`;
}
function renderCalendar() {
  const start=new Date(calendarDate);start.setDate(start.getDate()-start.getDay());const end=new Date(start);end.setDate(start.getDate()+6);const label=`${fmtDate(dateKey(start),{month:'short',day:'numeric'})} – ${fmtDate(dateKey(end),{month:'short',day:'numeric'})}`;
  return `${pageHead('캘린더','할 일을 시간으로 옮기고, 일정과 루틴을 한 주로 보세요.',`<div class="calendar-actions"><button class="button button-light" id="calendarGoogle">Google 연결</button><button class="button button-light" id="newEvent">＋ 일정</button><button class="button button-primary" id="newTask">＋ 업무</button></div>`)}
  <div class="calendar-toolbar"><button class="icon-button" id="calPrev" aria-label="이전 주">‹</button><button class="icon-button" id="calNext" aria-label="다음 주">›</button><strong>${calendarMode==='week'?label:new Intl.DateTimeFormat('ko-KR',{year:'numeric',month:'long'}).format(calendarDate)}</strong><button class="button button-light" id="calToday">오늘</button><div class="view-switch"><button data-cal-mode="week" class="${calendarMode==='week'?'active':''}">주간</button><button data-cal-mode="month" class="${calendarMode==='month'?'active':''}">월간</button></div></div>${quickInput()}
  <div class="calendar-layout">${calendarSidebar()}<section class="calendar-stage">${calendarMode==='week'?weekMarkup():monthMarkup()}</section></div>`;
}
function render() {
  const previousScroll=document.querySelector('.week-scroll')?.scrollTop||0;
  nowDateKey=todayKey();const titles={dashboard:'대시보드',all:'전체 업무',today:'오늘 할 일',someday:'언젠가',calendar:'캘린더'};if(!titles[view])view='calendar';
  document.getElementById('breadcrumb').textContent=titles[view];document.querySelectorAll('[data-view]').forEach(a=>a.classList.toggle('active',a.dataset.view===view));
  document.getElementById('sidebarDate').textContent=fmtDate(todayKey(),{year:'numeric',month:'long',day:'numeric',weekday:'long'});
  document.getElementById('allCount').textContent=tasks().filter(x=>!x.done).length;document.getElementById('todayCount').textContent=tasks().filter(x=>x.plannedDate===todayKey()&&!x.done).length;
  document.getElementById('categoryNav').innerHTML=categories.map((category,i)=>{const count=tasks().filter(x=>x.category===category&&!x.done).length;return `<a href="#all" data-category-nav="${esc(category)}" class="${view==='all'&&categoryFilter===category?'active':''}"><span class="category-dot cat-${i}"></span><span>${esc(category)}</span><span class="nav-count">${count}</span></a>`}).join('');
  const content=document.getElementById('content');content.innerHTML=view==='calendar'?renderCalendar():view==='dashboard'?renderDashboard():renderBoard(view);bindContent();updateUndoButton();
  if(view==='calendar'&&calendarMode==='week'){if(autoScrollWeek){requestAnimationFrame(scrollCalendarToNow);autoScrollWeek=false}else if(previousScroll){document.querySelector('.week-scroll').scrollTop=previousScroll}}
}
function bindContent() {
  document.querySelectorAll('[data-view]').forEach(a=>a.onclick=e=>{e.preventDefault();if(view!==a.dataset.view&&a.dataset.view==='calendar')autoScrollWeek=true;view=a.dataset.view;history.replaceState(null,'','#'+view);render();document.getElementById('sidebar').classList.remove('open')});
  document.querySelectorAll('[data-category-nav]').forEach(a=>a.onclick=e=>{e.preventDefault();categoryFilter=a.dataset.categoryNav;view='all';history.replaceState(null,'','#all');render()});
  document.querySelectorAll('[data-complete]').forEach(b=>b.onclick=()=>{const x=items.find(i=>i.id===b.dataset.complete);if(x){checkpoint();x.done=!x.done;x.updatedAt=Date.now();saveItems()}});
  document.querySelectorAll('[data-edit-task]').forEach(b=>b.onclick=e=>{e.stopPropagation();openTaskDrawer(b.dataset.editTask)});document.querySelectorAll('[data-edit-event]').forEach(b=>b.onclick=e=>{e.stopPropagation();openEventModal(b.dataset.editEvent)});document.querySelectorAll('[data-edit-routine]').forEach(b=>b.onclick=e=>{e.stopPropagation();openRoutineModal(b.dataset.editRoutine)});
  document.querySelectorAll('[data-toggle-category]').forEach(b=>b.onclick=()=>{const c=b.dataset.toggleCategory;collapsedCategories.has(c)?collapsedCategories.delete(c):collapsedCategories.add(c);render()});
  document.querySelectorAll('[data-filter]').forEach(b=>b.onclick=()=>{filter=b.dataset.filter;render()});const cf=document.getElementById('categoryFilter');if(cf)cf.onchange=()=>{categoryFilter=cf.value;render()};const ss=document.getElementById('sortSelect');if(ss)ss.onchange=()=>{sortMode=ss.value;render()};
  const si=document.getElementById('searchInput');if(si)si.oninput=()=>{search=si.value;const at=si.selectionStart;render();const next=document.getElementById('searchInput');next.focus();next.setSelectionRange(at,at)};
  const q=document.getElementById('quickForm');if(q)q.onsubmit=e=>{e.preventDefault();const field=document.getElementById('quickText'),value=field.value;field.value='';quickCategory=document.getElementById('quickCategory')?.value||'auto';quickCreate(value);renderParsePreview('')};
  const quickText=document.getElementById('quickText');if(quickText){quickText.oninput=()=>renderParsePreview(quickText.value);quickText.onkeydown=e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();q.requestSubmit()}}}
  const quickCat=document.getElementById('quickCategory');if(quickCat)quickCat.onchange=()=>{quickCategory=quickCat.value;renderParsePreview(quickText?.value||'')};
  const voice=document.getElementById('voiceInput');if(voice)voice.onclick=startVoiceInput;
  const auto=document.getElementById('smartPlan');if(auto)auto.onclick=suggestSchedule;
  const addTask=document.getElementById('newTask');if(addTask)addTask.onclick=()=>openTaskDrawer();const sideAdd=document.getElementById('sideAddTask');if(sideAdd)sideAdd.onclick=()=>openTaskDrawer();const addEvent=document.getElementById('newEvent');if(addEvent)addEvent.onclick=()=>openEventModal();const addRoutine=document.getElementById('addRoutine');if(addRoutine)addRoutine.onclick=()=>openRoutineModal();
  const addInCategory=document.getElementById('addCategoryTask');if(addInCategory)addInCategory.onclick=()=>openTaskDrawer(null,{category:categoryFilter==='all'?'업무':categoryFilter});
  document.querySelectorAll('[data-cal-mode]').forEach(b=>b.onclick=()=>{if(b.dataset.calMode==='week'&&calendarMode!=='week')autoScrollWeek=true;calendarMode=b.dataset.calMode;render()});const prev=document.getElementById('calPrev'),next=document.getElementById('calNext');if(prev)prev.onclick=()=>{calendarMode==='week'?calendarDate.setDate(calendarDate.getDate()-7):(calendarDate.setDate(1),calendarDate.setMonth(calendarDate.getMonth()-1));autoScrollWeek=calendarMode==='week';render()};if(next)next.onclick=()=>{calendarMode==='week'?calendarDate.setDate(calendarDate.getDate()+7):(calendarDate.setDate(1),calendarDate.setMonth(calendarDate.getMonth()+1));autoScrollWeek=calendarMode==='week';render()};const today=document.getElementById('calToday');if(today)today.onclick=()=>{calendarDate=parseDate(todayKey());autoScrollWeek=calendarMode==='week';render()};const gcal=document.getElementById('calendarGoogle');if(gcal)gcal.onclick=openGoogleSettings;
  document.querySelectorAll('[data-drag-task]').forEach(card=>card.ondragstart=e=>{e.dataTransfer.setData('text/plain',`task:${card.dataset.dragTask}`);e.dataTransfer.effectAllowed='move'});
  document.querySelectorAll('[data-calendar-drag]').forEach(card=>card.ondragstart=e=>{e.dataTransfer.setData('text/plain',`calendar:${card.dataset.calendarDrag}`);e.dataTransfer.effectAllowed='move'});
  document.querySelectorAll('[data-drop-date]').forEach(el=>{el.ondragover=e=>{e.preventDefault();e.dataTransfer.dropEffect='move';el.classList.add('drag-over')};el.ondragleave=()=>el.classList.remove('drag-over');el.ondrop=e=>{e.preventDefault();e.stopPropagation();el.classList.remove('drag-over');dropOnCalendar(e.dataTransfer.getData('text/plain'),el.dataset.dropDate,el.dataset.dropTime||'',el.classList.contains('all-day-lane'))}});
  document.querySelectorAll('.week-slot').forEach(el=>el.onclick=()=>openEventModal(null,{eventDate:el.dataset.dropDate,start:el.dataset.dropTime}));
  document.querySelectorAll('.month-cell').forEach(el=>el.onclick=e=>{if(e.target.closest('button'))return;openEventModal(null,{eventDate:el.dataset.dropDate})});
  document.querySelectorAll('[data-more-date]').forEach(b=>b.onclick=e=>{e.stopPropagation();calendarDate=parseDate(b.dataset.moreDate);calendarMode='week';autoScrollWeek=true;render()});
}
function renderParsePreview(value) {
  const box=document.getElementById('parsePreview');if(!box)return;
  if(!value.trim()){box.hidden=true;box.innerHTML='';return}
  const p=naturalParse(value),parts=[];
  if(p.plannedDate)parts.push(`실행 ${fmtDate(p.plannedDate,{month:'numeric',day:'numeric',weekday:'short'})}`);
  if(p.dueDate)parts.push(`마감 ${fmtDate(p.dueDate,{month:'numeric',day:'numeric',weekday:'short'})}`);
  if(p.date&&p.type==='event')parts.push(fmtDate(p.date,{month:'numeric',day:'numeric',weekday:'short'}));
  if(p.start)parts.push(p.end?`${p.start}–${p.end}`:p.start);
  if(p.repeat!=='none')parts.push(p.repeat==='daily'?'매일 반복':`${p.repeatDays.map(d=>weekdays[d]).join('·')} 반복`);
  if(p.priority!=='normal')parts.push(priorities[p.priority]);
  const category=p.category||(quickCategory!=='auto'?quickCategory:guessCategory(p.title));
  parts.push(category);
  if(p.duration)parts.push(`${p.duration}분`);
  box.hidden=false;box.innerHTML=`<span class="preview-title">${esc(p.title||'제목을 입력해 주세요')}</span>${parts.length?`<span class="preview-details">${parts.map((x,i)=>`<i class="preview-token ${i===parts.length-1?'token-category':''}">${esc(x)}</i>`).join('')}</span>`:''}${p.requiresConfirmation?'<span class="preview-warning">날짜 또는 시간을 확인해 주세요</span>':''}`;
}
function dropOnCalendar(data,date,time,allDay=false) {
  const [kind,id]=String(data).split(':');const x=items.find(i=>i.id===id);if(!x||!date)return;checkpoint();
  if(kind==='task'){x.plannedDate=date;if(time){x.start=time;x.end=toTime(clockMinutes(time)+(Number(x.duration)||60))}else if(allDay){x.start='';x.end=''}}
  else if(kind==='calendar'){if(x.type==='task')x.plannedDate=date;else if(x.type==='event')x.eventDate=date;if(time){x.start=time;x.end=toTime(clockMinutes(time)+(Number(x.duration)||60))}else if(allDay){x.start='';x.end=''}}
  x.updatedAt=Date.now();saveItems();toast('캘린더에 배치했어요');
}
function quickCreate(input) {
  if(!input.trim())return;
  const p=naturalParse(input);
  const category=p.category||(quickCategory!=='auto'?quickCategory:guessCategory(p.title));
  if(p.type==='event'){openEventModal(null,{title:p.title,eventDate:p.date,start:p.start,end:p.end,duration:p.duration,repeat:p.repeat,needsReview:p.requiresConfirmation});return}
  if(p.repeat!=='none'){openRoutineModal(null);return}
  // Parse first, show the recognized details, and save only after the user confirms.
  openTaskDrawer(null,{title:p.title,plannedDate:p.plannedDate,dueDate:p.dueDate,start:p.start||'',duration:p.duration||60,priority:p.priority,category,needsReview:p.requiresConfirmation});
}
function closeTaskDrawer(){const backdrop=document.getElementById('taskDrawerBackdrop');if(backdrop)backdrop.hidden=true}
function openTaskDrawer(id=null,prefill={}){
  const x=id?items.find(i=>i.id===id&&i.type==='task'):null;
  const a=x||{title:'',plannedDate:'',dueDate:'',start:'',duration:60,priority:'normal',category:'업무',subtasks:[],...prefill};
  const backdrop=document.getElementById('taskDrawerBackdrop'),heading=document.getElementById('taskDrawerHeading'),body=document.getElementById('taskDrawerBody');
  if(!backdrop||!body){openTaskModal(id,prefill);return}
  heading.textContent=x?'업무 상세':'새 업무';
  const childRows=(a.subtasks||[]).map(s=>`<label class='drawer-subtask'><input type='checkbox' data-drawer-child-done='${esc(s.id)}' ${s.done?'checked':''}><span>${esc(s.title)}</span></label>`).join('');
  body.innerHTML=`<form id='drawerTaskForm' class='drawer-task-form'>
    <label class='drawer-field'><span>업무 이름</span><input class='text-field drawer-title-input' name='title' required value='${esc(a.title)}' placeholder='예: 홈스쿨러 모임 재료 구매'></label>
    <div class='drawer-field-grid'>
      <label class='drawer-field'><span>계획</span><input class='date-field' type='date' name='plannedDate' value='${a.plannedDate||''}'></label>
      <label class='drawer-field'><span>마감일</span><input class='date-field' type='date' name='dueDate' value='${a.dueDate||''}'></label>
      <label class='drawer-field'><span>시간</span><input class='time-field' type='time' name='start' value='${a.start||''}'></label>
      <label class='drawer-field'><span>카테고리</span><select class='select-field' name='category'>${categories.map(c=>`<option value='${esc(c)}' ${a.category===c?'selected':''}>${esc(c)}</option>`).join('')}</select></label>
    </div>
    <div class='drawer-field'><span>하위 업무 <small>${(a.subtasks||[]).length}개</small></span><div class='drawer-subtasks'>${childRows||'<p class=\'drawer-empty\'>아직 하위 업무가 없어요.</p>'}</div>
      <div class='drawer-subtask-add'><input class='text-field' id='drawerSubtaskInput' placeholder='하위 업무 추가'><button class='button button-light' type='button' id='drawerSubtaskAdd'>＋ 추가</button></div></div>
    <label class='drawer-field'><span>예상 소요 시간</span><select class='select-field' name='duration'><option value='15' ${Number(a.duration)===15?'selected':''}>15분</option><option value='30' ${Number(a.duration)===30?'selected':''}>30분</option><option value='60' ${!a.duration||Number(a.duration)===60?'selected':''}>1시간</option><option value='90' ${Number(a.duration)===90?'selected':''}>1시간 30분</option><option value='120' ${Number(a.duration)===120?'selected':''}>2시간</option></select></label>
    <div class='drawer-footer'>${x?'<button type=\'button\' class=\'button button-danger\' id=\'drawerDelete\'>삭제</button>':'<span></span>'}<div><button type='button' class='button button-light' id='drawerCancel'>취소</button><button class='button button-primary' type='submit'>저장</button></div></div>
  </form>`;
  backdrop.hidden=false;
  document.getElementById('drawerCancel').onclick=closeTaskDrawer;
  const del=document.getElementById('drawerDelete');if(del)del.onclick=()=>{if(!confirm('이 업무를 삭제할까요?'))return;checkpoint();x.deleted=true;x.updatedAt=Date.now();saveItems();closeTaskDrawer();toast('업무를 삭제했어요')};
  document.getElementById('drawerTaskForm').onsubmit=e=>{e.preventDefault();const f=new FormData(e.currentTarget),stamp=Date.now(),title=String(f.get('title')||'').trim();if(!title)return;checkpoint();const record={...(x||{id:uid(),type:'task',createdAt:stamp,done:false,subtasks:a.subtasks||[]}),type:'task',title,plannedDate:String(f.get('plannedDate')||'')||null,dueDate:String(f.get('dueDate')||'')||null,start:String(f.get('start')||''),end:'',duration:Number(f.get('duration'))||60,category:String(f.get('category')||'기타'),priority:a.priority||'normal',updatedAt:stamp};if(x)items=items.map(i=>i.id===x.id?record:i);else items.push(record);saveItems();closeTaskDrawer();toast(x?'업무를 수정했어요':'업무를 추가했어요')};
  document.getElementById('drawerSubtaskAdd').onclick=()=>{const input=document.getElementById('drawerSubtaskInput'),title=input.value.trim();if(!title)return;if(x){checkpoint();x.subtasks=x.subtasks||[];x.subtasks.push({id:uid(),title,done:false,createdAt:Date.now(),updatedAt:Date.now()});x.updatedAt=Date.now();saveItems();openTaskDrawer(x.id)}else{a.subtasks=a.subtasks||[];a.subtasks.push({id:uid(),title,done:false,createdAt:Date.now(),updatedAt:Date.now()});openTaskDrawer(null,a)}};
  body.querySelectorAll('[data-drawer-child-done]').forEach(input=>input.onchange=()=>{if(!x)return;const child=x.subtasks.find(s=>s.id===input.dataset.drawerChildDone);if(!child)return;checkpoint();child.done=input.checked;child.updatedAt=Date.now();x.updatedAt=Date.now();saveItems();openTaskDrawer(x.id)});
}
function openSubtaskModal(taskId, childId=null) {
  const task=items.find(x=>x.id===taskId && x.type==='task');if(!task)return;
  const child=childId?(task.subtasks||[]).find(x=>x.id===childId):null;
  showModal(child?'하위 업무 수정':'하위 업무 추가',task.title,`<form id="subtaskForm"><div class="form-field"><label>이름</label><input class="text-field" name="title" required value="${esc(child?.title||'')}" autofocus></div><div class="form-actions">${child?'<button class="button button-danger" type="button" id="deleteSubtask">삭제</button>':'<span></span>'}<div><button class="button button-light" type="button" id="cancelEdit">취소</button><button class="button button-primary">저장</button></div></div></form>`);
  document.getElementById('cancelEdit').onclick=closeModal;
  const remove=document.getElementById('deleteSubtask');if(remove)remove.onclick=()=>{checkpoint();task.subtasks=task.subtasks.filter(x=>x.id!==child.id);task.updatedAt=Date.now();saveItems();closeModal()};
  document.getElementById('subtaskForm').onsubmit=e=>{e.preventDefault();const title=String(new FormData(e.currentTarget).get('title')).trim();if(!title)return;checkpoint();const stamp=Date.now();task.subtasks||=[];if(child){child.title=title;child.updatedAt=stamp}else task.subtasks.push({id:uid(),title,done:false,createdAt:stamp,updatedAt:stamp});task.updatedAt=stamp;expandedTasks.add(taskId);saveItems();closeModal()};
}
function startVoiceInput(){const SR=window.SpeechRecognition||window.webkitSpeechRecognition;if(!SR){toast('음성 입력 미지원 브라우저입니다.');return}const rec=new SR();rec.lang='ko-KR';rec.onresult=e=>{const field=document.getElementById('quickText');if(field){field.value=e.results[0][0].transcript;field.focus()}};rec.onerror=()=>toast('마이크 권한을 확인해 주세요.');rec.start()}
function showModal(title,subtitle,body){document.getElementById('modalTitle').textContent=title;document.getElementById('modalEyebrow').textContent=subtitle;document.getElementById('modalBody').innerHTML=body;document.getElementById('modalBackdrop').hidden=false;document.querySelector('#modalBody input')?.focus()}
function closeModal(){document.getElementById('modalBackdrop').hidden=true}
function deleteItem(item){if(!confirm('삭제할까요?'))return;checkpoint();item.deleted=true;item.updatedAt=Date.now();saveItems();closeModal();toast('삭제했어요')}
function openTaskModal(id=null,prefill={}){const x=id?items.find(i=>i.id===id):null;const a=x||{title:'',plannedDate:'',dueDate:'',duration:60,priority:'normal',category:'업무',...prefill};
  showModal(x?'업무 수정':'새 업무',a.needsReview?'입력 내용을 확인해 주세요':'할 일',`<form id="editForm"><div class="form-grid"><div class="form-field full"><label>업무 이름</label><input class="text-field" name="title" required value="${esc(a.title)}" placeholder="예: 보고서 초안 작성"></div><div class="form-field"><label>실행일</label><input class="date-field" name="plannedDate" type="date" value="${a.plannedDate||''}"></div><div class="form-field"><label>마감일</label><input class="date-field" name="dueDate" type="date" value="${a.dueDate||''}"></div><div class="form-field"><label>분류</label><select class="select-field" name="category">${categories.map(c=>`<option ${a.category===c?'selected':''}>${c}</option>`).join('')}</select></div><div class="form-field"><label>우선순위</label><select class="select-field" name="priority">${Object.entries(priorities).map(([k,v])=>`<option value="${k}" ${a.priority===k?'selected':''}>${v}</option>`).join('')}</select></div><div class="form-field"><label>예상 소요(분)</label><input class="text-field" name="duration" type="number" min="15" step="15" value="${a.duration||60}"></div><div class="form-field"><label>실행 시작 시간</label><input class="time-field" name="start" type="time" value="${a.start||''}"></div></div><p class="repeat-note">실행일은 내가 하기로 정한 날, 마감일은 제출·완료 기한입니다. ‘언젠가’ 업무도 전체 업무 목록에 계속 포함됩니다.</p><div class="form-actions">${x?'<button class="button button-danger" type="button" id="deleteItem">삭제</button>':'<span></span>'}<div><button class="button button-light" type="button" id="cancelEdit">취소</button><button class="button button-primary">저장</button></div></div></form>`);
  document.getElementById('cancelEdit').onclick=closeModal;const del=document.getElementById('deleteItem');if(del)del.onclick=()=>deleteItem(x);
  document.getElementById('editForm').onsubmit=e=>{e.preventDefault();const f=new FormData(e.currentTarget),stamp=Date.now();checkpoint();const record={...(x||{id:uid(),type:'task',createdAt:stamp,done:false}),type:'task',title:String(f.get('title')).trim(),plannedDate:String(f.get('plannedDate')||'')||null,dueDate:String(f.get('dueDate')||'')||null,category:String(f.get('category')),priority:String(f.get('priority')),duration:Number(f.get('duration'))||60,start:String(f.get('start')||''),end:'',updatedAt:stamp};if(x)items=items.map(i=>i.id===x.id?record:i);else items.push(record);saveItems();closeModal();toast('업무를 저장했어요')};
}
function openEventModal(id=null,prefill={}){const x=id?items.find(i=>i.id===id):null;const date=Object.hasOwn(prefill,'eventDate')?prefill.eventDate:todayKey();const a=x||{title:'',eventDate:date,start:'',end:'',duration:60,repeat:'none',...prefill};
  showModal(x?'일정 수정':'새 일정',a.needsReview?'날짜나 시간을 확인해 주세요':'캘린더 전용',`<form id="editForm"><div class="form-grid"><div class="form-field full"><label>일정 이름</label><input class="text-field" name="title" required value="${esc(a.title)}" placeholder="예: 병원 예약"></div><div class="form-field"><label>날짜</label><input class="date-field" name="eventDate" type="date" required value="${a.eventDate||''}"></div><div class="form-field"><label>반복</label><select class="select-field" name="repeat"><option value="none">반복 안 함</option><option value="weekly" ${a.repeat==='weekly'?'selected':''}>매주</option></select></div><div class="form-field"><label>시작</label><input class="time-field" name="start" type="time" value="${a.start||''}"></div><div class="form-field"><label>종료</label><input class="time-field" name="end" type="time" value="${a.end||''}"></div></div><p class="repeat-note">일정은 캘린더에만 표시되며 업무 목록에는 추가되지 않습니다.</p><div class="form-actions">${x?'<button class="button button-danger" type="button" id="deleteItem">삭제</button>':'<span></span>'}<div>${x?'<button class="button button-light" type="button" id="googleExportEvent">Google에 저장</button>':''}<button class="button button-light" type="button" id="cancelEdit">취소</button><button class="button button-primary">저장</button></div></div></form>`);
  document.getElementById('cancelEdit').onclick=closeModal;const del=document.getElementById('deleteItem');if(del)del.onclick=()=>deleteItem(x);const exportBtn=document.getElementById('googleExportEvent');if(exportBtn)exportBtn.onclick=()=>exportGoogleEvent(x.id);
  document.getElementById('editForm').onsubmit=e=>{e.preventDefault();const f=new FormData(e.currentTarget),start=String(f.get('start')||''),end=String(f.get('end')||'');if(start&&end&&clockMinutes(end)<=clockMinutes(start)){toast('종료 시간은 시작 시간보다 늦어야 해요.');return}const stamp=Date.now();checkpoint();const record={...(x||{id:uid(),type:'event',createdAt:stamp}),type:'event',title:String(f.get('title')).trim(),eventDate:String(f.get('eventDate')),start,end,repeat:String(f.get('repeat')),updatedAt:stamp};if(x)items=items.map(i=>i.id===x.id?record:i);else items.push(record);saveItems();closeModal();toast('캘린더에 일정을 저장했어요')};
}
function openRoutineModal(id=null){const x=id?items.find(i=>i.id===id):null;const a=x||{title:'',days:[1,2,3,4,5],start:'09:00',duration:15};
  showModal(x?'루틴 수정':'루틴 추가','반복 습관',`<form id="editForm"><div class="form-grid"><div class="form-field full"><label>루틴 이름</label><input class="text-field" name="title" required value="${esc(a.title)}" placeholder="예: 아침 스트레칭"></div><div class="form-field full"><label>반복 요일</label><div class="weekday-picks">${weekdays.map((d,i)=>`<label><input type="checkbox" name="days" value="${i}" ${(a.days||[]).includes(i)?'checked':''}>${d}</label>`).join('')}</div></div><div class="form-field"><label>시간</label><input class="time-field" name="start" type="time" value="${a.start||''}"></div><div class="form-field"><label>예상 시간(분)</label><input class="text-field" name="duration" type="number" min="5" step="5" value="${a.duration||15}"></div></div><p class="repeat-note">루틴은 캘린더에 반복 표시되며 업무 보드와 완료 업무 수에는 포함되지 않습니다.</p><div class="form-actions">${x?'<button class="button button-danger" type="button" id="deleteItem">삭제</button>':'<span></span>'}<div><button class="button button-light" type="button" id="cancelEdit">취소</button><button class="button button-primary">저장</button></div></div></form>`);
  document.getElementById('cancelEdit').onclick=closeModal;const del=document.getElementById('deleteItem');if(del)del.onclick=()=>deleteItem(x);
  document.getElementById('editForm').onsubmit=e=>{e.preventDefault();const f=new FormData(e.currentTarget),stamp=Date.now();checkpoint();const record={...(x||{id:uid(),type:'routine',createdAt:stamp}),type:'routine',title:String(f.get('title')).trim(),days:f.getAll('days').map(Number),start:String(f.get('start')||''),duration:Number(f.get('duration'))||15,updatedAt:stamp};if(x)items=items.map(i=>i.id===x.id?record:i);else items.push(record);saveItems();closeModal();toast('루틴을 저장했어요')};
}
async function openGoogleSettings(){const cfg=JSON.parse(localStorage.getItem(GOOGLE_KEY)||'{}');showModal('Google Calendar 연결','선택 사항',`<p class="repeat-note">OAuth Client ID를 입력하면 기본 캘린더 일정 가져오기와 개별 일정 내보내기를 사용할 수 있습니다. 결제 계정은 연결하지 마세요.</p><div class="form-field"><label>OAuth Client ID</label><input class="text-field" id="googleClientId" value="${esc(cfg.clientId||'')}" placeholder="...apps.googleusercontent.com"></div><div id="googleMsg" class="repeat-note"></div><div class="form-actions"><button class="button button-light" id="googleImport">연결 후 60일 일정 가져오기</button><button class="button button-primary" id="googleSave">설정 저장</button></div>`);const input=document.getElementById('googleClientId'),msg=document.getElementById('googleMsg');const save=()=>localStorage.setItem(GOOGLE_KEY,JSON.stringify({clientId:input.value.trim()}));document.getElementById('googleSave').onclick=()=>{save();msg.textContent='이 기기에 저장했습니다.'};document.getElementById('googleImport').onclick=async()=>{save();try{await googleAuthorize();const n=await importGoogleEvents();msg.textContent=`${n}개 일정을 가져왔습니다.`}catch(e){msg.textContent=e.message}};}
function loadGis(){return new Promise((resolve,reject)=>{if(window.google?.accounts?.oauth2){resolve();return}const s=document.createElement('script');s.src='https://accounts.google.com/gsi/client';s.async=true;s.onload=resolve;s.onerror=()=>reject(Error('Google 인증 라이브러리를 불러오지 못했습니다.'));document.head.append(s)})}
async function googleAuthorize(){const cfg=JSON.parse(localStorage.getItem(GOOGLE_KEY)||'{}');if(!cfg.clientId)throw Error('OAuth Client ID를 먼저 입력해 주세요.');await loadGis();return new Promise((resolve,reject)=>google.accounts.oauth2.initTokenClient({client_id:cfg.clientId,scope:'https://www.googleapis.com/auth/calendar.events.owned',callback:r=>{if(r.error)reject(Error(r.error));else{googleToken=r.access_token;resolve(googleToken)}}}).requestAccessToken({prompt:googleToken?'':'consent'}))}
async function gcal(path,options={}){if(!googleToken)await googleAuthorize();const r=await fetch(`https://www.googleapis.com/calendar/v3/${path}`,{...options,headers:{Authorization:`Bearer ${googleToken}`,'Content-Type':'application/json'}});if(!r.ok)throw Error(`Google Calendar 응답 ${r.status}`);return r.json()}
async function importGoogleEvents(){const end=new Date();end.setDate(end.getDate()+60);const p=new URLSearchParams({singleEvents:'true',orderBy:'startTime',timeMin:new Date().toISOString(),timeMax:end.toISOString(),maxResults:'250'});const data=await gcal(`calendars/primary/events?${p}`);checkpoint();let added=0;for(const e of data.items||[]){if(e.status==='cancelled')continue;const id=`gcal-${e.id}`,prior=items.find(x=>x.id===id),start=e.start?.dateTime,endTime=e.end?.dateTime;const record={...(prior||{id,type:'event',createdAt:Date.now()}),type:'event',title:e.summary||'Google 일정',eventDate:(start||e.start?.date||'').slice(0,10),start:start?new Date(start).toLocaleTimeString('en-GB',{timeZone:'Asia/Seoul',hour:'2-digit',minute:'2-digit'}):'',end:endTime?new Date(endTime).toLocaleTimeString('en-GB',{timeZone:'Asia/Seoul',hour:'2-digit',minute:'2-digit'}):'',googleEventId:e.id,source:'google',updatedAt:Date.now()};if(prior)items=items.map(x=>x.id===id?record:x);else{items.push(record);added++}}saveItems();return added}
async function exportGoogleEvent(id){const x=items.find(i=>i.id===id);if(!x)return;try{const start=x.start?{dateTime:`${x.eventDate}T${x.start}:00+09:00`,timeZone:'Asia/Seoul'}:{date:x.eventDate};const end=x.end?{dateTime:`${x.eventDate}T${x.end}:00+09:00`,timeZone:'Asia/Seoul'}:x.start?{dateTime:`${x.eventDate}T${toTime(clockMinutes(x.start)+60)}:00+09:00`,timeZone:'Asia/Seoul'}:{date:dateKey(new Date(parseDate(x.eventDate).getTime()+86400000))};const result=await gcal(x.googleEventId?`calendars/primary/events/${x.googleEventId}`:'calendars/primary/events',{method:x.googleEventId?'PATCH':'POST',body:JSON.stringify({summary:x.title,start,end})});checkpoint();x.googleEventId=result.id;x.source='google';x.updatedAt=Date.now();saveItems();toast('Google Calendar에 저장했어요')}catch(e){toast(e.message)}}
function openSyncSettings(){const cfg=JSON.parse(localStorage.getItem(FIREBASE_KEY)||'{}');showModal('기기 간 동기화','Firebase Spark 무료 요금제',`<p class="repeat-note">Firebase 웹 설정과 계정으로 로그인하면 기기 간 동기화합니다. 결제 계정·Blaze 전환은 설정하지 마세요.</p><form id="firebaseForm"><div class="form-grid">${[['apiKey','API Key'],['authDomain','Auth Domain'],['projectId','Project ID'],['appId','App ID']].map(([n,l])=>`<div class="form-field full"><label>${l}</label><input class="text-field" name="${n}" value="${esc(cfg[n]||'')}"></div>`).join('')}<div class="form-field"><label>이메일</label><input class="text-field" name="email" type="email"></div><div class="form-field"><label>비밀번호</label><input class="text-field" name="password" type="password"></div></div><p class="repeat-note" id="firebaseMessage"></p><div class="form-actions"><button type="button" class="button button-light" id="firebaseLogin">로그인</button><button type="submit" class="button button-primary">설정 저장</button></div></form>`);const f=document.getElementById('firebaseForm'),msg=document.getElementById('firebaseMessage');f.onsubmit=e=>{e.preventDefault();const d=new FormData(f),c=Object.fromEntries(['apiKey','authDomain','projectId','appId'].map(k=>[k,d.get(k)]));localStorage.setItem(FIREBASE_KEY,JSON.stringify(c));initFirebase(c).then(()=>msg.textContent='설정을 저장했습니다. 로그인하세요.').catch(e=>msg.textContent=e.message)};document.getElementById('firebaseLogin').onclick=async()=>{try{const d=new FormData(f);if(!firebase)await initFirebase(JSON.parse(localStorage.getItem(FIREBASE_KEY)||'{}'));await firebase.signInWithEmailAndPassword(firebase.auth,String(d.get('email')),String(d.get('password')));msg.textContent='로그인했습니다.'}catch(e){msg.textContent=e.message}};}
async function initFirebase(cfg){if(firebase)return firebase;if(!cfg.apiKey||!cfg.projectId||!cfg.appId)throw Error('Firebase 설정을 입력해 주세요.');const [a,u,d]=await Promise.all([import('https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js'),import('https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js'),import('https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js')]);const app=a.getApps().find(x=>x.name==='haru-app')||a.initializeApp(cfg,'haru-app');const auth=u.getAuth(app),db=d.getFirestore(app);firebase={...u,...d,auth,db};u.onAuthStateChanged(auth,async current=>{user=current;if(current)await loadRemote()});return firebase}
async function loadRemote(){if(!firebase||!user)return;try{const {collection,getDocs,doc,setDoc,onSnapshot}=firebase;const ref=collection(firebase.db,'users',user.uid,'haruItemsV1'),snap=await getDocs(ref),remote=snap.docs.map(d=>normalizeItem(d.data()));const merged=new Map(items.map(x=>[x.id,x]));for(const x of remote){const old=merged.get(x.id);if(!old||(x.updatedAt||0)>(old.updatedAt||0))merged.set(x.id,x)}items=[...merged.values()];localStorage.setItem(STORE_KEY,JSON.stringify(items));for(const x of items)lastSaved.set(x.id,x.updatedAt||0);for(const x of items)if(!remote.some(r=>r.id===x.id))await setDoc(doc(ref,x.id),x);remoteReady=true;render();unsubscribeRemote?.();unsubscribeRemote=onSnapshot(ref,s=>{const map=new Map(items.map(x=>[x.id,x]));for(const d of s.docs){const x=normalizeItem(d.data()),old=map.get(x.id);if(!old||(x.updatedAt||0)>(old.updatedAt||0))map.set(x.id,x)}items=[...map.values()];localStorage.setItem(STORE_KEY,JSON.stringify(items));for(const x of items)lastSaved.set(x.id,x.updatedAt||0);render()},()=>setSync('offline'));setSync('online')}catch(e){remoteReady=false;setSync('offline')}}
let syncTimer;function syncWrite(){clearTimeout(syncTimer);syncTimer=setTimeout(async()=>{if(!firebase||!user||!remoteReady||!dirtyIds.size)return;try{const {collection,doc,setDoc}=firebase,ref=collection(firebase.db,'users',user.uid,'haruItemsV1'),ids=[...dirtyIds];await Promise.all(ids.map(id=>{const x=items.find(a=>a.id===id);return x&&setDoc(doc(ref,id),x)}));ids.forEach(id=>dirtyIds.delete(id))}catch{setSync('offline')}},400)}
function setSync(mode){const dot=document.getElementById('syncDot'),label=document.getElementById('syncLabel'),sub=document.getElementById('syncSub');if(!dot)return;dot.className=`sync-dot ${mode==='online'?'online':mode==='offline'?'offline':mode==='storage-error'?'offline':''}`;label.textContent=mode==='online'?'실시간 동기화 중':mode==='offline'?'연결 대기 중':mode==='storage-error'?'기기 저장 공간 부족':'이 기기에 저장 중';if(sub)sub.textContent=mode==='online'?'변경 내용이 다른 기기에 반영됩니다':mode==='offline'?'연결되면 동기화를 다시 시도합니다':mode==='storage-error'?'브라우저 저장 공간을 확인해 주세요':'데이터는 브라우저에 보관됩니다'}
function init(){document.querySelectorAll('[data-view]').forEach(a=>a.onclick=e=>{e.preventDefault();if(view!==a.dataset.view&&a.dataset.view==='calendar')autoScrollWeek=true;view=a.dataset.view;history.replaceState(null,'','#'+view);render()});document.getElementById('quickAdd').onclick=()=>openTaskModal();document.getElementById('undoButton').onclick=undo;document.getElementById('settingsOpen').onclick=openSyncSettings;document.getElementById('accountButton').onclick=openSyncSettings;document.getElementById('modalClose').onclick=closeModal;document.getElementById('taskDrawerClose').onclick=closeTaskDrawer;document.getElementById('taskDrawerBackdrop').onclick=e=>{if(e.target.id==='taskDrawerBackdrop')closeTaskDrawer()};document.getElementById('modalBackdrop').onclick=e=>{if(e.target.id==='modalBackdrop')closeModal()};document.addEventListener('keydown',e=>{if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='z'){e.preventDefault();undo()}if(e.key==='Escape')closeModal()});window.addEventListener('hashchange',()=>{view=location.hash.slice(1)||'calendar';autoScrollWeek=view==='calendar';render()});render();const cfg=JSON.parse(localStorage.getItem(FIREBASE_KEY)||'{}');if(cfg.apiKey)initFirebase(cfg).catch(()=>setSync('offline'));setInterval(()=>{if(todayKey()!==nowDateKey){nowDateKey=todayKey();autoScrollWeek=true;render()}else if(view==='calendar'&&calendarMode==='week')updateNowMarker()},60000)}
init();
