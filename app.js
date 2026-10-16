/* 칭다오 가족여행 — 화면 동작. 콘텐츠는 data.js에 있습니다. */
(function () {
  "use strict";

  var T = self.TRIP;
  var HOUR = 3600 * 1000;
  var TZ_OFFSET = { CST: 8, KST: 9 }; // 중국 UTC+8, 한국 UTC+9 (둘 다 서머타임 없음)
  var WEEK = ["일", "월", "화", "수", "목", "금", "토"];
  var TBD = "미정";

  // ───────── 공통 도구 ─────────
  function $(sel, root) { return (root || document).querySelector(sel); }
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function isTbd(s) { return !s || String(s).trim() === TBD; }
  function txt(s) { return isTbd(s) ? '<span class="tbd">' + TBD + "</span>" : esc(s); }
  function pad(n) { return (n < 10 ? "0" : "") + n; }

  // "2026-10-23" + "16:05" (tz 기준) → 절대 시각(ms)
  function toMs(date, time, tz) {
    var d = date.split("-").map(Number);
    var t = time.split(":").map(Number);
    return Date.UTC(d[0], d[1] - 1, d[2], t[0], t[1]) - TZ_OFFSET[tz || "CST"] * HOUR;
  }
  // 절대 시각 → 중국 시간 기준 날짜·시각 조각
  function china(ms) {
    var d = new Date(ms + TZ_OFFSET.CST * HOUR);
    return { y: d.getUTCFullYear(), m: d.getUTCMonth() + 1, d: d.getUTCDate(), w: d.getUTCDay(), h: d.getUTCHours(), mi: d.getUTCMinutes() };
  }
  function dayKey(ms) { var c = china(ms); return c.y * 10000 + c.m * 100 + c.d; }
  function hm(ms) { var c = china(ms); return pad(c.h) + ":" + pad(c.mi); }
  function dateLabel(date) {
    var p = date.split("-").map(Number);
    var w = new Date(Date.UTC(p[0], p[1] - 1, p[2])).getUTCDay();
    return p[1] + "월 " + p[2] + "일 (" + WEEK[w] + ")";
  }

  // ───────── 테스트용 ?now=2026-10-24T14:00 (중국 시간) ─────────
  var previewMs = (function () {
    var m = /[?&]now=([^&#]+)/.exec(location.search);
    if (!m) return null;
    var v = decodeURIComponent(m[1]).replace(" ", "T");
    var p = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{1,2}):(\d{2}))?/.exec(v);
    if (!p) return null;
    return toMs(p[1] + "-" + p[2] + "-" + p[3], (p[4] || "0") + ":" + (p[5] || "00"));
  })();
  function now() { return previewMs != null ? previewMs : Date.now(); }

  // ───────── 장소 ─────────
  var placeById = {};
  T.places.forEach(function (p) { placeById[p.id] = p; });
  function placeIds(item) {
    var p = item.place;
    var ids = Array.isArray(p) ? p : p ? [p] : [];
    return ids.filter(function (id) { return placeById[id]; });
  }

  // ───────── 일정 펼치기 ─────────
  // 각 일정에 start(시작), until(이때까지 '지금'), dayIndex를 붙입니다.
  var flat = [];
  T.days.forEach(function (day, di) {
    day.items.forEach(function (it) {
      flat.push({
        item: it,
        day: day,
        dayIndex: di,
        start: it.time ? toMs(day.date, it.time, it.tz) : null,
        end: it.end ? toMs(day.date, it.end, it.tz) : null
      });
    });
  });
  flat.forEach(function (e, i) {
    if (e.start == null) return;
    if (e.end != null) { e.until = e.end; return; }
    var nextTimed = null;
    for (var j = i + 1; j < flat.length; j++) if (flat[j].start != null) { nextTimed = flat[j]; break; }
    var dayEnd = toMs(e.day.date, T.dayEnd || "23:00");
    if (nextTimed && nextTimed.dayIndex === e.dayIndex) e.until = nextTimed.start;
    else if (nextTimed) e.until = Math.min(dayEnd, nextTimed.start);
    else e.until = e.start; // 여행 마지막 일정(도착)
  });
  // 시각 없는 일정(예: 귀가 전)은 바로 앞 일정과 함께 지나갑니다.
  flat.forEach(function (e, i) {
    if (e.start != null) return;
    for (var j = i - 1; j >= 0; j--) if (flat[j].start != null) { e.until = flat[j].until; break; }
    if (e.until == null) e.until = Infinity;
  });
  var timed = flat.filter(function (e) { return e.start != null; });
  var tripStart = timed[0].start;
  var tripEnd = timed[timed.length - 1].start;

  function timeText(e) {
    var it = e.item;
    if (!it.time) return esc(it.timeLabel || "");
    var s = esc(it.time) + (it.end ? " ~ " + esc(it.end) : "");
    return it.tz === "KST" ? s + " (한국 시간)" : s;
  }
  function relDay(ms, ref) {
    var diff = Math.round((toMs(fromKey(dayKey(ms)), "00:00") - toMs(fromKey(dayKey(ref)), "00:00")) / (24 * HOUR));
    return diff === 0 ? "오늘" : diff === 1 ? "내일" : diff === 2 ? "모레" : dateLabel(fromKey(dayKey(ms)));
  }
  function fromKey(k) { return Math.floor(k / 10000) + "-" + pad(Math.floor(k / 100) % 100) + "-" + pad(k % 100); }

  // 지금 상태 계산
  function status(t) {
    if (t < tripStart) return { mode: "before" };
    if (t >= tripEnd) return { mode: "after" };
    var idx = -1;
    for (var i = 0; i < flat.length; i++) if (flat[i].start != null && flat[i].start <= t) idx = i;
    var cur = flat[idx];
    var res = { mode: "during", dayIndex: cur.dayIndex };
    if (t < cur.until) {
      res.current = cur;
      res.next = flat[idx + 1] || null;
    } else {
      var nextTimed = null;
      for (var j = idx + 1; j < flat.length; j++) if (flat[j].start != null) { nextTimed = flat[j]; break; }
      if (nextTimed && nextTimed.dayIndex === cur.dayIndex) {
        res.moving = true;
        res.next = nextTimed;
      } else {
        res.rest = true;
        res.endedDay = cur.dayIndex;
        res.next = nextTimed;
        if (nextTimed && dayKey(t) === dayKey(nextTimed.start)) res.dayIndex = nextTimed.dayIndex;
      }
    }
    res.gather = null;
    for (var k = 0; k < flat.length; k++) {
      if (flat[k].item.gather && flat[k].start > t) { res.gather = flat[k]; break; }
    }
    return res;
  }

  // ───────── 가족여행 십계명 ─────────
  // open이면 펼친 채로, 아니면 제목만 보이고 누르면 펼쳐집니다.
  function rulesBox(open) {
    var R = T.rules;
    if (!R || !R.items || !R.items.length) return "";
    return (
      '<details class="card rules"' + (open ? " open" : "") + ">" +
      "<summary>" + esc(R.title) + "</summary>" +
      '<ol class="rules-list">' + R.items.map(function (x) { return "<li>" + esc(x) + "</li>"; }).join("") + "</ol>" +
      "</details>"
    );
  }

  // ───────── 날씨 ─────────
  // 인터넷이 되면 Open-Meteo(무료, 키 없음)에서 예보를 받아 휴대폰에 저장해 두고,
  // 안 되면 마지막 저장본이나 data.js의 평년 기온을 보여 줍니다.
  var W = T.weather;
  var WX_KEY = "qingdao-weather";
  var WX_FRESH = 30 * 60 * 1000; // 30분마다 새로 받기
  var WX_RETRY = 5 * 60 * 1000;  // 실패하면 5분 뒤 다시 시도
  var wx = null, wxLastTry = 0;
  try { wx = JSON.parse(localStorage.getItem(WX_KEY) || "null"); } catch (e) { wx = null; }

  function wxDesc(code) {
    if (code === 0) return ["☀️", "맑음"];
    if (code === 1) return ["🌤️", "맑음"];
    if (code === 2) return ["⛅", "구름 조금"];
    if (code === 3) return ["☁️", "흐림"];
    if (code === 45 || code === 48) return ["🌫️", "안개"];
    if (code >= 51 && code <= 57) return ["🌦️", "이슬비"];
    if ((code >= 61 && code <= 67) || (code >= 80 && code <= 82)) return ["🌧️", "비"];
    if ((code >= 71 && code <= 77) || code === 85 || code === 86) return ["🌨️", "눈"];
    if (code >= 95) return ["⛈️", "천둥번개"];
    return ["🌡️", ""];
  }
  function deg(x) { return Math.round(x) + "°"; }

  function loadWeather() {
    if (!W || !window.fetch) return;
    var t = Date.now();
    if (wx && t - wx.at < WX_FRESH) return;
    if (t - wxLastTry < WX_RETRY) return;
    wxLastTry = t;
    var url = "https://api.open-meteo.com/v1/forecast?latitude=" + W.lat + "&longitude=" + W.lon +
      "&current=temperature_2m,weather_code" +
      "&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max" +
      "&timezone=Asia%2FShanghai&forecast_days=16";
    fetch(url).then(function (r) {
      if (!r.ok) throw new Error("weather " + r.status);
      return r.json();
    }).then(function (j) {
      if (!j || !j.daily) return;
      wx = { at: Date.now(), current: j.current || null, daily: j.daily };
      try { localStorage.setItem(WX_KEY, JSON.stringify(wx)); } catch (e) {}
      if (current === "now") renderNow();
    }).catch(function () {});
  }

  // 여행 전: 여행 3일 예보 / 여행 중: 지금 기온 + 오늘·내일 예보
  function weatherCard(t, mode) {
    if (!W) return "";
    var d = wx && wx.daily;
    var keys = mode === "before"
      ? T.days.map(function (x) { return x.date; })
      : [fromKey(dayKey(t)), fromKey(dayKey(t + 24 * HOUR))];
    var rows = "";
    if (d) keys.forEach(function (k) {
      var i = d.time.indexOf(k);
      if (i < 0) return;
      var w = wxDesc(d.weather_code[i]);
      var rain = d.precipitation_probability_max ? d.precipitation_probability_max[i] : null;
      rows +=
        '<li class="wx-row">' +
        '<span class="wx-day">' + relDay(toMs(k, "12:00"), t) + "</span>" +
        '<span class="wx-sky"><span aria-hidden="true">' + w[0] + "</span> " + esc(w[1]) + "</span>" +
        '<span class="wx-temp">' + deg(d.temperature_2m_max[i]) + ' <span class="muted">/ ' + deg(d.temperature_2m_min[i]) + "</span>" +
        (rain != null && rain >= 30 ? '<span class="wx-rain">비 올 확률 ' + rain + "%</span>" : "") +
        "</span></li>";
    });
    var cur = "";
    if (wx && wx.current && previewMs == null && Date.now() - wx.at < 3 * HOUR) {
      var cw = wxDesc(wx.current.weather_code);
      cur = '<p class="wx-now"><span aria-hidden="true">' + cw[0] + "</span> 지금 칭다오 " + deg(wx.current.temperature_2m) +
        ' <span class="wx-now-sky">' + esc(cw[1]) + "</span></p>";
    }
    var when = wx ? '<p class="wx-meta">예보 ' + relDay(wx.at, Date.now()) + " " + hm(wx.at) + " 기준 (중국 시간)</p>" : "";
    return (
      '<section class="card wx"><p class="eyebrow">칭다오 날씨</p>' +
      cur +
      (rows ? '<ul class="wx-list">' + rows + "</ul>" + when : "") +
      '<p class="wx-normal' + (rows ? "" : " solo") + '">10월 말 평소: ' + esc(W.normal) + "</p>" +
      (W.note ? '<p class="wx-meta">' + esc(W.note) + "</p>" : "") +
      "</section>"
    );
  }

  // ───────── 지금 탭 ─────────
  function renderNow() {
    var t = now();
    var s = status(t);
    var c = china(t);
    var korea = (c.h + 1) % 24;
    var head =
      '<div class="now-head">' +
      '<p class="now-date">' + c.m + "월 " + c.d + "일 (" + WEEK[c.w] + ")" +
      (s.mode === "during" ? " · " + esc(T.days[s.dayIndex].label) : "") + "</p>" +
      '<p class="now-clock">중국 시간 ' + pad(c.h) + ":" + pad(c.mi) + " · 한국은 " + pad(korea) + ":" + pad(c.mi) + "</p>" +
      "</div>";
    var html = head + rulesBox(s.mode === "before");

    if (s.mode === "before") {
      var dep = T.departure;
      var days = Math.round((toMs(dep.date, "00:00") - toMs(fromKey(dayKey(t)), "00:00")) / (24 * HOUR));
      var dday = days <= 0 ? "오늘 출발합니다" : days === 1 ? "내일 출발합니다" : "출발까지 " + days + "일";
      html +=
        '<section class="card now-card">' +
        '<p class="eyebrow accent">' + esc(T.title) + "</p>" +
        '<p class="dday">' + dday + "</p>" +
        '<dl class="kv">' +
        "<dt>출발</dt><dd>" + dateLabel(dep.date) + " " + esc(dep.time) + (dep.tz === "KST" ? " (한국 시간)" : "") + "</dd>" +
        "<dt>장소</dt><dd>" + txt(dep.place) + " · " + txt(dep.flight) + "</dd>" +
        "<dt>공항 집합</dt><dd>" + txt(dep.meetTime) + " · " + txt(dep.meetPlace) + "</dd>" +
        (T.returnFlight
          ? "<dt>돌아오는 편</dt><dd>" + dateLabel(T.returnFlight.date) + " " + esc(T.returnFlight.time) + " (중국 시간) · " + txt(T.returnFlight.flight) +
            '<span class="kv-sub">' + txt(T.returnFlight.meet) + "</span></dd>"
          : "") +
        "</dl></section>" +
        weatherCard(t, "before") +
        '<section class="card"><p class="eyebrow">준비물</p><ul class="plain-list">' +
        T.checklist.map(function (x) { return "<li>" + txt(x) + "</li>"; }).join("") +
        "</ul></section>";
    } else if (s.mode === "after") {
      html +=
        '<section class="card now-card farewell">' +
        '<p class="eyebrow accent">여행이 끝났습니다</p>' +
        T.farewell.map(function (x) { return "<p>" + esc(x) + "</p>"; }).join("") +
        "</section>";
    } else {
      if (s.current) {
        var ids = placeIds(s.current.item);
        html +=
          '<section class="card now-card">' +
          '<p class="eyebrow accent">지금</p>' +
          '<h1 class="now-title">' + esc(s.current.item.title) + "</h1>" +
          '<p class="now-time">' + timeText(s.current) + "</p>" +
          (ids.length ? '<div class="btn-row"><button type="button" class="btn primary" data-goplace="' + esc(ids.join(",")) + '">장소 보기</button></div>' : "") +
          "</section>";
      } else if (s.moving) {
        html +=
          '<section class="card now-card"><p class="eyebrow accent">지금</p>' +
          '<h1 class="now-title">다음 장소로 이동 중입니다</h1></section>';
      } else {
        html +=
          '<section class="card now-card"><p class="eyebrow accent">지금</p>' +
          '<h1 class="now-title">숙소에서 쉬는 시간입니다</h1>' +
          (dayKey(t) === dayKey(T.days[s.endedDay] ? toMs(T.days[s.endedDay].date, "12:00") : 0) ? '<p class="now-time muted">오늘 일정이 모두 끝났습니다</p>' : "") +
          "</section>";
      }
      if (s.next) {
        var nx = s.next;
        var when = nx.start != null ? relDay(nx.start, t) + " " + timeText(nx) : timeText(nx);
        html +=
          '<section class="card"><p class="eyebrow">다음</p>' +
          '<p class="next-title">' + esc(nx.item.title) + "</p>" +
          '<p class="next-time">' + when + "</p></section>";
      }
      if (s.gather) {
        html +=
          '<section class="card"><p class="eyebrow">다음 집합</p>' +
          '<p class="gather-time">' + relDay(s.gather.start, t) + " " + timeText(s.gather) + "</p>" +
          '<p class="gather-place">' + txt(s.gather.item.gather) + "</p></section>";
      }
      html += weatherCard(t, "during");
    }
    $("#tab-now").innerHTML = html;
    if (s.mode !== "after") loadWeather();
  }

  // ───────── 일정 탭 ─────────
  function renderSchedule() {
    var t = now();
    var s = status(t);
    var curEntry = s.mode === "during" ? s.current : null;
    var html = '<h1 class="page-title">일정</h1>';
    T.days.forEach(function (day, di) {
      html +=
        '<section class="day" id="day-' + di + '">' +
        '<div class="day-head"><h2>' + esc(day.label) + "</h2><span>" + dateLabel(day.date) + "</span></div>" +
        (day.note ? '<p class="day-note">' + esc(day.note) + "</p>" : "") +
        '<ul class="slots">';
      flat.forEach(function (e, i) {
        if (e.dayIndex !== di) return;
        var it = e.item;
        var ids = placeIds(it);
        var cls = "slot";
        if (e === curEntry) cls += " current";
        else if (s.mode === "after" || (s.mode === "during" && e.until <= t)) cls += " past";
        var time = it.time
          ? esc(it.time) + (it.end ? "<small>~ " + esc(it.end) + "</small>" : "") + (it.tz === "KST" ? "<small>한국 시간</small>" : "")
          : "<small>" + esc(it.timeLabel || "") + "</small>";
        var tags = (e === curEntry ? '<span class="tag">지금</span> ' : "") + (it.gather ? '<span class="tag plain">집합</span>' : "");
        var shorts = ids.map(function (id) { return placeById[id].short; }).filter(function (x) { return !isTbd(x); });
        var pic = null;
        ids.some(function (id) { var pl = placeById[id]; if (!isTbd(pl.image)) { pic = pl; return true; } return false; });
        var inner =
          '<span class="slot-time">' + time + "</span>" +
          '<span class="slot-title">' + (tags ? tags + "<br>" : "") + esc(it.title) +
          shorts.map(function (x) { return '<span class="slot-desc">' + esc(x) + "</span>"; }).join("") + "</span>" +
          '<span class="slot-go" aria-hidden="true">' + (ids.length ? "›" : "") + "</span>" +
          (pic ? '<img class="slot-photo" src="' + esc(pic.image) + '" alt="' + esc(pic.name) + '" loading="lazy" onerror="this.remove()">' : "");
        html += ids.length
          ? '<li><button type="button" class="' + cls + '" id="slot-' + i + '" data-goplace="' + esc(ids.join(",")) + '">' + inner + "</button></li>"
          : '<li><div class="' + cls + '" id="slot-' + i + '">' + inner + "</div></li>";
      });
      html += "</ul></section>";
    });
    $("#tab-schedule").innerHTML = html;
  }

  // ───────── 장소 탭 ─────────
  function photo(src, alt, credit) {
    if (isTbd(src)) return "";
    var img = '<img class="photo" src="' + esc(src) + '" alt="' + esc(alt) + '" loading="lazy" onerror="this.parentNode.remove()">';
    return '<figure class="photo-wrap">' + img + (credit ? '<figcaption class="photo-credit">' + esc(credit) + "</figcaption>" : "") + "</figure>";
  }
  function amapUrl(zh) {
    return "https://uri.amap.com/search?keyword=" + encodeURIComponent(zh) + "&city=" + encodeURIComponent("青岛") + "&src=family-trip&callnative=1";
  }
  function renderPlaces() {
    var html = '<h1 class="page-title">장소</h1>';
    T.places.forEach(function (p) {
      var hasZh = !isTbd(p.zh);
      html +=
        '<article class="card place" id="place-' + esc(p.id) + '">' +
        '<span class="tag plain">' + esc(p.type) + "</span>" +
        '<h2 class="place-name">' + esc(p.name) + "</h2>" +
        (hasZh ? '<p class="place-zh" lang="zh-CN">' + esc(p.zh) + "</p>" : "") +
        photo(p.image, p.name, p.credit) +
        '<p class="place-desc">' + txt(p.desc) + "</p>";
      if (p.menu) {
        if (!p.menu.length) html += '<p class="menu-title">' + esc(p.menuTitle || "추천 메뉴") + "</p>";
        if (p.menu.length) {
          var label = esc(p.menuTitle || "추천 메뉴");
          html +=
            '<div class="fold">' +
            '<button type="button" class="fold-btn" data-fold aria-expanded="false">' +
            '<span class="fold-open">' + label + " 펼치기 (" + p.menu.length + "개) ▾</span>" +
            '<span class="fold-close">' + label + " 접기 ▴</span></button>" +
            '<div class="fold-body">' + menuList(p.menu) +
            '<button type="button" class="fold-btn fold-bottom" data-fold aria-expanded="true">' +
            '<span class="fold-close">' + label + " 접기 ▴</span></button>" +
            "</div></div>";
        } else {
          html += '<p class="tbd">' + esc(p.menuNote || TBD) + "</p>";
        }
      }
      if (hasZh) {
        html +=
          '<div class="btn-row">' +
          '<button type="button" class="btn primary" data-big="' + esc(p.zh) + '" data-sub="' + esc(p.name) + '">중국어로 크게 보기</button>' +
          '<a class="btn" href="' + esc(amapUrl(p.zh)) + '" target="_blank" rel="noopener">길찾기</a>' +
          "</div>";
      }
      html += "</article>";
    });
    $("#tab-places").innerHTML = html;
  }

  // 메뉴 목록: 누르면 중국어 이름이 크게 뜹니다.
  function menuList(items) {
    return '<ul class="menu">' + items.map(function (m) {
      var ko = isTbd(m.ko) ? "" : m.ko;
      return (
        '<li><button type="button" class="menu-item" data-big="' + esc(m.zh) + '" data-sub="' + esc(ko) + '">' +
        '<span class="zh" lang="zh-CN">' + esc(m.zh) + "</span>" +
        (ko ? '<span class="name">' + esc(ko) + "</span>" : "") +
        (m.desc ? '<span class="ko">' + txt(m.desc) + "</span>" : "") +
        photo(m.image, ko || m.zh) +
        "</button></li>"
      );
    }).join("") + "</ul>";
  }

  // ───────── 더보기 탭 ─────────
  function renderMore() {
    var html = '<h1 class="page-title">더보기</h1>';
    html += rulesBox(true);

    html += '<h2 class="section-title" style="margin-top:0">간단한 중국어</h2><p class="muted" style="margin-bottom:12px">누르면 크게 보입니다</p>';
    T.phrases.forEach(function (ph) {
      if (isTbd(ph.zh)) {
        html += '<div class="card phrase"><p class="ko tbd">' + TBD + "</p></div>";
        return;
      }
      html +=
        '<button type="button" class="card phrase" data-big="' + esc(ph.zh) + '" data-sub="' + esc(ph.ko) + '">' +
        '<p class="ko">' + esc(ph.ko) + "</p>" +
        '<p class="say">' + esc(ph.sound) + '<span class="zh" lang="zh-CN">' + esc(ph.zh) + "</span></p>" +
        "</button>";
    });

    html += '<h2 class="section-title">준비물</h2><section class="card"><ul class="plain-list">' +
      T.checklist.map(function (x) { return "<li>" + txt(x) + "</li>"; }).join("") + "</ul></section>";

    html += '<h2 class="section-title">알아둘 점</h2><section class="card"><ul class="plain-list">' +
      T.tips.map(function (x) { return "<li>" + txt(x) + "</li>"; }).join("") + "</ul></section>";

    html += '<h2 class="section-title">야시장 먹거리</h2>';
    var market = placeById[T.nightMarketPlace];
    if (market && market.menu && market.menu.length) {
      html += '<p class="muted">누르면 크게 보입니다</p>' + menuList(market.menu).replace('class="menu"', 'class="menu plain"');
    } else {
      html += '<p class="note-box">준비 중입니다</p>';
    }

    html += '<h2 class="section-title">중국 이야기</h2>';
    if (T.stories && T.stories.length) {
      html += '<p class="muted" style="margin-bottom:12px">제목을 누르면 펼쳐집니다</p>';
      T.stories.forEach(function (st) {
        html += '<details class="card story"><summary>' + esc(st.title) + "</summary><p>" + esc(st.body) + "</p></details>";
      });
    } else {
      html += '<p class="note-box">준비 중입니다</p>';
    }
    $("#tab-more").innerHTML = html;
  }

  // ───────── 길 잃었을 때 ─────────
  function helpBox(h) {
    return (
      '<h3 class="section-title" style="margin-top:22px">중국 분께 도움 요청</h3>' +
      '<p class="lost-guide">' + esc(h.guide) + "</p>" +
      '<div class="addr">' +
      '<p class="addr-help" lang="zh-CN">' + esc(h.zh) + "</p>" +
      '<p class="addr-wechat">WeChat: ' + esc(h.wechat) + "</p>" +
      '<p class="addr-taxi-ko">' + esc(h.ko) + "</p>" +
      "</div>" +
      '<button type="button" class="btn primary" data-big="' + esc(h.zh) + '" data-sub="' + esc(h.ko) + '">이 글 크게 보기</button>'
    );
  }
  function renderLost() {
    var L = T.lost;
    $("#lost").innerHTML =
      '<div class="lost-inner">' +
      '<div class="lost-top"><h2>길 잃었을 때</h2><button type="button" class="btn" data-close>닫기</button></div>' +
      '<p class="lost-guide">' + esc(L.guide) + "</p>" +
      '<div class="addr">' +
      '<p class="addr-label">숙소 주소 · 택시 기사에게 보여 주세요</p>' +
      '<p class="addr-text" lang="zh-CN">' + L.addressLines.map(function (x) { return "<span>" + esc(x) + "</span>"; }).join("") + "</p>" +
      '<p class="addr-taxi" lang="zh-CN">' + esc(L.taxi) + "</p>" +
      '<p class="addr-taxi-ko">' + esc(L.taxiKo) + "</p>" +
      "</div>" +
      (L.help ? helpBox(L.help) : "") +
      '<h3 class="section-title" style="margin-top:22px">비상 연락처</h3>' +
      L.contacts.map(function (ct) {
        return '<a class="tel" href="tel:' + esc(ct.tel) + '"><span class="tel-label">' + esc(ct.label) + '</span><span class="tel-num">' + esc(ct.number) + "</span></a>";
      }).join("") +
      "</div>";
  }

  // ───────── 겹쳐 뜨는 화면 (뒤로가기로 닫힘) ─────────
  var openOverlay = null;
  function showOverlay(el) {
    if (openOverlay) hideOverlay();
    openOverlay = el;
    el.hidden = false;
    el.scrollTop = 0;
    document.body.classList.add("locked");
    try { history.pushState({ overlay: true }, ""); } catch (e) {}
  }
  function hideOverlay() {
    if (!openOverlay) return;
    openOverlay.hidden = true;
    openOverlay = null;
    document.body.classList.remove("locked");
  }
  function closeOverlay() {
    if (history.state && history.state.overlay) history.back();
    else hideOverlay();
  }
  window.addEventListener("popstate", hideOverlay);

  function showBig(zh, sub) {
    var el = $("#big");
    $("#big-text").textContent = zh;
    $("#big-sub").textContent = sub || "";
    showOverlay(el);
    fitBig();
  }
  // 글자가 화면을 넘지 않는 가장 큰 크기로 맞춥니다.
  function fitBig() {
    var stage = $(".big-stage");
    var p = $("#big-text");
    var lo = 24, hi = 220;
    while (lo < hi) {
      var mid = Math.ceil((lo + hi) / 2);
      p.style.fontSize = mid + "px";
      if (p.scrollHeight <= stage.clientHeight && p.scrollWidth <= stage.clientWidth) lo = mid;
      else hi = mid - 1;
    }
    p.style.fontSize = lo + "px";
  }
  window.addEventListener("resize", function () { if (openOverlay === $("#big")) fitBig(); });

  // ───────── 탭 ─────────
  var current = "now";
  function showTab(name, opts) {
    current = name;
    ["now", "schedule", "places", "more"].forEach(function (n) {
      $("#tab-" + n).hidden = n !== name;
      var b = $('.tabbar [data-tab="' + n + '"]');
      if (n === name) b.setAttribute("aria-current", "page");
      else b.removeAttribute("aria-current");
    });
    if (name === "now") renderNow();
    if (name === "schedule") renderSchedule();
    if (!opts || !opts.keepScroll) window.scrollTo(0, 0);
    if (name === "schedule") {
      var cur = $("#tab-schedule .slot.current") || $("#day-" + (status(now()).dayIndex || 0));
      if (cur && status(now()).mode === "during") cur.scrollIntoView({ block: "center" });
    }
  }

  function goPlace(ids) {
    showTab("places", { keepScroll: true });
    var first = null;
    ids.split(",").forEach(function (id) {
      var el = document.getElementById("place-" + id);
      if (!el) return;
      if (!first) first = el;
      el.classList.add("flash");
      setTimeout(function () { el.classList.remove("flash"); }, 2500);
    });
    if (first) first.scrollIntoView({ block: "start" });
  }

  // 메뉴 접기/펼치기. 아래쪽 '접기'를 누르면 위쪽 버튼이 보이도록 화면을 올립니다.
  function toggleFold(btn) {
    var box = btn.closest(".fold");
    var open = !box.classList.contains("open");
    box.classList.toggle("open", open);
    var top = box.querySelector(".fold-btn");
    top.setAttribute("aria-expanded", open ? "true" : "false");
    if (!open && btn !== top) {
      var r = top.getBoundingClientRect();
      if (r.top < 0 || r.bottom > window.innerHeight) top.scrollIntoView({ block: "center" });
    }
  }

  document.addEventListener("click", function (ev) {
    var el = ev.target.closest("[data-tab],[data-goplace],[data-big],[data-close],[data-fold],#lost-btn");
    if (!el) return;
    if (el.hasAttribute("data-fold")) return toggleFold(el);
    if (el.id === "lost-btn") return showOverlay($("#lost"));
    if (el.hasAttribute("data-close")) return closeOverlay();
    if (el.hasAttribute("data-tab")) return showTab(el.getAttribute("data-tab"));
    if (el.hasAttribute("data-goplace")) return goPlace(el.getAttribute("data-goplace"));
    if (el.hasAttribute("data-big")) return showBig(el.getAttribute("data-big"), el.getAttribute("data-sub"));
  });

  // ───────── 시작 ─────────
  if (previewMs != null) {
    var pv = china(previewMs);
    var bar = $("#preview");
    bar.textContent = "미리보기: " + pv.m + "월 " + pv.d + "일 " + pad(pv.h) + ":" + pad(pv.mi) + " (중국 시간)";
    bar.hidden = false;
  }
  renderPlaces();
  renderMore();
  renderLost();
  showTab("now");

  // 시간이 흐르면 '지금'과 '일정'을 다시 그립니다.
  function refresh() {
    if (current === "now") renderNow();
    if (current === "schedule") renderSchedule();
  }
  if (previewMs == null) setInterval(refresh, 30 * 1000);
  document.addEventListener("visibilitychange", function () { if (!document.hidden) refresh(); });

  // ───────── 오프라인 (서비스 워커) ─────────
  if ("serviceWorker" in navigator) {
    var hadController = !!navigator.serviceWorker.controller;
    var reloading = false;
    function reloadOnce() {
      if (reloading) return;
      reloading = true;
      location.reload();
    }
    navigator.serviceWorker.addEventListener("controllerchange", function () {
      if (hadController) reloadOnce();
      hadController = true;
    });
    navigator.serviceWorker.addEventListener("message", function (ev) {
      if (ev.data && ev.data.type === "content-updated" && !openOverlay) reloadOnce();
    });
    window.addEventListener("load", function () {
      navigator.serviceWorker.register("sw.js", { updateViaCache: "none" }).then(function (reg) {
        // data.js에 적힌 사진도 오프라인용으로 저장합니다.
        var imgs = [];
        T.places.forEach(function (p) {
          if (!isTbd(p.image)) imgs.push(p.image);
          (p.menu || []).forEach(function (m) { if (!isTbd(m.image)) imgs.push(m.image); });
        });
        if (imgs.length) {
          navigator.serviceWorker.ready.then(function (r) {
            if (r.active) r.active.postMessage({ type: "cache-images", urls: imgs });
          });
        }
        reg.update().catch(function () {});
      }).catch(function () {});
    });
  }
})();
