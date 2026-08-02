// ─── Source : TenderNed (Pays-Bas) ─────────────────────────────────────────────
// Stratégie 1 : RSS data.overheid.nl (timeout court car souvent 404)
// Stratégie 2 (fallback) : TED API v3 CY=NLD + PD>=YYYYMMDD

import fetch from 'node-fetch';
import Parser from 'rss-parser';
import { log } from '../logger.js';

const TENDERNED_RSS = 'https://data.overheid.nl/feeds/tenderned.rss';
const TED_SEARCH    = 'https://api.ted.europa.eu/v3/notices/search';
const TED_HEADERS   = { 'Content-Type': 'application/json', 'Accept': 'application/json' };

const KEYWORD_MAP = [
  ['schoonmaak','Nettoyage'], ['reiniging','Nettoyage'], ['nettoyage','Nettoyage'],
  ['loodgieter','Plomberie'], ['sanitair','Plomberie'],
  ['elektric','Électricité'], ['verlichting','Électricité'],
  ['tuin','Jardinage / Espaces verts'], ['groenvoorziening','Jardinage / Espaces verts'],
  ['bouw','Maçonnerie / BTP'], ['renovatie','Maçonnerie / BTP'], ['constructie','Maçonnerie / BTP'],
  ['verhuiz','Transport / Déménagement'], ['transport','Transport / Déménagement'],
  ['schilders','Peinture'], ['beveiliging','Sécurité'], ['bewaking','Sécurité'],
  ['ict','Informatique / IT'], ['software','Informatique / IT'],
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
  try { const d = new Date(val); return isNaN(d.getTime()) ? null : d.toISOString(); }
  catch { return null; }
}

function extractTitle(ti) {
  if (!ti) return null;
  if (typeof ti === 'string') return ti;
  if (Array.isArray(ti)) return ti[0] ?? null;
  return ti.nld ?? ti.fra ?? ti.eng ?? ti.deu ?? Object.values(ti)[0] ?? null;
}

export async function fetchTenderNedOpportunities() {
  // ── Stratégie 1 : RSS (timeout court — souvent 404) ──────────────────────
  log('info', '[TenderNed] Tentative RSS', { url: TENDERNED_RSS });
  try {
    const parser = new Parser({
      timeout: 8000,
      headers: { 'User-Agent': 'Proxigo-AI-Hunter/2.0' },
    });
    const feed = await parser.parseURL(TENDERNED_RSS);
    const items = feed.items ?? [];
    if (items.length > 0) {
      log('info', '[TenderNed] RSS OK', { count: items.length });
      const results = items.map(item => {
        const id = item.guid ?? item.link ?? String(Date.now() + Math.random());
        return {
          external_id:     `nl-rss-${Buffer.from(String(id)).toString('base64').substring(0, 60)}`,
          title:           String(item.title ?? 'Aanbesteding NL').substring(0, 500),
          description:     String(item.contentSnippet ?? item.content ?? '').substring(0, 2000),
          source_name:     'TenderNed (NL)',
          source_url:      item.link ?? 'https://www.tenderned.nl',
          organism:        null,
          category:        guessCategory(`${item.title ?? ''} ${item.contentSnippet ?? ''}`),
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
        };
      });
      log('info', '[TenderNed] Opportunités RSS', { count: results.length });
      return results;
    }
  } catch (err) {
    log('warn', '[TenderNed] RSS échoué → fallback TED NLD', { error: err.message });
  }

  // ── Stratégie 2 : TED API v3 CY=NLD ──────────────────────────────────────
  const since = yyyymmdd(new Date(Date.now() - 30 * 24 * 60 * 60 * 1000));
  const query = `CY=NLD AND PD>=${since}`;
  log('info', '[TenderNed] Fallback TED/NLD', { query });

  try {
    const body = {
      query,
      fields: ['ND', 'TI', 'CY', 'PC', 'PD'],
      page: 1,
      limit: 30,
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
      log('error', '[TenderNed] TED/NLD non-OK', { status: res.status, body: msg.substring(0, 200) });
      return [];
    }
    const data = await res.json();
    const notices = data.notices ?? [];
    log('info', '[TenderNed] Notices TED/NLD', { count: notices.length });
    const results = [];
    for (const n of notices) {
      const id = n.ND ?? n['publication-number'];
      if (!id) continue;
      const titleRaw = extractTitle(n.TI) ?? 'Aanbesteding NL';
      results.push({
        external_id:     `nl-ted-${id}`,
        title:           String(titleRaw).substring(0, 500),
        description:     null,
        source_name:     'TenderNed (NL)',
        source_url:      `https://ted.europa.eu/en/notice/${id}/html`,
        organism:        null,
        category:        guessCategory(titleRaw),
        country:         'NL',
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
        tags:            [],
      });
    }
    log('info', '[TenderNed] Opportunités (fallback TED)', { count: results.length });
    return results;
  } catch (err) {
    log('error', '[TenderNed] TED/NLD exception', { error: err.message });
    return [];
  }
}
