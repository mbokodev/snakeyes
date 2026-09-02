# SALE - eBay & Kijiji Deal Finder

Système automatisé de scraping pour détecter les bonnes affaires sur **eBay Canada** et **Kijiji.ca**, avec notifications Telegram en temps réel.

## Architecture

```
SALE/
├── ebay/
│   ├── scrapper.py          # Scraper eBay (API Browse v1)
│   ├── kijiji_scrapper.py   # Scraper Kijiji (web scraping)
│   ├── ebay_auth.py         # Authentification OAuth2 eBay
│   ├── run.sh               # Script de scheduling (boucle infinie)
│   ├── configs/             # Configurations YAML par catégorie
│   │   ├── laptop.yml
│   │   ├── phones.yml
│   │   ├── tablets.yml
│   │   ├── konsole.yml
│   │   └── voitures.yml     # Kijiji seulement (ebay_enabled: false)
│   └── cache/               # Cache des IDs déjà vus (évite les doublons)
├── webui/
│   ├── backend/             # API FastAPI
│   │   └── app/
│   │       ├── main.py      # Point d'entrée + auth middleware
│   │       ├── security.py  # HTTP Basic Auth
│   │       ├── files.py     # Helpers YAML/fichiers
│   │       └── routers/
│   │           ├── configs.py  # CRUD configurations
│   │           └── status.py   # Status, logs, run manuel
│   └── frontend/            # SPA React (Vite + TypeScript)
├── docker-compose.yml
└── .env                     # Variables d'environnement
```

## Fonctionnalités

### Scraping multi-sources
- **eBay Canada** : API officielle Browse v1 (OAuth2)
- **Kijiji.ca** : Web scraping du JSON `__NEXT_DATA__` (état Apollo)
  - Catégories standards : annonces `StandardListing`
  - Catégorie autos-camions (c174) : annonces `AutosListing` (structure identique : id, titre, description, prix en cents, location)

### Filtrage intelligent
- Mots-clés par plage de prix (ex: RTX 3080 entre 700-1600$)
- Support regex : `regex:(?=.*\bM1\b)(?=.*\bMacBook\b)`
- Exclusions : `!for parts`, `!défectueux`
- Blocklist globale (pièces détachées, water damage, etc.)
- Filtrage par province (code postal)

### Système de notation
Chaque annonce reçoit un grade (1-5 étoiles) basé sur sa position dans la plage de prix :
- 5 étoiles : en dessous du minimum (excellente affaire)
- 4-1 étoiles : quartiles de la plage

### Notifications Telegram
- Un bot par catégorie (Laptops, Phones, Tablets, Consoles, Gadgets, Voitures)
- Message formaté : titre, prix, grade, mot-clé matchant, lien
- Un token vide désactive silencieusement les notifications du bot (warning `Bot 'X' not found in BOT_MAPPING` dans les logs)

### Interface Web (WebUI)
- Authentification HTTP Basic
- Liste des configurations avec statut en temps réel
- Édition YAML (mode brut ou structuré)
- Visualisation des logs
- Déclenchement manuel des runs
- Activation/désactivation par config

## Installation

### Prérequis
- Docker & Docker Compose
- Compte développeur eBay (API Production)
- Bots Telegram (un par catégorie)

### Configuration

1. Copier le fichier d'environnement :
```bash
cp .env.example .env
```

2. Remplir les variables dans `.env` :
```env
# eBay Developer (Production)
EBAY_CLIENT_ID=your_client_id
EBAY_CLIENT_SECRET=your_client_secret
EBAY_REDIRECT_URI=your_redirect_uri

# Telegram
TELEGRAM_CHAT_ID=your_chat_id
TELEGRAM_TOKEN_LAPTOPS=bot_token_laptops
TELEGRAM_TOKEN_CONSOLES=bot_token_consoles
TELEGRAM_TOKEN_PHONES=bot_token_phones
TELEGRAM_TOKEN_TABLETS=bot_token_tablets
TELEGRAM_TOKEN_GADGETS=bot_token_gadgets
TELEGRAM_TOKEN_VOITURES=bot_token_voitures

# WebUI Auth
UI_USERNAME=admin
UI_PASSWORD=secret

# Scheduling (secondes entre chaque cycle)
SCRAPE_INTERVAL=300
```

3. Lancer les services :
```bash
docker compose up -d
```

## Configuration YAML

Chaque fichier dans `ebay/configs/` définit une catégorie à surveiller.

### Structure

```yaml
# Bot Telegram à utiliser
bot:
  - Laptops

# Mots-clés par plage de prix (même index)
keywords:
  - '8750H;9300H;RTX;regex:\b32\s*g[bo]\s*ram\b;!M6700'
  - '1650;1660;3050;!N3050'
  - '3060;3070;4060'

price_ranges:
  - 250-580
  - 300-750
  - 450-1050

# Termes bloqués (annonce ignorée si présent)
bot_blocklist:
  - for parts
  - not working
  - water damage
  - pour pièces
  - défectueux

# eBay
ebay_enabled: true     # false = config Kijiji seulement, skip le run eBay
ebay_category: 175672  # Laptops
ebay_filters: 'buyingOptions:{FIXED_PRICE},itemLocationCountry:CA,deliveryCountry:CA'
item_location_provinces: []  # Vide = tout le Canada

# Kijiji (optionnel)
kijiji_url: https://www.kijiji.ca/b-laptops/quebec/c773l9001
kijiji_price: 200-4000

# Activer/désactiver
enabled: true
```

### Syntaxe des mots-clés

| Format | Description | Exemple |
|--------|-------------|---------|
| `mot` | Recherche simple (insensible à la casse) | `RTX` |
| `!mot` | Exclusion (ignore l'annonce si trouvé) | `!for parts` |
| `regex:pattern` | Expression régulière | `regex:\b32\s*g[bo]\s*ram\b` |
| `!regex:pattern` | Exclusion par regex | `!regex:broken\|damaged` |

Les mots-clés sont séparés par `;` dans une même plage de prix.

## API WebUI

L'API est protégée par HTTP Basic Auth.

### Endpoints

| Méthode | Endpoint | Description |
|---------|----------|-------------|
| `GET` | `/api/configs` | Liste des configurations |
| `GET` | `/api/configs/{name}` | Contenu parsé d'une config |
| `GET` | `/api/configs/{name}/raw` | Contenu brut YAML |
| `PUT` | `/api/configs/{name}` | Mise à jour (JSON) |
| `PUT` | `/api/configs/{name}/raw` | Mise à jour (YAML brut) |
| `POST` | `/api/configs` | Créer une config |
| `DELETE` | `/api/configs/{name}` | Supprimer une config |
| `GET` | `/api/status` | Statut de toutes les configs |
| `POST` | `/api/status/{name}/run` | Lancer un run manuel |
| `POST` | `/api/status/{name}/stop` | Arrêter un run en cours |
| `PUT` | `/api/status/{name}/enabled` | Activer/désactiver |
| `GET` | `/api/logs/{name}` | Dernières lignes du log |

### Exemple

```bash
# Lister les configs
curl -u admin:secret http://localhost:8000/api/configs

# Lancer un run manuel
curl -u admin:secret -X POST http://localhost:8000/api/status/laptop.yml/run
```

## Fonctionnement

### Cycle de scraping

1. `run.sh` boucle toutes les `SCRAPE_INTERVAL` secondes
2. Pour chaque config `.yml` avec `enabled: true` :
   - Lance `scrapper.py` (eBay) — sauf si `ebay_enabled: false`
   - Lance `kijiji_scrapper.py` (si `kijiji_url` défini)
3. Chaque scraper :
   - Charge le cache des IDs déjà vus
   - Récupère les nouvelles annonces
   - Filtre par province (si configuré)
   - Récupère les détails (description)
   - Applique le filtrage mots-clés/prix
   - Envoie les matchs sur Telegram
   - Sauvegarde le cache (max 500 IDs)

### Premier run (seed)

Au premier lancement, le cache est vide. Le scraper seed les IDs existants sans envoyer de notifications pour éviter un flood.

### Gestion des conflits

Un fichier `.lock` empêche les runs concurrents sur la même config. Un lock de plus de 5 minutes est considéré stale et supprimé.

## Développement

### Backend (sans Docker)

```bash
cd webui/backend
python -m venv venv
source venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload
```

### Frontend

```bash
cd webui/frontend
npm install
npm run dev
```

### Tests manuels du scraper

```bash
cd ebay
python -m venv venv
source venv/bin/activate
pip install -r requirements.txt

# Charger les variables d'environnement
source .env

# Lancer sur une config
python scrapper.py configs/laptop.yml
python kijiji_scrapper.py configs/laptop.yml
```

## Déploiement

Le projet est configuré pour Dokploy avec Traefik :
- Le service `webui` expose le port 8000 sur le réseau `dokploy-network`
- Pas de publication de port sur l'hôte (évite les conflits)

### Synchronisation des configs (important)

Les configs actives vivent sur le volume partagé (`/data/configs`), pas dans l'image.
Au démarrage, `run.sh` copie uniquement les configs **nouvelles** — il n'écrase
jamais une config existante (pour préserver les éditions faites via le webui).

Conséquence : **modifier un YAML dans git ne met pas à jour le serveur.**
Pour propager une modification de config existante, deux options :
- L'éditer via le webui (recommandé), puis reporter le changement dans git
- La copier manuellement sur le volume :
  ```bash
  cat ebay/configs/voitures.yml | ssh dokploy \
    "docker exec -i <container-scraper> sh -c 'cat > /data/configs/voitures.yml'"
  ```

Les changements de **code** (scrapers, webui), eux, nécessitent un redéploiement
Dokploy (rebuild de l'image). Les tokens Telegram se gèrent dans l'onglet
Environment de Dokploy — un token manquant y est remplacé par une chaîne vide.

### Config Kijiji seulement (ex : voitures)

Les voitures ne se vendent pas sur eBay CA : `voitures.yml` définit
`ebay_enabled: false` pour skipper le run eBay, et seul le scraper Kijiji
tourne (catégorie autos-camions, annonces `AutosListing`).

## Licence

Projet privé.
