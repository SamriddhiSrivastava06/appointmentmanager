import axios from 'axios';

const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';

/**
 * Single reusable LLM call wrapper with retry + graceful fallback.
 */
export async function callLLM(prompt: string, expectedKeys: string[] = []): Promise<string> {
  const apiKey = process.env.ANTHROPIC_API_KEY;

  if (!apiKey || apiKey === '' || apiKey.startsWith('YOUR_')) {
    console.warn('[LLM] ANTHROPIC_API_KEY is not configured. Falling back to mock generator.');
    return generateMockResponse(prompt, expectedKeys);
  }

  let retries = 3;
  let delay = 1000; // start with 1s delay

  while (retries > 0) {
    try {
      console.log(`[LLM] Calling Claude API (Retries left: ${retries - 1})...`);
      const response = await axios.post(
        ANTHROPIC_API_URL,
        {
          model: 'claude-3-haiku-20240307',
          max_tokens: 1000,
          messages: [{ role: 'user', content: prompt }],
          temperature: 0.2
        },
        {
          headers: {
            'x-api-key': apiKey,
            'anthropic-version': '2023-06-01',
            'content-type': 'application/json'
          },
          timeout: 10000 // 10s timeout
        }
      );

      const responseText = response.data?.content?.[0]?.text;
      if (responseText) {
        return responseText;
      }
      throw new Error('Empty response from Claude API');
    } catch (error: any) {
      console.error(`[LLM] Error calling Claude API (status ${error.response?.status}):`, error.message || error);
      retries--;
      if (retries === 0) {
        throw new Error(`Claude API failed after 3 attempts. Last error: ${error.message}`);
      }
      // Wait for backoff delay
      await new Promise((resolve) => setTimeout(resolve, delay));
      delay *= 2; // exponential backoff
    }
  }

  throw new Error('LLM call exhausted retries');
}

/**
 * Parses JSON response from LLM, or throws an error.
 */
export async function callLLMJson<T>(prompt: string, expectedKeys: string[]): Promise<T> {
  const jsonSystemPrompt = `\n\nReturn ONLY a raw JSON object matching these keys: [${expectedKeys.join(
    ', '
  )}]. Do not add any conversational text, markdown formatting, or HTML tags. Just return the valid JSON.`;
  
  const responseText = await callLLM(prompt + jsonSystemPrompt, expectedKeys);
  try {
    // Strip markdown formatting if any (e.g. ```json ... ```)
    let cleaned = responseText.trim();
    if (cleaned.startsWith('```')) {
      cleaned = cleaned.replace(/^```json\s*/, '').replace(/```$/, '');
    }
    return JSON.parse(cleaned) as T;
  } catch (error) {
    console.error('[LLM] Failed to parse JSON response:', responseText);
    throw new Error('LLM did not return a valid JSON format');
  }
}

/**
 * Generates mock response matching the desired keys for symptom diagnostics and post-visit notes.
 */
function generateMockResponse(prompt: string, expectedKeys: string[]): string {
  const promptLower = prompt.toLowerCase();

  // 1. Pre-visit summary
  if (promptLower.includes('urgency level') || expectedKeys.includes('urgency')) {
    let urgency = 'Low';
    if (promptLower.includes('severe') || promptLower.includes('chest pain') || promptLower.includes('breath') || promptLower.includes('high fever')) {
      urgency = 'High';
    } else if (promptLower.includes('moderate') || promptLower.includes('cough') || promptLower.includes('pain') || promptLower.includes('migraine')) {
      urgency = 'Medium';
    }

    const mockResponse = {
      urgency,
      chiefComplaint: extractChiefComplaint(prompt),
      questions: [
        'How long have you been experiencing these symptoms?',
        'Does anything specific make the pain or discomfort better or worse?',
        'Are you currently taking any regular medications or supplements?'
      ]
    };
    return JSON.stringify(mockResponse, null, 2);
  }

  // 2. Post-visit summary
  if (promptLower.includes('patient-friendly summary') || promptLower.includes('clinical notes') || expectedKeys.includes('patientFriendlySummary')) {
    const mockResponse = {
      patientFriendlySummary: `Thank you for your visit today. Based on our clinical assessment, we have diagnosed you and prescribed appropriate therapy. Please follow the instructions below:\n\n1. Rest well and hydrate.\n2. Complete the prescribed medication course as directed.\n3. Schedule a follow-up visit if your condition does not improve within 5 days.`
    };
    return JSON.stringify(mockResponse, null, 2);
  }

  // General fallback
  return JSON.stringify({
    message: 'Mock response fallback',
    timestamp: new Date().toISOString()
  });
}

function extractChiefComplaint(prompt: string): string {
  const match = prompt.match(/symptoms:\s*(.*)$/i);
  if (match && match[1]) {
    const symptoms = match[1].trim();
    return symptoms.length > 60 ? symptoms.substring(0, 57) + '...' : symptoms;
  }
  return 'General health concern';
}
