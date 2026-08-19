import { GoogleGenAI, Type } from "@google/genai";

// NOTE: VITE_-prefixed variables are readable in the shipped client bundle.
// This key is exposed to every user. Moving moderation to a Cloud Function is
// the real fix and is still required before public launch.
const apiKey = import.meta.env.VITE_GEMINI_API_KEY;

let client: GoogleGenAI | null = null;

// Constructed lazily so a missing key surfaces inside moderateQuestion's catch
// rather than throwing at module load and taking the whole bundle down.
function getClient(): GoogleGenAI {
  if (!apiKey) throw new Error('VITE_GEMINI_API_KEY is not set');
  if (!client) client = new GoogleGenAI({ apiKey });
  return client;
}

export async function moderateQuestion(text: string, options: [string, string]): Promise<{ status: 'live' | 'rejected', reason?: string }> {
  try {
    const response = await getClient().models.generateContent({
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
