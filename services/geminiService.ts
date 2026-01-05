import { GoogleGenAI, Type } from "@google/genai";
import { Market, AIAnalysis } from "../types";

export const analyzeMarket = async (market: Market): Promise<AIAnalysis | null> => {
  try {
    const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: `Analyze the following Polymarket BTC prediction market:
        Question: ${market.question}
        Description: ${market.description}
        Outcomes: ${market.outcomes.join(", ")}
        Current Prices: ${market.outcomePrices.join(", ")}
        
        Predict the probability (0-100) of the first outcome (typically 'YES') being true. 
        Consider the market description and current pricing in your reasoning.`,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            probability: {
              type: Type.NUMBER,
              description: "The calculated probability for the first outcome (0-100).",
            },
            confidence: {
              type: Type.NUMBER,
              description: "Confidence score of the analysis (0.0 to 1.0).",
            },
            reasoning: {
              type: Type.STRING,
              description: "Brief reasoning for the prediction.",
            },
          },
          required: ["probability", "confidence", "reasoning"],
          propertyOrdering: ["probability", "confidence", "reasoning"],
        },
      },
    });

    const jsonStr = response.text;
    if (!jsonStr) return null;

    return JSON.parse(jsonStr.trim()) as AIAnalysis;
  } catch (error) {
    console.error("Gemini analysis failed:", error);
    return null;
  }
};