📝 Serveur d’analyse de texte (Node.js)

API REST légère pour analyser des productions écrites multilingues : détection de langue, correction LanguageTool, similarité lexicale et sémantique (Hugging Face), heuristiques de structure, et agrégation d’un score CECRL (content/organization/lexis/grammar/mechanics).

Statut : prêt pour un dépôt public. Aucune donnée sensible dans le code. Les clés/API passent par les variables d’environnement.

✨ Fonctionnalités

Détection de langue (ISO‑639‑1) via franc-min → utils/lang.js mappe iso3 → iso2.

Correction grammaticale & orthographique via LanguageTool :

API publique ou instance self-host (configurable via LT_BASE_URL + LT_API_KEY).

Similarité lexicale (forme) avec string-similarity (0–100).

Similarité sémantique (sens) avec Hugging Face Inference API (embeddings + cosinus, 0–100).

Heuristiques de structure : présence de verbes (EN + heuristiques FR), score de mots‑clés.

Évaluation de contenu configurable par question : mots‑clés all/any/banned, regex, longueur min/max, verbe requis, similarité.

Agrégateur CECRL (pondérations dans rubrics/cefr_rubric.json) → overall + breakdown.

API Express : CORS whitelist, logging (morgan), rate limit (60 req/min/IP), healthcheck.

🧩 Architecture (fichiers clés)

.
├─ index.js                 # Entrée serveur (routes, CORS, rate-limit, health)
├─ evaluation.js            # Évaluation de contenu (similarité/keywords/regex/longueur/verbe)
├─ scoring.js               # Similarité lexicale + scores grammaire/orthographe + heuristiques
├─ semantic.js              # Similarité sémantique (HF Inference API)
├─ languagetool.js          # Client LanguageTool (public ou self-host)
├─ rubricScoring.js         # Agrégation CECRL (content/organization/lexis/grammar/mechanics)
├─ lexis.js                 # Indicateurs lexicaux (TTR, répétitions)
├─ organization.js          # Indicateurs de structure (paragraphes, connecteurs)
├─ utils/
│   └─ lang.js              # Mapping iso3 → iso2 (franc-min)
└─ rubrics/
    └─ cefr_rubric.json     # Pondérations CECRL par défaut

🔧 Prérequis

Node.js ≥ 18

Accès Internet sortant (LanguageTool public ou votre instance self‑host + Hugging Face)

📦 Installation

# 1) Cloner
git clone https://github.com/<user>/serveur-analyse-texte-node.git
cd serveur-analyse-texte-node

# 2) Dépendances
npm install

# 3) Variables d’environnement
cp .env.example .env   # créez .env si absent et complétez les valeurs

# 4) Lancer en dev
npm start               # écoute sur PORT (par défaut 8080)
# ou
node index.js

.env.example

# Port d’écoute HTTP
PORT=8080

# LanguageTool
# - L’un OU l’autre : soit API publique (laisser LT_BASE_URL vide, éventuellement LT_API_KEY),
#   soit votre instance self-host (définir LT_BASE_URL, et LT_API_KEY si configurée côté serveur)
LT_BASE_URL=
LT_API_KEY=

# Similarité sémantique Hugging Face (obligatoire pour semanticScore)
HF_API_KEY=
# Modèle d’embeddings (multilingue conseillé)
HF_MODEL=sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2

# Pondération pénalité par erreur LanguageTool (optionnel)
GRAMMAR_PTS_PER_ERROR=6
SPELLING_PTS_PER_ERROR=5

# CORS (liste d’origines autorisées, séparées par des virgules). "*" = tout (défaut).
CORS_ORIGINS=*

🔒 Sécurité : ne commitez jamais .env. Fournissez seulement un .env.example sans secrets.

🚦 Démarrage & santé

Démarrer : npm start → http://0.0.0.0:<PORT>

Healthcheck : GET /health → { status: "ok", uptime, ts }

Rate limit : 60 req/min/IP (configurée dans index.js).

🔌 Endpoints

POST /analyse-text

Corps JSON :

{
  "text": "réponse de l'élève",
  "expectedAnswer": "réponse attendue (facultatif)",
  "expectedLang": "fr" ,
  "keywords": ["mot1", "mot2"],
  "eval": {
    "expectedAnswer": "...",                 
    "similarityThreshold": 70,                 
    "keywords": { "all": ["..."], "any": ["..."], "banned": ["..."] },
    "anyAtLeast": 1,                          
    "regex": ["\\bexpr(?:ession)?\\b"],  
    "minWords": 30, "maxWords": 120,         
    "requireVerb": true,                      
    "weights": {                              
      "similarity": 60, "all": 25, "any": 15,
      "regex": 20, "length": 10, "verb": 10, "penaltyBanned": 30
    }
  }
}

text (requis) : texte à analyser.

expectedAnswer (opt.) : texte de référence pour la similarité (lexicale + sémantique).

expectedLang (opt.) : langue attendue (ex. fr). Si différent de la détection, un issue de type language est ajouté.

keywords (opt.) : liste de mots‑clés utilisés par certaines heuristiques.

eval (opt.) : configuration d’évaluation de contenu (voir ci‑dessus). Vous pouvez n’en utiliser qu’une partie.

Réponse :

{
  "lang": "fr",
  "grammarScore": 86,
  "spellingScore": 92,
  "similarityScore": 74,   
  "semanticScore": 81,     
  "issues": [
    {"type": "grammar", "message": "...", "ruleId": "...", "offset": 12, "length": 5, "replacements": ["..."]}
  ],
  "content": {
    "contentScore": 78,
    "isCorrect": true,
    "reasons": [
      {"rule": "similarity", "value": 81, "weight": 60, "points": 49, "threshold": 70},
      {"rule": "keywords_all", "found": 2, "total": 2, "pct": 100, "weight": 25, "points": 25},
      {"rule": "length", "wordCount": 65, "minWords": 30, "maxWords": 120, "weight": 10, "points": 10}
    ]
  },
  "rubric": {
    "overall": 80,
    "breakdown": {
      "content": 81,
      "organization": 74,
      "lexis": 77,
      "grammar": 86,
      "mechanics": 92
    },
    "details": {
      "semantic": 81,
      "organization": {"paragraphs": 2, "words": 120, "paraScore": 66, "connScore": 50},
      "lexis": {"total": 120, "types": 85, "ttr": 0.708, "ttrScore": 100, "repeatedTop": ["..."], "lexisScore": 90}
    }
  },
  "details": {
    "grammarErrors": 3,
    "spellingErrors": 1,
    "ltError": null,
    "hasVerb": true,
    "keywordScore": 100,
    "keywordsFound": 2,
    "keywordsTotal": 2
  }
}

semanticScore retourne null si HF_API_KEY n’est pas renseignée.

Exemples curl

# Minimal (sans sémantique)
curl -sS http://localhost:8080/analyse-text \
  -H 'Content-Type: application/json' \
  -d '{"text":"Bonjour je m\'appelle Jean et je vis en France."}' | jq .

# Avec expectedAnswer + évaluation de contenu
curl -sS http://localhost:8080/analyse-text \
  -H 'Content-Type: application/json' \
  -d '{
        "text":"Je m\'appelle Jean, j\'habite à Paris et je travaille comme développeur.",
        "expectedAnswer":"Je m\'appelle Paul, j\'habite en France et je suis ingénieur.",
        "expectedLang":"fr",
        "eval":{
          "expectedAnswer":"Je m\'appelle Paul, j\'habite en France et je suis ingénieur.",
          "similarityThreshold":70,
          "keywords":{"all":["habite","travaille"],"any":["France","Paris"],"banned":["!!!"]},
          "minWords":10,
          "requireVerb":true
        }
      }' | jq .

🧮 Détails des calculs (rapide)

Similarité lexicale : string-similarity sur textes normalisés (minuscules, diacritiques retirés, espaces compressés) → 0–100.

Similarité sémantique : embeddings Hugging Face (pipeline feature-extraction) → moyenne spatiale → cosinus → 0–100.

Grammar/Spelling : pénalité linéaire par erreur LT (GRAMMAR_PTS_PER_ERROR, SPELLING_PTS_PER_ERROR), borné 0–100.

Organization : nb. de paragraphes (≥3 ⇒ 100) + connecteurs repérés (FR/EN) → moyenne 50/50.

Lexis : TTR (type‑token ratio) + pénalité répétitions (≥4 occurrences) → 0–100.

Rubric CECRL : pondérations dans rubrics/cefr_rubric.json (par défaut : content 35, organization 15, lexis 20, grammar 20, mechanics 10).

🔐 Sécurité & bonnes pratiques

Ne placez aucune clé en dur dans le code. Utilisez .env.

Limitez les origines CORS avec CORS_ORIGINS en production.

En charge élevée : self-host LanguageTool et pointez LT_BASE_URL.

L’endpoint Hugging Face est appelé avec un timeout (15s). Gérez la résilience côté client.

🚀 Déploiement (pistes)

Render / Railway / Fly.io : exposez PORT et variables .env. Prévoir un keep‑alive si la plateforme met en veille.

Docker (exemple minimal)

FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production
COPY . .
ENV NODE_ENV=production
EXPOSE 8080
CMD ["node", "index.js"]

🧪 Tests manuels rapides

GET /health → doit renvoyer status: ok.

POST /analyse-text uniquement avec text → renvoie langue détectée + scores sans sémantique.

Ajoutez HF_API_KEY → semanticScore ≠ null.

Fixez expectedLang ≠ langue détectée → un issue language apparaît.

📄 Licence

Choisissez et ajoutez un fichier LICENSE (MIT recommandé si usage libre).

ℹ️ Merci de simplement mentionner dans vos projets que la partie serveur d’analyse de texte a été créée par Yann de support and Learn with yann alias leprof06 (pseudo de github) . C’est tout ce qui est demandé.

🙌 Remerciements

LanguageTool

Hugging Face Inference API

franc-min

string-similarity

