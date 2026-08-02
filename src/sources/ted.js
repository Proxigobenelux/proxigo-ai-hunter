// ─── Source : TED Europa v3 ───────────────────────────────────────────────────
// Nouvel endpoint (mai 2025) : POST https://api.ted.europa.eu/v3/notices/search
// Pas de clé API requise pour la Search API.
// Doc : https://docs.ted.europa.eu/api/latest/index.html

import fetch from 'node-fetch';
import { log } from '../logger.js';

const TED_SEARCH = 'https://api.ted.europa.eu/v3/notices/search';

const CPV_CATEGORY = {
  '90': 'Nettoyage',
  '45': 'Maçonnerie / BTP',
  '77': 'Jardinage / Espaces verts',
  '50': 'Réparation / Maintenance',
  '31': 'Électricité',
  '51': 'Installation électrique',
  '60': 'Transport / Déménagement',
  '71': 'Architecture / Ingénierie',
  '72': 'Informatique / IT',
  '98': 'Services aux particuliers',
};

const KEYWORD_MAP = [
  ['nettoyage', 'Nettoyage'], ['cleaning', 'Nettoyage'], ['entretien', 'Nettoyage'],
  ['plomberie', 'Plomberie'], ['sanitaire', 'Plomberie'],
  ['jardinage', 'Jardinage / Espaces verts'], ['espaces verts', 'Jardinage / Espaces verts'],
  ['électric', 'Électricité'], ['electric', 'Électricité'],
  ['maçonnerie', 'Maçonnerie / BTP'], ['construction', 'Maçonnerie / BTP'], ['travaux', 'Maçonnerie / BTP'],
  ['transport', 'Transport / Déménagement'], ['déménagement', 'Transport / Déménagement'],
  ['informatique', 'Informatique / IT'],
  ['maintenance', 'Réparation / Maintenance'],
];

function guessCategory(cpvCodes = [], title = '') {
  for (const code of cpvCodes) {
    const prefix = String(code).substring(0, 2);
    if (CPV_CATEGORY[prefix]) return CPV_CATEGORY[prefix];
  }
  const lower = title.toLowerCase();
  for (const [kw, cat] of KEYWORD_MAP) {
    if (lower.includes(kw)) return cat;
  }
  return 'Services généraux';
}

function safeDate(val) {
  if (!val) return null;
  try {
    const d = new Date(String(val).length === 8 ? `${val.substring(0,4)}-${val.substring(4,6)}-${val.substring(6,8)}` : val);
    return isNaN(d.getTime()) ? null : d.toISOString();
  } catch { return null; }
}

export async function fetchTEDOpportunities() {
  // L'API v3 utilise POST avec un body JSON
  const body = {
    query: 'BT-09(b)-Procedure in (BEL, FRA, LUX, NLD)',
    fields: ['ND', 'TI', 'AC', 'CY', 'DD', 'TVH', 'PC'],
    page: 1,
    pageSize: 50,
    onlyLatestVersions: true,
  };

  log('info', '[TED] Appel API v3 (POST)', { url: TED_SEARCH });

  let res;
  try {
    res = await fetch(TED_SEARCH, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'User-Agent': 'Proxigo-AI-Hunter/2.0 (contact@proxigo.eu)',
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30000),
    });
  } catch (err) {
    log('error', '[TED] Erreur réseau', { error: err.message });
    return [];
  }

  log('info', '[TED] Réponse HTTP', { status: res.status, contentType: res.headers.get('content-type') });

  if (!res.ok) {
    const errBody = await res.text();
    log('error', '[TED] HTTP non-OK', { status: res.status, body: errBody.substring(0, 400) });
    // Fallback : essayer la requête simplifiée sans filtre pays
    return fetchTEDFallback();
  }

  const raw = await res.text();
  if (!raw || raw.trim().length === 0) {
    log('error', '[TED] Réponse vide');
    return fetchTEDFallback();
  }

  let data;
  try {
    data = JSON.parse(raw);
  } catch (e) {
    log('error', '[TED] JSON invalide', { preview: raw.substring(0, 300), error: e.message });
    return [];
  }

  const notices = data.notices ?? data.results ?? data.data ?? [];
  log('info', '[TED] Notices trouvées', { count: notices.length, total: data.totalNoticeCount ?? '?' });

  return mapNotices(notices, 'ted');
}

// Fallback : requête simplifiée si le filtre pays échoue
async function fetchTEDFallback() {
  const body = {
    query: 'PD=[20240101,20991231]',
    fields: ['ND', 'TI', 'AC', 'CY', 'DD', 'TVH', 'PC'],
    page: 1,
    pageSize: 50,
    onlyLatestVersions: true,
  };

  log('info', '[TED] Fallback sans filtre pays', { url: TED_SEARCH });

  try {
    const res = await fetch(TED_SEARCH, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'User-Agent': 'Proxigo-AI-Hunter/2.0 (contact@proxigo.eu)',
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30000),
    });

    if (!res.ok) {
      log('error', '[TED] Fallback aussi échoué', { status: res.status });
      return [];
    }

    const data = await res.json();
    const notices = data.notices ?? data.results ?? [];
    log('info', '[TED] Notices fallback', { count: notices.length });
    return mapNotices(notices, 'ted-fb');
  } catch (err) {
    log('error', '[TED] Fallback exception', { error: err.message });
    return [];
  }
}

function mapNotices(notices, prefix) {
  const results = [];
  for (const n of notices) {
    const id = n.ND?.[0] ?? n.noticePublicationId ?? n.id;
    if (!id) continue;

    const titleRaw = n.TI?.[0] ?? n.title ?? "Appel d'offres TED";
    const country  = (n.CY?.[0] ?? n.PC?.[0] ?? 'EU').toUpperCase().substring(0, 2);
    const cpvCodes = Array.isArray(n.PC) ? n.PC : [];
    const budget   = n.TVH?.[0] ?? null;

    results.push({
      external_id:     `${prefix}-${id}`,
      title:           String(titleRaw).substring(0, 500),
      description:     n.AC?.[0] ? String(n.AC[0]).substring(0, 2000) : null,
      source_name:     'TED Europa',
      source_url:      `https://ted.europa.eu/en/notice/-/detail/${id}`,
      organism:        n.AC?.[0] ? String(n.AC[0]).substring(0, 255) : null,
      category:        guessCategory(cpvCodes, titleRaw),
      country,
      city:            null,
      postal_code:     null,
      budget_min:      null,
      budget_max:      budget ? parseFloat(budget) : null,
      budget_currency: 'EUR',
      deadline:        safeDate(n.DD?.[0]),
      published_at:    new Date().toISOString(),
      type:            'public',
      status:          'active',
      documents:       [],
      tags:            cpvCodes.slice(0, 5),
    });
  }
  log('info', '[TED] Opportunités construites', { count: results.length });
  return results;
}
