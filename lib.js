const Phone = require('../phones.js');

const EMAIL_RE = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi;
const BAD_MAIL = /\.(png|jpe?g|gif|svg|webp|css|js|woff2?)$|^(example|test|sentry|noreply|no-reply|user|name|email)@|wixpress|sentry\.|godaddy|domain\.com$/i;
const SOCIALS = {
  linkedin: /https?:\/\/(?:[a-z]{2,3}\.)?linkedin\.com\/(?:company|in)\/[\w\-%.]+/i,
  facebook: /https?:\/\/(?:www\.|m\.)?facebook\.com\/(?!sharer|tr\?|plugins|dialog|share)[\w\-.%]+/i,
  instagram: /https?:\/\/(?:www\.)?instagram\.com\/(?!p\/|explore)[\w\-.]+/i,
  x: /https?:\/\/(?:www\.)?(?:twitter|x)\.com\/(?!intent|share|home)[\w\-.]+/i
};

function stripHtml(h) {
  return h.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>|<!--[\s\S]*?-->/gi, ' ')
    .replace(/<[^>]+>/g, ' ').replace(/&nbsp;|&#160;/g, ' ').replace(/&#64;|\[at\]|\(at\)/gi, '@').replace(/\s+/g, ' ');
}
const meta = (h, n) => {
  const m = h.match(new RegExp(`<meta[^>]+(?:name|property)=["']${n}["'][^>]*content=["']([^"']*)["']`, 'i')) ||
            h.match(new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]*(?:name|property)=["']${n}["']`, 'i'));
  return m ? m[1].trim() : '';
};

function jsonld(h) {
  const out = {};
  const re = /<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi; let m;
  const walk = o => {
    if (!o || typeof o !== 'object') return;
    if (Array.isArray(o)) return o.forEach(walk);
    const t = [].concat(o['@type'] || []).join(' ');
    if (/Organization|LocalBusiness|Corporation|Store|Company/i.test(t)) {
      out.name = out.name || o.name; out.telephone = out.telephone || o.telephone; out.email = out.email || o.email;
      const a = o.address;
      if (a && !out.address) out.address = typeof a === 'string' ? a : [a.streetAddress, a.addressLocality, a.addressCountry && (a.addressCountry.name || a.addressCountry)].filter(Boolean).join(', ');
    }
    Object.values(o).forEach(v => typeof v === 'object' && walk(v));
  };
  while ((m = re.exec(h))) { try { walk(JSON.parse(m[1])); } catch { /* json invalide */ } }
  return out;
}

function extractAll(h) {
  const text = stripHtml(h);
  const tel = [...h.matchAll(/href=["']tel:([^"']+)/gi)].map(x => decodeURIComponent(x[1]));
  const mailto = [...h.matchAll(/href=["']mailto:([^"'?]+)/gi)].map(x => decodeURIComponent(x[1]));
  const wa = [...h.matchAll(/(?:wa\.me\/|api\.whatsapp\.com\/send\/?\?phone=|whatsapp:\/\/send\?phone=)\+?(\d{8,15})/gi)].map(x => x[1]);
  const ld = jsonld(h);
  const phones = new Map();
  [...tel, ...wa.map(w => '+' + w), ld.telephone || '', ...Phone.find(text).map(p => p.display)].forEach(raw => {
    const p = raw && (Phone.find(raw)[0] || Phone.make(raw)); if (p && !phones.has(p.n)) phones.set(p.n, p);
  });
  const emails = [...new Set([...mailto, ld.email || '', ...(text.match(EMAIL_RE) || [])]
    .map(e => String(e).toLowerCase().trim()).filter(e => /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/.test(e) && !BAD_MAIL.test(e)))];
  const socials = {};
  for (const [k, re] of Object.entries(SOCIALS)) { const m = h.match(re); if (m) socials[k] = m[0]; }
  return {
    emails: emails.slice(0, 8), phones: [...phones.values()].slice(0, 8),
    whatsapp: [...new Set(wa)].slice(0, 3), socials,
    title: ((h.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || '').replace(/\s+/g, ' ').trim(),
    description: meta(h, 'description') || meta(h, 'og:description'),
    siteName: meta(h, 'og:site_name'), jsonld: ld
  };
}
module.exports = { extractAll, stripHtml };
