/* Distance-only audit: compares native GPS increments with manually read vehicle-trip increments.
   Independent of journal records, payments, storage synchronization, and location APIs. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.GpsSegmentAudit = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  function km(value) {
    if (value === null || value === undefined || value === '') return null;
    if (typeof value === 'boolean') throw Error('車両トリップの入力が不正です');
    const n = typeof value === 'number' ? value : Number(String(value).trim().replace(',', '.'));
    if (!Number.isFinite(n) || n < 0 || n > 10000) throw Error('区間距離は0〜10000kmで入力してください');
    return Math.round(n * 1000) / 1000;
  }
  function compare(derived, vehicleLegs) {
    if (!derived || !Array.isArray(derived.rows) || !Array.isArray(vehicleLegs)) throw Error('比較データが不正です');
    return derived.rows.map((r, i) => {
      const vehicleKm = km(vehicleLegs[i]);
      const gpsKm = r.error || r.deltaKm === null || r.deltaKm === undefined ? null : km(r.deltaKm);
      const differenceKm = gpsKm === null || vehicleKm === null ? null :
        Math.round((vehicleKm - gpsKm) * 1000) / 1000;
      return { number: i + 1, gpsKm, vehicleKm, differenceKm,
        differenceMeters: differenceKm === null ? null : Math.round(differenceKm * 1000),
        differencePercent: differenceKm === null || vehicleKm === 0 ? null :
          Math.round(differenceKm / vehicleKm * 10000) / 100,
        error: r.error || '', at: r.at || null, place: typeof r.place === 'string' ? r.place : '' };
    });
  }
  // Derive vehicle leg distances from cumulative hand-entered vehicle trip readings.
  // Never treat a GPS-derived/display-only value as a vehicle meter reading.
  function compareFromCumulative(derived) {
    if (!derived || !Array.isArray(derived.rows)) throw Error('比較データが不正です');
    let previous = km(derived.startKm), previousKnown = previous !== null;
    const legs = derived.rows.map(r => {
      const current = km(r.manualKm);
      const delta = previousKnown && current !== null && current >= previous ?
        Math.round((current - previous) * 1000) / 1000 : null;
      previous = current;
      previousKnown = current !== null;
      return delta;
    });
    return compare(derived, legs);
  }
  function csvCell(value) {
    let text = value === null || value === undefined ? '' : String(value);
    if (/^[\s]*[=+@\-]/.test(text)) text = "'" + text; // Excel formula protection
    return '"' + text.replace(/"/g, '""') + '"';
  }
  function csv(rows) {
    const lines = [['区間', 'GPS区間(km)', '車両実測区間(km)', '車両-GPS(m)', '不足率(%)', '取得時刻(ISO)', '場所']];
    for (const r of rows) lines.push([r.number, r.gpsKm, r.vehicleKm, r.differenceMeters,
      r.differencePercent, r.at ? new Date(r.at).toISOString() : '', r.place]);
    return lines.map(row => row.map(csvCell).join(',')).join('\r\n') + '\r\n';
  }
  return { km, compare, compareFromCumulative, csv };
});
