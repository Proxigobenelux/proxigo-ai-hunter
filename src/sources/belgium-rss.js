// ─── Source : e-Procurement Belgique ─────────────────────────────────────────
// Le RSS publicprocurement.be retourne du XML malformé — on utilise à la place
// l'API TED v3.0 filtrée sur le pays BE (JSON propre, même données).

import fetch from 'node-fetch';
import { log } from '../logger.js';

const TED_BE = 'https://ted.europa.eu/api/v3.0/notices/search?fields=ND,TI,AC,CY,DD,TVH&q=CY%3ABE&pageSize=50&page=1';

const KEYWORD_MAP = [
  ['nettoyage', 'Nettoyage'], ['cleaning', 'Nettoyage'], ['entretien', 'Nettoyage'],
  ['plomberie', 'Plomberie'], ['sanitaire', 'Plomberie'],
  ['électric', 'Électricité'], ['electric', 'Électricité'],
  ['jardin', 'Jardinage / Espaces verts'], ['espaces verts', 'Jardinage / Espaces verts'],
  ['maçon', 'Maçonnerie / BTP'], ['construction', 'Maçonnerie / BTP'], ['travaux', 'Maçonnerie / BTP'],
  ['déménagement', 'Transport / Déménagement'], ['transport', 'Transport / Déménagement'],
  ['peinture', 'Peinture'],
  ['sécurité', 'Sécurité'], ['gardiennage', 'Sécurité'],
  ['informatique', 'Informatique / IT'],
];

function guessCategory(text = '') {
  const lower = text.toLowerCase();
  for (const [kw, cat] of KEYWORD_MAP) {
    if (lower.includes(kw)) return cat;
  }
  return 'Services généraux';
}

function safeDate(val) {
  if (!val) return null;
  try {
    const d = new Date(val);
    if (isNaN(d.getTime())) return null;
    return d.toISOString();
  } catch {
    return null;
  }
}

export async function fetchBelgiumRSSOpportunities() {
  log('info', '[Belgique] Appel TED API filtré BE', { url: TED_BE });

  let res;
  try {
    res = await fetch(TED_BE, {
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'Proxigo-AI-Hunter/2.0 (contact@proxigo.eu)',
      },
      signal: AbortSignal.timeout(25000),
    });
  } catch (err) {
    log('error', '[Belgique] Erreur réseau', { error: err.message });
    return [];
  }

  log('info', '[Belgique] Réponse HTTP', { status: res.status, contentType: res.headers.get('content-type') });

  if (!res.ok) {
    const body = await res.text();
    log('error', '[Belgique] HTTP non-OK', { status: res.status, body: body.substring(0, 300) });
    return [];
  }

  const raw = await res.text();
  if (!raw || raw.trim().length === 0) {
    log('error', '[Belgique] Réponse vide');
    return [];
  }

  let data;
  try {
    data = JSON.parse(raw);
  } catch (parseErr) {
    log('error', '[Belgique] JSON invalide', { preview: raw.substring(0, 300), error: parseErr.message });
    return [];
  }

  const notices = data.notices ?? data.results ?? [];
  log('info', '[Belgique] Notices TED/BE trouvées', { count: notices.length });

  const results = [];
  for (const n of notices) {
    const id = n.ND?.[0] ?? n.id;
    if (!id) continue;

    const titleRaw = n.TI?.[0] ?? 'Marché public Belgique';
    const budget   = n.TVH?.[0] ?? null;

    results.push({
      external_id:     `be-ted-${id}`,
      title:           String(titleRaw).substring(0, 500),
      description:     n.AC?.[0] ? String(n.AC[0]).substring(0, 2000) : null,
      source_name:     'e-Procurement Belgique',
      source_url:      `https://ted.europa.eu/udl?uri=TED:NOTICE:${id}:TEXT:FR:HTML`,
      organism:        n.AC?.[0] ? String(n.AC[0]).substring(0, 255) : null,
      category:        guessCategory(titleRaw),
      country:         'BE',
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
      tags:            ['Belgique', 'Marché public'],
    });
  }

  log('info', '[Belgique] Opportunités construites', { count: results.length });
  return results;
}
