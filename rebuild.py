#!/usr/bin/env python3
"""
rebuild.py — Proxigo AI Hunter v2
Exécuter depuis la racine de ton repo cloné : python3 rebuild.py
Recrée tous les fichiers src/ avec le code corrigé et vérifié.
"""

import os, sys

ROOT = os.path.dirname(os.path.abspath(__file__))

FILES = {}

# ── package.json ──────────────────────────────────────────────────────────────
FILES["package.json"] = '''{
  "name": "proxigo-ai-hunter",
  "version": "2.0.0",
  "description": "Proxigo AI Hunter — Autonomous tender collector service",
  "type": "module",
  "main": "src/index.js",
  "scripts": {
    "start": "node src/index.js",
    "dev": "node --watch src/index.js",
    "check": "node --check src/index.js && node --check src/logger.js && node --check src/sources/ted.js && node --check src/sources/boamp.js && node --check src/sources/belgium-rss.js && node --check src/sources/tendernet.js && node --check src/sources/luxembourg.js"
  },
  "dependencies": {
    "@supabase/supabase-js": "^2.39.0",
    "node-fetch": "^3.3.2",
    "rss-parser": "^3.13.0"
  },
  "engines": {
    "node": ">=20.0.0"
  }
}
'''

# ── src/logger.js ─────────────────────────────────────────────────────────────
FILES["src/logger.js"] = '''// Proxigo AI Hunter — Logger
export function log(level, message, meta = {}) {
  const entry = { ts: new Date().toISOString(), level, message, ...meta };
  console.log(JSON.stringify(entry));
}
'''

# ── src/sources/ted.js ────────────────────────────────────────────────────────
FILES["src/sources/ted.js"] = r'''import fetch from 'node-fetch';
import { log } from '../logger.js';

const TED_SEARCH = 'https://ted.europa.eu/api/v3.0/notices/search';

const CPV_CATEGORY = {
  '90': 'Nettoyage','45': 'Maconnerie / BTP','77': 'Jardinage / Espaces verts',
  '50': 'Reparation / Maintenance','31': 'Electricite','51': 'Installation electrique',
  '60': 'Transport / Demenagement','71': 'Architecture / Ingenierie',
  '72': 'Informatique / IT','98': 'Services aux particuliers',
};

const KEYWORD_MAP = [
  ['nettoyage','Nettoyage'],['cleaning','Nettoyage'],['entretien','Nettoyage'],
  ['plomberie','Plomberie'],['sanitaire','Plomberie'],
  ['jardinage','Jardinage / Espaces verts'],['espaces verts','Jardinage / Espaces verts'],
  ['electr','Electricite'],
  ['maconn','Maconnerie / BTP'],['construction','Maconnerie / BTP'],['batiment','Maconnerie / BTP'],
  ['transport','Transport / Demenagement'],['demenagement','Transport / Demenagement'],
  ['informatique','Informatique / IT'],['maintenance','Reparation / Maintenance'],
];

function guessCategory(cpvCodes = [], title = '') {
  for (const code of cpvCodes) {
    const prefix = String(code).substring(0, 2);
    if (CPV_CATEGORY[prefix]) return CPV_CATEGORY[prefix];
  }
  const lower = title.toLowerCase();
  for (const [kw, cat] of KEYWORD_MAP) { if (lower.includes(kw)) return cat; }
  return 'Services generaux';
}

function safeDate(val) {
  if (!val) return null;
  try { const d = new Date(val); return isNaN(d.getTime()) ? null : d.toISOString(); } catch { return null; }
}

export async function fetchTEDOpportunities() {
  const url = `${TED_SEARCH}?fields=ND,TI,AC,CY,DD,TVH&q=CY%3A(BE+OR+FR+OR+LU+OR+NL)&pageSize=50&page=1`;
  log('info', '[TED] Appel API', { url });

  let res;
  try {
    res = await fetch(url, {
      headers: { 'Accept': 'application/json', 'User-Agent': 'Proxigo-AI-Hunter/2.0' },
      signal: AbortSignal.timeout(25000),
    });
  } catch (err) { log('error', '[TED] Erreur reseau', { error: err.message }); return []; }

  log('info', '[TED] Reponse HTTP', { status: res.status, contentType: res.headers.get('content-type') });
  if (!res.ok) { const b = await res.text(); log('error', '[TED] HTTP non-OK', { status: res.status, body: b.substring(0,300) }); return []; }

  const raw = await res.text();
  if (!raw || !raw.trim()) { log('error', '[TED] Reponse vide'); return []; }

  let data;
  try { data = JSON.parse(raw); } catch (e) { log('error', '[TED] JSON invalide', { preview: raw.substring(0,200), error: e.message }); return []; }

  const notices = data.notices ?? data.results ?? [];
  log('info', '[TED] Notices trouvees', { count: notices.length });

  const results = [];
  for (const n of notices) {
    const id = n.ND?.[0] ?? n.id; if (!id) continue;
    const titleRaw = n.TI?.[0] ?? "Appel d'offres TED";
    const country  = (n.CY?.[0] ?? n.PC?.[0] ?? 'EU').toUpperCase().substring(0, 2);
    results.push({
      external_id: `ted-${id}`, title: String(titleRaw).substring(0,500),
      description: n.AC?.[0] ? String(n.AC[0]).substring(0,2000) : null,
      source_name: 'TED Europa', source_url: `https://ted.europa.eu/udl?uri=TED:NOTICE:${id}:TEXT:FR:HTML`,
      organism: n.AC?.[0] ? String(n.AC[0]).substring(0,255) : null,
      category: guessCategory(Array.isArray(n.PC) ? n.PC : [], titleRaw),
      country, city: null, postal_code: null, budget_min: null,
      budget_max: n.TVH?.[0] ? parseFloat(n.TVH[0]) : null, budget_currency: 'EUR',
      deadline: safeDate(n.DD?.[0]), published_at: new Date().toISOString(),
      type: 'public', status: 'active', documents: [],
      tags: (Array.isArray(n.PC) ? n.PC : []).slice(0,5),
    });
  }
  log('info', '[TED] Opportunites construites', { count: results.length });
  return results;
}
'''

# ── src/sources/boamp.js ──────────────────────────────────────────────────────
FILES["src/sources/boamp.js"] = r'''import fetch from 'node-fetch';
import { log } from '../logger.js';

const BOAMP_API = 'https://boamp-datadila.opendatasoft.com/api/explore/v2.1/catalog/datasets/boamp/records';

const KEYWORD_MAP = [
  ['nettoyage','Nettoyage'],['entretien','Nettoyage'],['proprete','Nettoyage'],
  ['plomberie','Plomberie'],['sanitaire','Plomberie'],['chauffage','Plomberie'],
  ['electricite','Electricite'],['eclairage','Electricite'],
  ['jardinage','Jardinage / Espaces verts'],['espaces verts','Jardinage / Espaces verts'],
  ['maconn','Maconnerie / BTP'],['travaux','Maconnerie / BTP'],['batiment','Maconnerie / BTP'],
  ['peinture','Peinture'],
  ['transport','Transport / Demenagement'],['demenagement','Transport / Demenagement'],
  ['securite','Securite'],['gardiennage','Securite'],
  ['informatique','Informatique / IT'],['maintenance','Reparation / Maintenance'],
];

function guessCategory(title = '') {
  const lower = title.toLowerCase();
  for (const [kw, cat] of KEYWORD_MAP) { if (lower.includes(kw)) return cat; }
  return 'Services generaux';
}

function safeDate(val) {
  if (!val) return null;
  try { const d = new Date(val); return isNaN(d.getTime()) ? null : d.toISOString(); } catch { return null; }
}

export async function fetchBOAMPOpportunities() {
  const since = new Date(Date.now() - 72 * 60 * 60 * 1000).toISOString().split('T')[0];
  const params = new URLSearchParams();
  params.set('select', 'idweb,objet,acheteur_nom,acheteur_ville,cpv,montant,date_limite_reponse,url_avis,date_publication,descripteur_libelle');
  params.set('where', `date_publication >= date'${since}' AND famille = 'AAPC'`);
  params.set('order_by', 'date_publication DESC');
  params.set('limit', '100');
  params.set('timezone', 'UTC');

  const url = `${BOAMP_API}?${params.toString()}`;
  log('info', '[BOAMP] Appel API', { url });

  let res;
  try {
    res = await fetch(url, {
      headers: { 'Accept': 'application/json', 'User-Agent': 'Proxigo-AI-Hunter/2.0' },
      signal: AbortSignal.timeout(25000),
    });
  } catch (err) { log('error', '[BOAMP] Erreur reseau', { error: err.message }); return []; }

  log('info', '[BOAMP] Reponse HTTP', { status: res.status, contentType: res.headers.get('content-type') });
  if (!res.ok) { const b = await res.text(); log('error', '[BOAMP] HTTP non-OK', { status: res.status, body: b.substring(0,400) }); return []; }

  const raw = await res.text();
  if (!raw || !raw.trim()) { log('error', '[BOAMP] Reponse vide'); return []; }

  let data;
  try { data = JSON.parse(raw); } catch (e) { log('error', '[BOAMP] JSON invalide', { preview: raw.substring(0,300), error: e.message }); return []; }

  const records = data.results ?? data.records ?? [];
  log('info', '[BOAMP] Records trouves', { count: records.length, total: data.total_count ?? '?' });

  const results = [];
  for (const f of records) {
    if (!f.idweb || !f.objet) continue;
    results.push({
      external_id: `boamp-${f.idweb}`, title: String(f.objet).substring(0,500),
      description: f.acheteur_nom ? `Acheteur : ${f.acheteur_nom}` : null,
      source_name: 'BOAMP France', source_url: f.url_avis ?? `https://www.boamp.fr/pages/detail/?g=${f.idweb}`,
      organism: f.acheteur_nom ? String(f.acheteur_nom).substring(0,255) : null,
      category: f.descripteur_libelle ?? guessCategory(f.objet),
      country: 'FR', city: f.acheteur_ville ?? null, postal_code: null,
      budget_min: null, budget_max: f.montant ? parseFloat(f.montant) : null, budget_currency: 'EUR',
      deadline: safeDate(f.date_limite_reponse), published_at: safeDate(f.date_publication) ?? new Date().toISOString(),
      type: 'public', status: 'active', documents: [], tags: f.cpv ? [String(f.cpv)] : [],
    });
  }
  log('info', '[BOAMP] Opportunites construites', { count: results.length });
  return results;
}
'''

# ── src/sources/belgium-rss.js ────────────────────────────────────────────────
FILES["src/sources/belgium-rss.js"] = r'''import fetch from 'node-fetch';
import { log } from '../logger.js';

const TED_BE = 'https://ted.europa.eu/api/v3.0/notices/search?fields=ND,TI,AC,CY,DD,TVH&q=CY%3ABE&pageSize=50&page=1';

const KEYWORD_MAP = [
  ['nettoyage','Nettoyage'],['cleaning','Nettoyage'],['entretien','Nettoyage'],
  ['plomberie','Plomberie'],['sanitaire','Plomberie'],
  ['electr','Electricite'],
  ['jardin','Jardinage / Espaces verts'],['espaces verts','Jardinage / Espaces verts'],
  ['macon','Maconnerie / BTP'],['construction','Maconnerie / BTP'],['travaux','Maconnerie / BTP'],
  ['demenagement','Transport / Demenagement'],['transport','Transport / Demenagement'],
  ['peinture','Peinture'],['securite','Securite'],['informatique','Informatique / IT'],
];

function guessCategory(text = '') {
  const lower = text.toLowerCase();
  for (const [kw, cat] of KEYWORD_MAP) { if (lower.includes(kw)) return cat; }
  return 'Services generaux';
}

function safeDate(val) {
  if (!val) return null;
  try { const d = new Date(val); return isNaN(d.getTime()) ? null : d.toISOString(); } catch { return null; }
}

export async function fetchBelgiumRSSOpportunities() {
  log('info', '[Belgique] Appel TED API filtre BE', { url: TED_BE });

  let res;
  try {
    res = await fetch(TED_BE, {
      headers: { 'Accept': 'application/json', 'User-Agent': 'Proxigo-AI-Hunter/2.0' },
      signal: AbortSignal.timeout(25000),
    });
  } catch (err) { log('error', '[Belgique] Erreur reseau', { error: err.message }); return []; }

  log('info', '[Belgique] Reponse HTTP', { status: res.status, contentType: res.headers.get('content-type') });
  if (!res.ok) { log('error', '[Belgique] HTTP non-OK', { status: res.status }); return []; }

  const raw = await res.text();
  if (!raw || !raw.trim()) { log('error', '[Belgique] Reponse vide'); return []; }

  let data;
  try { data = JSON.parse(raw); } catch (e) { log('error', '[Belgique] JSON invalide', { preview: raw.substring(0,200), error: e.message }); return []; }

  const notices = data.notices ?? data.results ?? [];
  log('info', '[Belgique] Notices TED/BE trouvees', { count: notices.length });

  const results = [];
  for (const n of notices) {
    const id = n.ND?.[0] ?? n.id; if (!id) continue;
    const titleRaw = n.TI?.[0] ?? 'Marche public Belgique';
    results.push({
      external_id: `be-ted-${id}`, title: String(titleRaw).substring(0,500),
      description: n.AC?.[0] ? String(n.AC[0]).substring(0,2000) : null,
      source_name: 'e-Procurement Belgique', source_url: `https://ted.europa.eu/udl?uri=TED:NOTICE:${id}:TEXT:FR:HTML`,
      organism: n.AC?.[0] ? String(n.AC[0]).substring(0,255) : null,
      category: guessCategory(titleRaw), country: 'BE', city: null, postal_code: null,
      budget_min: null, budget_max: n.TVH?.[0] ? parseFloat(n.TVH[0]) : null, budget_currency: 'EUR',
      deadline: safeDate(n.DD?.[0]), published_at: new Date().toISOString(),
      type: 'public', status: 'active', documents: [], tags: ['Belgique','Marche public'],
    });
  }
  log('info', '[Belgique] Opportunites construites', { count: results.length });
  return results;
}
'''

# ── src/sources/tendernet.js ──────────────────────────────────────────────────
FILES["src/sources/tendernet.js"] = r'''import fetch from 'node-fetch';
import { log } from '../logger.js';

const TENDERNET_BASE = 'https://www.tenderned.nl/api/publieksportaal/aanbestedingen';

const KEYWORD_MAP = [
  ['schoonmaak','Nettoyage'],['reiniging','Nettoyage'],
  ['loodgieter','Plomberie'],['sanitair','Plomberie'],
  ['elektric','Electricite'],['verlichting','Electricite'],
  ['tuin','Jardinage / Espaces verts'],['groenvoorziening','Jardinage / Espaces verts'],
  ['bouw','Maconnerie / BTP'],['renovatie','Maconnerie / BTP'],
  ['verhuiz','Transport / Demenagement'],['transport','Transport / Demenagement'],
  ['schilders','Peinture'],['beveiliging','Securite'],
  ['ict','Informatique / IT'],['software','Informatique / IT'],
];

function guessCategory(text = '') {
  const lower = text.toLowerCase();
  for (const [kw, cat] of KEYWORD_MAP) { if (lower.includes(kw)) return cat; }
  return 'Services generaux';
}

function safeDate(val) {
  if (!val) return null;
  try { const d = new Date(val); return isNaN(d.getTime()) ? null : d.toISOString(); } catch { return null; }
}

export async function fetchTenderNedOpportunities() {
  const url = `${TENDERNET_BASE}?page=0&size=50&sort=publicatieDatum,desc`;
  log('info', '[TenderNed] Appel API', { url });

  let res;
  try {
    res = await fetch(url, {
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'Proxigo-AI-Hunter/2.0',
        'Accept-Language': 'nl,fr;q=0.8',
      },
      signal: AbortSignal.timeout(25000),
    });
  } catch (err) { log('error', '[TenderNed] Erreur reseau', { error: err.message }); return []; }

  log('info', '[TenderNed] Reponse HTTP', { status: res.status, contentType: res.headers.get('content-type') });
  if (!res.ok) { const b = await res.text(); log('error', '[TenderNed] HTTP non-OK', { status: res.status, body: b.substring(0,400) }); return []; }

  const raw = await res.text();
  if (!raw || !raw.trim()) { log('error', '[TenderNed] Reponse vide'); return []; }

  let data;
  try { data = JSON.parse(raw); } catch (e) { log('error', '[TenderNed] JSON invalide', { preview: raw.substring(0,300), error: e.message }); return []; }

  let items = [];
  if (Array.isArray(data)) items = data;
  else if (Array.isArray(data.content)) items = data.content;
  else if (Array.isArray(data._embedded?.aanbestedingen)) items = data._embedded.aanbestedingen;
  else if (Array.isArray(data.aanbestedingen)) items = data.aanbestedingen;
  else if (Array.isArray(data.results)) items = data.results;

  log('info', '[TenderNed] Items trouves', { count: items.length, topLevelKeys: Object.keys(data).join(',') });

  const results = [];
  for (const item of items) {
    const id = item.id ?? item.aanbestedingId ?? item.publicatieId; if (!id) continue;
    const title = item.naam ?? item.titel ?? item.omschrijving ?? 'Aanbesteding NL';
    const description = item.omschrijving ?? item.opdrachtomschrijving ?? '';
    const city = item.plaatsVanUitvoering ?? item.opdrachtgeverPlaats ?? item.stad ?? '';
    results.push({
      external_id: `nl-${id}`, title: String(title).substring(0,500),
      description: String(description).substring(0,2000),
      source_name: 'TenderNed (NL)', source_url: `https://www.tenderned.nl/aankondigingen/overzicht/${id}`,
      organism: item.aanbestedendeDienst ?? item.opdrachtgever ?? null,
      category: guessCategory(`${title} ${description}`),
      country: 'NL', city: String(city).substring(0,100), postal_code: null,
      budget_min: null, budget_max: item.budgetTo ?? item.raming ?? null, budget_currency: 'EUR',
      deadline: safeDate(item.inschrijvenTot ?? item.sluitingsDatum ?? item.sluitingsDate),
      published_at: safeDate(item.publicatieDatum ?? item.datumPublicatie) ?? new Date().toISOString(),
      type: 'public', status: 'active', documents: [], tags: [],
    });
  }
  log('info', '[TenderNed] Opportunites construites', { count: results.length });
  return results;
}
'''

# ── src/sources/luxembourg.js ─────────────────────────────────────────────────
FILES["src/sources/luxembourg.js"] = r'''import fetch from 'node-fetch';
import Parser from 'rss-parser';
import { log } from '../logger.js';

const TED_LU = 'https://ted.europa.eu/api/v3.0/notices/search?fields=ND,TI,AC,CY,DD,TVH&q=CY%3ALU&pageSize=30&page=1';
const LU_RSS = 'https://www.marches-publics.lu/rss/avis';

const KEYWORD_MAP = [
  ['nettoyage','Nettoyage'],['entretien','Nettoyage'],['plomberie','Plomberie'],
  ['electr','Electricite'],['jardin','Jardinage / Espaces verts'],
  ['macon','Maconnerie / BTP'],['construction','Maconnerie / BTP'],['travaux','Maconnerie / BTP'],
  ['transport','Transport / Demenagement'],['peinture','Peinture'],['securite','Securite'],
];

function guessCategory(text = '') {
  const lower = text.toLowerCase();
  for (const [kw, cat] of KEYWORD_MAP) { if (lower.includes(kw)) return cat; }
  return 'Services generaux';
}

function safeDate(val) {
  if (!val) return null;
  try { const d = new Date(val); return isNaN(d.getTime()) ? null : d.toISOString(); } catch { return null; }
}

export async function fetchLuxembourgOpportunities() {
  log('info', '[Luxembourg] Appel TED API/LU', { url: TED_LU });

  try {
    const res = await fetch(TED_LU, {
      headers: { 'Accept': 'application/json', 'User-Agent': 'Proxigo-AI-Hunter/2.0' },
      signal: AbortSignal.timeout(25000),
    });
    log('info', '[Luxembourg] TED Reponse HTTP', { status: res.status, contentType: res.headers.get('content-type') });

    if (res.ok) {
      const raw = await res.text();
      if (raw && raw.trim()) {
        let data;
        try { data = JSON.parse(raw); } catch (e) { throw new Error('JSON invalide: ' + e.message); }
        const notices = data.notices ?? data.results ?? [];
        log('info', '[Luxembourg] Notices TED/LU trouvees', { count: notices.length });
        if (notices.length > 0) {
          const results = [];
          for (const n of notices) {
            const id = n.ND?.[0] ?? n.id; if (!id) continue;
            const titleRaw = n.TI?.[0] ?? 'Marche public Luxembourg';
            results.push({
              external_id: `lu-ted-${id}`, title: String(titleRaw).substring(0,500),
              description: n.AC?.[0] ? String(n.AC[0]).substring(0,2000) : null,
              source_name: 'Marches publics Luxembourg',
              source_url: `https://ted.europa.eu/udl?uri=TED:NOTICE:${id}:TEXT:FR:HTML`,
              organism: n.AC?.[0] ? String(n.AC[0]).substring(0,255) : null,
              category: guessCategory(titleRaw), country: 'LU', city: null, postal_code: null,
              budget_min: null, budget_max: n.TVH?.[0] ? parseFloat(n.TVH[0]) : null, budget_currency: 'EUR',
              deadline: safeDate(n.DD?.[0]), published_at: new Date().toISOString(),
              type: 'public', status: 'active', documents: [], tags: ['Luxembourg'],
            });
          }
          log('info', '[Luxembourg] Opportunites construites (TED)', { count: results.length });
          return results;
        }
      }
    }
  } catch (err) {
    log('warn', '[Luxembourg] TED API echouee, fallback RSS', { error: err.message });
  }

  log('info', '[Luxembourg] Fallback RSS', { url: LU_RSS });
  try {
    const parser = new Parser({ timeout: 20000, headers: { 'User-Agent': 'Proxigo-AI-Hunter/2.0' } });
    const feed = await parser.parseURL(LU_RSS);
    const items = feed.items ?? [];
    log('info', '[Luxembourg] Items RSS trouves', { count: items.length });
    const results = [];
    for (const item of items) {
      const id = item.guid ?? item.link ?? `lu-rss-${Date.now()}-${Math.random()}`;
      const title = item.title ?? 'Marche public Luxembourg';
      results.push({
        external_id: `lu-rss-${Buffer.from(String(id)).toString('base64').substring(0,60)}`,
        title: String(title).substring(0,500),
        description: String(item.contentSnippet ?? item.content ?? '').substring(0,2000),
        source_name: 'Marches publics Luxembourg', source_url: item.link ?? 'https://www.marches-publics.lu',
        organism: null, category: guessCategory(title), country: 'LU', city: null, postal_code: null,
        budget_min: null, budget_max: null, budget_currency: 'EUR', deadline: null,
        published_at: safeDate(item.pubDate) ?? new Date().toISOString(),
        type: 'public', status: 'active', documents: [], tags: ['Luxembourg'],
      });
    }
    log('info', '[Luxembourg] Opportunites construites (RSS)', { count: results.length });
    return results;
  } catch (err) {
    log('error', '[Luxembourg] RSS aussi echoue', { error: err.message });
    return [];
  }
}
'''

# ── src/index.js ──────────────────────────────────────────────────────────────
FILES["src/index.js"] = r'''import { createClient } from '@supabase/supabase-js';
import { fetchTEDOpportunities }        from './sources/ted.js';
import { fetchBelgiumRSSOpportunities } from './sources/belgium-rss.js';
import { fetchBOAMPOpportunities }      from './sources/boamp.js';
import { fetchTenderNedOpportunities }  from './sources/tendernet.js';
import { fetchLuxembourgOpportunities } from './sources/luxembourg.js';
import { log }                          from './logger.js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;
const INTERVAL_MS  = parseInt(process.env.CRON_INTERVAL_MS ?? '3600000', 10);

if (!SUPABASE_URL || !SUPABASE_KEY) { console.error('[FATAL] SUPABASE_URL et SUPABASE_KEY requis.'); process.exit(1); }

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

function buildRow(opp) {
  return {
    external_id:     String(opp.external_id),
    title:           String(opp.title ?? '').substring(0,500),
    description:     opp.description ? String(opp.description).substring(0,2000) : null,
    source_name:     String(opp.source_name ?? 'Inconnu'),
    source_url:      String(opp.source_url ?? ''),
    organism:        opp.organism ? String(opp.organism).substring(0,255) : null,
    category:        String(opp.category ?? 'Services generaux'),
    country:         String(opp.country ?? 'EU').substring(0,10),
    city:            opp.city ? String(opp.city).substring(0,100) : null,
    postal_code:     opp.postal_code ? String(opp.postal_code).substring(0,20) : null,
    budget_min:      opp.budget_min != null ? Number(opp.budget_min) : null,
    budget_max:      opp.budget_max != null ? Number(opp.budget_max) : null,
    budget_currency: String(opp.budget_currency ?? 'EUR'),
    deadline:        opp.deadline ?? null,
    published_at:    opp.published_at ?? new Date().toISOString(),
    type:            String(opp.type ?? 'public'),
    status:          'active',
    documents:       Array.isArray(opp.documents) ? opp.documents : [],
    tags:            Array.isArray(opp.tags) ? opp.tags : [],
  };
}

async function insertOpportunities(opps) {
  let inserted = 0, skipped = 0, errors = 0;
  for (const opp of opps) {
    try {
      const { error } = await supabase.from('opportunities').insert(buildRow(opp));
      if (error) { if (error.code === '23505') skipped++; else { log('error','[DB] Erreur insertion',{id:opp.external_id,code:error.code,msg:error.message}); errors++; } }
      else inserted++;
    } catch (err) { log('error','[DB] Exception',{error:err.message}); errors++; }
  }
  return { inserted, skipped, errors };
}

async function runCollectionCycle() {
  log('info', '=== Demarrage cycle ===', { interval_min: INTERVAL_MS / 60000 });
  const SOURCES = [
    { name: 'TED Europa',             fn: fetchTEDOpportunities },
    { name: 'e-Procurement Belgique', fn: fetchBelgiumRSSOpportunities },
    { name: 'BOAMP France',           fn: fetchBOAMPOpportunities },
    { name: 'TenderNed (NL)',         fn: fetchTenderNedOpportunities },
    { name: 'Luxembourg',             fn: fetchLuxembourgOpportunities },
  ];
  let totalFetched = 0, totalInserted = 0, totalSkipped = 0;
  for (const { name, fn } of SOURCES) {
    try {
      const opps = await fn();
      totalFetched += opps.length;
      if (opps.length > 0) {
        const { inserted, skipped, errors } = await insertOpportunities(opps);
        log('info', `[${name}] Resultat`, { fetched: opps.length, inserted, skipped, errors });
        totalInserted += inserted; totalSkipped += skipped;
      } else { log('warn', `[${name}] Aucune opportunite collectee`); }
    } catch (err) { log('error', `[${name}] Erreur fatale`, { error: err.message }); }
  }
  log('info', '=== Fin cycle ===', { total_fetched: totalFetched, total_inserted: totalInserted, total_skipped: totalSkipped });
}

log('info', 'Proxigo AI Hunter v2 demarre', { node: process.version, interval_min: INTERVAL_MS / 60000 });
runCollectionCycle().catch(err => log('error', '[FATAL] Cycle initial', { error: err.message }));
setInterval(() => runCollectionCycle().catch(err => log('error', '[FATAL] Cycle periodique', { error: err.message })), INTERVAL_MS);
'''

# ── Write all files ────────────────────────────────────────────────────────────
def write(rel_path, content):
    abs_path = os.path.join(ROOT, rel_path)
    os.makedirs(os.path.dirname(abs_path), exist_ok=True)
    with open(abs_path, 'w', encoding='utf-8') as f:
        f.write(content)
    print(f"  ✓ {rel_path}")

print("\n🔧 Proxigo AI Hunter v2 — Reconstruction des fichiers\n")
for rel_path, content in FILES.items():
    write(rel_path, content)

print("\n✅ Tous les fichiers ont été écrits.\n")
print("📋 Commandes Git :\n")
print("  git add .")
print('  git commit -m "fix: AI Hunter v2 — correction 5 sources, Node 20, colonnes Supabase"')
print("  git push origin main\n")
