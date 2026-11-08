const dayNames = {
  일: 0, 월: 1, 화: 2, 수: 3, 목: 4, 금: 5, 토: 6,
  sunday: 0, sun: 0, monday: 1, mon: 1, tuesday: 2, tue: 2, tues: 2,
  wednesday: 3, wed: 3, thursday: 4, thu: 4, thur: 4, thurs: 4,
  friday: 5, fri: 5, saturday: 6, sat: 6,
};
const monthNames = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3,
  apr: 4, april: 4, may: 5, jun: 6, june: 6, jul: 7, july: 7,
  aug: 8, august: 8, sep: 9, sept: 9, september: 9,
  oct: 10, october: 10, nov: 11, november: 11, dec: 12, december: 12,
};
const dayNameSource = '(?:월요일|화요일|수요일|목요일|금요일|토요일|일요일|월|화|수|목|금|토|일|Wednesday|Thursday|Saturday|Tuesday|Monday|Friday|Sunday|Wed|Thu|Tue|Mon|Fri|Sat|Sun)';
const dateSource = `(?:20\\d{2}\\s*년\\s*\\d{1,2}\\s*월\\s*\\d{1,2}\\s*일?|\\d{4}[-./]\\d{1,2}[-./]\\d{1,2}|\\d{1,2}\\s*월\\s*\\d{1,2}\\s*일?|\\d{1,2}\\s*[/.-]\\s*\\d{1,2}|(?:January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)\\s+\\d{1,2}(?:st|nd|rd|th)?(?:,?\\s+20\\d{2})?|(?:오늘|내일|모레|내후일|어제|today|tomorrow|tom|tod|yesterday|day after tomorrow|in\\s+\\d+\\s+days?|\\d+\\s*일\\s*후|다음\\s*주(?:\\s*${dayNameSource})?|이번\\s*주\\s*${dayNameSource}|next\\s+week(?:\\s+${dayNameSource})?|this\\s+${dayNameSource}|next\\s+${dayNameSource}|${dayNameSource}))`;
const datePattern = new RegExp(`(?:${dateSource})(?=$|[\\s,.;!?(){}])`, 'giu');

function dateKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}
function parseDate(value) {
  const [year, month, day] = value.split('-').map(Number);
  return new Date(year, month - 1, day, 12);
}
function seoulToday() {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date()).map(part => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}
function shiftDate(base, amount) {
  const date = new Date(base);
  date.setDate(date.getDate() + amount);
  return dateKey(date);
}
function normalizedDay(value) { return value.toLocaleLowerCase().replace(/요일/g, '').trim(); }
function monthCandidate(year, month, day) {
  if (month < 1 || month > 12 || day < 1 || day > new Date(year, month, 0).getDate()) return null;
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}
function nextWeekday(base, weekday) {
  return shiftDate(base, (weekday - base.getDay() + 7) % 7);
}
function followingWeekday(base, weekday) {
  const monday = new Date(base);
  monday.setDate(base.getDate() - ((base.getDay() + 6) % 7) + 7);
  monday.setDate(monday.getDate() + weekday - 1);
  return dateKey(monday);
}

function resolveDate(phrase, base) {
  const value = phrase.trim().replace(/[,]$/, '');
  const lower = value.toLocaleLowerCase();
  if (/^(오늘|today|tod)$/.test(lower)) return { date: dateKey(base) };
  if (/^(내일|tomorrow|tom)$/.test(lower)) return { date: shiftDate(base, 1) };
  if (/^(모레|day after tomorrow)$/.test(lower)) return { date: shiftDate(base, 2) };
  if (/^내후일$/.test(lower)) return { date: shiftDate(base, 3) };
  if (/^(어제|yesterday)$/.test(lower)) return { date: shiftDate(base, -1), past: true };
  const inDays = lower.match(/^(?:in\s+)?(\d+)\s*(?:일\s*후|days?)$/);
  if (inDays) return { date: shiftDate(base, Number(inDays[1])) };
  if (/^(다음\s*주|next\s+week)$/.test(lower)) return { date: followingWeekday(base, 1) };
  const nextEnglishDay = lower.match(/^next\s+week\s+(?:on\s+)?(.+)$/);
  if (nextEnglishDay && dayNames[normalizedDay(nextEnglishDay[1])] !== undefined) return { date: followingWeekday(base, dayNames[normalizedDay(nextEnglishDay[1])]) };

  const koYear = lower.match(/^(20\d{2})\s*년\s*(\d{1,2})\s*월\s*(\d{1,2})\s*일?$/);
  if (koYear) {
    const date = monthCandidate(+koYear[1], +koYear[2], +koYear[3]);
    return date ? { date } : { invalid: true };
  }
  const iso = lower.match(/^(20\d{2})[-./](\d{1,2})[-./](\d{1,2})$/);
  if (iso) {
    const date = monthCandidate(+iso[1], +iso[2], +iso[3]);
    return date ? { date } : { invalid: true };
  }
  const koreanMonth = lower.match(/^(\d{1,2})\s*월\s*(\d{1,2})\s*일?$/);
  if (koreanMonth) {
    for (let year = base.getFullYear(); year <= base.getFullYear() + 8; year++) {
      const date = monthCandidate(year, +koreanMonth[1], +koreanMonth[2]);
      if (date && parseDate(date) >= base) return { date };
    }
    return { invalid: true };
  }
  const numeric = lower.match(/^(\d{1,2})\s*[/.-]\s*(\d{1,2})$/);
  if (numeric) {
    const month = +numeric[1], day = +numeric[2];
    for (let year = base.getFullYear(); year <= base.getFullYear() + 8; year++) {
      const date = monthCandidate(year, month, day);
      if (date && parseDate(date) >= base) return { date };
    }
    return { invalid: true };
  }
  const englishMonth = lower.match(/^([a-z]+)\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s+(20\d{2}))?$/);
  if (englishMonth) {
    const month = monthNames[englishMonth[1]], day = +englishMonth[2];
    if (englishMonth[3]) {
      const date = monthCandidate(+englishMonth[3], month, day);
      return date ? { date } : { invalid: true };
    }
    for (let year = base.getFullYear(); year <= base.getFullYear() + 8; year++) {
      const date = monthCandidate(year, month, day);
      if (date && parseDate(date) >= base) return { date };
    }
    return { invalid: true };
  }

  const weekDay = lower.match(/^(?:(다음|next|이번|this)\s*(?:주\s*)?)?(.+)$/);
  if (weekDay && dayNames[normalizedDay(weekDay[2])] !== undefined) {
    const day = dayNames[normalizedDay(weekDay[2])];
    if (weekDay[1] === '다음' || weekDay[1] === 'next') return { date: followingWeekday(base, day) };
    if (weekDay[1] === '이번' || weekDay[1] === 'this') {
      const monday = new Date(base);
      monday.setDate(base.getDate() - ((base.getDay() + 6) % 7));
      monday.setDate(monday.getDate() + day - 1);
      const date = dateKey(monday);
      return { date, past: date < dateKey(base) };
    }
    return { date: nextWeekday(base, day) };
  }
  return null;
}

function removeRanges(text, ranges) {
  return [...ranges].sort((a, b) => b.start - a.start).reduce((out, range) => out.slice(0, range.start) + ' ' + out.slice(range.end), text);
}
function cleanTitle(text) {
  return text.replace(/\s+/g, ' ').trim()
    .replace(/^(?:(?:에|부터|까지|at|on|by|for|일정|할\s*일)\s*)+/i, '')
    .replace(/(?:\s+(?:at|on|by|까지|마감|기한|데드라인|deadline))+$/i, '')
    .replace(/\s+/g, ' ').trim();
}
function readTime(value) {
  const text = value.trim().toLocaleLowerCase();
  const periodMatch = text.match(/(오전|오후|새벽|아침|저녁|밤|정오|자정|am|pm)\s*(\d{1,2})(?:\s*(?:시|:)?\s*(\d{1,2})\s*분?)?/i)
    || text.match(/(\d{1,2})(?:\s*(?:시|:)?\s*(\d{1,2})\s*분?)?\s*(am|pm)/i);
  let hour, minute, period, ambiguous = false;
  if (periodMatch) {
    const hasPrefix = /^(오전|오후|새벽|아침|저녁|밤|정오|자정|am|pm)/i.test(text);
    hour = Number(hasPrefix ? periodMatch[2] : periodMatch[1]);
    minute = Number(hasPrefix ? periodMatch[3] || 0 : periodMatch[2] || 0);
    period = hasPrefix ? periodMatch[1].toLocaleLowerCase() : periodMatch[3].toLocaleLowerCase();
  } else {
    const bare = text.match(/^(\d{1,2})(?:(?:\s*시(?:\s*(\d{1,2})\s*분?)?)|(?:\s*:\s*(\d{1,2})))?$/);
    if (!bare) return null;
    hour = +bare[1]; minute = +(bare[2] || bare[3] || 0);
    if (hour > 23 || minute > 59) return null;
    ambiguous = hour < 12;
  }
  if (hour > 23 || minute > 59) return null;
  if (['오후', '저녁', '밤', 'pm'].includes(period) && hour < 12) hour += 12;
  if (['오전', '아침', '새벽', 'am'].includes(period) && hour === 12) hour = 0;
  if (period === '정오') hour = 12;
  if (period === '자정') hour = 0;
  return { value: `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`, period, ambiguous };
}
function timeMatches(text) {
  const koreanPeriod = '(?:오전|오후|새벽|아침|저녁|밤|정오|자정)\\s*\\d{1,2}(?:\\s*(?:시|:)(?:\\s*\\d{1,2}\\s*분?)?)?';
  const englishPeriod = '(?:\\d{1,2}(?:\\s*:\\s*\\d{1,2})?\\s*(?:a\\.?m\\.?|p\\.?m\\.?)|(?:a\\.?m\\.?|p\\.?m\\.?)\\s*\\d{1,2}(?:\\s*:\\s*\\d{1,2})?)';
  const bare = '(?:[01]?\\d|2[0-3])(?:\\s*시(?:\\s*\\d{1,2}\\s*분?)?|:\\s*[0-5]\\d)';
  const source = `(?:${koreanPeriod}|${englishPeriod}|${bare})`;
  return new RegExp(`(?:${source}\\s*(?:부터|~|–|—|to|-)\\s*${source}\\s*(?:까지)?(?![\\p{L}])|(?:(?<![\\p{L}\\d])${source}(?![\\p{L}])))`, 'iu');
}
function parseTimePhrase(text) {
  const match = text.match(timeMatches(text));
  if (!match) return null;
  const phrase = match[0].trim();
  const rangeMatch = phrase.match(/^(.+?)\s*(?:부터|~|–|—|to|-)\s*(.+?)(?:\s*까지)?$/i);
  if (rangeMatch) {
    const first = readTime(rangeMatch[1]), secondRaw = rangeMatch[2];
    let second = readTime(secondRaw);
    if (first && second && !/[오전오후새벽아침저녁밤]|(?:a\.?m\.?|p\.?m\.?)/i.test(secondRaw)) {
      const firstHour = +first.value.slice(0, 2), secondHour = +second.value.slice(0, 2);
      if (secondHour <= firstHour && first.period && ['오후', '저녁', '밤', 'pm'].includes(first.period) && secondHour < 12) {
        second = { ...second, value: `${String(secondHour + 12).padStart(2, '0')}:${second.value.slice(3)}` };
      }
    }
    return { phrase, start: first, end: second, ambiguous: !!(first?.ambiguous || (second?.ambiguous && !first?.period)) };
  }
  const start = readTime(phrase);
  return start ? { phrase, start, end: null, ambiguous: start.ambiguous } : null;
}

export function naturalParse(input, today = null) {
  const original = String(input || '').trim();
  const base = today ? parseDate(today) : parseDate(seoulToday());
  const result = {
    title: original, date: null, plannedDate: null, dueDate: null, start: null, end: null,
    duration: null, repeat: 'none', repeatDays: [], priority: 'normal', category: null,
    type: 'task', ambiguousTime: false, requiresConfirmation: false, confidence: false,
  };
  if (!original) return result;
  let text = original;
  const remove = [];
  let invalidDate = false, pastDate = false, dateCount = 0, dueCount = 0;

  const dueRanges = [];
  for (const match of original.matchAll(/\{([^{}]+)\}/g)) {
    const phrase = match[1].trim();
    const parsed = resolveDate(phrase, base);
    if (parsed?.date) { result.dueDate = parsed.date; dueCount++; dueRanges.push({ start: match.index, end: match.index + match[0].length }); }
    else if (parsed?.invalid) { invalidDate = true; dueRanges.push({ start: match.index, end: match.index + match[0].length }); }
  }
  const dueExpressions = [
    new RegExp(`(?:마감(?:일)?|기한|데드라인|deadline)\\s*(?:은|는|:)?\\s*(${dateSource})(?=$|[\\s,.;!?])`, 'giu'),
    new RegExp(`(${dateSource})\\s*(?:까지|마감(?:일)?|기한|데드라인|deadline)(?=$|[\\s,.;!?])`, 'giu'),
  ];
  for (const expression of dueExpressions) for (const match of original.matchAll(expression)) {
    const phrase = match[1];
    const parsed = resolveDate(phrase, base);
    if (parsed?.date) { if (!result.dueDate) result.dueDate = parsed.date; dueCount++; dueRanges.push({ start: match.index, end: match.index + match[0].length }); }
    else if (parsed?.invalid) { invalidDate = true; dueRanges.push({ start: match.index, end: match.index + match[0].length }); }
  }
  remove.push(...dueRanges);
  text = removeRanges(text, dueRanges);

  const repeatPatterns = [
    { re: /매일|매일마다|every\s+day|daily/iu, repeat: 'daily', days: [0,1,2,3,4,5,6] },
    { re: /평일마다|매주\s*평일|every\s+weekday|weekdays/iu, repeat: 'weekly', days: [1,2,3,4,5] },
    { re: /격주\s*(월요일|화요일|수요일|목요일|금요일|토요일|일요일|월|화|수|목|금|토|일)|every\s+other\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday)/iu, repeat: 'biweekly' },
    { re: /매주\s*(월요일|화요일|수요일|목요일|금요일|토요일|일요일|월|화|수|목|금|토|일)|every\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday)/iu, repeat: 'weekly' },
  ];
  for (const pattern of repeatPatterns) {
    const match = text.match(pattern.re);
    if (!match) continue;
    result.repeat = pattern.repeat;
    const dayPhrase = match[1] || match[2];
    if (dayPhrase) {
      const index = dayNames[normalizedDay(dayPhrase)];
      result.repeatDays = [index];
      result.date = nextWeekday(base, index);
    } else if (pattern.days) {
      result.repeatDays = pattern.days;
      result.date = dateKey(base);
    }
    remove.push({ start: 0, end: 0 });
    text = text.replace(match[0], ' ');
    break;
  }

  const dateRanges = [];
  datePattern.lastIndex = 0;
  for (const match of text.matchAll(datePattern)) {
    const phrase = match[0];
    const parsed = resolveDate(phrase, base);
    if (!parsed) continue;
    dateCount++;
    if (parsed.invalid) invalidDate = true;
    if (parsed.past) pastDate = true;
    if (parsed.date && !result.date) result.date = parsed.date;
    dateRanges.push({ start: match.index, end: match.index + phrase.length });
  }
  text = removeRanges(text, dateRanges);
  remove.push(...dateRanges);

  const time = parseTimePhrase(text);
  if (time) {
    result.start = time.start?.value || null;
    result.end = time.end?.value || null;
    result.ambiguousTime = time.ambiguous;
    text = text.replace(time.phrase, ' ');
  }

  const duration = text.match(/(\d+)\s*시간(?:\s*(\d+)\s*분)?|(\d+)\s*분/iu);
  if (duration) {
    result.duration = duration[1] ? Number(duration[1]) * 60 + Number(duration[2] || 0) : Number(duration[3]);
    text = text.replace(duration[0], ' ');
  }

  const priority = text.match(/(?:^|\s)(?:p([1-4])|!!([1-4]))(?=$|\s)/i);
  if (priority) {
    const level = Number(priority[1] || priority[2]);
    result.priority = level === 1 ? 'high' : level === 4 ? 'low' : 'normal';
    text = text.replace(priority[0], ' ');
  } else if (/급함|긴급|매우\s*중요/.test(text)) {
    result.priority = 'high';
    text = text.replace(/급함|긴급|매우\s*중요/g, ' ');
  }

  const categoryMatch = text.match(/(?:^|\s)#([가-힣A-Za-z0-9_-]+)(?=$|\s)/);
  if (categoryMatch) {
    result.category = categoryMatch[1];
    text = text.replace(categoryMatch[0], ' ');
  }

  result.title = cleanTitle(text.replace(/[{}]/g, ''));
  result.type = /일정|약속|병원|회의|미팅|수업|방문|상담|면접|검진|진료|예약|식사|concert|meeting|appointment|interview|class/i.test(result.title) ? 'event' : 'task';
  if (result.type === 'task') {
    result.plannedDate = result.date;
    result.dueDate = result.dueDate || (dueCount && result.date ? result.date : null);
  }
  result.requiresConfirmation = invalidDate || pastDate || dateCount > 1 || dueCount > 1 || result.ambiguousTime
    || !result.title || (result.type === 'event' && !result.date) || (!!result.start && !result.date);
  result.confidence = Boolean(result.date || result.dueDate || result.start || result.repeat !== 'none');
  result.recognized = {
    executionDate: result.type === 'task' ? result.plannedDate : result.date,
    dueDate: result.dueDate,
    start: result.start,
    end: result.end,
    repeat: result.repeat,
    priority: result.priority,
    category: result.category,
    duration: result.duration,
  };
  return result;
}
