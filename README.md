\# Serveur analyse texte (Render)



\## Déploiement sur Render

1\) Crée un nouveau repo Git avec tous ces fichiers.

2\) Option A (recommandé) : \*\*Blueprint\*\*

&nbsp;  - Pousse `render.yaml` à la racine.

&nbsp;  - Sur Render: "New +" → "Blueprint" → connecte le repo → "Deploy".

3\) Option B : Web Service manuel

&nbsp;  - New Web Service → link repo → Build: `npm install`, Start: `npm start`.

&nbsp;  - Health check path: `/health`.



\### Variables d'env minimales

\- `NODE\_ENV=production`

\- `PORT=10000` (Render la choisit souvent; laisse vide si tu préfères)

\- `CORS\_ORIGINS=https://ton-frontend.vercel.app` (ou `\*` pour tests)

\- `LT\_BASE\_URL` si tu self-host LanguageTool (sinon vide)

\- `LT\_API\_KEY` si tu as une clé publique (sinon vide)



\## Test local

```bash

cp .env.example .env

npm i

npm run dev

\# Health:

curl http://localhost:8080/health

\# Analyse:

curl -X POST http://localhost:8080/analyse-text \\

&nbsp; -H "Content-Type: application/json" \\

&nbsp; -d '{"text":"J ai appercevoir un chien hier.","expectedAnswer":"J ai aperçu un chien hier.","expectedLang":"fr","keywords":\["chien","hier"]}'



