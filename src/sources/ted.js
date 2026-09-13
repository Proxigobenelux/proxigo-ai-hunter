// ─── Source : TED Europa v3 ────────────────────────────────────────────────────
// POST https://api.ted.europa.eu/v3/notices/search

import fetch from 'node-fetch';
import { log } from '../logger.js';

const TED_SEARCH = 'https://api.ted.europa.eu/v3/notices/search';

const TED_HEADERS = {
  'Content-Type': 'application/json',
  'Accept': 'application/json',
  'User-Agent': 'Proxigo-AI-Hunter/2.0 (contact@proxigo.eu)',
};

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
  ['nettoyage', 'Nettoyage'],
  ['cleaning', 'Nettoyage'],
  ['entretien', 'Nettoyage'],
  ['plomberie', 'Plomberie'],
  ['sanitaire', 'Plomberie'],
  ['jardinage', 'Jardinage / Espaces verts'],
  ['espaces verts', 'Jardinage / Espaces verts'],
  ['électric', 'Électricité'],
  ['electric', 'Électricité'],
  ['maçonnerie', 'Maçonnerie / BTP'],
  ['construction', 'Maçonnerie / BTP'],
  ['travaux', 'Maçonnerie / BTP'],
  ['transport', 'Transport / Déménagement'],
  ['déménagement', 'Transport / Déménagement'],
  ['informatique', 'Informatique / IT'],
  ['maintenance', 'Réparation / Maintenance'],
];

function yyyymmdd(date = new Date()) {
  return date.toISOString().split('T')[0].replace(/-/g, '');
}

function safeDate(value) {
  if (!value) return null;

  try {
    const date = new Date(String(value));

    if (Number.isNaN(date.getTime())) {
      return null;
    }

    return date.toISOString();
  } catch {
    return null;
  }
}

function extractValue(value) {
  if (value === null || value === undefined) {
    return null;
  }

  if (typeof value === 'string' || typeof value === 'number') {
    return String(value);
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      const extracted = extractValue(item);

      if (extracted) {
        return extracted;
      }
    }

    return null;
  }

  if (typeof value === 'object') {
    const preferredLanguages = [
      'fra',
      'fre',
      'fr',
      'eng',
      'nld',
      'deu',
    ];

    for (const language of preferredLanguages) {
      if (value[language]) {
        return String(value[language]);
      }
    }

    for (const item of Object.values(value)) {
      const extracted = extractValue(item);

      if (extracted) {
        return extracted;
      }
    }
  }

  return null;
}

function extractTitle(notice) {
  return extractValue(
    notice['notice-title'] ??
    notice.TI
  );
}

function extractBuyerName(notice) {
  return extractValue(
    notice['buyer-name'] ??
    notice.AU
  );
}

function extractCountry(notice) {
  const value =
    notice['buyer-country'] ??
    notice.CY;

  const country = extractValue(value);

  if (!country) {
    return 'EU';
  }

  const map = {
    BEL: 'BE',
    FRA: 'FR',
    LUX: 'LU',
    NLD: 'NL',
    BE: 'BE',
    FR: 'FR',
    LU: 'LU',
    NL: 'NL',
  };

  return map[country.toUpperCase()] ??
    country.substring(0, 2).toUpperCase();
}

function extractCpvCodes(notice) {
  const value =
    notice['classification-cpv'] ??
    notice.PC;

  if (!value) {
    return [];
  }

  if (Array.isArray(value)) {
    return value
      .map(item => {
        if (typeof item === 'object') {
          return String(
            item.code ??
            item.id ??
            item.value ??
            ''
          );
        }

        return String(item);
      })
      .filter(Boolean);
  }

  if (typeof value === 'object') {
    return Object.values(value)
      .map(item => String(item))
      .filter(Boolean);
  }

  return [String(value)];
}

function extractDeadline(notice) {
  const date = extractValue(
  notice['deadline-receipt-tender-date-lot'] ??
  notice['deadline-date-lot'] ??
  notice.deadline ??
  notice['deadline-date'] ??
  notice.DD
);

const time = extractValue(
  notice['deadline-receipt-tender-time-lot'] ??
  notice['deadline-time-lot']
);

  if (date && time) {
    return safeDate(`${date}T${time}`);
  }

  return safeDate(date);
}

function extractPublicationDate(notice) {
  return safeDate(
    notice['publication-date'] ??
    notice.PD
  );
}

function extractPublicationNumber(notice) {
  return extractValue(
    notice['publication-number'] ??
    notice.ND
  );
}
function extractFormType(notice) {
  return extractValue(
    notice['form-type'] ??
    notice['form-type-code']
  );
}
function extractBudget(notice) {
  const value =
    notice['total-value'] ??
    notice['total-value-amount'];

  if (value === null || value === undefined) {
    return {
      amount: null,
      currency: 'EUR',
    };
  }

  if (typeof value === 'object') {
    const amount =
      value.amount ??
      value.value ??
      value.number;

    const currency =
      value.currency ??
      value.currencyCode ??
      'EUR';

    return {
      amount: amount !== undefined ? Number(amount) : null,
      currency: String(currency),
    };
  }

  const amount = Number(value);

  return {
    amount: Number.isFinite(amount) ? amount : null,
    currency: 'EUR',
  };
}

function guessCategory(cpvCodes = [], title = '') {
  for (const code of cpvCodes) {
    const prefix = String(code).substring(0, 2);

    if (CPV_CATEGORY[prefix]) {
      return CPV_CATEGORY[prefix];
    }
  }

  const lower = String(title).toLowerCase();

  for (const [keyword, category] of KEYWORD_MAP) {
    if (lower.includes(keyword)) {
      return category;
    }
  }

  return 'Services généraux';
}

async function tedPost(query, limit = 50) {
  const body = {
    query,
    fields: [
      
  'publication-number',
  'notice-title',
  'buyer-name',
  'buyer-country',
  'classification-cpv',
  'total-value',
  'deadline',
  'deadline-receipt-tender-date-lot',
  'deadline-receipt-tender-time-lot',
  'form-type',
  'notice-type',
  'publication-date',
],
    
    page: 1,
    limit,
    scope: 'ALL',
    checkQuerySyntax: false,
    paginationMode: 'PAGE_NUMBER',
  };

  const response = await fetch(TED_SEARCH, {
    method: 'POST',
    headers: TED_HEADERS,
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30000),
  });

  if (!response.ok) {
    const message = await response.text();

    throw new Error(
      `TED HTTP ${response.status}: ${message.substring(0, 500)}`
    );
  }

  return response.json();
}

export async function fetchTEDOpportunities({
  countries = ['BEL', 'FRA', 'LUX', 'NLD'],
} = {}) {
  const since = yyyymmdd(
    new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
  );

  const countryQuery = countries
    .map(country => `CY=${country}`)
    .join(' OR ');

  const query = `(${countryQuery}) AND PD>=${since}`;

  log('info', '[TED] Appel API v3', {
    query,
    countries,
  });

  let data;

  try {
    data = await tedPost(query, 50);
  } catch (error) {
    log('error', '[TED] Erreur API principale', {
      error: error.message,
    });

    return [];
  }

  const notices = Array.isArray(data.notices)
    ? data.notices
    : [];

  log('info', '[TED] Résultat API', {
    count: notices.length,
    total: data.totalNoticeCount ?? 0,
    timedOut: data.timedOut ?? false,
  });

  return mapNotices(notices);
}

function mapNotices(notices) {
  const results = [];

  for (const notice of notices) {
    const id = extractPublicationNumber(notice);

    if (!id) {
      continue;
    }

    const title =
      extractTitle(notice) ??
      "Appel d'offres TED";

    const organism =
      extractBuyerName(notice);

    const country =
      extractCountry(notice);

    const cpvCodes =
      extractCpvCodes(notice);

    const deadline =
      extractDeadline(notice);
    const formType =
      extractFormType(notice);
    const normalizedFormType =
  String(formType ?? '').toLowerCase();

if (normalizedFormType.includes('result')) {
  continue;
}
    const publishedAt =
      extractPublicationDate(notice) ??
      new Date().toISOString();

    const budget =
      extractBudget(notice);

    results.push({
      external_id: `ted-${id}`,

      title: String(title)
        .substring(0, 500),

      description: organism
        ? `Acheteur : ${String(organism).substring(0, 500)}`
        : null,

      source_name: 'TED Europa',

      source_url:
        `https://ted.europa.eu/en/notice/${id}/html`,

      organism: organism
        ? String(organism).substring(0, 255)
        : null,

      category:
        guessCategory(cpvCodes, title),

      country,

      city: null,

      postal_code: null,

      budget_min:
        budget.amount,

      budget_max:
        budget.amount,

      budget_currency:
        budget.currency,

      deadline,

      published_at:
        publishedAt,

      type: 'public',

      status:
        deadline && new Date(deadline) < new Date()
          ? 'closed'
          : 'active',

      documents: [],

      tags:
        cpvCodes.slice(0, 5),
    });
  }

  log('info', '[TED] Opportunités construites', {
    count: results.length,
  });

  return results;
}
