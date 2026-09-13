// ─── Source : BOAMP France ────────────────────────────────────────────────────
// API OpenDataSoft v2.1
// Dataset : boamp
//
// Champs utilisés :
// idweb, objet, nomacheteur, code_departement_prestation,
// descripteur_libelle, descripteur_code, datelimitereponse,
// dateparution, nature, url_avis

import fetch from 'node-fetch';
import { log } from '../logger.js';

const BOAMP_API =
  'https://boamp-datadila.opendatasoft.com/api/explore/v2.1/catalog/datasets/boamp/records';

const KEYWORD_MAP = [
  ['nettoyage', 'Nettoyage'],
  ['entretien', 'Nettoyage'],
  ['propreté', 'Nettoyage'],
  ['désinfection', 'Nettoyage'],

  ['plomberie', 'Plomberie'],
  ['sanitaire', 'Plomberie'],
  ['chauffage', 'Plomberie'],

  ['électricité', 'Électricité'],
  ['éclairage', 'Électricité'],
  ['courant fort', 'Électricité'],

  ['jardinage', 'Jardinage / Espaces verts'],
  ['espaces verts', 'Jardinage / Espaces verts'],
  ['tonte', 'Jardinage / Espaces verts'],

  ['maçonnerie', 'Maçonnerie / BTP'],
  ['travaux', 'Maçonnerie / BTP'],
  ['bâtiment', 'Maçonnerie / BTP'],
  ['construction', 'Maçonnerie / BTP'],

  ['peinture', 'Peinture'],
  ['façade', 'Peinture'],

  ['transport', 'Transport / Déménagement'],
  ['déménagement', 'Transport / Déménagement'],
  ['logistique', 'Transport / Déménagement'],

  ['sécurité', 'Sécurité'],
  ['gardiennage', 'Sécurité'],
  ['surveillance', 'Sécurité'],

  ['informatique', 'Informatique / IT'],
  ['numérique', 'Informatique / IT'],
  ['réseau', 'Informatique / IT'],

  ['maintenance', 'Réparation / Maintenance'],
  ['réparation', 'Réparation / Maintenance'],
];

function guessCategory(title = '', descriptors = '') {
  const text = `${title} ${descriptors}`.toLowerCase();

  for (const [keyword, category] of KEYWORD_MAP) {
    if (text.includes(keyword)) {
      return category;
    }
  }

  return 'Services généraux';
}

function safeDate(value) {
  if (!value) {
    return null;
  }

  try {
    const date = new Date(value);

    if (Number.isNaN(date.getTime())) {
      return null;
    }

    return date.toISOString();
  } catch {
    return null;
  }
}

function extractText(value) {
  if (value === null || value === undefined) {
    return null;
  }

  if (typeof value === 'string' || typeof value === 'number') {
    return String(value);
  }

  if (Array.isArray(value)) {
    return value
      .map(item => extractText(item))
      .filter(Boolean)
      .join(', ');
  }

  if (typeof value === 'object') {
    return Object.values(value)
      .map(item => extractText(item))
      .filter(Boolean)
      .join(', ');
  }

  return null;
}

async function fetchBOAMPRecords({
  since,
  limit = 100,
  withNatureFilter = true,
}) {
  const params = new URLSearchParams();

  params.set(
    'select',
    [
      'idweb',
      'objet',
      'nomacheteur',
      'code_departement_prestation',
      'descripteur_libelle',
      'descripteur_code',
      'datelimitereponse',
      'dateparution',
      'nature',
      'url_avis',
    ].join(',')
  );

  if (withNatureFilter) {
    params.set(
      'where',
      `dateparution >= date'${since}' AND nature = 'APPEL_OFFRE'`
    );
  } else {
    params.set(
      'where',
      `dateparution >= date'${since}'`
    );
  }

  params.set('order_by', 'dateparution DESC');
  params.set('limit', String(limit));
  params.set('timezone', 'UTC');
  params.set('lang', 'fr');

  const url = `${BOAMP_API}?${params.toString()}`;

  log('info', '[BOAMP] Appel API', {
    url: url.substring(0, 300),
  });

  const response = await fetch(url, {
    method: 'GET',
    headers: {
      Accept: 'application/json',
      'User-Agent': 'Proxigo-AI-Hunter/2.0 (contact@proxigo.eu)',
    },
    signal: AbortSignal.timeout(30000),
  });

  if (!response.ok) {
    const body = await response.text();

    throw new Error(
      `BOAMP HTTP ${response.status}: ${body.substring(0, 500)}`
    );
  }

  return response.json();
}

export async function fetchBOAMPOpportunities() {
  const since = new Date(
    Date.now() - 7 * 24 * 60 * 60 * 1000
  )
    .toISOString()
    .split('T')[0];

  let data;

  try {
    data = await fetchBOAMPRecords({
      since,
      limit: 100,
      withNatureFilter: true,
    });
  } catch (error) {
    log('warn', '[BOAMP] Filtre APPEL_OFFRE échoué', {
      error: error.message,
    });

    try {
      data = await fetchBOAMPRecords({
        since,
        limit: 100,
        withNatureFilter: false,
      });

      log('info', '[BOAMP] Fallback sans filtre nature');
    } catch (fallbackError) {
      log('error', '[BOAMP] Fallback échoué', {
        error: fallbackError.message,
      });

      return [];
    }
  }

  const records = Array.isArray(data.results)
    ? data.results
    : [];

  log('info', '[BOAMP] Records trouvés', {
    count: records.length,
    total: data.total_count ?? 0,
  });

  return mapBoampRecords(records);
}

function mapBoampRecords(records) {
  const results = [];

  for (const record of records) {
    if (!record.idweb || !record.objet) {
      continue;
    }

    const title =
      String(record.objet).substring(0, 500);

    const descriptors =
      extractText(record.descripteur_libelle);

    const descriptorCodes =
      extractText(record.descripteur_code);

    const organism =
      record.nomacheteur
        ? String(record.nomacheteur).substring(0, 255)
        : null;

    const deadline =
      safeDate(record.datelimitereponse);

    const publishedAt =
      safeDate(record.dateparution) ??
      new Date().toISOString();

    const officialUrl =
      record.url_avis ??
      `https://www.boamp.fr/pages/avis/?q=idweb:${encodeURIComponent(record.idweb)}`;

    results.push({
      external_id:
        `boamp-${record.idweb}`,

      title,

      description:
        organism
          ? `Acheteur : ${organism}`
          : null,

      source_name:
        'BOAMP France',

      source_url:
        officialUrl,

      organism,

      category:
        guessCategory(title, descriptors),

      country:
        'FR',

      // code_departement_prestation est un département,
      // pas une ville : on ne le met donc pas dans city.
      city:
        null,

      postal_code:
        null,

      budget_min:
        null,

      budget_max:
        null,

      budget_currency:
        'EUR',

      deadline,

      published_at:
        publishedAt,

      type:
        'public',

      status:
        deadline && new Date(deadline) < new Date()
          ? 'closed'
          : 'active',

      documents:
        [],

      tags:
        [
          ...(descriptors ? [descriptors] : []),
          ...(descriptorCodes ? [descriptorCodes] : []),
        ].slice(0, 5),
    });
  }

  log('info', '[BOAMP] Opportunités construites', {
    count: results.length,
  });

  return results;
}
