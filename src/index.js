// API Node/Express d’analyse de texte
// - Détection de langue (franc-min)
// - Appel LanguageTool (API publique ou self-host via LT_BASE_URL)
// - Similarité (string-similarity)
// - Heuristiques de structure (verbes & mots-clés)
// - CORS whitelist, logging, rate limit, healthcheck
import "dotenv/config";
import express from "express";
import cors from "cors";
import morgan from "morgan";
import rateLimit from "express-rate-limit";
import { franc } from "franc-min";

import { iso3ToIso2 } from "./utils/lang.js";
import { checkWithLanguageTool } from "./services/languagetool.js";
import { similarityScore, grammarSpellingScores, structureHeuristics } from "./scoring.js";
import { evaluateAnswer } from "./evaluation.js";

import rubricCfg from "./rubrics/cefr_rubric.json" assert { type: "json" };
import { rubricAggregate } from "./rubricScoring.js";

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
// POST /analyse-text
// body: { text: string, expectedAnswer?: string, expectedLang?: string, keywords?: string[], eval?: EvaluationConfig }
app.post("/analyse-text", async (req, res) => {
  try {
    const { text, expectedAnswer = "", expectedLang = "", keywords = [] } = req.body || {};
    if (!text || typeof text !== "string") {
      return res.status(400).json({ error: "Champ 'text' requis (string)." });
    }

    // 1) Détection langue
    const detectedIso3 = franc(text, { minLength: 10 }); // évite faux positifs sur textes trop courts
    const lang = iso3ToIso2(detectedIso3);

    // 2) LanguageTool (public ou self-host)
    let ltData = { matches: [] };
    try {
      const ltLang = expectedLang || lang || "auto";
      ltData = await checkWithLanguageTool(text, ltLang, LT_API_KEY);
    } catch (e) {
      ltData = { matches: [], _error: "LanguageTool unreachable" };
    }

    // 3) Similarité
    const similarity = similarityScore(text, expectedAnswer);

    // 4) Heuristiques de structure
    const struct = structureHeuristics(text, keywords, expectedLang || lang);

    // 5) Scores grammaire/orthographe (V1 linéaire)
    const { grammarScore, spellingScore, grammarErr, spellingErr } = grammarSpellingScores(ltData.matches);

    // 6) Issues formatées
    const issues = (ltData.matches || []).slice(0, 100).map(m => ({
      type: (m.rule?.issueType || "grammar").toLowerCase(),
      message: m.message || m.shortMessage || "Problème détecté",
      ruleId: m.rule?.id,
      description: m.rule?.description,
      offset: m.offset,
      length: m.length,
      replacements: (m.replacements || []).slice(0, 5).map(r => r.value)
    }));

    // 7) Alerte si langue inattendue
    if (expectedLang && expectedLang !== (lang || "und")) {
      issues.unshift({
        type: "language",
        message: `Réponse détectée en '${lang || "indéterminée"}' au lieu de '${expectedLang}'.`
      });
    }

    // 8) Évaluation de contenu (optionnelle) si le client fournit "eval"
    const evalCfg = req.body?.eval || null;
    let contentEval = { contentScore: 0, isCorrect: false, reasons: [] };
    if (evalCfg) {
      contentEval = evaluateAnswer(text, evalCfg, expectedLang || lang);
    }

    // 9) Barème CECRL (facultatif). Si pas d’EMB_BASE_URL, content=0 mais le reste (org/lexis/grammar/mechanics) fonctionne.
    const rubric = rubricCfg.writing_default;
    const rubricScore = await rubricAggregate({
      text,
      lang: expectedLang || lang,
      ltMatches: ltData.matches || [],
      expectedAnswer,
      rubric
    });

    // 10) Réponse
    res.json({
      lang,
      grammarScore,
      spellingScore,
      similarityScore: similarity,
      issues,
      content: contentEval,     // évaluation configurable par question
      rubric: rubricScore,      // agrégat type correction humaine CECRL
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
    // si LanguageTool public rate-limit → transforme en 503 pour indiquer côté front de réessayer
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
