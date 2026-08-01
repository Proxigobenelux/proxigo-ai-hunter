// ─── Source : TED Europa v3.0 ─────────────────────────────────────────────────
// Endpoint stable : https://ted.europa.eu/api/v3.0/notices/search
// Pas de clé API requise pour les recherches publiques.

import fetch from 'node-fetch';
import { log } from '../logger.js';

const TED_SEARCH = 'https://ted.europa.eu/api/v3.0/notices/search';

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
  ['maçonnerie', 'Maçonnerie / BTP'], ['construction', 'Maçonnerie / BTP'], ['bâtiment', 'Maçonnerie / BTP'],
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

export async function fetchTEDOpportunities() {
  // Filtre pays : BE, FR, LU, NL — champs minimaux pour éviter timeout
  const url = `${TED_SEARCH}?fields=ND,TI,AC,CY,DD,TVH&q=CY%3A(BE+OR+FR+OR+LU+OR+NL)&pageSize=50&page=1`;

  log('info', '[TED] Appel API', { url });

  let res;
  try {
    res = await fetch(url, {
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'Proxigo-AI-Hunter/2.0 (contact@proxigo.eu)',
      },
      signal: AbortSignal.timeout(25000),
    });
  } catch (err) {
    log('error', '[TED] Erreur réseau', { error: err.message });
    return [];
  }

  log('info', '[TED] Réponse HTTP', { status: res.status, contentType: res.headers.get('content-type') });

  if (!res.ok) {
    const body = await res.text();
    log('error', '[TED] HTTP non-OK', { status: res.status, body: body.substring(0, 300) });
    return [];
  }

  const raw = await res.text();
  if (!raw || raw.trim().length === 0) {
    log('error', '[TED] Réponse vide');
    return [];
  }

  let data;
  try {
    data = JSON.parse(raw);
  } catch (parseErr) {
    log('error', '[TED] JSON invalide', { preview: raw.substring(0, 300), error: parseErr.message });
    return [];
  }

  const notices = data.notices ?? data.results ?? data.data ?? [];
  log('info', '[TED] Notices trouvées', { count: notices.length });

  const results = [];
  for (const n of notices) {
    const id = n.ND?.[0] ?? n.noticePublicationId ?? n.id;
    if (!id) continue;

    const titleRaw = n.TI?.[0] ?? n.title ?? "Appel d'offres TED";
    const country  = (n.CY?.[0] ?? n.PC?.[0] ?? 'EU').toUpperCase().substring(0, 2);
    const cpvCodes = Array.isArray(n.PC) ? n.PC : [];
    const deadline = n.DD?.[0] ?? null;
    const budget   = n.TVH?.[0] ?? null;

    let deadlineISO = null;
    if (deadline) {
      try { deadlineISO = new Date(deadline).toISOString(); } catch { deadlineISO = null; }
    }

    results.push({
      external_id:     `ted-${id}`,
      title:           String(titleRaw).substring(0, 500),
      description:     n.AC?.[0] ? String(n.AC[0]).substring(0, 2000) : null,
      source_name:     'TED Europa',
      source_url:      `https://ted.europa.eu/udl?uri=TED:NOTICE:${id}:TEXT:FR:HTML`,
      organism:        n.AC?.[0] ? String(n.AC[0]).substring(0, 255) : null,
      category:        guessCategory(cpvCodes, titleRaw),
      country,
      city:            null,
      postal_code:     null,
      budget_min:      null,
      budget_max:      budget ? parseFloat(budget) : null,
      budget_currency: 'EUR',
      deadline:        deadlineISO,
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
