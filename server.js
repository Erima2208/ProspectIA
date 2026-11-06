require('dotenv').config();
const express = require('express');
const cors = require('cors');
const nodemailer = require('nodemailer');
const dns = require('dns').promises;
const net = require('net');
const { extractAll } = require('./lib');

const app = express();
app.use(cors({ origin: process.env.ALLOWED_ORIGIN || '*' }));
app.use(express.json({ limit: '5mb' }));

function isPrivate(ip) {
  return /^(10\.|127\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|0\.)/.test(ip) || ip === '::1' || /^f[cd]/i.test(ip) || /^fe80/i.test(ip);
}
async function safeUrl(u) {
  const url = new URL(u);
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Protocole refusé');
  if (net.isIP(url.hostname)) { if (isPrivate(url.hostname)) throw new Error('Hôte privé refusé'); }
  else { const { address } = await dns.lookup(url.hostname); if (isPrivate(address)) throw new Error('Hôte privé refusé'); }
  return url;
}
async function getHtml(u) {
  const url = await safeUrl(u);
  const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), 8000);
  try {
    const r = await fetch(url, { signal: ctrl.signal, redirect: 'follow', headers: { 'User-Agent': 'Mozilla/5.0 (compatible; ProspectIA/2.0)', 'Accept-Language': 'fr' } });
    if (!r.ok || !/text\/html/.test(r.headers.get('content-type') || '')) return '';
    return (await r.text()).slice(0, 1_500_000);
  } finally { clearTimeout(t); }
}

// Audit d'un site : page d'accueil + pages contact. Ne retourne que ce qui est réellement trouvé.
app.post('/scrape', async (req, res) => {
  try {
    const base = await safeUrl(req.body.url);
    const paths = ['', '/contact', '/contact-us', '/contactez-nous', '/nous-contacter', '/a-propos', '/about'];
    const merged = { emails: [], phones: [], whatsapp: [], socials: {}, title: '', description: '', siteName: '', jsonld: {}, pages: 0 };
    const seen = new Set();
    for (const p of paths) {
      let html = '';
      try { html = await getHtml(new URL(p, base).href); } catch { continue; }
      if (!html) continue;
      const x = extractAll(html); merged.pages++;
      x.emails.forEach(e => !merged.emails.includes(e) && merged.emails.push(e));
      x.phones.forEach(ph => !seen.has(ph.n) && (seen.add(ph.n), merged.phones.push(ph)));
      x.whatsapp.forEach(w => !merged.whatsapp.includes(w) && merged.whatsapp.push(w));
      Object.assign(merged.socials, Object.fromEntries(Object.entries(x.socials).filter(([k]) => !merged.socials[k])));
      merged.title = merged.title || x.title; merged.description = merged.description || x.description;
      merged.siteName = merged.siteName || x.siteName;
      merged.jsonld = { ...x.jsonld, ...merged.jsonld };
    }
    merged.emails = merged.emails.slice(0, 8); merged.phones = merged.phones.slice(0, 8);
    res.json(merged);
  } catch (e) { res.status(400).json({ error: e.message }); }
});

let transporter;
function mailer() {
  if (!transporter) {
    const port = +process.env.SMTP_PORT || 465;
    transporter = nodemailer.createTransport({ host: process.env.SMTP_HOST, port, secure: port === 465, auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } });
  }
  return transporter;
}
app.post('/send-email', async (req, res) => {
  const { to, subject, body, html } = req.body || {};
  if (!to || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to) || !subject || !body) return res.status(400).json({ error: 'Champs invalides' });
  if (!process.env.SMTP_HOST || !process.env.SMTP_USER) return res.status(500).json({ error: 'SMTP non configuré (.env)' });
  try {
    await mailer().sendMail({ from: `"${process.env.FROM_NAME || 'ProspectIA'}" <${process.env.SMTP_USER}>`, to, subject, text: body, html: html || undefined });
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Rapport Word (.docx) des prospects fournis
app.post('/export-docx', async (req, res) => {
  try {
    const { Document, Packer, Paragraph, TextRun, HeadingLevel, Table, TableRow, TableCell, WidthType, ShadingType } = require('docx');
    const list = Array.isArray(req.body.prospects) ? req.body.prospects.slice(0, 500) : [];
    const title = String(req.body.title || 'Rapport de prospection');
    const cell = (t, o = {}) => new TableCell({
      width: { size: o.w || 25, type: WidthType.PERCENTAGE },
      shading: o.head ? { type: ShadingType.CLEAR, fill: '4F46E5', color: 'auto' } : undefined,
      children: [new Paragraph({ children: [new TextRun({ text: String(t ?? ''), bold: !!o.head, color: o.head ? 'FFFFFF' : '1E293B', size: 18 })] })]
    });
    const line = (label, v) => v ? new Paragraph({ children: [new TextRun({ text: label + ' : ', bold: true }), new TextRun(String(v))] }) : null;
    const rows = [new TableRow({ tableHeader: true, children: [cell('Entreprise', { head: 1, w: 30 }), cell('Contacts', { head: 1, w: 40 }), cell('Score', { head: 1, w: 10 }), cell('Statut', { head: 1, w: 20 })] })]
      .concat(list.map(p => new TableRow({ children: [cell(p.name, { w: 30 }), cell([...(p.phones || []), ...(p.emails || [])].join('\n'), { w: 40 }), cell(p.score, { w: 10 }), cell(p.status, { w: 20 })] })));
    const details = list.flatMap(p => [
      new Paragraph({ text: p.name || 'Sans nom', heading: HeadingLevel.HEADING_2, spacing: { before: 280 } }),
      line('Site', p.url), line('Mot-clé', p.keyword), line('Adresse', p.address),
      line('Mobiles', (p.mobiles || []).join(', ')), line('Autres téléphones', (p.others || []).join(', ')),
      line('Emails', (p.emails || []).join(', ')), line('Réseaux', (p.socials || []).join(', ')),
      line('Score / statut', `${p.score} — ${p.status}`), line('Notes', p.notes)
    ].filter(Boolean));
    const doc = new Document({ sections: [{ children: [
      new Paragraph({ text: title, heading: HeadingLevel.TITLE }),
      new Paragraph({ children: [new TextRun({ text: `Généré le ${new Date().toLocaleDateString('fr-FR')} — ${list.length} prospect(s)`, color: '64748B' })] }),
      new Paragraph({ text: '' }), new Table({ rows, width: { size: 100, type: WidthType.PERCENTAGE } }), ...details
    ] }] });
    const buf = await Packer.toBuffer(doc);
    res.set({ 'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'Content-Disposition': 'attachment; filename="prospects.docx"' });
    res.send(buf);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/health', (_, res) => res.json({ ok: true, smtp: !!process.env.SMTP_HOST }));
const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`ProspectIA backend → http://localhost:${PORT}`));
