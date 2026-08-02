// ─── Source : TenderNed (Pays-Bas) ────────────────────────────────────────────
// L'API REST publique /api/publieksportaal/ est morte (404 / auth requise).
// Nouvelle stratégie : RSS via data.overheid.nl + TED API v3 filtrée NLD.

import fetch from 'node-fetch';
import Parser from 'rss-parser';
import { log } from '../logger.js';

// RSS officiel fourni par data.overheid.nl pour TenderNed
const TENDERNED_RSS = 'https://data.overheid.nl/feeds/tenderned.rss';
// TED API v3 comme complément pour les marchés NL publiés sur TED
const TED_SEARCH    = 'https://api.ted.europa.eu/v3/notices/search';

const KEYWORD_MAP = [
  ['schoonmaak', 'Nettoyage'], ['reiniging', 'Nettoyage'], ['nettoyage', 'Nettoyage'],
  ['loodgieter', 'Plomberie'], ['sanitair', 'Plomberie'],
  ['elektric', 'Électricité'], ['verlichting', 'Électricité'],
  ['tuin', 'Jardinage / Espaces verts'], ['groenvoorziening', 'Jardinage / Espaces verts'],
  ['bouw', 'Maçonnerie / BTP'], ['renovatie', 'Maçonnerie / BTP'], ['constructie', 'Maçonnerie / BTP'],
  ['verhuiz', 'Transport / Déménagement'], ['transport', 'Transport / Déménagement'],
  ['schilders', 'Peinture'], ['verf', 'Peinture'],
  ['beveiliging', 'Sécurité'], ['bewaking', 'Sécurité'],
  ['ict', 'Informatique / IT'], ['software', 'Informatique / IT'],
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
    return isNaN(d.getTime()) ? null : d.toISOString();
  } catch { return null; }
}

export async function fetchTenderNedOpportunities() {
  const results = [];

  // ── Stratégie 1 : RSS data.overheid.nl ───────────────────────────────────
  log('info', '[TenderNed] Appel RSS data.overheid.nl', { url: TENDERNED_RSS });
  try {
    const parser = new Parser({
      timeout: 25000,
      headers: { 'User-Agent': 'Proxigo-AI-Hunter/2.0 (contact@proxigo.eu)' },
    });
    const feed = await parser.parseURL(TENDERNED_RSS);
    const items = feed.items ?? [];
    log('info', '[TenderNed] Items RSS trouvés', { count: items.length });

    for (const item of items) {
      const id = item.guid ?? item.link;
      if (!id) continue;
      const title       = item.title ?? 'Aanbesteding NL';
      const description = item.contentSnippet ?? item.content ?? '';

      results.push({
        external_id:     `nl-rss-${Buffer.from(String(id)).toString('base64').substring(0, 60)}`,
        title:           String(title).substring(0, 500),
        description:     String(description).substring(0, 2000),
        source_name:     'TenderNed (NL)',
        source_url:      item.link ?? 'https://www.tenderned.nl',
        organism:        null,
        category:        guessCategory(`${title} ${description}`),
        country:         'NL',
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
        tags:            [],
      });
    }
  } catch (err) {
    log('warn', '[TenderNed] RSS échoué, passage à TED API NLD', { error: err.message });
  }

  // ── Stratégie 2 : TED API v3 filtrée NLD ─────────────────────────────────
  if (results.length === 0) {
    log('info', '[TenderNed] Fallback TED API v3 NLD', { url: TED_SEARCH });
    try {
      const body = {
        query: 'BT-09(b)-Procedure=NLD',
        fields: ['ND', 'TI', 'AC', 'CY', 'DD', 'TVH'],
        page: 1,
        pageSize: 30,
        onlyLatestVersions: true,
      };

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

      log('info', '[TenderNed] TED/NLD Réponse HTTP', { status: res.status });

      if (res.ok) {
        const data = await res.json();
        const notices = data.notices ?? data.results ?? [];
        log('info', '[TenderNed] Notices TED/NLD', { count: notices.length });

        for (const n of notices) {
          const id = n.ND?.[0] ?? n.id;
          if (!id) continue;
          const titleRaw = n.TI?.[0] ?? 'Aanbesteding NL';
          results.push({
            external_id:     `nl-ted-${id}`,
            title:           String(titleRaw).substring(0, 500),
            description:     n.AC?.[0] ? String(n.AC[0]).substring(0, 2000) : null,
            source_name:     'TenderNed (NL)',
            source_url:      `https://ted.europa.eu/en/notice/-/detail/${id}`,
            organism:        n.AC?.[0] ? String(n.AC[0]).substring(0, 255) : null,
            category:        guessCategory(titleRaw),
            country:         'NL',
            city:            null,
            postal_code:     null,
            budget_min:      null,
            budget_max:      n.TVH?.[0] ? parseFloat(n.TVH[0]) : null,
            budget_currency: 'EUR',
            deadline:        safeDate(n.DD?.[0]),
            published_at:    new Date().toISOString(),
            type:            'public',
            status:          'active',
            documents:       [],
            tags:            [],
          });
        }
      }
    } catch (err) {
      log('error', '[TenderNed] TED/NLD fallback échoué', { error: err.message });
    }
  }

  log('info', '[TenderNed] Opportunités construites', { count: results.length });
  return results;
}
