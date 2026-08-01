// ─── Source : Marchés publics Luxembourg ─────────────────────────────────────
// Stratégie primaire  : TED API v3.0 filtrée CY=LU (JSON stable)
// Stratégie secondaire : RSS portail marches-publics.lu

import fetch from 'node-fetch';
import Parser from 'rss-parser';
import { log } from '../logger.js';

const TED_LU  = 'https://ted.europa.eu/api/v3.0/notices/search?fields=ND,TI,AC,CY,DD,TVH&q=CY%3ALU&pageSize=30&page=1';
const LU_RSS  = 'https://www.marches-publics.lu/rss/avis';

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
    const d = new Date(val);
    if (isNaN(d.getTime())) return null;
    return d.toISOString();
  } catch {
    return null;
  }
}

export async function fetchLuxembourgOpportunities() {
  // ── Tentative 1 : TED API JSON filtrée LU ────────────────────────────────
  log('info', '[Luxembourg] Appel TED API/LU', { url: TED_LU });

  try {
    const res = await fetch(TED_LU, {
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'Proxigo-AI-Hunter/2.0 (contact@proxigo.eu)',
      },
      signal: AbortSignal.timeout(25000),
    });

    log('info', '[Luxembourg] TED Réponse HTTP', { status: res.status, contentType: res.headers.get('content-type') });

    if (res.ok) {
      const raw = await res.text();
      if (raw && raw.trim().length > 0) {
        let data;
        try {
          data = JSON.parse(raw);
        } catch (parseErr) {
          log('error', '[Luxembourg] JSON invalide TED', { preview: raw.substring(0, 200), error: parseErr.message });
          throw new Error('JSON invalide');
        }

        const notices = data.notices ?? data.results ?? [];
        log('info', '[Luxembourg] Notices TED/LU trouvées', { count: notices.length });

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
              source_url:      `https://ted.europa.eu/udl?uri=TED:NOTICE:${id}:TEXT:FR:HTML`,
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
    }
  } catch (err) {
    log('warn', '[Luxembourg] TED API échouée, passage au fallback RSS', { error: err.message });
  }

  // ── Tentative 2 : RSS portail marches-publics.lu ──────────────────────────
  log('info', '[Luxembourg] Fallback RSS', { url: LU_RSS });
  try {
    const parser = new Parser({
      timeout: 20000,
      headers: { 'User-Agent': 'Proxigo-AI-Hunter/2.0 (contact@proxigo.eu)' },
    });
    const feed = await parser.parseURL(LU_RSS);
    const items = feed.items ?? [];
    log('info', '[Luxembourg] Items RSS trouvés', { count: items.length });

    const results = [];
    for (const item of items) {
      const id = item.guid ?? item.link ?? `lu-rss-${Date.now()}-${Math.random()}`;
      const title = item.title ?? 'Marché public Luxembourg';
      const description = item.contentSnippet ?? item.content ?? '';

      results.push({
        external_id:     `lu-rss-${Buffer.from(String(id)).toString('base64').substring(0, 60)}`,
        title:           String(title).substring(0, 500),
        description:     String(description).substring(0, 2000),
        source_name:     'Marchés publics Luxembourg',
        source_url:      item.link ?? 'https://www.marches-publics.lu',
        organism:        null,
        category:        guessCategory(`${title} ${description}`),
        country:         'LU',
        city:            null,
        postal_code:     null,
        budget_min:      null,
        budget_max:      null,
        budget_currency: 'EUR',
        deadline:        null,
        published_at:    safeDate(item.pubDate) ?? new Date().toISOString(),
        type:            'public',
        status:          'active',
        documents:       [],
        tags:            ['Luxembourg'],
      });
    }
    log('info', '[Luxembourg] Opportunités construites (RSS)', { count: results.length });
    return results;
  } catch (err) {
    log('error', '[Luxembourg] RSS aussi échoué', { error: err.message });
    return [];
  }
}
