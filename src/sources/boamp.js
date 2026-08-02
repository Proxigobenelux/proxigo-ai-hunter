// ─── Source : BOAMP France ────────────────────────────────────────────────────
// API OpenDataSoft sur www.boamp.fr
// Vrais champs : nomacheteur, dateparution, datelimitereponse, descripteur_libelle, nature
// Filtre : nature='APPEL_OFFRE' (pas famille='AAPC' qui n'existe plus en tant que valeur de filtre)
// Doc : https://www.boamp.fr/api/explore/v2.1/console/

import fetch from 'node-fetch';
import { log } from '../logger.js';

const BOAMP_API = 'https://www.boamp.fr/api/explore/v2.1/catalog/datasets/boamp/records';

const KEYWORD_MAP = [
  ['nettoyage', 'Nettoyage'], ['entretien', 'Nettoyage'], ['propreté', 'Nettoyage'], ['désinfection', 'Nettoyage'],
  ['plomberie', 'Plomberie'], ['sanitaire', 'Plomberie'], ['chauffage', 'Plomberie'],
  ['électricité', 'Électricité'], ['éclairage', 'Électricité'], ['courant fort', 'Électricité'],
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
    return isNaN(d.getTime()) ? null : d.toISOString();
  } catch {
    return null;
  }
}

function extractDescripteur(descripteur) {
  if (!descripteur) return null;
  if (Array.isArray(descripteur)) return descripteur[0] ?? null;
  return String(descripteur);
}

export async function fetchBOAMPOpportunities() {
  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

  // Vrais champs BOAMP v2 : nomacheteur, dateparution, datelimitereponse
  const params = new URLSearchParams();
  params.set('select', 'idweb,objet,nomacheteur,code_departement_prestation,descripteur_libelle,datelimitereponse,dateparution,famille,nature');
  params.set('where', `dateparution >= date'${since}' AND nature='APPEL_OFFRE'`);
  params.set('order_by', 'dateparution DESC');
  params.set('limit', '100');
  params.set('timezone', 'UTC');
  params.set('lang', 'fr');

  const url = `${BOAMP_API}?${params.toString()}`;
  log('info', '[BOAMP] Appel API', { url: url.substring(0, 200) });

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

  log('info', '[BOAMP] Réponse HTTP', { status: res.status });

  if (!res.ok) {
    const errBody = await res.text();
    log('error', '[BOAMP] HTTP non-OK', { status: res.status, body: errBody.substring(0, 400) });
    return fetchBOAMPFallback(since);
  }

  let data;
  try {
    data = await res.json();
  } catch (e) {
    log('error', '[BOAMP] JSON invalide', { error: e.message });
    return [];
  }

  const records = data.results ?? [];
  log('info', '[BOAMP] Records trouvés', { count: records.length, total: data.total_count ?? '?' });

  return mapBoampRecords(records);
}

// Fallback : sans filtre nature (retourne tout type d'avis)
async function fetchBOAMPFallback(since) {
  const params = new URLSearchParams();
  params.set('select', 'idweb,objet,nomacheteur,code_departement_prestation,descripteur_libelle,datelimitereponse,dateparution');
  params.set('where', `dateparution >= date'${since}'`);
  params.set('order_by', 'dateparution DESC');
  params.set('limit', '50');
  params.set('timezone', 'UTC');

  const url = `${BOAMP_API}?${params.toString()}`;
  log('info', '[BOAMP] Fallback sans filtre nature', { url: url.substring(0, 200) });

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
    const records = data.results ?? [];
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

    const descripteur = extractDescripteur(f.descripteur_libelle);

    results.push({
      external_id:     `boamp-${f.idweb}`,
      title:           String(f.objet).substring(0, 500),
      description:     f.nomacheteur ? `Acheteur : ${f.nomacheteur}` : null,
      source_name:     'BOAMP France',
      source_url:      `https://www.boamp.fr/pages/detail/?g=${f.idweb}`,
      organism:        f.nomacheteur ? String(f.nomacheteur).substring(0, 255) : null,
      category:        descripteur ?? guessCategory(f.objet),
      country:         'FR',
      city:            f.code_departement_prestation ?? null,
      postal_code:     null,
      budget_min:      null,
      budget_max:      null,
      budget_currency: 'EUR',
      deadline:        safeDate(f.datelimitereponse),
      published_at:    safeDate(f.dateparution) ?? new Date().toISOString(),
      type:            'public',
      status:          'active',
      documents:       [],
      tags:            descripteur ? [descripteur] : [],
    });
  }

  log('info', '[BOAMP] Opportunités construites', { count: results.length });
  return results;
}
