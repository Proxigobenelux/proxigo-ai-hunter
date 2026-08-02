// ─── Source : e-Procurement Belgique via TED v3 ────────────────────────────────
// Même API TED, filtrée CY=BEL + PD>=YYYYMMDD (format sans tirets, validé)

import fetch from 'node-fetch';
import { log } from '../logger.js';

const TED_SEARCH = 'https://api.ted.europa.eu/v3/notices/search';
const TED_HEADERS = { 'Content-Type': 'application/json', 'Accept': 'application/json' };

const KEYWORD_MAP = [
  ['nettoyage','Nettoyage'], ['cleaning','Nettoyage'], ['entretien','Nettoyage'],
  ['plomberie','Plomberie'], ['sanitaire','Plomberie'],
  ['électric','Électricité'], ['electric','Électricité'],
  ['jardin','Jardinage / Espaces verts'], ['espaces verts','Jardinage / Espaces verts'],
  ['maçon','Maçonnerie / BTP'], ['construction','Maçonnerie / BTP'], ['travaux','Maçonnerie / BTP'],
  ['déménagement','Transport / Déménagement'], ['transport','Transport / Déménagement'],
  ['peinture','Peinture'], ['sécurité','Sécurité'], ['gardiennage','Sécurité'],
  ['informatique','Informatique / IT'],
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
  return ti.fra ?? ti.fre ?? ti.eng ?? ti.nld ?? ti.deu ?? Object.values(ti)[0] ?? null;
}

export async function fetchBelgiumRSSOpportunities() {
  const since = yyyymmdd(new Date(Date.now() - 30 * 24 * 60 * 60 * 1000));
  const query = `CY=BEL AND PD>=${since}`;

  log('info', '[Belgique] Appel TED API v3/BE', { query });

  let data;
  try {
    const body = {
      query,
      fields: ['ND', 'TI', 'CY', 'PC', 'PD'],
      page: 1,
      limit: 50,
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
    data = await res.json();
  } catch (err) {
    log('error', '[Belgique] Erreur TED', { error: err.message });
    return [];
  }

  const notices = data.notices ?? [];
  log('info', '[Belgique] Notices TED/BE', { count: notices.length, total: data.totalNoticeCount ?? '?' });

  const results = [];
  for (const n of notices) {
    const id = n.ND ?? n['publication-number'];
    if (!id) continue;
    const titleRaw = extractTitle(n.TI) ?? 'Marché public Belgique';
    results.push({
      external_id:     `be-ted-${id}`,
      title:           String(titleRaw).substring(0, 500),
      description:     null,
      source_name:     'e-Procurement Belgique',
      source_url:      `https://ted.europa.eu/en/notice/${id}/html`,
      organism:        null,
      category:        guessCategory(titleRaw),
      country:         'BE',
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
      tags:            ['Belgique', 'Marché public'],
    });
  }

  log('info', '[Belgique] Opportunités construites', { count: results.length });
  return results;
}
