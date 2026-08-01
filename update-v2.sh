#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════════════════
#  Proxigo AI Hunter — update-v2.sh
#  Ce script remplace intégralement les 8 fichiers corrigés dans ~/proxigo-ai-hunter
#  puis pousse le tout sur GitHub (branche main).
#
#  Usage :
#    chmod +x update-v2.sh && ./update-v2.sh
# ═══════════════════════════════════════════════════════════════════════════════

set -e

REPO_DIR="${1:-$HOME/proxigo-ai-hunter}"

if [ ! -d "$REPO_DIR" ]; then
  echo "❌  Dossier introuvable : $REPO_DIR"
  echo "    Passe le chemin en argument : ./update-v2.sh /chemin/vers/proxigo-ai-hunter"
  exit 1
fi

cd "$REPO_DIR"
echo "📂  Dossier : $(pwd)"

mkdir -p src/sources

# ─────────────────────────────────────────────────────────────────────────────
# 1. package.json
# ─────────────────────────────────────────────────────────────────────────────
cat > package.json << 'ENDOFFILE'
{
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
ENDOFFILE
echo "✅  package.json"

# ─────────────────────────────────────────────────────────────────────────────
# 2. src/logger.js
# ─────────────────────────────────────────────────────────────────────────────
cat > src/logger.js << 'ENDOFFILE'
// ─── Proxigo AI Hunter — Logger ───────────────────────────────────────────────
export function log(level, message, meta = {}) {
  const entry = { ts: new Date().toISOString(), level, message, ...meta };
  console.log(JSON.stringify(entry));
}
ENDOFFILE
echo "✅  src/logger.js"

# ─────────────────────────────────────────────────────────────────────────────
# 3. src/index.js
# ─────────────────────────────────────────────────────────────────────────────
cat > src/index.js << 'ENDOFFILE'
// ─── Proxigo AI Hunter v2 — Entry Point ──────────────────────────────────────

import { createClient } from '@supabase/supabase-js';
import { fetchTEDOpportunities }        from './sources/ted.js';
import { fetchBelgiumRSSOpportunities } from './sources/belgium-rss.js';
import { fetchBOAMPOpportunities }      from './sources/boamp.js';
import { fetchTenderNedOpportunities }  from './sources/tendernet.js';
import { fetchLuxembourgOpportunities } from './sources/luxembourg.js';
import { log }                          from './logger.js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;
const INTERVAL_MS  = parseInt(process.env.CRON_INTERVAL_MS ?? '3600000', 10);

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('[FATAL] SUPABASE_URL et SUPABASE_KEY sont requis.');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// ── Colonnes exactes de la table opportunities ────────────────────────────────
function buildRow(opp) {
  return {
    external_id:     String(opp.external_id),
    title:           String(opp.title ?? '').substring(0, 500),
    description:     opp.description ? String(opp.description).substring(0, 2000) : null,
    source_name:     String(opp.source_name ?? 'Inconnu'),
    source_url:      String(opp.source_url ?? ''),
    organism:        opp.organism ? String(opp.organism).substring(0, 255) : null,
    category:        String(opp.category ?? 'Services généraux'),
    country:         String(opp.country ?? 'EU').substring(0, 10),
    city:            opp.city ? String(opp.city).substring(0, 100) : null,
    postal_code:     opp.postal_code ? String(opp.postal_code).substring(0, 20) : null,
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
  let inserted = 0;
  let skipped  = 0;
  let errors   = 0;

  for (const opp of opps) {
    try {
      const row = buildRow(opp);
      const { error } = await supabase.from('opportunities').insert(row);

      if (error) {
        if (error.code === '23505') {
          skipped++;
        } else {
          log('error', '[DB] Erreur insertion', {
            id:   opp.external_id,
            code: error.code,
            msg:  error.message,
          });
          errors++;
        }
      } else {
        inserted++;
      }
    } catch (err) {
      log('error', '[DB] Exception insertion', { error: err.message });
      errors++;
    }
  }

  return { inserted, skipped, errors };
}

// ── Cycle de collecte ────────────────────────────────────────────────────────
async function runCollectionCycle() {
  log('info', '=== Démarrage cycle de collecte ===', { interval_min: INTERVAL_MS / 60000 });

  const SOURCES = [
    { name: 'TED Europa',             fn: fetchTEDOpportunities },
    { name: 'e-Procurement Belgique', fn: fetchBelgiumRSSOpportunities },
    { name: 'BOAMP France',           fn: fetchBOAMPOpportunities },
    { name: 'TenderNed (NL)',         fn: fetchTenderNedOpportunities },
    { name: 'Luxembourg',             fn: fetchLuxembourgOpportunities },
  ];

  let totalFetched  = 0;
  let totalInserted = 0;
  let totalSkipped  = 0;
  let totalErrors   = 0;

  for (const { name, fn } of SOURCES) {
    try {
      const opps = await fn();
      totalFetched += opps.length;

      if (opps.length > 0) {
        const { inserted, skipped, errors } = await insertOpportunities(opps);
        log('info', `[${name}] Résultat insertion`, { fetched: opps.length, inserted, skipped, errors });
        totalInserted += inserted;
        totalSkipped  += skipped;
        totalErrors   += errors;
      } else {
        log('warn', `[${name}] Aucune opportunité collectée`);
      }
    } catch (err) {
      log('error', `[${name}] Erreur fatale source`, { error: err.message, stack: err.stack?.substring(0, 300) });
    }
  }

  log('info', '=== Fin cycle ===', {
    total_fetched:  totalFetched,
    total_inserted: totalInserted,
    total_skipped:  totalSkipped,
    total_errors:   totalErrors,
  });
}

// ── Start ────────────────────────────────────────────────────────────────────
log('info', 'Proxigo AI Hunter v2 démarré', {
  node_version:  process.version,
  interval_min:  INTERVAL_MS / 60000,
  supabase_url:  SUPABASE_URL?.substring(0, 40) + '...',
});

runCollectionCycle().catch(err => {
  log('error', '[FATAL] Cycle initial échoué', { error: err.message });
});

setInterval(() => {
  runCollectionCycle().catch(err => {
    log('error', '[FATAL] Cycle périodique échoué', { error: err.message });
  });
}, INTERVAL_MS);
ENDOFFILE
echo "✅  src/index.js"

# ─────────────────────────────────────────────────────────────────────────────
# 4. src/sources/ted.js
# ─────────────────────────────────────────────────────────────────────────────
cat > src/sources/ted.js << 'ENDOFFILE'
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
ENDOFFILE
echo "✅  src/sources/ted.js"

# ─────────────────────────────────────────────────────────────────────────────
# 5. src/sources/boamp.js
# ─────────────────────────────────────────────────────────────────────────────
cat > src/sources/boamp.js << 'ENDOFFILE'
// ─── Source : BOAMP France ────────────────────────────────────────────────────
// API OpenDataSoft — dataset "boamp" sur boamp-datadila.opendatasoft.com
// Filtre : famille AAPC (Avis d'Appel à la Concurrence), dernières 72h

import fetch from 'node-fetch';
import { log } from '../logger.js';

const BOAMP_API = 'https://boamp-datadila.opendatasoft.com/api/explore/v2.1/catalog/datasets/boamp/records';

const KEYWORD_MAP = [
  ['nettoyage', 'Nettoyage'], ['entretien', 'Nettoyage'], ['propreté', 'Nettoyage'], ['désinfection', 'Nettoyage'],
  ['plomberie', 'Plomberie'], ['sanitaire', 'Plomberie'], ['chauffage', 'Plomberie'],
  ['électricité', 'Électricité'], ['éclairage', 'Électricité'], ['courant', 'Électricité'],
  ['jardinage', 'Jardinage / Espaces verts'], ['espaces verts', 'Jardinage / Espaces verts'], ['tonte', 'Jardinage / Espaces verts'],
  ['maçonnerie', 'Maçonnerie / BTP'], ['travaux', 'Maçonnerie / BTP'], ['bâtiment', 'Maçonnerie / BTP'], ['construction', 'Maçonnerie / BTP'],
  ['peinture', 'Peinture'], ['façade', 'Peinture'],
  ['transport', 'Transport / Déménagement'], ['déménagement', 'Transport / Déménagement'], ['logistique', 'Transport / Déménagement'],
  ['sécurité', 'Sécurité'], ['gardiennage', 'Sécurité'], ['surveillance', 'Sécurité'],
  ['informatique', 'Informatique / IT'], ['numérique', 'Informatique / IT'], ['réseau', 'Informatique / IT'],
  ['maintenance', 'Réparation / Maintenance'], ['réparation', 'Réparation / Maintenance'],
];

function guessCategory(title = '') {
  const lower = title.toLowerCase();
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

export async function fetchBOAMPOpportunities() {
  const since = new Date(Date.now() - 72 * 60 * 60 * 1000).toISOString().split('T')[0];

  // Paramètres encodés manuellement pour éviter les doubles-encodages
  const params = new URLSearchParams();
  params.set('select', 'idweb,objet,acheteur_nom,acheteur_ville,cpv,montant,date_limite_reponse,url_avis,date_publication,descripteur_libelle,famille');
  params.set('where', `date_publication >= date'${since}' AND famille = 'AAPC'`);
  params.set('order_by', 'date_publication DESC');
  params.set('limit', '100');
  params.set('timezone', 'UTC');

  const url = `${BOAMP_API}?${params.toString()}`;
  log('info', '[BOAMP] Appel API', { url });

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
    log('error', '[BOAMP] Erreur réseau', { error: err.message });
    return [];
  }

  log('info', '[BOAMP] Réponse HTTP', { status: res.status, contentType: res.headers.get('content-type') });

  if (!res.ok) {
    const body = await res.text();
    log('error', '[BOAMP] HTTP non-OK', { status: res.status, body: body.substring(0, 400) });
    return [];
  }

  const raw = await res.text();
  if (!raw || raw.trim().length === 0) {
    log('error', '[BOAMP] Réponse vide');
    return [];
  }

  let data;
  try {
    data = JSON.parse(raw);
  } catch (parseErr) {
    log('error', '[BOAMP] JSON invalide', { preview: raw.substring(0, 300), error: parseErr.message });
    return [];
  }

  const records = data.results ?? data.records ?? [];
  log('info', '[BOAMP] Records trouvés', { count: records.length, total: data.total_count ?? '?' });

  const results = [];
  for (const f of records) {
    if (!f.idweb || !f.objet) continue;

    results.push({
      external_id:     `boamp-${f.idweb}`,
      title:           String(f.objet).substring(0, 500),
      description:     f.acheteur_nom ? `Acheteur : ${f.acheteur_nom}` : null,
      source_name:     'BOAMP France',
      source_url:      f.url_avis ?? `https://www.boamp.fr/pages/detail/?g=${f.idweb}`,
      organism:        f.acheteur_nom ? String(f.acheteur_nom).substring(0, 255) : null,
      category:        f.descripteur_libelle ?? guessCategory(f.objet),
      country:         'FR',
      city:            f.acheteur_ville ?? null,
      postal_code:     null,
      budget_min:      null,
      budget_max:      f.montant ? parseFloat(f.montant) : null,
      budget_currency: 'EUR',
      deadline:        safeDate(f.date_limite_reponse),
      published_at:    safeDate(f.date_publication) ?? new Date().toISOString(),
      type:            'public',
      status:          'active',
      documents:       [],
      tags:            f.cpv ? [String(f.cpv)] : [],
    });
  }

  log('info', '[BOAMP] Opportunités construites', { count: results.length });
  return results;
}
ENDOFFILE
echo "✅  src/sources/boamp.js"

# ─────────────────────────────────────────────────────────────────────────────
# 6. src/sources/belgium-rss.js
# ─────────────────────────────────────────────────────────────────────────────
cat > src/sources/belgium-rss.js << 'ENDOFFILE'
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
ENDOFFILE
echo "✅  src/sources/belgium-rss.js"

# ─────────────────────────────────────────────────────────────────────────────
# 7. src/sources/tendernet.js
# ─────────────────────────────────────────────────────────────────────────────
cat > src/sources/tendernet.js << 'ENDOFFILE'
// ─── Source : TenderNed (Pays-Bas) ────────────────────────────────────────────
// API REST publique — structure de réponse 2024 couvrant toutes les variantes.

import fetch from 'node-fetch';
import { log } from '../logger.js';

const TENDERNET_BASE = 'https://www.tenderned.nl/api/publieksportaal/aanbestedingen';

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
    if (isNaN(d.getTime())) return null;
    return d.toISOString();
  } catch {
    return null;
  }
}

export async function fetchTenderNedOpportunities() {
  const url = `${TENDERNET_BASE}?page=0&size=50&sort=publicatieDatum,desc`;
  log('info', '[TenderNed] Appel API', { url });

  let res;
  try {
    res = await fetch(url, {
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'Proxigo-AI-Hunter/2.0 (contact@proxigo.eu)',
        'Accept-Language': 'nl,fr;q=0.8',
      },
      signal: AbortSignal.timeout(25000),
    });
  } catch (err) {
    log('error', '[TenderNed] Erreur réseau', { error: err.message });
    return [];
  }

  log('info', '[TenderNed] Réponse HTTP', { status: res.status, contentType: res.headers.get('content-type') });

  if (!res.ok) {
    const body = await res.text();
    log('error', '[TenderNed] HTTP non-OK', { status: res.status, body: body.substring(0, 400) });
    return [];
  }

  const raw = await res.text();
  if (!raw || raw.trim().length === 0) {
    log('error', '[TenderNed] Réponse vide');
    return [];
  }

  let data;
  try {
    data = JSON.parse(raw);
  } catch (parseErr) {
    log('error', '[TenderNed] JSON invalide', { preview: raw.substring(0, 300), error: parseErr.message });
    return [];
  }

  // Couvre toutes les structures connues de l'API TenderNed
  let items = [];
  if (Array.isArray(data)) {
    items = data;
  } else if (Array.isArray(data.content)) {
    items = data.content;
  } else if (Array.isArray(data._embedded?.aanbestedingen)) {
    items = data._embedded.aanbestedingen;
  } else if (Array.isArray(data.aanbestedingen)) {
    items = data.aanbestedingen;
  } else if (Array.isArray(data.results)) {
    items = data.results;
  }

  log('info', '[TenderNed] Items trouvés', { count: items.length, topLevelKeys: Object.keys(data).join(',') });

  const results = [];
  for (const item of items) {
    const id = item.id ?? item.aanbestedingId ?? item.publicatieId;
    if (!id) continue;

    const title       = item.naam ?? item.titel ?? item.omschrijving ?? 'Aanbesteding NL';
    const description = item.omschrijving ?? item.opdrachtomschrijving ?? '';
    const city        = item.plaatsVanUitvoering ?? item.opdrachtgeverPlaats ?? item.stad ?? '';

    results.push({
      external_id:     `nl-${id}`,
      title:           String(title).substring(0, 500),
      description:     String(description).substring(0, 2000),
      source_name:     'TenderNed (NL)',
      source_url:      `https://www.tenderned.nl/aankondigingen/overzicht/${id}`,
      organism:        item.aanbestedendeDienst ?? item.opdrachtgever ?? null,
      category:        guessCategory(`${title} ${description}`),
      country:         'NL',
      city:            String(city).substring(0, 100),
      postal_code:     null,
      budget_min:      null,
      budget_max:      item.budgetTo ?? item.raming ?? item.geraamdeWaarde ?? null,
      budget_currency: 'EUR',
      deadline:        safeDate(item.inschrijvenTot ?? item.sluitingsDatum ?? item.sluitingsDate),
      published_at:    safeDate(item.publicatieDatum ?? item.datumPublicatie) ?? new Date().toISOString(),
      type:            'public',
      status:          'active',
      documents:       [],
      tags:            [],
    });
  }

  log('info', '[TenderNed] Opportunités construites', { count: results.length });
  return results;
}
ENDOFFILE
echo "✅  src/sources/tendernet.js"

# ─────────────────────────────────────────────────────────────────────────────
# 8. src/sources/luxembourg.js
# ─────────────────────────────────────────────────────────────────────────────
cat > src/sources/luxembourg.js << 'ENDOFFILE'
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
ENDOFFILE
echo "✅  src/sources/luxembourg.js"

# ─────────────────────────────────────────────────────────────────────────────
# Git push
# ─────────────────────────────────────────────────────────────────────────────
echo ""
echo "🚀  Commit et push vers GitHub..."
git add .
git commit -m "fix: AI Hunter v2 — 5 sources corrigées, Node 20, colonnes Supabase alignées"
git push origin main

echo ""
echo "═══════════════════════════════════════════════════════════════════════"
echo "✅  AI Hunter v2 poussé sur GitHub."
echo "    Railway redéploie automatiquement. Surveille les logs Railway et"
echo "    confirme que total_inserted > 0 dans le premier cycle."
echo "═══════════════════════════════════════════════════════════════════════"
