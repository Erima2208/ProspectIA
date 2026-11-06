(() => {
  'use strict';
  const $ = s => document.querySelector(s);
  const LS = { cfg: 'prospectia3_cfg', data: 'prospectia3_prospects', hist: 'prospectia3_history' };
  const STATUS = [['nouveau', 'Nouveau'], ['qualifie', 'Qualifié'], ['contacte', 'Contacté'], ['client', 'Client'], ['sans_suite', 'Sans suite']];
  const EXCLUDE = /(^|\.)(facebook|instagram|linkedin|twitter|x|youtube|tiktok|pinterest|wikipedia|wikimedia|reddit|google)\.(com|org|fr)$/i;
  const DIRECTORY = /annuaire|pagesjaunes|pages-jaunes|yellow|kompass|europages|abidjan\.net|infoentreprises|cybo|goafricaonline|africaindex|societe\.com|tripadvisor|jumia|jiji|expat|coinafrique/i;
  const PRESETS = [
    ['🚜 Engins & BTP', 'location bulldozer, location pelle hydraulique, location engins de chantier'],
    ['⚡ Groupes & inverseurs', 'groupe électrogène, inverseur de source ATS, maintenance groupe électrogène'],
    ['🏗️ Ciment & carrières', 'centrale à béton, carrière granulats, fournisseur ciment'],
    ['❄️ Froid industriel', 'chambre froide industrielle, froid commercial, conteneur frigorifique'],
    ['🚛 Transport & logistique', 'transport lourd, société de logistique, transitaire'],
    ['💧 Forage & pompage', 'forage hydraulique, pompage solaire, château d\'eau'],
    ['🛡️ Sécurité & incendie', 'sécurité incendie, extincteurs, société de gardiennage'],
    ['🏭 Maintenance industrielle', 'maintenance industrielle, coffrets électriques, pièces de rechange']
  ];
  const ZONES = [['Abidjan', 'Abidjan, Côte d\'Ivoire'], ['Cocody', 'Cocody Abidjan'], ['Marcory', 'Marcory Abidjan'], ['Yopougon', 'Yopougon Abidjan'], ['Koumassi', 'Koumassi Abidjan'], ['Bouaké', 'Bouaké Côte d\'Ivoire'], ['San-Pédro', 'San-Pédro Côte d\'Ivoire'], ['Yamoussoukro', 'Yamoussoukro Côte d\'Ivoire'], ['Assinie', 'Assinie Côte d\'Ivoire'], ['Dakar', 'Dakar Sénégal'], ['Ouagadougou', 'Ouagadougou Burkina Faso'], ['Niamey', 'Niamey Niger']];
  const DEF_OFFER = 'Nous proposons :\n- Location et vente de groupes électrogènes (5 à 1500 kVA)\n- Maintenance préventive et curative\n- Pièces de rechange et coffrets inverseurs\n- Solutions de froid commercial et chambres froides';

  const load = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } };
  const stored = load(LS.cfg, {});
  let cfg = { apiKey: '', cxId: '', backendUrl: 'http://localhost:3001', offer: DEF_OFFER, ...stored, sig: { name: '', title: '', company: '', phone: '', email: '', site: '', ...(stored.sig || {}) } };
  let prospects = load(LS.data, []);
  let history = load(LS.hist, []);
  const selected = new Set();
  const offsets = {};
  let volume = 6, queue = [], bulk = false, sending = false, abort = false, scanning = false;

  const save = () => localStorage.setItem(LS.data, JSON.stringify(prospects));
  const saveCfg = () => localStorage.setItem(LS.cfg, JSON.stringify(cfg));
  const saveHist = () => localStorage.setItem(LS.hist, JSON.stringify(history.slice(0, 60)));
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const safeUrl = u => /^https?:\/\//i.test(u || '') ? u : '#';
  const uniq = a => [...new Set(a)];
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const backend = () => cfg.backendUrl.replace(/\/$/, '');
  const domainOf = u => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return u; } };
  const uid = () => (crypto.randomUUID ? crypto.randomUUID() : String(Date.now() + Math.random()));
  const toast = m => { const t = $('#toast'); t.textContent = m; t.classList.remove('hidden'); clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.add('hidden'), 3200); };
  const progress = m => { const p = $('#progress'); p.classList.remove('hidden'); p.textContent = m; };
  const EMAIL_RE = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi;
  const BAD_MAIL = /\.(png|jpe?g|gif|svg|webp|css|js)$|^(example|test|sentry|noreply|no-reply)@|wixpress/i;
  const findEmails = t => uniq((String(t || '').match(EMAIL_RE) || []).map(e => e.toLowerCase()).filter(e => !BAD_MAIL.test(e)));

  // ---------- Score (calculé à partir de signaux réels, pas d'IA) ----------
  function score(p) {
    if (p.type === 'particulier') return 50;
    let s = 35;
    if (p.url) s += 8;
    if (p.phones.some(x => x.kind === 'mobile')) s += 20;
    else if (p.phones.length) s += 10;
    if (p.emails.length) s += 14;
    if (Object.keys(p.socials || {}).length) s += 4;
    if (p.address) s += 5;
    const hay = `${p.name} ${p.snippet} ${p.description || ''}`.toLowerCase();
    const words = (p.keyword || '').toLowerCase().split(/\s+/).filter(w => w.length > 3);
    if (words.length) s += Math.round(12 * words.filter(w => hay.includes(w)).length / words.length);
    if (p.directory) s -= 15;
    return Math.max(5, Math.min(99, s));
  }

  // ---------- Recherche Google (résultats réels) ----------
  async function googleSearch(q, num, start) {
    const url = `https://www.googleapis.com/customsearch/v1?key=${encodeURIComponent(cfg.apiKey)}&cx=${encodeURIComponent(cfg.cxId)}&q=${encodeURIComponent(q)}&num=${num}&start=${start}&hl=fr`;
    const r = await fetch(url); const j = await r.json();
    if (!r.ok) throw new Error(j.error?.message || `Erreur Google ${r.status}`);
    return j.items || [];
  }
  function pickName(it, dom) {
    const meta = (it.pagemap?.metatags || [])[0] || {};
    if (meta['og:site_name']) return meta['og:site_name'].trim();
    const segs = String(it.title || dom).split(/\s[-|–—·»]\s/).map(s => s.trim()).filter(Boolean);
    const sld = dom.split('.').slice(-2, -1)[0] || dom;
    const flat = x => x.toLowerCase().replace(/[^a-z0-9]/g, '');
    const byDom = segs.find(s => flat(s).includes(flat(sld)) && flat(sld).length > 2);
    return byDom || (segs.length > 1 && segs[segs.length - 1].length <= 40 ? segs[segs.length - 1] : segs[0]) || dom;
  }
  function fromResult(it, kw, zone) {
    const dom = domainOf(it.link);
    const meta = (it.pagemap?.metatags || [])[0] || {};
    const text = `${it.title}. ${it.snippet || ''} ${meta['og:description'] || ''}`;
    const p = {
      id: uid(), type: 'entreprise', name: pickName(it, dom), url: it.link, domain: dom,
      snippet: (it.snippet || '').replace(/\s+/g, ' '), description: meta['og:description'] || '', keyword: kw, zone,
      emails: findEmails(text), phones: PhoneLib.find(text), socials: {}, address: '', directory: DIRECTORY.test(dom),
      status: 'nouveau', notes: '', date: new Date().toISOString(), source: 'google'
    };
    p.score = score(p); return p;
  }
  async function audit(p) {
    const r = await fetch(`${backend()}/scrape`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url: p.url }) });
    if (!r.ok) throw new Error('Backend ' + r.status);
    const d = await r.json();
    p.emails = uniq([...p.emails, ...(d.emails || [])]);
    const seen = new Set(p.phones.map(x => x.n));
    (d.phones || []).forEach(x => { if (!seen.has(x.n)) { seen.add(x.n); p.phones.push(x); } });
    p.socials = { ...p.socials, ...(d.socials || {}) };
    p.address = p.address || d.jsonld?.address || '';
    p.description = p.description || d.description || '';
    if (d.jsonld?.name && p.name.length < 3) p.name = d.jsonld.name;
    p.audited = true; p.score = score(p);
  }

  async function runScan(next) {
    if (scanning) return;
    if (!cfg.apiKey || !cfg.cxId) { openModal('#mSettings'); return toast('Renseignez la clé Google et le CX.'); }
    const kws = $('#keywords').value.split(/[,\n]/).map(s => s.trim()).filter(Boolean);
    if (!kws.length) return toast('Saisissez au moins un mot-clé.');
    const zoneTxt = $('#zone').value.trim(), deep = $('#deep').checked;
    scanning = true; $('#btnScan').disabled = $('#btnNext').disabled = true;
    let found = 0, added = 0, backendOff = false; const fresh = [];
    try {
      for (let i = 0; i < kws.length; i++) {
        const key = `${kws[i]}|${zoneTxt}`; const start = next ? (offsets[key] || 1) : 1;
        progress(`🔎 (${i + 1}/${kws.length}) « ${kws[i]} » — ${zoneTxt}…`);
        let items;
        try { items = await googleSearch(`${kws[i]} ${zoneTxt}`, Math.min(volume, 10), Math.min(start, 91)); }
        catch (e) { progress('❌ ' + e.message); if (/quota|limit|exceeded/i.test(e.message)) break; continue; }
        offsets[key] = start + volume;
        for (const it of items) {
          found++; const dom = domainOf(it.link);
          if (EXCLUDE.test(dom)) continue;
          if (prospects.some(p => p.domain === dom) || fresh.some(p => p.domain === dom)) continue;
          fresh.push(fromResult(it, kws[i], zoneTxt));
        }
      }
      if (deep) {
        let n = 0; const todo = fresh.filter(p => !p.directory);
        const pool = async () => {
          while (todo.length) {
            const p = todo.shift(); progress(`🔬 Audit ${++n}/${n + todo.length} — ${p.domain}`);
            if (backendOff) continue;
            try { await audit(p); } catch (e) { if (/fetch|Failed|Backend/i.test(e.message)) backendOff = true; }
          }
        };
        await Promise.all([pool(), pool(), pool()]);
        if (backendOff) toast('Backend injoignable : audit approfondi ignoré.');
      }
      fresh.forEach(p => { p.score = score(p); prospects.unshift(p); added++; });
      save();
      history.unshift({ id: uid(), date: new Date().toISOString(), keywords: kws.join(', '), zone: zoneTxt, found, added });
      saveHist(); render();
      progress(`✅ ${found} résultat(s) Google · ${added} nouveau(x) prospect(s) ajouté(s).`);
    } finally { scanning = false; $('#btnScan').disabled = $('#btnNext').disabled = false; }
  }

  // ---------- Dérivés ----------
  const mobiles = p => p.phones.filter(x => x.kind === 'mobile');
  const waLinks = p => uniq([...mobiles(p).map(x => x.n)]);
  function waText(p) {
    const s = cfg.sig;
    return `Bonjour, ici ${s.name || 'notre équipe'}${s.company ? ' de ' + s.company : ''}. Je vous contacte au sujet de ${p.name} (${p.keyword}). Seriez-vous disponible pour un échange rapide ? Merci.`;
  }
  function tpl() {
    return { subject: 'Proposition de services — {{secteur}}', body: `Bonjour,\n\nJe me permets de vous contacter concernant les activités de {{entreprise}} dans le domaine « {{secteur}} ».\n\n${cfg.offer}\n\nSeriez-vous disponible pour un échange rapide cette semaine ?\n\nCordialement,` };
  }
  const fill = (t, p) => t.replace(/\{\{entreprise\}\}/gi, p.name).replace(/\{\{secteur\}\}/gi, p.keyword || 'votre secteur');
  function signature() {
    const s = cfg.sig; if (!s.name) return { html: '', text: '' };
    let site = s.site; if (site && !/^https?:\/\//i.test(site)) site = 'https://' + site;
    const row = (i, v) => v ? `<div style="color:#475569;font-size:12px;margin-top:3px">${i} ${esc(v)}</div>` : '';
    const html = `<table cellpadding="0" cellspacing="0" style="margin-top:20px;font-family:Arial,sans-serif"><tr><td style="width:4px;background-color:#6366f1;background-image:linear-gradient(180deg,#6366f1,#ec4899,#f59e0b)"></td><td style="padding-left:12px"><div style="font-weight:700;font-size:15px;color:#1e293b">${esc(s.name)}</div>${s.title ? `<div style="color:#6366f1;font-size:13px;font-weight:600">${esc(s.title)}${s.company ? ' · ' + esc(s.company) : ''}</div>` : (s.company ? `<div style="color:#6366f1;font-size:13px;font-weight:600">${esc(s.company)}</div>` : '')}${row('📞', s.phone)}${row('✉️', s.email)}${site ? `<div style="margin-top:3px;font-size:12px"><a href="${esc(site)}" style="color:#ec4899;text-decoration:none">${esc(site)}</a></div>` : ''}</td></tr></table>`;
    return { html, text: '\n\n--\n' + [s.name, [s.title, s.company].filter(Boolean).join(' · '), s.phone, s.email, site].filter(Boolean).join('\n') };
  }

  // ---------- Rendu ----------
  function visible() {
    const t = $('#fText').value.toLowerCase(), ty = $('#fType').value, st = $('#fStatus').value, ch = $('#fChannel').value, so = $('#fSort').value;
    const l = prospects.filter(p => (!ty || p.type === ty) && (!st || p.status === st) &&
      (!t || [p.name, p.domain, p.keyword, p.snippet, ...p.emails, ...p.phones.map(x => x.display)].join(' ').toLowerCase().includes(t)) &&
      (!ch || (ch === 'wa' ? mobiles(p).length : ch === 'mail' ? p.emails.length && !p.phones.length : p.phones.length)));
    return l.sort((a, b) => so === 'name' ? a.name.localeCompare(b.name) : so === 'recent' ? b.date.localeCompare(a.date) : b.score - a.score);
  }
  function renderStats() {
    const n = prospects.length, mob = prospects.filter(p => mobiles(p).length).length, mail = prospects.filter(p => p.emails.length).length, hi = prospects.filter(p => p.score >= 70).length;
    const c = (t, ic, cl, v, s) => `<div class="stat"><div class="t"><span>${t}</span><span class="ic ${cl}">${ic}</span></div><div class="n">${v}</div><div class="s">${s}</div></div>`;
    $('#statCards').innerHTML =
      c('Total prospects', '👥', 'i-ind', n, `${prospects.filter(p => p.type === 'entreprise').length} entreprises · ${prospects.filter(p => p.type === 'particulier').length} particuliers`) +
      c('Mobiles & WhatsApp', '💬', 'i-em', mob, 'numéros mobiles réellement trouvés') +
      c('Avec email', '✉️', 'i-sky', mail, 'adresses publiques trouvées') +
      c('Score ≥ 70', '⭐', 'i-amb', hi, `${prospects.filter(p => p.status === 'contacte').length} contactés · ${prospects.filter(p => p.status === 'client').length} clients`);
    const cnt = Object.fromEntries(STATUS.map(([k]) => [k, prospects.filter(p => p.status === k).length]));
    $('#pipeline').innerHTML = `<div class="pipe-h"><b>Répartition par statut</b><span>Pipeline commercial</span></div>
      <div class="bar">${STATUS.map(([k]) => `<i class="c-${k}" style="width:${n ? cnt[k] / n * 100 : 0}%"></i>`).join('')}</div>
      <div class="legend">${STATUS.map(([k, l]) => `<div><b>${cnt[k]}</b>${l}</div>`).join('')}</div>`;
    $('#countBadge').textContent = n; $('#histCount').textContent = history.length;
  }
  function card(p, i) {
    const mob = mobiles(p), oth = p.phones.filter(x => x.kind !== 'mobile');
    const soc = Object.entries(p.socials || {}).filter(([, u]) => /^https?:/.test(u));
    const tier = p.score >= 75 ? 'hi' : p.score >= 55 ? 'mid' : 'lo';
    const lines = [
      ...mob.map(x => `<div class="cl">📱 <b>${esc(x.display)}</b> <a class="wa" target="_blank" rel="noopener" href="https://wa.me/${x.n}?text=${encodeURIComponent(waText(p))}">WhatsApp</a></div>`),
      ...oth.map(x => `<div class="cl">☎️ <a href="tel:+${x.n}">${esc(x.display)}</a></div>`),
      ...p.emails.map(e => `<div class="cl">✉️ <a href="mailto:${esc(e)}">${esc(e)}</a></div>`),
      soc.length ? `<div class="cl soc">${soc.map(([k, u]) => `<a target="_blank" rel="noopener noreferrer" href="${esc(u)}">${esc(k)}</a>`).join('')}</div>` : ''
    ].filter(Boolean).join('') || `<div class="none">Aucun contact public trouvé${p.audited ? ' sur le site' : ' — activez l\'audit approfondi'}.</div>`;
    return `<article class="card st-${p.status} ${selected.has(p.id) ? 'sel' : ''}" data-id="${p.id}" style="animation-delay:${Math.min(i, 10) * 40}ms">
      <div class="ct-top"><input type="checkbox" data-a="sel" ${selected.has(p.id) ? 'checked' : ''} aria-label="Sélectionner">
        <div class="grow"><div class="badges"><span class="badge ${p.type === 'particulier' ? 'part' : ''}">${p.type === 'particulier' ? 'Particulier' : 'Entreprise / B2B'}</span>${p.keyword ? `<span class="badge kw">🔎 ${esc(p.keyword)}</span>` : ''}${p.directory ? '<span class="badge warn" title="Page d\'annuaire : les contacts peuvent ne pas être ceux de l\'entreprise">Annuaire</span>' : ''}</div>
        <h3>${esc(p.name)}</h3>${p.url ? `<a class="site" target="_blank" rel="noopener noreferrer" href="${esc(safeUrl(p.url))}">${esc(p.domain)} ↗</a>` : ''}</div>
        <div class="score s-${tier}" title="Score calculé : site, mobile, email, pertinence du mot-clé, réseaux">${p.score}<small>Score</small></div></div>
      ${p.address ? `<p class="addr">📍 ${esc(p.address)}</p>` : ''}
      ${p.snippet ? `<p class="snip">${esc(p.snippet)}</p>` : ''}
      <div class="contacts">${lines}</div>
      <div class="st-row">${STATUS.map(([k, l]) => `<button data-a="st" data-v="${k}" class="${p.status === k ? 'on ' + k : ''}">${l}</button>`).join('')}</div>
      <div class="acts">${p.emails.length ? '<button class="mail" data-a="mail">✉️ Email</button>' : ''}${mob.length ? `<button data-a="wa">💬 WhatsApp</button>` : ''}<button data-a="note">📝 ${p.notes ? 'Note ✓' : 'Note'}</button><button class="del" data-a="del">✕</button></div></article>`;
  }
  function updateBulk() {
    const n = prospects.filter(p => selected.has(p.id) && p.emails.length).length;
    $('#btnBulk').textContent = `📨 Envoi groupé (${n})`; $('#btnBulk').disabled = !n;
  }
  function render() {
    renderStats();
    const l = visible();
    $('#results').innerHTML = l.length ? l.map(card).join('') : '<div class="empty">Aucun prospect. Choisissez un secteur, une zone et lancez le scan 🚀</div>';
    updateBulk();
  }

  // ---------- Événements liste ----------
  $('#results').addEventListener('click', e => {
    const b = e.target.closest('[data-a]'); if (!b) return;
    const p = prospects.find(x => x.id === b.closest('.card').dataset.id); if (!p) return;
    const a = b.dataset.a;
    if (a === 'sel') { b.checked ? selected.add(p.id) : selected.delete(p.id); b.closest('.card').classList.toggle('sel', b.checked); updateBulk(); return; }
    if (a === 'st') { p.status = b.dataset.v; save(); render(); }
    if (a === 'del') { prospects = prospects.filter(x => x !== p); selected.delete(p.id); save(); render(); }
    if (a === 'note') { const n = prompt('Note pour ' + p.name, p.notes || ''); if (n !== null) { p.notes = n.trim(); save(); render(); } }
    if (a === 'wa') { const m = mobiles(p)[0]; window.open(`https://wa.me/${m.n}?text=${encodeURIComponent(waText(p))}`, '_blank', 'noopener'); if (p.status === 'nouveau') { p.status = 'contacte'; save(); render(); } }
    if (a === 'mail') openMail([p], false);
  });
  ['#fText', '#fType', '#fStatus', '#fChannel', '#fSort'].forEach(s => $(s).addEventListener('input', render));
  $('#fStatus').innerHTML += STATUS.map(([k, l]) => `<option value="${k}">${l}</option>`).join('');
  $('#selAll').onchange = e => { visible().filter(p => p.emails.length).forEach(p => e.target.checked ? selected.add(p.id) : selected.delete(p.id)); render(); };
  $('#btnClear').onclick = () => { if (prospects.length && confirm('Vider toute la liste ?')) { prospects = []; selected.clear(); save(); render(); } };
  $('#btnReset').onclick = () => { if (confirm('Réinitialiser prospects, historique et réglages ?')) { Object.values(LS).forEach(k => localStorage.removeItem(k)); location.reload(); } };

  // ---------- Scanner UI ----------
  $('#presets').innerHTML = PRESETS.map(([l, k]) => `<button data-k="${esc(k)}">${l}</button>`).join('');
  $('#presets').onclick = e => { const b = e.target.closest('[data-k]'); if (b) $('#keywords').value = b.dataset.k; };
  $('#zones').innerHTML = ZONES.map(([l, q]) => `<button data-z="${esc(q)}">${l}</button>`).join('');
  $('#zones').onclick = e => { const b = e.target.closest('[data-z]'); if (b) $('#zone').value = b.dataset.z; };
  $('#volume').onclick = e => { const b = e.target.closest('[data-v]'); if (!b) return; volume = +b.dataset.v; [...$('#volume').children].forEach(x => x.classList.toggle('on', x === b)); };
  $('#btnScan').onclick = () => runScan(false);
  $('#btnNext').onclick = () => runScan(true);

  // ---------- Modales ----------
  const openModal = s => $(s).classList.remove('hidden');
  const closeModals = () => { if (!sending) document.querySelectorAll('.modal').forEach(m => m.classList.add('hidden')); };
  document.querySelectorAll('.modal').forEach(m => m.addEventListener('click', ev => { if (ev.target === m || ev.target.hasAttribute('data-close')) closeModals(); }));
  document.addEventListener('keydown', ev => { if (ev.key === 'Escape') closeModals(); });

  $('#btnSettings').onclick = () => { $('#apiKey').value = cfg.apiKey; $('#cxId').value = cfg.cxId; $('#backendUrl').value = cfg.backendUrl; openModal('#mSettings'); };
  $('#btnSig').onclick = () => { ['Name', 'Title', 'Company', 'Phone', 'Email', 'Site'].forEach(k => $('#sig' + k).value = cfg.sig[k.toLowerCase()] || ''); $('#offer').value = cfg.offer; openModal('#mSig'); };
  document.querySelector('[data-save="settings"]').onclick = () => { cfg.apiKey = $('#apiKey').value.trim(); cfg.cxId = $('#cxId').value.trim(); cfg.backendUrl = $('#backendUrl').value.trim() || 'http://localhost:3001'; saveCfg(); closeModals(); toast('Paramètres enregistrés'); ping(); };
  document.querySelector('[data-save="sig"]').onclick = () => { ['Name', 'Title', 'Company', 'Phone', 'Email', 'Site'].forEach(k => cfg.sig[k.toLowerCase()] = $('#sig' + k).value.trim()); cfg.offer = $('#offer').value.trim() || DEF_OFFER; saveCfg(); closeModals(); toast('Signature enregistrée'); };

  $('#btnHistory').onclick = () => {
    $('#histList').innerHTML = history.length ? history.map(h => `<div class="hi"><div><b>${esc(h.keywords)}</b><br><small>${esc(h.zone)} · ${new Date(h.date).toLocaleString('fr-FR')} · ${h.found} résultats · ${h.added} ajoutés</small></div><button data-h="${h.id}">Relancer</button></div>`).join('') : '<p class="muted">Aucun scan pour le moment.</p>';
    openModal('#mHist');
  };
  $('#histList').onclick = e => { const b = e.target.closest('[data-h]'); if (!b) return; const h = history.find(x => x.id === b.dataset.h); if (h) { $('#keywords').value = h.keywords; $('#zone').value = h.zone; closeModals(); toast('Recherche rechargée — cliquez sur « Lancer le scan »'); } };
  $('#btnHistClear').onclick = () => { history = []; saveHist(); renderStats(); $('#histList').innerHTML = ''; };

  $('#btnAdd').onclick = () => { ['aName', 'aPhone', 'aEmail', 'aSite', 'aKw'].forEach(i => $('#' + i).value = ''); openModal('#mAdd'); };
  $('#btnAddOk').onclick = () => {
    const name = $('#aName').value.trim(); if (!name) return toast('Le nom est requis.');
    let site = $('#aSite').value.trim(); if (site && !/^https?:\/\//i.test(site)) site = 'https://' + site;
    const p = { id: uid(), type: $('#aType').value, name, url: site, domain: site ? domainOf(site) : '', snippet: '', description: '', keyword: $('#aKw').value.trim(), zone: '', emails: findEmails($('#aEmail').value), phones: PhoneLib.find($('#aPhone').value), socials: {}, address: '', directory: false, status: 'nouveau', notes: '', date: new Date().toISOString(), source: 'manuel' };
    p.score = score(p); prospects.unshift(p); save(); closeModals(); render();
  };

  // ---------- Email ----------
  function openMail(list, isBulk) {
    queue = list; bulk = isBulk; abort = false; const t = tpl();
    $('#mailTitle').textContent = isBulk ? '📨 Envoi groupé' : '✉️ Envoyer un email';
    $('#mailTo').textContent = isBulk ? `${list.length} destinataire(s) — un email individuel chacun (1ʳᵉ adresse trouvée)` : `À : ${list[0].emails[0]} — ${list[0].name}`;
    $('#mailSubject').value = t.subject; $('#mailBody').value = t.body;
    $('#delayWrap').classList.toggle('hidden', !isBulk); $('#mailStatus').classList.add('hidden'); $('#btnMailCancel').textContent = 'Annuler';
    openModal('#mMail');
  }
  $('#btnBulk').onclick = () => { const l = prospects.filter(p => selected.has(p.id) && p.emails.length); if (l.length) openMail(l, true); };
  $('#btnMailCancel').onclick = () => { if (sending) abort = true; else closeModals(); };
  async function sendOne(p, subject, body, sig) {
    const b = fill(body, p);
    const html = `<div style="font-family:Arial,sans-serif;font-size:14px;line-height:1.6;color:#1e293b">${esc(b).replace(/\n/g, '<br>')}</div>${sig.html}`;
    const r = await fetch(`${backend()}/send-email`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ to: p.emails[0], subject: fill(subject, p), body: b + sig.text, html }) });
    const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.error || 'Erreur ' + r.status);
    if (p.status === 'nouveau' || p.status === 'qualifie') p.status = 'contacte'; save(); render();
  }
  $('#btnSend').onclick = async () => {
    if (sending || !queue.length) return;
    const subject = $('#mailSubject').value.trim(), body = $('#mailBody').value; if (!subject || !body.trim()) return;
    if (bulk && !confirm(`Envoyer ${queue.length} email(s) ?`)) return;
    const st = $('#mailStatus'); st.classList.remove('hidden');
    const sig = signature(), delay = Math.max(5, +$('#mailDelay').value || 20); let ok = 0, fail = 0;
    sending = true; abort = false; $('#btnSend').disabled = true; if (bulk) $('#btnMailCancel').textContent = '⏹ Arrêter';
    for (let i = 0; i < queue.length && !abort; i++) {
      st.textContent = `📤 ${i + 1}/${queue.length} → ${queue[i].emails[0]}`;
      try { await sendOne(queue[i], subject, body, sig); ok++; selected.delete(queue[i].id); } catch (e) { fail++; st.textContent = '❌ ' + e.message; if (!bulk) break; await sleep(1500); }
      if (bulk && i < queue.length - 1) for (let s = delay; s > 0 && !abort; s--) { st.textContent = `✅ ${ok} envoyé(s) · ❌ ${fail} · prochain dans ${s}s (${i + 2}/${queue.length})`; await sleep(1000); }
    }
    if (!(fail && !bulk)) st.textContent = `${abort ? '⏹ Arrêté' : '🎉 Terminé'} — ${ok} envoyé(s), ${fail} échec(s).`;
    sending = false; $('#btnSend').disabled = false; $('#btnMailCancel').textContent = 'Fermer'; render();
  };

  // ---------- Exports / import ----------
  const dl = (blob, name) => { const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000); };
  $('#btnCsv').onclick = () => {
    if (!prospects.length) return toast('Aucun prospect à exporter.');
    const q = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const rows = [['Nom', 'Site', 'Emails', 'Téléphones', 'Mot-clé', 'Zone', 'Score', 'Statut', 'Type', 'Adresse', 'Notes']].concat(prospects.map(p => [p.name, p.url, p.emails.join(' | '), p.phones.map(x => x.display).join(' | '), p.keyword, p.zone, p.score, p.status, p.type, p.address, p.notes]));
    dl(new Blob(['\ufeff' + rows.map(r => r.map(q).join(';')).join('\n')], { type: 'text/csv;charset=utf-8' }), `prospects_${new Date().toISOString().slice(0, 10)}.csv`);
  };
  function parseCsv(t) {
    const d = (t.split('\n')[0].match(/;/g) || []).length >= (t.split('\n')[0].match(/,/g) || []).length ? ';' : ',';
    const rows = []; let r = [], c = '', q = false;
    for (let i = 0; i < t.length; i++) {
      const ch = t[i];
      if (q) { if (ch === '"') { if (t[i + 1] === '"') { c += '"'; i++; } else q = false; } else c += ch; }
      else if (ch === '"') q = true; else if (ch === d) { r.push(c); c = ''; } else if (ch === '\n') { r.push(c); rows.push(r); r = []; c = ''; } else if (ch !== '\r') c += ch;
    }
    if (c || r.length) { r.push(c); rows.push(r); } return rows;
  }
  $('#importFile').onchange = async e => {
    const f = e.target.files[0]; if (!f) return;
    const rows = parseCsv((await f.text()).replace(/^\ufeff/, '')); const h = rows.shift().map(x => x.trim().toLowerCase()); const ix = n => h.findIndex(x => x.startsWith(n));
    let n = 0;
    rows.forEach(r => {
      const name = r[ix('nom')]; if (!name) return; const site = r[ix('site')] || '';
      const p = { id: uid(), type: (r[ix('type')] || 'entreprise').toLowerCase().startsWith('part') ? 'particulier' : 'entreprise', name, url: site, domain: site ? domainOf(site) : '', snippet: '', description: '', keyword: r[ix('mot')] || '', zone: r[ix('zone')] || '', emails: findEmails(r[ix('email')]), phones: PhoneLib.find((r[ix('t')] || '').replace(/\|/g, ' ; ')), socials: {}, address: r[ix('adresse')] || '', directory: false, status: STATUS.some(s => s[0] === r[ix('statut')]) ? r[ix('statut')] : 'nouveau', notes: r[ix('notes')] || '', date: new Date().toISOString(), source: 'csv' };
      if (site && prospects.some(x => x.domain === p.domain)) return;
      p.score = score(p); prospects.push(p); n++;
    });
    save(); render(); toast(`${n} prospect(s) importé(s)`); e.target.value = '';
  };
  async function exportDocx(list) {
    if (!list.length) return toast('Aucun prospect à exporter.');
    try {
      const payload = list.map(p => ({ name: p.name, url: p.url, keyword: p.keyword, address: p.address, mobiles: mobiles(p).map(x => x.display), others: p.phones.filter(x => x.kind !== 'mobile').map(x => x.display), emails: p.emails, socials: Object.values(p.socials || {}), score: p.score, status: p.status, notes: p.notes, phones: p.phones.map(x => x.display) }));
      const r = await fetch(`${backend()}/export-docx`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: 'Rapport de prospection ProspectIA', prospects: payload }) });
      if (!r.ok) throw new Error('Backend ' + r.status);
      dl(await r.blob(), `prospection_${new Date().toISOString().slice(0, 10)}.docx`);
    } catch { toast('Export .DOCX impossible : lancez le backend (npm start).'); }
  }
  $('#btnDocx').onclick = () => exportDocx(prospects);
  $('#btnDocxSel').onclick = () => exportDocx(selected.size ? prospects.filter(p => selected.has(p.id)) : visible());

  // ---------- Statut moteur ----------
  async function ping() {
    const el = $('#engine'); const set = (c, t) => { el.className = 'pill ' + c; el.innerHTML = `<i class="dot"></i><span>${t}</span>`; };
    const g = cfg.apiKey && cfg.cxId; let be = false;
    try { be = (await fetch(`${backend()}/health`, { cache: 'no-store' })).ok; } catch { /* hors ligne */ }
    if (g && be) set('ok', 'Moteur en ligne'); else if (g) set('warn', 'Backend hors ligne'); else set('bad', 'Clé Google requise');
  }

  $('#keywords').value = 'forage hydraulique, pompage solaire, château d\'eau';
  render(); ping();
})();
