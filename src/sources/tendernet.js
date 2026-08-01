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
