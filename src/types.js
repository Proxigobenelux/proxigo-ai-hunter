/**
 * @typedef {Object} RawOpportunity
 * @property {string}       external_id   - ID unique de la source (anti-doublon)
 * @property {string}       title         - Titre de l'opportunité
 * @property {string|null}  description   - Description détaillée
 * @property {string}       category      - Catégorie Proxigo (ex: 'Nettoyage', 'Plomberie')
 * @property {string}       country       - Code pays ISO 2 lettres (BE, FR, LU, NL)
 * @property {string|null}  city          - Ville (optionnel)
 * @property {'public'|'private'} type    - Type de marché
 * @property {string}       source        - Nom de la source (ex: 'TED Europa')
 * @property {string|null}  source_url    - Lien direct vers l'annonce d'origine
 * @property {number|null}  budget_min    - Budget minimum en EUR
 * @property {number|null}  budget_max    - Budget maximum en EUR
 * @property {string|null}  deadline      - Date limite ISO 8601
 * @property {string}       published_at  - Date de publication ISO 8601
 * @property {string[]}     tags          - Tags libres
 */

export {};
