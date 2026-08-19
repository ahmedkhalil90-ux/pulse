import { GoogleGenAI, Type } from "@google/genai";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });

export async function moderateQuestion(text: string, options: [string, string]): Promise<{ status: 'live' | 'rejected', reason?: string }> {
  try {
    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: `Moderate this binary choice question for an anonymous polling app. 
      Question: "${text}"
      Option 1: "${options[0]}"
      Option 2: "${options[1]}"
      
      Rules:
      1. No hate speech, explicit content, or harassment.
      2. No personally identifying information (PII).
      3. No questions that could be used to de-anonymize a user.
      4. Must be a clear binary choice.
      
      Return JSON with "status" ('live' or 'rejected') and "reason" (if rejected).`,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            status: { type: Type.STRING, enum: ["live", "rejected"] },
            reason: { type: Type.STRING }
          },
          required: ["status"]
        }
      }
    });

    const result = JSON.parse(response.text);
    return result;
  } catch (error) {
    console.error("Moderation error:", error);
    return { status: 'live' }; // Default to live if AI fails, or could be 'pending' for human review
  }
}
