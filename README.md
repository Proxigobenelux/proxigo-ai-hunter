# Proxigo AI Hunter — Service Railway

Service Node.js autonome qui collecte automatiquement les appels d'offres depuis TED Europa et e-Procurement Belgique (RSS), les déduplique, puis les insère dans la base Proxigo.

## Déploiement sur Railway

1. Crée un compte sur https://railway.app
2. "New Project" → "Deploy from GitHub Repo"
3. Pointe vers ce dossier `proxigo-ai-hunter/`
4. Ajoute les variables d'environnement (voir ci-dessous)
5. Le service démarre automatiquement

## Variables d'environnement à configurer sur Railway

```
SUPABASE_URL=       # URL de ta base Wegic Cloud (récupère-la dans les paramètres du projet)
SUPABASE_KEY=       # Clé service_role de ta base (récupère-la dans les paramètres du projet)
CRON_INTERVAL_MS=   # Intervalle en ms entre deux collectes (ex: 3600000 = 1h) — défaut: 3600000
TED_API_KEY=        # Optionnel — laisse vide pour l'accès public TED
```

## Sources connectées

| Source | Type | Fréquence | Compte requis |
|--------|------|-----------|---------------|
| TED Europa (EU) | REST API publique | 1h | Non |
| e-Procurement Belgique | RSS public | 1h | Non |

## Ajouter d'autres sources plus tard

Crée un fichier dans `src/sources/` et exporte une fonction `fetchOpportunities(): Promise<RawOpportunity[]>`.
