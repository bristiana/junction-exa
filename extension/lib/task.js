// Builds the Exa Agent request for one errand: the instructions, the page context and the output shape.
// Personal details never go to Exa: the agent writes placeholders like {{name}} and the extension fills them in locally.

export const PROFILE_FIELDS = [
  ["name", "Full name"],
  ["email", "Email"],
  ["phone", "Phone"],
  ["address", "Street address"],
  ["postal_code", "Postal code"],
  ["city", "City"],
  ["country", "Country"],
  ["date_of_birth", "Date of birth"],
  ["nationality", "Nationality"],
  ["language", "Answer language"],
];

const TOKENS = PROFILE_FIELDS.filter(([k]) => k !== "language").map(([k]) => `{{${k}}}`).join(", ");

export const SYSTEM_PROMPT = `You are Vali, a personal errand agent for people living in Finland, especially newcomers and international students who do not read Finnish well.
Your job is to take a tedious errand off the user's hands: find what matters on the live web, work out what needs to happen, and prepare the next step so the user only has to approve it.

Rules:
- Use current, authoritative sources: official Finnish sites (suomi.fi, kela.fi, migri.fi, vero.fi, dvv.fi, hel.fi, espoo.fi, vantaa.fi, kkv.fi), EU sites (europa.eu), and the company's own pages. Prefer them over blogs and forums.
- Be concrete: amounts in euros, deadlines as dates, the exact form or page to use, opening hours, prices. Say "not found" rather than guess.
- Write plain, short English unless the user's language says otherwise. Translate Finnish terms and keep the Finnish name in brackets.
- Never invent personal details. Where the user's personal data is needed, write one of these placeholders exactly: ${TOKENS}. Use {{booking_reference}} or similar descriptive placeholders for anything else only the user knows.
- Prepare actions, never perform them. Emails are drafts, forms are pre-filled for review, bookings are links. The user approves.
- If the page the user is on has a form that fits the errand, fill it in form_fill using the field ids given. Leave out fields you cannot fill with confidence.`;

const ACTION_TYPES = ["email", "calendar", "open_link", "phone_call", "copy_text"];

export function outputSchema({ hasForm }) {
  const props = {
    answer: {
      type: "string",
      description: "The short answer to the errand in 1-3 sentences, with the key number, date or verdict first.",
    },
    status: {
      type: "string",
      enum: ["ready_to_approve", "needs_info", "not_possible", "info_only"],
      description: "ready_to_approve: an action is prepared. needs_info: the user must answer missing_info first. not_possible: the errand cannot be done (say why in answer). info_only: the answer is the result.",
    },
    key_facts: {
      type: "array",
      maxItems: 5,
      description: "Facts the answer rests on: amounts, deadlines, eligibility rules, prices, opening hours.",
      items: {
        type: "object",
        properties: { label: { type: "string" }, value: { type: "string" } },
        required: ["label", "value"],
      },
    },
    steps: {
      type: "array",
      maxItems: 6,
      description: "What needs to happen, in order. Mark steps Vali already prepared as done_by_hoida.",
      items: {
        type: "object",
        properties: {
          title: { type: "string" },
          detail: { type: "string" },
          url: { type: ["string", "null"], format: "uri" },
          done_by_hoida: { type: "boolean" },
        },
        required: ["title", "detail"],
      },
    },
    actions: {
      type: "array",
      maxItems: 4,
      description: "Prepared next steps for the user to approve. email: a ready-to-send draft. calendar: a deadline or appointment. open_link: the exact form, booking or claim page. phone_call: who to call and what to say. copy_text: a message to paste somewhere.",
      items: {
        type: "object",
        properties: {
          type: { type: "string", enum: ACTION_TYPES },
          label: { type: "string", description: "Button text, 2-5 words, e.g. 'Send claim email'." },
          url: { type: ["string", "null"], format: "uri" },
          to: { type: ["string", "null"], description: "Email address or phone number of the recipient, if found on an official page." },
          subject: { type: ["string", "null"] },
          body: { type: ["string", "null"], description: "Full email or message text, with {{placeholders}} for personal details." },
          start: { type: ["string", "null"], description: "ISO 8601 date or date-time for calendar actions." },
          end: { type: ["string", "null"] },
          location: { type: ["string", "null"] },
        },
        required: ["type", "label"],
      },
    },
    missing_info: {
      type: "array",
      maxItems: 3,
      items: { type: "string" },
      description: "Questions the user must answer before the errand can be finished. Empty if none.",
    },
  };
  const required = ["answer", "status", "steps", "actions"];
  if (hasForm) {
    props.form_fill = {
      type: "array",
      maxItems: 40,
      description: "Values for the form on the user's current page. Use field ids exactly as given. Use {{placeholders}} for personal data.",
      items: {
        type: "object",
        properties: { field_id: { type: "string" }, value: { type: "string" } },
        required: ["field_id", "value"],
      },
    };
  }
  return { type: "object", properties: props, required };
}

function clip(s, n) {
  s = String(s || "").replace(/\s+/g, " ").trim();
  return s.length > n ? s.slice(0, n) + "…" : s;
}

// page: { url, title, selection, text, fields: [{id, label, type, options}] } captured by content/page.js
export function buildQuery(task, page, profile = {}) {
  const parts = [`Errand: ${task.trim()}`];
  const lang = profile.language && profile.language.trim();
  if (lang) parts.push(`Answer in: ${lang}.`);
  const known = PROFILE_FIELDS.filter(([k]) => k !== "language" && profile[k]).map(([k]) => k);
  if (known.length) parts.push(`The user has saved these details (use placeholders, the values stay on their device): ${known.join(", ")}.`);
  if (profile.city) parts.push(`The user lives in ${profile.city}${profile.country ? ", " + profile.country : ""}.`);
  parts.push(`Today is ${new Date().toISOString().slice(0, 10)}.`);
  if (page?.url) {
    parts.push(`The user is on this page: ${page.title ? clip(page.title, 140) + " — " : ""}${page.url}`);
    if (page.selection) parts.push(`They selected this text:\n"""${clip(page.selection, 2500)}"""`);
    else if (page.text) parts.push(`Page text (start):\n"""${clip(page.text, 3500)}"""`);
    if (page.fields?.length) {
      const lines = page.fields.slice(0, 40).map((f) => {
        const opts = f.options?.length ? ` options: ${f.options.slice(0, 12).join(" | ")}` : "";
        return `- ${f.id}: "${clip(f.label, 80)}" (${f.type}${f.required ? ", required" : ""})${opts}`;
      });
      parts.push(`The page has a form with these fields:\n${lines.join("\n")}`);
    }
  }
  return parts.join("\n\n");
}

export function buildRunRequest(task, page, profile, { effort = "low" } = {}) {
  const hasForm = !!page?.fields?.length;
  return {
    query: buildQuery(task, page, profile),
    systemPrompt: SYSTEM_PROMPT,
    effort,
    outputSchema: outputSchema({ hasForm }),
    metadata: { app: "hoida" },
  };
}
