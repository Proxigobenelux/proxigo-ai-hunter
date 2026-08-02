// ─── Source : Marchés publics Luxembourg via TED v3 ────────────────────────────
// CY=LUX + PD>=YYYYMMDD (format sans tirets, validé Swagger)

import fetch from 'node-fetch';
import { log } from '../logger.js';

const TED_SEARCH = 'https://api.ted.europa.eu/v3/notices/search';
const TED_HEADERS = { 'Content-Type': 'application/json', 'Accept': 'application/json' };

const KEYWORD_MAP = [
  ['nettoyage','Nettoyage'], ['entretien','Nettoyage'],
  ['plomberie','Plomberie'], ['électric','Électricité'],
  ['jardin','Jardinage / Espaces verts'],
  ['maçon','Maçonnerie / BTP'], ['construction','Maçonnerie / BTP'], ['travaux','Maçonnerie / BTP'],
  ['transport','Transport / Déménagement'], ['peinture','Peinture'], ['sécurité','Sécurité'],
];

function yyyymmdd(d = new Date()) {
  return d.toISOString().split('T')[0].replace(/-/g, '');
}

function guessCategory(text = '') {
  const lower = text.toLowerCase();
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
  return ti.fra ?? ti.fre ?? ti.eng ?? ti.deu ?? Object.values(ti)[0] ?? null;
}

async function tedPost(query, limit) {
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
    throw new Error(`HTTP ${res.status}: ${msg.substring(0, 200)}`);
  }
  return res.json();
}

export async function fetchLuxembourgOpportunities() {
  const since = yyyymmdd(new Date(Date.now() - 30 * 24 * 60 * 60 * 1000));
  const query = `CY=LUX AND PD>=${since}`;
  log('info', '[Luxembourg] Appel TED API v3/LUX', { query });

  let data;
  try {
    data = await tedPost(query, 30);
  } catch (err) {
    log('warn', '[Luxembourg] Erreur principale → fallback sans date', { error: err.message });
    try {
      data = await tedPost('CY=LUX', 20);
    } catch (err2) {
      log('error', '[Luxembourg] Fallback échoué', { error: err2.message });
      return [];
    }
  }

  const notices = data.notices ?? [];
  log('info', '[Luxembourg] Notices TED/LUX', { count: notices.length, total: data.totalNoticeCount ?? '?' });

  const results = [];
  for (const n of notices) {
    const id = n.ND ?? n['publication-number'];
    if (!id) continue;
    const titleRaw = extractTitle(n.TI) ?? 'Marché public Luxembourg';
    const cpvCodes = Array.isArray(n.PC) ? n.PC : [];
    results.push({
      external_id:     `lu-ted-${id}`,
      title:           String(titleRaw).substring(0, 500),
      description:     null,
      source_name:     'Marchés publics Luxembourg',
      source_url:      `https://ted.europa.eu/en/notice/${id}/html`,
      organism:        null,
      category:        guessCategory(titleRaw),
      country:         'LU',
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
      tags:            ['Luxembourg', ...cpvCodes.slice(0, 3)],
    });
  }
  log('info', '[Luxembourg] Opportunités construites', { count: results.length });
  return results;
}
