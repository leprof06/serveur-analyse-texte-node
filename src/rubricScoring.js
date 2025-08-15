import { grammarSpellingScores } from "./scoring.js";             // LT → grammar/mechanics basiques
import { organizationMetrics } from "./organization.js";
import { lexisMetrics } from "./lexis.js";
import { semanticSimilarity } from "./semantic.js";                // optionnel

// agrège selon le barème
export async function rubricAggregate({ text, lang, ltMatches, expectedAnswer, rubric }) {
  const w = rubric.weights;

  // 1) grammar/mechanics -> depuis LT
  const { grammarScore, spellingScore } = grammarSpellingScores(ltMatches);

  // 2) content -> sémantique (ou retomber sur similarité string si pas d’EMB)
  const sem = await semanticSimilarity(text, expectedAnswer); // 0..100 (si pas d’EMB=0)
  const contentScore = expectedAnswer ? (sem || 0) : 0;

  // 3) organization
  const org = organizationMetrics(text, lang);
  const organizationScore = Math.round((org.paraScore * 0.5) + (org.connScore * 0.5));

  // 4) lexis
  const lex = lexisMetrics(text, lang);
  const lexisScore = lex.lexisScore;

  // 5) mechanics = orthographe & ponctuation. Ici on recycle spellingScore.
  const mechanicsScore = spellingScore;

  // PONDÉRATION
  const final =
      (contentScore     * (w.content/100)) +
      (organizationScore* (w.organization/100)) +
      (lexisScore       * (w.lexis/100)) +
      (grammarScore     * (w.grammar/100)) +
      (mechanicsScore   * (w.mechanics/100));

  return {
    overall: Math.round(final),
    breakdown: {
      content: Math.round(contentScore),
      organization: Math.round(organizationScore),
      lexis: Math.round(lexisScore),
      grammar: Math.round(grammarScore),
      mechanics: Math.round(mechanicsScore)
    },
    details: { semantic: sem, organization: org, lexis: lex }
  };
}
