const env = require('../config/env');

const MAX_RETRIES = 3;
const BASE_DELAY_MS = 1000;

/**
 * Checks if a line contains institutional, administrative, or non-curricular keywords
 */
function isInstitutionalLine(line) {
  return /\b(?:COLLEGE|UNIVERSITY|INSTITUTE|DEPARTMENT|CAMPUS|CENTRE|ACADEMY|POLYTECHNIC|DIRECTORATE|AFFILIATED|AUTONOMOUS|ACCREDITED|APPROVED|GOVERNMENT|SEMESTER|SESSION|BATCH|REGULATION|BRANCH|DEGREE|FACULTY)\b/i.test(
    line
  );
}

/**
 * Stage 2 & 3: Clean and Extract Syllabus Structure
 * Strips headers, footers, exam patterns, textbook references, and partitions text into Units & Topics.
 * @param {string} rawText
 */
function cleanAndStructureSyllabus(rawText) {
  if (!rawText || typeof rawText !== 'string') {
    return {
      courseTitle: 'Course Curriculum',
      units: [],
      structuredSummary: '',
    };
  }

  const lines = rawText.split(/\r?\n/).map((l) => l.trim());

  // Unit / Chapter / Module header pattern
  const unitHeadingRegex = /^(?:UNIT|MODULE|CHAPTER)\s*([0-9IVXLCDM]+)?\s*[:\-–\.]?\s*(.*)$/i;

  // Sections that must be skipped entirely (not syllabus curriculum)
  const skipSectionHeaderRegex = /^(?:COURSE\s+OBJECTIVES?|COURSE\s+OUTCOMES?|PROGRAM\s+OUTCOMES?|CO\s*-\s*PO|BLOOM|TEXT\s*BOOKS?|RECOMMENDED\s*BOOKS?|REFERENCES?|REFERENCE\s*BOOKS?|WEB\s*RESOURCES?|ONLINE\s*RESOURCES?|EVALUATION\s+SCHEME|QUESTION\s+PAPER|EXAM\s+PATTERN|INTERNAL\s+ASSESSMENT|GRADING\s+SCHEME|LABORATORY|PRACTICAL\s+HOURS?)\b/i;

  // Metadata / administrative lines to skip
  const metadataLineRegex = /^(?:DEPARTMENT|COLLEGE|FACULTY|INSTITUTE|UNIVERSITY|SCHOOL|AUTONOMOUS|AFFILIATED|ACCREDITED|APPROVED|COURSE\s+CODE|SUBJECT\s+CODE|CODE|CREDITS?|L\s*T\s*P\s*C?|HOURS?|CONTACT\s+HOURS?|SEMESTER|BRANCH|DEGREE|BATCH|REGULATION|YEAR|MAX(?:IMUM)?\s+MARKS|INTERNAL\s+MARKS|EXTERNAL\s+MARKS|EXAM\s+HOURS?|FACULTY\s+NAME|INSTRUCTOR|PROFESSOR|TEACHER)\s*[:\-–]/i;

  // Page numbering and divider artifacts
  const paginationRegex = /^(?:---+\s*Page\s*\d+.*---+|Page\s+\d+\s+of\s+\d+|Page\s+\d+|[-_=~*]{3,})$/i;

  let currentSection = 'HEADER';
  let courseTitle = '';
  const rawUnits = [];
  let currentUnit = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line) continue;
    if (paginationRegex.test(line)) continue;

    // Detect Course Name if explicitly present
    const courseMatch = line.match(/^(?:COURSE\s+NAME|COURSE\s+TITLE|SUBJECT)\s*[:\-–]\s*(.+)$/i);
    if (courseMatch && !courseTitle) {
      courseTitle = courseMatch[1].trim();
      continue;
    }

    if (metadataLineRegex.test(line) || (currentSection === 'HEADER' && isInstitutionalLine(line))) {
      continue;
    }

    // Entering a skipped section (e.g. Textbooks or Objectives)
    if (skipSectionHeaderRegex.test(line)) {
      currentSection = 'SKIP_SECTION';
      if (currentUnit) {
        rawUnits.push(currentUnit);
        currentUnit = null;
      }
      continue;
    }

    // If currently inside a skipped section, wait until next real unit
    if (currentSection === 'SKIP_SECTION') {
      const isNewUnit = unitHeadingRegex.test(line);
      if (!isNewUnit) continue;
      currentSection = 'IN_UNIT';
    }

    // Check if line starts a unit/module
    const unitMatch = line.match(unitHeadingRegex);
    if (unitMatch) {
      currentSection = 'IN_UNIT';
      if (currentUnit) {
        rawUnits.push(currentUnit);
      }
      const rawNum = unitMatch[1] || `${rawUnits.length + 1}`;
      const title = unitMatch[2] ? unitMatch[2].trim() : `Unit ${rawNum}`;
      currentUnit = {
        unitNumber: rawNum,
        title: title || `Unit ${rawNum}`,
        contentLines: [],
      };
      continue;
    }

    // Inside unit: capture curriculum topics
    if (currentSection === 'IN_UNIT' && currentUnit) {
      const cleanLine = line.replace(/^[•●■◆\uF0B7\s\-–—*]+/, '').trim();
      // Skip inline exam mark notes like "[10 Marks]"
      if (cleanLine && !/^\s*\[?\s*\d+\s*(?:marks?|hours?)\s*\]?\s*$/i.test(cleanLine)) {
        currentUnit.contentLines.push(cleanLine);
      }
      continue;
    }

    // In header section: try capturing course title if simple text
    if (currentSection === 'HEADER' && !courseTitle) {
      if (line.length > 3 && line.length < 60 && !line.includes(':') && !isInstitutionalLine(line)) {
        courseTitle = line;
      }
    }
  }

  if (currentUnit) {
    rawUnits.push(currentUnit);
  }

  // If no explicit Unit headers found, group meaningful lines into logical units
  if (rawUnits.length === 0) {
    const meaningfulLines = lines.filter(
      (l) =>
        !paginationRegex.test(l) &&
        !metadataLineRegex.test(l) &&
        !skipSectionHeaderRegex.test(l) &&
        !isInstitutionalLine(l) &&
        l.length > 5
    );

    const targetUnitCount = Math.min(5, Math.max(1, Math.ceil(meaningfulLines.length / 4)));
    const chunkSize = Math.ceil(meaningfulLines.length / targetUnitCount);
    for (let i = 0; i < meaningfulLines.length; i += chunkSize) {
      const slice = meaningfulLines.slice(i, i + chunkSize);
      const uNum = `${rawUnits.length + 1}`;
      rawUnits.push({
        unitNumber: uNum,
        title: slice[0].length < 60 ? slice[0] : `Unit ${uNum}`,
        contentLines: slice,
      });
    }
  }

  // Process subtopics per unit
  const processedUnits = rawUnits.map((u, idx) => {
    const fullText = u.contentLines.join(' ');
    const rawTopics = fullText
      .split(/(?:;|\. |\n|,\s*(?=[A-Z]))/)
      .map((t) => t.trim().replace(/^[-–—:*\d.]+\s*/, ''))
      .filter((t) => t.length > 2 && !/^(etc|and|or|in|with|of|the|for)$/i.test(t));

    return {
      unitNumber: u.unitNumber || `${idx + 1}`,
      title: u.title.replace(/^[:\-–\s]+/, '').trim() || `Unit ${idx + 1}`,
      topics: rawTopics.length > 0 ? rawTopics : [u.title],
    };
  });

  const structuredSummary = processedUnits
    .map((u) => `Unit ${u.unitNumber}: ${u.title}\nTopics: ${u.topics.join(', ')}`)
    .join('\n\n');

  return {
    courseTitle: courseTitle || 'Course Curriculum',
    units: processedUnits,
    structuredSummary,
  };
}

/**
 * Intelligent Fallback Generator:
 * Uses structured unit tree to distribute targetDays proportionally across units.
 * NEVER splits on random characters or outputs raw document metadata.
 */
function generateIntelligentFallbackPlan(structuredData, targetDays) {
  const units =
    structuredData.units && structuredData.units.length > 0
      ? structuredData.units
      : [{ unitNumber: '1', title: 'Core Concepts', topics: ['Fundamentals', 'Methodologies', 'Applications'] }];

  const totalDays = Math.max(1, parseInt(targetDays, 10));
  const unitCount = units.length;

  const finalReviewDays = totalDays >= 30 ? 2 : totalDays >= 15 ? 1 : 0;
  const teachingDays = Math.max(1, totalDays - finalReviewDays);

  const baseDaysPerUnit = Math.floor(teachingDays / unitCount);
  let extraDays = teachingDays % unitCount;

  const plan = [];
  let currentDay = 1;

  for (let uIdx = 0; uIdx < unitCount; uIdx++) {
    const unit = units[uIdx];
    const allocatedDays = baseDaysPerUnit + (extraDays > 0 ? 1 : 0);
    if (extraDays > 0) extraDays--;

    const topics = unit.topics && unit.topics.length > 0 ? unit.topics : [unit.title];

    if (allocatedDays <= 1) {
      plan.push({
        dayNumber: currentDay++,
        topic: `Unit ${unit.unitNumber}: ${unit.title} - Core Principles & Overview`,
      });
    } else if (allocatedDays >= topics.length) {
      let tIdx = 0;
      for (let d = 0; d < allocatedDays; d++) {
        let topicText = '';
        if (d === allocatedDays - 1 && allocatedDays >= 3) {
          topicText = `Unit ${unit.unitNumber}: Review, Problem Solving & Assessment on ${unit.title}`;
        } else if (tIdx < topics.length) {
          topicText = `Unit ${unit.unitNumber}: ${topics[tIdx]}`;
          tIdx++;
        } else {
          topicText = `Unit ${unit.unitNumber}: Practical Applications & Deep Dive into ${unit.title}`;
        }
        plan.push({
          dayNumber: currentDay++,
          topic: topicText,
        });
      }
    } else {
      const topicsPerDay = Math.ceil(topics.length / allocatedDays);
      for (let d = 0; d < allocatedDays; d++) {
        const slice = topics.slice(d * topicsPerDay, (d + 1) * topicsPerDay);
        const combined = slice.join(' & ');
        plan.push({
          dayNumber: currentDay++,
          topic: `Unit ${unit.unitNumber}: ${combined || unit.title}`,
        });
      }
    }
  }

  // Final review sessions
  if (finalReviewDays >= 2) {
    plan.push({
      dayNumber: currentDay++,
      topic: 'Comprehensive Course Revision & Previous Year Question Discussion',
    });
    plan.push({
      dayNumber: currentDay++,
      topic: 'Final Doubt Clearance, Synthesis & Examination Readiness',
    });
  } else if (finalReviewDays === 1) {
    plan.push({
      dayNumber: currentDay++,
      topic: 'Comprehensive Course Revision & Doubt Clearance',
    });
  }

  return validateAndNormalizePlan(plan, totalDays, structuredData);
}

/**
 * Stage 5: Validated Lesson Plan
 * Guarantees exactly targetDays, sequential dayNumbers 1..N, clean non-redundant strings.
 */
function validateAndNormalizePlan(rawDays, targetDays, structuredData) {
  const totalDays = Math.max(1, parseInt(targetDays, 10));
  const normalized = [];

  if (Array.isArray(rawDays)) {
    for (let i = 0; i < rawDays.length; i++) {
      const item = rawDays[i];
      let topic = typeof item === 'string' ? item : item?.topic || '';
      topic = topic.replace(/^Day\s*\d+\s*[:\-–]\s*/i, '').trim();

      if (topic.length > 0) {
        normalized.push({
          dayNumber: normalized.length + 1,
          topic: topic.length > 130 ? topic.substring(0, 127) + '...' : topic,
        });
      }
    }
  }

  // If fewer days than target, supplement with structured synthesis / review days
  const units = structuredData?.units || [];
  let supplementIdx = 0;
  while (normalized.length < totalDays) {
    const dayNum = normalized.length + 1;
    const unitRef = units[supplementIdx % (units.length || 1)];
    supplementIdx++;

    let fillerTopic = 'Comprehensive Course Review & Problem Solving Session';
    if (unitRef) {
      fillerTopic = `Unit ${unitRef.unitNumber}: In-depth Case Analysis & Problem Solving in ${unitRef.title}`;
    }

    normalized.push({
      dayNumber: dayNum,
      topic: fillerTopic,
    });
  }

  // If more days than target, truncate gracefully and ensure final day is a synthesis day
  const result = normalized.slice(0, totalDays);
  if (totalDays >= 10 && !result[totalDays - 1].topic.toLowerCase().includes('review') && !result[totalDays - 1].topic.toLowerCase().includes('revision')) {
    result[totalDays - 1].topic = 'Course Synthesis, Revision & Final Assessment Discussion';
  }

  return result.map((item, idx) => ({
    dayNumber: idx + 1,
    topic: item.topic,
  }));
}

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
        model: env.GROQ_MODEL || 'qwen/qwen3.8-27b',
        messages,
        temperature: 0.2,
        max_tokens: 4096,
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
 * Stage 4: Generate Day-by-Day Syllabus Plan using Groq LLM
 * Adheres to the 5-stage pipeline:
 * 1. PDF Extracted Text (input)
 * 2. Text Cleaning
 * 3. Syllabus Structure Extraction
 * 4. Groq AI Curriculum Planner with intelligent pacing
 * 5. Validated Lesson Plan
 * @param {string} syllabusText
 * @param {number} numberOfDays
 */
const generateSyllabusPlan = async (syllabusText, numberOfDays) => {
  const days = parseInt(numberOfDays, 10);
  if (isNaN(days) || days < 1) {
    throw new Error('numberOfDays must be a positive integer');
  }

  // 1 & 2 & 3: Clean and Extract Structure
  const structured = cleanAndStructureSyllabus(syllabusText);

  // If no Groq API Key or placeholder key, use intelligent fallback
  if (!env.GROQ_API_KEY || env.GROQ_API_KEY.includes('your_') || env.GROQ_API_KEY === 'mock') {
    console.log('[Groq API:DEV_MODE] No valid GROQ_API_KEY provided. Generating intelligent fallback plan.');
    return generateIntelligentFallbackPlan(structured, days);
  }

  const prompt = `You are an expert college academic curriculum designer and university professor.
Your task is to transform the following syllabus into a structured, day-by-day lecture plan of EXACTLY ${days} teaching days.

### COURSE INFORMATION:
Course: ${structured.courseTitle}
Detected Units: ${structured.units.length} units

### CURRICULUM SYLLABUS:
${structured.structuredSummary}

### CURRICULUM PACING & DECOMPOSITION RULES:
1. TARGET DAYS: Exactly ${days} days. (Day 1 to Day ${days}).
2. PEDAGOGICAL DECISION MAKING BASED ON DURATION (${days} DAYS):
   - IF DAYS >= 30:
     * Break broad topics into granular subtopics, deep dives, architecture, and mathematical/numerical problem solving.
     * Include 1 dedicated "Unit Review & Quiz / Practice Questions" at the end of each unit.
     * Reserve the final 2-3 days for "Comprehensive Course Revision" and "Previous Year Exam Problems".
   - IF DAYS BETWEEN 20 AND 29:
     * Balanced coverage: allocate roughly equal days per unit with 1 wrap-up day per unit.
   - IF DAYS < 20:
     * Synthesize and group closely related subtopics together into high-yield, compact lectures.
     * Ensure ALL units are represented proportionally without skipping core fundamentals.
3. TOPIC FORMAT:
   * Every day MUST have a clear, descriptive, professional lecture title prefixed by the Unit (e.g., "Unit 1: Fundamentals of Data Communication & Network Topologies").
   * Strictly NO placeholder text, NO administrative headers, NO textbook or author citations.
   * Strictly NO exact duplicates across days.

Return strictly a JSON object with a "days" array:
{
  "days": [
    { "dayNumber": 1, "topic": "Unit 1: Introduction to Data Communication and Transmission Models" },
    ...
  ]
}`;

  try {
    const rawContent = await callGroqWithRetry([
      { role: 'system', content: 'You are an academic curriculum assistant that outputs strictly valid JSON.' },
      { role: 'user', content: prompt },
    ]);

    // Parse JSON safely
    let parsed;
    try {
      parsed = JSON.parse(rawContent);
    } catch (parseErr) {
      // If LLM returned text wrapped in ```json ```, extract the inner block
      const jsonMatch = rawContent.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        parsed = JSON.parse(jsonMatch[0]);
      } else {
        throw parseErr;
      }
    }

    const planDays = Array.isArray(parsed.days) ? parsed.days : Array.isArray(parsed) ? parsed : null;

    if (!planDays || planDays.length === 0) {
      throw new Error('Groq returned invalid plan format.');
    }

    // Stage 5: Validate and Normalize exactly to N days
    return validateAndNormalizePlan(planDays, days, structured);
  } catch (error) {
    console.error('[Groq API] Generation error, falling back to intelligent curriculum planner:', error.message);
    return generateIntelligentFallbackPlan(structured, days);
  }
};

module.exports = {
  generateSyllabusPlan,
  cleanAndStructureSyllabus,
  generateIntelligentFallbackPlan,
};
