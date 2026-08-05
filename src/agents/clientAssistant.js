export function analyzeClientRequest(message) {
  const text = String(message || "").trim();

  if (!text) {
    return {
      complete: false,
      reply: "Bonjour, décrivez le service recherché et indiquez votre ville.",
      data: {}
    };
  }

  const lower = text.toLowerCase();

  const categories = [
    { keywords: ["plombier", "plomberie", "fuite"], category: "Plomberie" },
    { keywords: ["électricien", "electricien", "électricité", "electricite"], category: "Électricité" },
    { keywords: ["poubelle", "conteneur"], category: "Nettoyage de poubelles" },
    { keywords: ["voiture", "lavage auto", "nettoyage auto"], category: "Lavage automobile" },
    { keywords: ["jardin", "jardinier"], category: "Jardinage" },
    { keywords: ["vitre", "fenêtre"], category: "Nettoyage de vitres" },
    { keywords: ["chantier"], category: "Nettoyage après chantier" },
    { keywords: ["maçon", "macon", "maçonnerie"], category: "Maçonnerie" }
  ];

  const matchedCategory = categories.find(item =>
    item.keywords.some(keyword => lower.includes(keyword))
  );

  const cityMatch = text.match(
    /\b(?:à|a|sur|près de|proche de)\s+([A-Za-zÀ-ÿ' -]{2,40})/i
  );

  const category = matchedCategory?.category || null;
  const city = cityMatch?.[1]?.trim() || null;

  const missing = [];

  if (!category) missing.push("service");
  if (!city) missing.push("ville");

  if (missing.length > 0) {
    return {
      complete: false,
      reply: `Merci. Pouvez-vous préciser : ${missing.join(" et ")} ?`,
      data: {
        category,
        city,
        description: text
      }
    };
  }

  return {
    complete: true,
    reply: `Votre demande pour "${category}" à ${city} est prête à être enregistrée.`,
    data: {
      category,
      city,
      description: text,
      status: "new",
      source: "proxigo_ai"
    }
  };
}
