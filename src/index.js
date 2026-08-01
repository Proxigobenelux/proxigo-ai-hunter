// ─── Proxigo AI Hunter v2 — Entry Point ──────────────────────────────────────

import { createClient } from '@supabase/supabase-js';
import WebSocket from 'ws';
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

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  realtime: {
    transport: WebSocket,
  },
});

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
