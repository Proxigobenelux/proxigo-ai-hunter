// ─── Source : Marchés publics Luxembourg ─────────────────────────────────────
// Stratégie 1 : TED API v3 (POST) filtrée LUX
// Stratégie 2 : portail marches.public.lu (pas de RSS public — scrape des derniers avis)
// Le RSS marches-publics.lu/rss/avis retourne 404 — abandonné.

import fetch from 'node-fetch';
import { log } from '../logger.js';

const TED_SEARCH = 'https://api.ted.europa.eu/v3/notices/search';

const KEYWORD_MAP = [
  ['nettoyage', 'Nettoyage'], ['entretien', 'Nettoyage'],
  ['plomberie', 'Plomberie'],
  ['électric', 'Électricité'],
  ['jardin', 'Jardinage / Espaces verts'],
  ['maçon', 'Maçonnerie / BTP'], ['construction', 'Maçonnerie / BTP'], ['travaux', 'Maçonnerie / BTP'],
  ['transport', 'Transport / Déménagement'],
  ['peinture', 'Peinture'],
  ['sécurité', 'Sécurité'],
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
    const d = new Date(String(val).length === 8 ? `${val.substring(0,4)}-${val.substring(4,6)}-${val.substring(6,8)}` : val);
    return isNaN(d.getTime()) ? null : d.toISOString();
  } catch { return null; }
}

export async function fetchLuxembourgOpportunities() {
  // ── TED API v3 POST filtrée LUX ───────────────────────────────────────────
  const body = {
    query: 'BT-09(b)-Procedure=LUX',
    fields: ['ND', 'TI', 'AC', 'CY', 'DD', 'TVH', 'PC'],
    page: 1,
    pageSize: 30,
    onlyLatestVersions: true,
  };

  log('info', '[Luxembourg] Appel TED API v3/LUX (POST)', { url: TED_SEARCH });

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

    log('info', '[Luxembourg] TED Réponse HTTP', { status: res.status, contentType: res.headers.get('content-type') });

    if (res.ok) {
      const raw = await res.text();
      if (raw && raw.trim().length > 0) {
        let data;
        try { data = JSON.parse(raw); } catch (e) {
          log('error', '[Luxembourg] JSON invalide', { preview: raw.substring(0, 200), error: e.message });
          throw new Error('JSON invalide');
        }

        const notices = data.notices ?? data.results ?? [];
        log('info', '[Luxembourg] Notices TED/LUX trouvées', { count: notices.length });

        if (notices.length > 0) {
          const results = [];
          for (const n of notices) {
            const id = n.ND?.[0] ?? n.id;
            if (!id) continue;
            const titleRaw = n.TI?.[0] ?? 'Marché public Luxembourg';
            const budget   = n.TVH?.[0] ?? null;

            results.push({
              external_id:     `lu-ted-${id}`,
              title:           String(titleRaw).substring(0, 500),
              description:     n.AC?.[0] ? String(n.AC[0]).substring(0, 2000) : null,
              source_name:     'Marchés publics Luxembourg',
              source_url:      `https://ted.europa.eu/en/notice/-/detail/${id}`,
              organism:        n.AC?.[0] ? String(n.AC[0]).substring(0, 255) : null,
              category:        guessCategory(titleRaw),
              country:         'LU',
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
              tags:            ['Luxembourg'],
            });
          }
          log('info', '[Luxembourg] Opportunités construites (TED)', { count: results.length });
          return results;
        }
      }
    } else {
      const errBody = await res.text();
      log('error', '[Luxembourg] TED non-OK', { status: res.status, body: errBody.substring(0, 300) });
    }
  } catch (err) {
    log('warn', '[Luxembourg] TED API échouée', { error: err.message });
  }

  // ── Fallback : TED sans filtre pays, filtré post-mapping ─────────────────
  log('info', '[Luxembourg] Fallback TED générique filtré CY=LU');
  try {
    const fallbackBody = {
      query: 'PD=[20240101,20991231]',
      fields: ['ND', 'TI', 'AC', 'CY', 'DD', 'TVH'],
      page: 1,
      pageSize: 50,
      onlyLatestVersions: true,
    };

    const res = await fetch(TED_SEARCH, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'User-Agent': 'Proxigo-AI-Hunter/2.0 (contact@proxigo.eu)',
      },
      body: JSON.stringify(fallbackBody),
      signal: AbortSignal.timeout(30000),
    });

    if (!res.ok) {
      log('error', '[Luxembourg] Fallback TED non-OK', { status: res.status });
      return [];
    }

    const data = await res.json();
    const notices = (data.notices ?? data.results ?? [])
      .filter(n => (n.CY?.[0] ?? '').toUpperCase() === 'LU');

    log('info', '[Luxembourg] Notices fallback CY=LU', { count: notices.length });

    const results = [];
    for (const n of notices) {
      const id = n.ND?.[0] ?? n.id;
      if (!id) continue;
      const titleRaw = n.TI?.[0] ?? 'Marché public Luxembourg';
      results.push({
        external_id:     `lu-fb-${id}`,
        title:           String(titleRaw).substring(0, 500),
        description:     n.AC?.[0] ? String(n.AC[0]).substring(0, 2000) : null,
        source_name:     'Marchés publics Luxembourg',
        source_url:      `https://ted.europa.eu/en/notice/-/detail/${id}`,
        organism:        n.AC?.[0] ? String(n.AC[0]).substring(0, 255) : null,
        category:        guessCategory(titleRaw),
        country:         'LU',
        city:            null, postal_code: null,
        budget_min:      null,
        budget_max:      n.TVH?.[0] ? parseFloat(n.TVH[0]) : null,
        budget_currency: 'EUR',
        deadline:        safeDate(n.DD?.[0]),
        published_at:    new Date().toISOString(),
        type:            'public', status: 'active',
        documents:       [], tags: ['Luxembourg'],
      });
    }
    log('info', '[Luxembourg] Opportunités fallback construites', { count: results.length });
    return results;
  } catch (err) {
    log('error', '[Luxembourg] Fallback aussi échoué', { error: err.message });
    return [];
  }
}
