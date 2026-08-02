// ─── Source : TED Europa v3 ────────────────────────────────────────────────────
// POST https://api.ted.europa.eu/v3/notices/search
// Champs validés : query (string, format expert), fields (array), page (int), limit (int ≤250)
// scope: 'ALL' | 'ACTIVE', paginationMode: 'PAGE_NUMBER'
// Date format dans query : PD>=YYYYMMDD (sans tirets, sans crochets)
// TI = objet multilangue {fra, eng, nld, ...}   CY = array ['BEL']

import fetch from 'node-fetch';
import { log } from '../logger.js';

const TED_SEARCH = 'https://api.ted.europa.eu/v3/notices/search';
const TED_HEADERS = { 'Content-Type': 'application/json', 'Accept': 'application/json' };

const CPV_CATEGORY = {
  '90': 'Nettoyage', '45': 'Maçonnerie / BTP', '77': 'Jardinage / Espaces verts',
  '50': 'Réparation / Maintenance', '31': 'Électricité', '51': 'Installation électrique',
  '60': 'Transport / Déménagement', '71': 'Architecture / Ingénierie',
  '72': 'Informatique / IT', '98': 'Services aux particuliers',
};

const KEYWORD_MAP = [
  ['nettoyage','Nettoyage'], ['cleaning','Nettoyage'], ['entretien','Nettoyage'],
  ['plomberie','Plomberie'], ['sanitaire','Plomberie'],
  ['jardinage','Jardinage / Espaces verts'], ['espaces verts','Jardinage / Espaces verts'],
  ['électric','Électricité'], ['electric','Électricité'],
  ['maçonnerie','Maçonnerie / BTP'], ['construction','Maçonnerie / BTP'], ['travaux','Maçonnerie / BTP'],
  ['transport','Transport / Déménagement'], ['déménagement','Transport / Déménagement'],
  ['informatique','Informatique / IT'], ['maintenance','Réparation / Maintenance'],
];

/** YYYYMMDD sans tirets — format requis par l'expert query TED */
function yyyymmdd(d = new Date()) {
  return d.toISOString().split('T')[0].replace(/-/g, '');
}

function guessCategory(cpvCodes = [], title = '') {
  for (const code of cpvCodes) {
    const p = String(code).substring(0, 2);
    if (CPV_CATEGORY[p]) return CPV_CATEGORY[p];
  }
  const lower = title.toLowerCase();
  for (const [kw, cat] of KEYWORD_MAP) if (lower.includes(kw)) return cat;
  return 'Services généraux';
}

function safeDate(val) {
  if (!val) return null;
  try { const d = new Date(String(val)); return isNaN(d.getTime()) ? null : d.toISOString(); }
  catch { return null; }
}

function extractTitle(ti) {
  if (!ti) return null;
  if (typeof ti === 'string') return ti;
  if (Array.isArray(ti)) return ti[0] ?? null;
  return ti.fra ?? ti.fre ?? ti.eng ?? ti.nld ?? ti.deu ?? Object.values(ti)[0] ?? null;
}

async function tedPost(query, limit = 50) {
  const body = {
    query,
    fields: ['ND', 'TI', 'CY', 'PC', 'PD'],
    page: 1,
    limit,
    scope: 'ALL',
    paginationMode: 'PAGE_NUMBER',
    onlyLatestVersions: false,
  };
  const res = await fetch(TED_SEARCH, {
    method: 'POST',
    headers: TED_HEADERS,
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30000),
  });
  if (!res.ok) {
    const msg = await res.text();
    throw new Error(`TED HTTP ${res.status}: ${msg.substring(0, 200)}`);
  }
  return res.json();
}

export async function fetchTEDOpportunities() {
  const since = yyyymmdd(new Date(Date.now() - 30 * 24 * 60 * 60 * 1000));
  const query = `(CY=BEL OR CY=FRA OR CY=LUX OR CY=NLD) AND PD>=${since}`;

  log('info', '[TED] Appel API v3', { query });

  let data;
  try {
    data = await tedPost(query, 50);
  } catch (err) {
    log('error', '[TED] Erreur principale', { error: err.message });
    // Fallback : sans filtre date
    try {
      data = await tedPost('CY=BEL OR CY=FRA OR CY=LUX OR CY=NLD', 30);
      log('info', '[TED] Fallback sans filtre date');
    } catch (err2) {
      log('error', '[TED] Fallback échoué', { error: err2.message });
      return [];
    }
  }

  const notices = data.notices ?? [];
  log('info', '[TED] Notices', { count: notices.length, total: data.totalNoticeCount ?? '?' });
  return mapNotices(notices, 'ted');
}

function mapNotices(notices, prefix) {
  const COUNTRY_MAP = { BEL: 'BE', FRA: 'FR', LUX: 'LU', NLD: 'NL' };
  const results = [];
  for (const n of notices) {
    const id = n.ND ?? n['publication-number'];
    if (!id) continue;
    const titleRaw = extractTitle(n.TI) ?? "Appel d'offres TED";
    const cyRaw    = Array.isArray(n.CY) ? n.CY[0] : (n.CY ?? 'EU');
    const country  = COUNTRY_MAP[String(cyRaw).toUpperCase()] ?? String(cyRaw).substring(0, 2);
    const cpvCodes = Array.isArray(n.PC) ? n.PC : [];
    results.push({
      external_id:     `${prefix}-${id}`,
      title:           String(titleRaw).substring(0, 500),
      description:     null,
      source_name:     'TED Europa',
      source_url:      `https://ted.europa.eu/en/notice/${id}/html`,
      organism:        null,
      category:        guessCategory(cpvCodes, titleRaw),
      country,
      city:            null,
      postal_code:     null,
      budget_min:      null,
      budget_max:      null,
      budget_currency: 'EUR',
      deadline:        null,
      published_at:    safeDate(n.PD) ?? new Date().toISOString(),
      type:            'public',
      status:          'active',
      documents:       [],
      tags:            cpvCodes.slice(0, 5),
    });
  }
  log('info', '[TED] Opportunités construites', { count: results.length });
  return results;
}
