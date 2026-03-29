// ============================================================
//  AI Controller — powered by Ollama (100% FREE, runs locally)
//  No API key needed. Ollama must be running on your machine.
//  Install: https://ollama.com  |  then: ollama pull llama3
// ============================================================

const OLLAMA_BASE_URL = process.env.OLLAMA_URL || "http://localhost:11434";
const OLLAMA_MODEL    = process.env.OLLAMA_MODEL || "llama3";

// ── Helper: call Ollama /api/chat ──────────────────────────
const callOllama = async (systemPrompt, userMessage) => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000); // 30s timeout

  try {
    const response = await fetch(`${OLLAMA_BASE_URL}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify({
        model: OLLAMA_MODEL,
        stream: false,               // get full response at once
        options: {
          temperature: 0.1,          // low = more deterministic JSON
          num_predict: 300,          // max tokens to generate
        },
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user",   content: userMessage  },
        ],
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Ollama HTTP ${response.status}: ${errText}`);
    }

    const data = await response.json();
    return data?.message?.content?.trim() || "";
  } finally {
    clearTimeout(timeout);
  }
};

// ── Helper: extract JSON even if model wraps it in markdown ─
const extractJSON = (raw) => {
  if (!raw) return null;

  // Try direct parse first
  try { return JSON.parse(raw); } catch {}

  // Strip ```json ... ``` or ``` ... ```
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced) {
    try { return JSON.parse(fenced[1].trim()); } catch {}
  }

  // Find first { ... } block
  const braceStart = raw.indexOf("{");
  const braceEnd   = raw.lastIndexOf("}");
  if (braceStart !== -1 && braceEnd > braceStart) {
    try { return JSON.parse(raw.slice(braceStart, braceEnd + 1)); } catch {}
  }

  return null;
};

// ── POST /api/ai/parse-expense ───────────────────────────────
const parseExpense = async (req, res) => {
  try {
    const { text, groupMembers } = req.body;

    if (!text || text.trim().length === 0) {
      return res.status(400).json({
        success: false,
        message: "Text input is required.",
      });
    }

    const memberNames = groupMembers?.length
      ? groupMembers.map((m) => m.name || m.email).join(", ")
      : "unknown members";

    // ── System prompt ──────────────────────────────────────
    // Very explicit instructions — helps smaller local models
    // like llama3, mistral, gemma follow the JSON schema exactly.
    const systemPrompt = `You are a JSON-only expense parser. You must ALWAYS respond with ONLY a valid JSON object — no explanation, no markdown, no extra text.

Context:
- Group members available: ${memberNames}
- Current user (payer if "I" or "me" is used): ${req.user.name}

Your JSON must have exactly these keys:
{
  "title": "short expense name (e.g. Petrol, Dinner, Movie)",
  "amount": 123.45,
  "category": "food|transport|entertainment|utilities|shopping|health|travel|general",
  "paidBy": "name of who paid, or '${req.user.name}' if user said I/me",
  "splitBetween": ["Name1", "Name2"],
  "description": "optional extra note or null"
}

Category rules:
- food: restaurant, dinner, lunch, swiggy, zomato, chai, pizza, groceries
- transport: petrol, uber, ola, auto, rickshaw, bus, fuel, taxi
- entertainment: movie, concert, game, netflix, party
- utilities: electricity, wifi, internet, water, gas bill
- shopping: clothes, amazon, flipkart, mall, shoes
- health: medicine, doctor, pharmacy, hospital
- travel: flight, hotel, trip, holiday, train ticket
- general: anything else

Rules:
1. Return ONLY the JSON object. Nothing else.
2. If amount not mentioned, set amount to null.
3. If split not mentioned, set splitBetween to [] (means split among all members).
4. Always include payer in splitBetween unless specified otherwise.
5. "I paid" or "I spent" means paidBy is "${req.user.name}".`;

    // ── Call Ollama ────────────────────────────────────────
    let rawContent;
    try {
      rawContent = await callOllama(systemPrompt, text);
    } catch (ollamaErr) {
      console.error("Ollama connection error:", ollamaErr.message);

      // Give a clear, actionable error message
      const isConnectionRefused =
        ollamaErr.message.includes("ECONNREFUSED") ||
        ollamaErr.message.includes("fetch failed") ||
        ollamaErr.name === "AbortError";

      return res.status(503).json({
        success: false,
        message: isConnectionRefused
          ? "Ollama is not running. Start it with: ollama serve"
          : `Ollama error: ${ollamaErr.message}`,
        hint: `Make sure Ollama is running and model '${OLLAMA_MODEL}' is pulled. Run: ollama pull ${OLLAMA_MODEL}`,
      });
    }

    console.log(`Ollama raw response: ${rawContent}`);

    // ── Parse JSON from response ───────────────────────────
    const parsedExpense = extractJSON(rawContent);

    if (!parsedExpense) {
      console.error("Could not extract JSON from:", rawContent);
      return res.status(422).json({
        success: false,
        message: "AI returned an unexpected format. Try rephrasing, e.g: 'I paid 200 for petrol with Rahul'",
      });
    }

    // ── Sanitize / fill defaults ───────────────────────────
    if (!parsedExpense.title || typeof parsedExpense.title !== "string") {
      parsedExpense.title = "Unnamed Expense";
    }

    if (parsedExpense.amount !== null && isNaN(Number(parsedExpense.amount))) {
      parsedExpense.amount = null;
    } else if (parsedExpense.amount !== null) {
      parsedExpense.amount = Number(parsedExpense.amount);
    }

    const validCategories = ["food","transport","entertainment","utilities","shopping","health","travel","general"];
    if (!validCategories.includes(parsedExpense.category)) {
      parsedExpense.category = "general";
    }

    if (!Array.isArray(parsedExpense.splitBetween)) {
      parsedExpense.splitBetween = [];
    }

    res.json({
      success: true,
      data: {
        parsed: parsedExpense,
        originalText: text,
        model: OLLAMA_MODEL,
      },
    });
  } catch (error) {
    console.error("AI parse error:", error);
    res.status(500).json({ success: false, message: "AI parsing failed." });
  }
};

// ── GET /api/ai/status — check if Ollama is reachable ───────
const getStatus = async (req, res) => {
  try {
    const response = await fetch(`${OLLAMA_BASE_URL}/api/tags`, {
      signal: AbortSignal.timeout(5000),
    });

    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const data = await response.json();
    const models = data?.models?.map((m) => m.name) || [];
    const modelReady = models.some((m) => m.startsWith(OLLAMA_MODEL));

    res.json({
      success: true,
      data: {
        ollamaRunning: true,
        activeModel: OLLAMA_MODEL,
        modelPulled: modelReady,
        availableModels: models,
        ollamaUrl: OLLAMA_BASE_URL,
        hint: modelReady
          ? `✅ Ready! Using ${OLLAMA_MODEL}`
          : `⚠️ Model not found. Run: ollama pull ${OLLAMA_MODEL}`,
      },
    });
  } catch (err) {
    res.json({
      success: false,
      data: {
        ollamaRunning: false,
        activeModel: OLLAMA_MODEL,
        ollamaUrl: OLLAMA_BASE_URL,
        hint: "Ollama is not running. Start with: ollama serve",
      },
    });
  }
};

module.exports = { parseExpense, getStatus };
