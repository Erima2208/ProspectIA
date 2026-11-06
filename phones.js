/* Détection / normalisation de numéros — partagé navigateur + Node */
(function (root) {
  function norm(raw) {
    const t = String(raw).trim(); const d = t.replace(/\D/g, '');
    if (!d) return '';
    if (t.startsWith('+')) return d;
    if (d.startsWith('00')) return d.slice(2);
    if (d.length === 10) return '225' + d;
    return d;
  }
  function kind(d) {
    if (d.startsWith('225') && d.length === 13) return ['01', '05', '07'].includes(d.slice(3, 5)) ? 'mobile' : 'fixe';
    if (d.startsWith('221') && d.length === 12) return /^7[05678]/.test(d.slice(3)) ? 'mobile' : 'fixe';
    if (d.length >= 10 && d.length <= 14) return 'tel';
    return '';
  }
  function fmt(d) {
    if (d.startsWith('225') && d.length === 13) return `+225 ${d.slice(3, 5)} ${d.slice(5, 7)} ${d.slice(7, 9)} ${d.slice(9, 11)} ${d.slice(11, 13)}`;
    if (d.startsWith('221') && d.length === 12) return `+221 ${d.slice(3, 5)} ${d.slice(5, 8)} ${d.slice(8, 10)} ${d.slice(10)}`;
    return '+' + d;
  }
  function make(raw) {
    const n = norm(raw); const k = kind(n);
    return k ? { n, kind: k, display: fmt(n) } : null;
  }
  function find(text) {
    const out = new Map(); const s = String(text || '');
    const res = [
      /(?:^|[^\d+])((?:0[157]|2[0-5,7]|3[0-7])(?:[\s.\-]?\d{2}){4})(?!\d)/g,
      /(?:^|[^\d])((?:\+|00)\s?\d{1,3}(?:[\s.()\-]*\d){8,11})(?!\d)/g
    ];
    for (const re of res) {
      let m; while ((m = re.exec(s))) { const p = make(m[1]); if (p && !out.has(p.n)) out.set(p.n, p); }
    }
    return [...out.values()];
  }
  const api = { norm, kind, fmt, make, find };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.PhoneLib = api;
})(typeof self !== 'undefined' ? self : this);
