// ─── Source : BOAMP France ────────────────────────────────────────────────────
// API OpenDataSoft hébergée sur www.boamp.fr (pas boamp-datadila.opendatasoft.com)
// Filtre : famille AAPC (Avis d'Appel à la Concurrence), dernières 72h
// Doc : https://www.boamp.fr/api-console/explore/v2.1/

import fetch from 'node-fetch';
import { log } from '../logger.js';

const BOAMP_API = 'https://www.boamp.fr/api/explore/v2.1/catalog/datasets/boamp/records';

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

  // ODSQL : guillemets simples autour des valeurs string, date() pour les dates
  const params = new URLSearchParams();
  params.set('select', 'idweb,objet,acheteur_nom,acheteur_ville,cpv,montant,date_limite_reponse,url_avis,date_publication,descripteur_libelle,famille');
  params.set('where', `date_publication >= date'${since}' AND famille='AAPC'`);
  params.set('order_by', 'date_publication DESC');
  params.set('limit', '100');
  params.set('timezone', 'UTC');
  params.set('lang', 'fr');

  const url = `${BOAMP_API}?${params.toString()}`;
  log('info', '[BOAMP] Appel API', { url });

  let res;
  try {
    res = await fetch(url, {
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'Proxigo-AI-Hunter/2.0 (contact@proxigo.eu)',
      },
      signal: AbortSignal.timeout(30000),
    });
  } catch (err) {
    log('error', '[BOAMP] Erreur réseau', { error: err.message });
    return [];
  }

  log('info', '[BOAMP] Réponse HTTP', { status: res.status, contentType: res.headers.get('content-type') });

  if (!res.ok) {
    const errBody = await res.text();
    log('error', '[BOAMP] HTTP non-OK', { status: res.status, body: errBody.substring(0, 400) });

    // Fallback : sans filtre famille pour voir si l'API répond
    return fetchBOAMPFallback(since);
  }

  const raw = await res.text();
  if (!raw || raw.trim().length === 0) {
    log('error', '[BOAMP] Réponse vide');
    return [];
  }

  let data;
  try {
    data = JSON.parse(raw);
  } catch (e) {
    log('error', '[BOAMP] JSON invalide', { preview: raw.substring(0, 300), error: e.message });
    return [];
  }

  const records = data.results ?? data.records ?? [];
  log('info', '[BOAMP] Records trouvés', { count: records.length, total: data.total_count ?? '?' });

  return mapBoampRecords(records);
}

// Fallback sans filtre famille (diagnose si le problème vient du where)
async function fetchBOAMPFallback(since) {
  const params = new URLSearchParams();
  params.set('select', 'idweb,objet,acheteur_nom,acheteur_ville,cpv,montant,date_limite_reponse,url_avis,date_publication,descripteur_libelle');
  params.set('where', `date_publication >= date'${since}'`);
  params.set('order_by', 'date_publication DESC');
  params.set('limit', '50');
  params.set('timezone', 'UTC');

  const url = `${BOAMP_API}?${params.toString()}`;
  log('info', '[BOAMP] Fallback sans filtre famille', { url });

  try {
    const res = await fetch(url, {
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'Proxigo-AI-Hunter/2.0 (contact@proxigo.eu)',
      },
      signal: AbortSignal.timeout(30000),
    });

    if (!res.ok) {
      log('error', '[BOAMP] Fallback HTTP non-OK', { status: res.status });
      return [];
    }

    const data = await res.json();
    const records = data.results ?? data.records ?? [];
    log('info', '[BOAMP] Fallback records', { count: records.length });
    return mapBoampRecords(records);
  } catch (err) {
    log('error', '[BOAMP] Fallback exception', { error: err.message });
    return [];
  }
}

function mapBoampRecords(records) {
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
