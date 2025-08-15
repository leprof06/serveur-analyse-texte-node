// API Node/Express d’analyse de texte
// - Détection de langue (franc-min)
// - Appel LanguageTool (API publique ou self-host via LT_BASE_URL)
// - Similarité (string-similarity) + Similarité sémantique (HF Inference API)
// - Heuristiques de structure (verbes & mots-clés)
// - CORS whitelist, logging, rate limit, healthcheck

import "dotenv/config";
import express from "express";
import cors from "cors";
import morgan from "morgan";
import rateLimit from "express-rate-limit";
import { franc } from "franc-min";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

import { iso3ToIso2 } from "./utils/lang.js";
import { checkWithLanguageTool } from "./services/languagetool.js";
import { similarityScore, grammarSpellingScores, structureHeuristics } from "./scoring.js";
import { evaluateAnswer } from "./evaluation.js";
import { rubricAggregate } from "./rubricScoring.js";
import { semanticSimilarity100 } from "./semantic.js";

// ----- Charger le JSON rubric sans import assertion -----
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rubricPath = path.join(__dirname, "rubrics", "cefr_rubric.json");
let rubricCfg = { writing_default: { weights: { content: 35, organization: 15, lexis: 20, grammar: 20, mechanics: 10 } } };
try {
  const raw = fs.readFileSync(rubricPath, "utf8");
  rubricCfg = JSON.parse(raw);
} catch (e) {
  console.warn("[rubric] Fallback défaut :", e?.message || e);
}

const app = express();

// ----- Config -----
const PORT = Number(process.env.PORT || 8080);
const LT_API_KEY = process.env.LT_API_KEY || null;

// CORS: liste blanche via env (séparée par virgules). "*" autorise tout (tests).
const CORS_ORIGINS = (process.env.CORS_ORIGINS || "*")
  .split(",")
  .map(s => s.trim())
  .filter(Boolean);

// Middlewares
app.use(express.json({ limit: "2mb" }));
app.use(morgan("tiny"));

if (CORS_ORIGINS.includes("*")) {
  app.use(cors());
} else {
  app.use(
    cors({
      origin: (origin, cb) => {
        if (!origin) return cb(null, true); // Postman / scripts
        const ok = CORS_ORIGINS.some(o => origin === o);
        cb(ok ? null : new Error("Origin not allowed by CORS"), ok);
      },
      credentials: false
    })
  );
}

// Rate limit: 60 requêtes / minute par IP
app.use(
  rateLimit({
    windowMs: 60_000,
    max: 60
  })
);

// ----- Healthcheck -----
app.get("/health", (req, res) => {
  res.json({ status: "ok", uptime: process.uptime(), ts: Date.now() });
});

// ----- Route principale -----
// body: { text, expectedAnswer?, expectedLang?, keywords?, eval? }
app.post("/analyse-text", async (req, res) => {
  try {
    const { text, expectedAnswer = "", expectedLang = "", keywords = [] } = req.body || {};
    if (!text || typeof text !== "string") {
      return res.status(400).json({ error: "Champ 'text' requis (string)." });
    }

    // 1) Détection langue
    const detectedIso3 = franc(text, { minLength: 10 });
    const lang = iso3ToIso2(detectedIso3);

    // 2) LanguageTool
    let ltData = { matches: [] };
    try {
      const ltLang = expectedLang || lang || "auto";
      ltData = await checkWithLanguageTool(text, ltLang, LT_API_KEY);
    } catch (e) {
      ltData = { matches: [], _error: "LanguageTool unreachable" };
    }

    // 3) Similarité "lettres/mots" 0..100
    const similarity = similarityScore(text, expectedAnswer);

    // 4) Similarité sémantique 0..100 via HF (si HF_API_KEY configuré + expectedAnswer)
    let semanticScore = null;
    if (expectedAnswer) {
      semanticScore = await semanticSimilarity100(text, expectedAnswer);
    }

    // 5) Heuristiques de structure
    const struct = structureHeuristics(text, keywords, expectedLang || lang);

    // 6) Scores grammaire/orthographe
    const { grammarScore, spellingScore, grammarErr, spellingErr } = grammarSpellingScores(ltData.matches);

    // 7) Issues formatées
    const issues = (ltData.matches || []).slice(0, 100).map(m => ({
      type: (m.rule?.issueType || "grammar").toLowerCase(),
      message: m.message || m.shortMessage || "Problème détecté",
      ruleId: m.rule?.id,
      description: m.rule?.description,
      offset: m.offset,
      length: m.length,
      replacements: (m.replacements || []).slice(0, 5).map(r => r.value)
    }));

    // 8) Langue inattendue
    if (expectedLang && expectedLang !== (lang || "und")) {
      issues.unshift({
        type: "language",
        message: `Réponse détectée en '${lang || "indéterminée"}' au lieu de '${expectedLang}'.`
      });
    }

    // 9) Évaluation de contenu (optionnelle) pilotée par le front
    const evalCfg = req.body?.eval || null;
    let contentEval = { contentScore: 0, isCorrect: false, reasons: [] };
    if (evalCfg) {
      contentEval = evaluateAnswer(text, evalCfg, expectedLang || lang);
    }

    // 10) Barème CECRL (content s’appuie aussi sur la similarité sémantique)
    const rubric = rubricCfg.writing_default;
    const rubricScore = await rubricAggregate({
      text,
      lang: expectedLang || lang,
      ltMatches: ltData.matches || [],
      expectedAnswer,
      rubric
    });

    // 11) Réponse
    res.json({
      lang,
      grammarScore,
      spellingScore,
      similarityScore: similarity, // forme (lettres/mots)
      semanticScore,               // sens (HF) 0..100 ou null
      issues,
      content: contentEval,        // évaluation configurable par question
      rubric: rubricScore,         // agrégat “style prof CECRL”
      details: {
        grammarErrors: grammarErr,
        spellingErrors: spellingErr,
        ltError: ltData._error || null,
        hasVerb: struct.hasVerb,
        keywordScore: struct.keywordScore,
        keywordsFound: struct.found,
        keywordsTotal: struct.total
      }
    });
  } catch (err) {
    const msg = err?.message || "Unknown error";
    const is429 = /429/.test(msg);
    res.status(is429 ? 503 : 500).json({
      error: "analysis_failed",
      message: msg,
      hint: is429
        ? "Limite atteinte sur LanguageTool public : fournissez LT_BASE_URL vers votre instance self-hostée."
        : undefined
    });
  }
});

// ----- Lancement -----
app.listen(PORT, () => {
  console.log(`[analyse-texte] Écoute sur : http://0.0.0.0:${PORT}`);
});
