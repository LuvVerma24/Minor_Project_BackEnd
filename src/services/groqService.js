const env = require('../config/env');

const MAX_RETRIES = 3;
const BASE_DELAY_MS = 1000;

/**
 * Fallback plan generator for offline/dev testing when Groq key is absent or exhausted
 */
const generateFallbackPlan = (syllabusText, numberOfDays) => {
  const lines = syllabusText
    .split(/\r?\n|;|\. /)
    .map((s) => s.trim())
    .filter((s) => s.length > 5);

  const plan = [];
  for (let day = 1; day <= numberOfDays; day++) {
    let topic;
    if (lines.length > 0) {
      const idx = (day - 1) % lines.length;
      topic = lines[idx];
    } else {
      topic = `Unit ${Math.ceil(day / 5)}: Core Module Part ${day}`;
    }
    plan.push({
      dayNumber: day,
      topic: topic.length > 120 ? topic.substring(0, 117) + '...' : topic,
    });
  }
  return plan;
};

/**
 * Call Groq API with exponential backoff for rate limits (429) and transient errors
 */
const callGroqWithRetry = async (messages, attempt = 1) => {
  try {
    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${env.GROQ_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: env.GROQ_MODEL,
        messages,
        temperature: 0.2,
        response_format: { type: 'json_object' },
      }),
    });

    if (response.status === 429 || (response.status >= 500 && response.status < 600)) {
      if (attempt <= MAX_RETRIES) {
        const delay = BASE_DELAY_MS * Math.pow(2, attempt - 1);
        console.warn(`[Groq API] HTTP ${response.status}. Retrying attempt ${attempt}/${MAX_RETRIES} after ${delay}ms...`);
        await new Promise((resolve) => setTimeout(resolve, delay));
        return callGroqWithRetry(messages, attempt + 1);
      }
      throw new Error(`Groq API failed with status ${response.status} after ${MAX_RETRIES} attempts.`);
    }

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Groq API error (${response.status}): ${errorText}`);
    }

    const data = await response.json();
    return data.choices[0]?.message?.content;
  } catch (error) {
    if (attempt <= MAX_RETRIES && (error.code === 'ECONNRESET' || error.name === 'FetchError' || error.message.includes('fetch'))) {
      const delay = BASE_DELAY_MS * Math.pow(2, attempt - 1);
      console.warn(`[Groq API] Network error: ${error.message}. Retrying attempt ${attempt}/${MAX_RETRIES} after ${delay}ms...`);
      await new Promise((resolve) => setTimeout(resolve, delay));
      return callGroqWithRetry(messages, attempt + 1);
    }
    throw error;
  }
};

/**
 * Generate Day-by-Day Syllabus Plan using Groq LLM
 * @param {string} syllabusText
 * @param {number} numberOfDays
 */
const generateSyllabusPlan = async (syllabusText, numberOfDays) => {
  const days = parseInt(numberOfDays, 10);
  if (isNaN(days) || days < 1) {
    throw new Error('numberOfDays must be a positive integer');
  }

  // If no Groq API Key or placeholder key, use reliable fallback
  if (!env.GROQ_API_KEY || env.GROQ_API_KEY.includes('your_') || env.GROQ_API_KEY === 'mock') {
    console.log('[Groq API:DEV_MODE] No valid GROQ_API_KEY provided. Generating structured fallback plan.');
    return generateFallbackPlan(syllabusText, days);
  }

  const prompt = `You are an expert college academic curriculum planner.
Given the following syllabus and a target of exactly ${days} teaching days, break the syllabus down into a day-by-day lecture plan.
Each day must have a concise, clear lecture topic.

Return ONLY a JSON object with a "days" array containing exactly ${days} items in this format:
{
  "days": [
    { "dayNumber": 1, "topic": "Brief description of topic covered on day 1" },
    ...
  ]
}

Syllabus Content:
${syllabusText.substring(0, 8000)}`;

  try {
    const rawContent = await callGroqWithRetry([
      { role: 'system', content: 'You are an academic curriculum assistant that outputs strictly valid JSON.' },
      { role: 'user', content: prompt },
    ]);

    const parsed = JSON.parse(rawContent);
    const planDays = Array.isArray(parsed.days) ? parsed.days : Array.isArray(parsed) ? parsed : null;

    if (!planDays || planDays.length === 0) {
      throw new Error('Groq returned invalid plan format.');
    }

    return planDays.map((item, index) => ({
      dayNumber: item.dayNumber || index + 1,
      topic: item.topic || `Topic for Day ${index + 1}`,
    }));
  } catch (error) {
    console.error('[Groq API] Generation error, falling back to local curriculum splitter:', error.message);
    return generateFallbackPlan(syllabusText, days);
  }
};

module.exports = {
  generateSyllabusPlan,
};
