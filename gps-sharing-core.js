/* TAXIAPP GPS location sharing: pure logic, independent of diary data. */

(function(root){'use strict';

function activeDuty(model) {
  if (!model || model.version !== 1 || !Array.isArray(model.shifts) || !model.activeId) return null;
  const shift = model.shifts.find(item => item && item.id === model.activeId);
  if (!shift || (!shift.startedIso && !shift.startedAt) || shift.endedAt || shift.endedIso) return null;
  return shift;
}

function businessStatus(shift) {
  if (!shift) return null;
  const d = shift.draft || null;
  if (d && d.kind === 'dispatch') return '迎車';
  if (d && d.kind === 'ride') {
    return d.status === 'alighted' || Boolean(d.raw && d.raw.M) ? '支払い' : '実車';
  }
  if (shift.breakActive || (d && ['empty','cancel'].includes(d.kind))) return '空車';
  if (shift.waiting) return '待機';
  return '空車';
}

function fixFromPosition(position) {
  const c = position && position.coords;
  if (!c) return null;
  const lat = Number(c.latitude), lon = Number(c.longitude);
  const accuracy = Number(c.accuracy);
  const timestamp = Number(position.timestamp);
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 ||
      Math.abs(lon) > 180 || !Number.isFinite(accuracy) || accuracy < 0 ||
      !Number.isFinite(timestamp) || timestamp <= 0) return null;
  const speed = c.speed == null || !Number.isFinite(Number(c.speed)) || Number(c.speed) < 0 ? null : Number(c.speed);
  const heading = c.heading == null || !Number.isFinite(Number(c.heading)) ||
    Number(c.heading) < 0 || Number(c.heading) >= 360 ? null : Number(c.heading);
  return {lat, lon, accuracy, speed, heading, capturedAtMs: timestamp};
}

function distanceMeters(a, b) {
  const toRad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * toRad, dLon = (b.lon - a.lon) * toRad;
  const x = Math.sin(dLat / 2) ** 2 +
    Math.cos(a.lat * toRad) * Math.cos(b.lat * toRad) * Math.sin(dLon / 2) ** 2;
  return 12742000 * Math.asin(Math.min(1, Math.sqrt(Math.max(0, x))));
}

function fixDecision(previous, current) {
  if (!current || !Number.isFinite(current.capturedAtMs)) return {ok:false, reason:'GPSデータ不正'};
  if (!previous) return {ok:true};
  const sec = (current.capturedAtMs - previous.capturedAtMs) / 1000;
  if (!Number.isFinite(sec) || sec <= 0) return {ok:false, reason:'GPS時刻の逆転'};
  // Provisional only: verify the outlier threshold using real-device readings before production.
  if (distanceMeters(previous,current) / sec > 75) return {ok:false, reason:'位置飛び疑い'};
  return {ok:true};
}

function presenceView(doc, nowMs) {
  if (!doc || doc.public !== true || doc.onDuty !== true) return {show:false};
  const ts = doc.updatedAt;
  const updatedAtMs = ts && typeof ts.toMillis === 'function' ? ts.toMillis() : Number(ts);
  if (!Number.isFinite(updatedAtMs) || updatedAtMs <= 0) return {show:false};
  const age = nowMs - updatedAtMs;
  if (age < -30000 || age >= 300000) return {show:false};
  if (!Number.isFinite(doc.lat) || !Number.isFinite(doc.lon) ||
      Math.abs(doc.lat) > 90 || Math.abs(doc.lon) > 180) return {show:false};
  return {show:true, stale:age > 90000, ageMs:age};
}

function sendIntervalMs(current, previous) {
  if (current && current.speed !== null && current.speed !== undefined) {
    return current.speed >= 0.7 ? 15000 : 90000;
  }
  if (current && previous && distanceMeters(previous,current) > 15) return 15000;
  return 90000;
}

function historyCsv(points) {
  const header = ['記録日時（日本時間）','緯度','経度','測位精度（m）',
    '測位判定','区間番号','速度（km/h）','進行方位（度）'];
  const csvEscape = value => '"' + String(value == null ? '' : value).replace(/"/g,'""') + '"';
  const rows = [header];
  for (const p of points || []) {
    const d = new Date(p.capturedAtMs);
    const jst = Number.isFinite(d.getTime()) ? new Date(d.getTime()+9*3600000).toISOString().slice(0,19).replace('T',' ') : '';
    rows.push([jst,p.lat,p.lon,p.accuracy,p.suspectedJump?'位置飛び疑い':'正常',
      p.segmentNo == null ? '' : p.segmentNo,
      p.speed == null ? '' : Math.round(p.speed*360)/100,
      p.heading == null ? '' : p.heading]);
  }
  return '\ufeff' + rows.map(row => row.map(csvEscape).join(',')).join('\r\n') + '\r\n';
}

const api = Object.freeze({activeDuty,businessStatus,fixFromPosition,distanceMeters,fixDecision,presenceView,sendIntervalMs,historyCsv});

if (typeof module !== 'undefined' && module.exports) module.exports=api;

root.TAXIAPP_GPS_SHARING_CORE=api;

})(typeof window !== 'undefined' ? window : globalThis);
