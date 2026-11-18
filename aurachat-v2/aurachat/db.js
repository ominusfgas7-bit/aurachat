const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new Database(path.join(DATA_DIR, 'aurachat.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS conversations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  model TEXT,
  created INTEGER NOT NULL,
  updated INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  conv_id INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  model TEXT,
  created INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_messages_conv ON messages(conv_id, id);
CREATE TABLE IF NOT EXISTS attachments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  msg_id INTEGER NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  mime TEXT NOT NULL,
  data TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_att_msg ON attachments(msg_id);
CREATE TABLE IF NOT EXISTS memories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  text TEXT NOT NULL,
  created INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS skills (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT UNIQUE,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  instructions TEXT NOT NULL DEFAULT '',
  enabled INTEGER NOT NULL DEFAULT 0,
  builtin INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`);

// ---- migrations (safe to run on every start) ----
function addCol(table, col, def) {
  if (!db.prepare(`PRAGMA table_info(${table})`).all().some((c) => c.name === col)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${def}`);
}
addCol('messages', 'thinking', "TEXT NOT NULL DEFAULT ''");
addCol('conversations', 'starred', 'INTEGER NOT NULL DEFAULT 0');
addCol('conversations', 'skill_id', 'INTEGER NOT NULL DEFAULT 0');
addCol('attachments', 'kind', "TEXT NOT NULL DEFAULT 'image'");
addCol('attachments', 'name', "TEXT NOT NULL DEFAULT ''");
addCol('attachments', 'text', "TEXT NOT NULL DEFAULT ''");
addCol('skills', 'icon', "TEXT NOT NULL DEFAULT '✦'");

// ---- default skills (memory is on by default) ----
const MEMORY_INSTRUCTIONS = `You have a persistent memory about the user that carries across conversations. The "Saved memories" section (if present) lists what you already know; use it naturally, without announcing that you are using memory.
When the user shares a durable fact or preference worth remembering later (name, job, projects, setup, preferences, ongoing goals), or explicitly asks you to remember something, add one tag per fact at the very END of your reply, like: <memory>Runs a game server hosting business</memory>
Rules: keep each memory short and in third person; only durable facts, not one-off requests; never save passwords, API keys, payment or government ID numbers, or other secrets; never duplicate something already saved; never mention or explain the tag itself.`;

const DEFAULT_SKILLS = [
  {
    slug: 'memory', name: 'Memory', enabled: 1,
    description: 'Remember durable facts about you across chats (on by default).',
    instructions: MEMORY_INSTRUCTIONS,
  },
  {
    slug: 'coding', name: 'Coding helper', enabled: 0,
    description: 'Production-minded code help with short explanations.',
    instructions: 'When helping with code: give complete, working code in fenced blocks with the language tag, prefer simple solutions, mention gotchas and how to run/test it, and ask before making large assumptions. For shell commands, state which OS/shell they target.',
  },
  {
    slug: 'concise', name: 'Concise mode', enabled: 0,
    description: 'Short, direct answers with no filler.',
    instructions: 'Keep answers as short as possible while being correct. No preambles, no recaps, no unnecessary caveats. Use lists or code only when they genuinely help.',
  },
  {
    slug: 'writer', name: 'Writing editor', enabled: 0,
    description: 'Improve and rewrite text while keeping your voice.',
    instructions: 'When the user pastes text to improve, return the improved version first, then a brief note on the main changes. Preserve their voice and meaning; do not add new claims.',
  },
  {
    slug: 'deep-research', name: 'Deep research', enabled: 0,
    description: 'Multi-angle research with sources, ending in a structured report.',
    instructions: `For research questions: (1) restate the question and list 3-6 sub-questions; (2) if web search is available, search each sub-question separately and prefer primary/official sources over summaries; (3) cross-check key claims across at least two sources and flag disagreements or weak evidence; (4) write a narrative report: short summary first, then findings by theme, then caveats and what is still unknown; (5) end with a "Sources" list. Never invent sources or statistics; say plainly when you could not verify something. For anything time-sensitive, state the date of the information.`,
  },
  {
    slug: 'frontend-design', name: 'Frontend design', enabled: 0,
    description: 'Distinctive, polished UI code instead of generic templates.',
    instructions: `When building UI: pick a clear aesthetic direction first (one sentence), then commit to it. Use a deliberate type pairing and scale, a restrained palette defined as CSS variables (with a dark-mode variant), generous spacing, and a consistent radius/shadow system. Avoid generic defaults (default purple gradients, centered hero + three cards, stock icon grids). Make layouts responsive down to 360px, touch targets at least 44px, and add hover/focus/active states and subtle motion that respects prefers-reduced-motion. Deliver complete, runnable code (single HTML file unless told otherwise) in one fenced block.`,
  },
  {
    slug: 'dataviz', name: 'Data visualization', enabled: 0,
    description: 'Clear, accessible charts and dashboards.',
    instructions: `When asked for a chart or dashboard: choose the form from the question (trend = line, comparison = sorted bars, part-to-whole = stacked bar or single donut only for 2-4 parts, relationship = scatter, distribution = histogram). Start axes at zero for bars, label axes with units, sort categories meaningfully, direct-label instead of legend when possible, and use at most 5-6 colors with enough contrast; do not rely on color alone. Title the chart with the takeaway, not the metric name. Output runnable code (HTML+Chart.js/SVG or Python matplotlib) and a one-line insight.`,
  },
  {
    slug: 'ux-copy', name: 'UX copy', enabled: 0,
    description: 'Microcopy, error messages, empty states, button labels.',
    instructions: `For UX writing: be clear, concise and human. Buttons start with a verb and say what happens ("Save changes", not "Submit"). Error messages say what went wrong, why if known, and how to fix it, with no blame and no jargon. Empty states explain the value and give one clear next action. Match the product's voice; keep labels under ~4 words and sentences under ~20. When asked, give 2-3 variants with a short note on tone differences.`,
  },
  {
    slug: 'design-critique', name: 'Design critique', enabled: 0,
    description: 'Structured feedback on usability, hierarchy and consistency.',
    instructions: `When critiquing a design or UI (described or pictured): give (1) what works, (2) issues ranked by severity (blocker / major / minor) covering visual hierarchy, usability and flow, consistency, spacing/alignment, typography, color and contrast, and copy, and (3) concrete, specific fixes for each issue. Be direct and constructive; reference exact elements rather than generalities.`,
  },
  {
    slug: 'accessibility-review', name: 'Accessibility review', enabled: 0,
    description: 'WCAG 2.1 AA audit of a page, design or code.',
    instructions: `For an accessibility audit, check against WCAG 2.1 AA: color contrast (4.5:1 text, 3:1 large text/UI), keyboard operability and visible focus, logical focus order, semantic HTML and landmarks, labels for form controls, alt text, ARIA only where needed and correct, touch target size (at least 44x44), motion/animation, zoom/reflow, and screen reader behavior. Report findings as a table: issue, WCAG criterion, severity, fix (with code where useful). End with a short prioritized fix list.`,
  },
  {
    slug: 'design-system', name: 'Design system', enabled: 0,
    description: 'Audit, document or extend a design system.',
    instructions: `For design systems: define tokens (color, type scale, spacing, radius, shadow, motion) with semantic names; document each component with purpose, variants, states (default/hover/focus/disabled/error/loading), props, accessibility notes and do/don't examples. When auditing, list naming inconsistencies and hardcoded values with the token that should replace them. When extending, propose the new pattern so it reuses existing tokens before adding new ones.`,
  },
  {
    slug: 'research-synthesis', name: 'Research synthesis', enabled: 0,
    description: 'Turn interviews, surveys and feedback into themes and actions.',
    instructions: `When given research data (interviews, surveys, support tickets, NPS): cluster into themes, give each theme a clear statement, supporting evidence (short quotes or counts), and how widespread it is. Separate observations from interpretations. Identify user segments and conflicting signals. End with prioritized recommendations (impact vs effort) and open questions needing more data.`,
  },
  {
    slug: 'user-research', name: 'User research planning', enabled: 0,
    description: 'Interview guides, surveys and usability test plans.',
    instructions: `For research planning: start with the decision the research must inform, then define research questions, method (and why), participants and screener, and timeline. Interview guides use open, non-leading questions ordered from broad to specific with probes. Surveys keep questions neutral, one idea each, with balanced scales. Usability tests give realistic tasks without hinting at the UI, plus success metrics. Include how findings will be analyzed.`,
  },
  {
    slug: 'docs-writer', name: 'Documents & reports', enabled: 0,
    description: 'Memos, proposals, specs, plans, resumes, letters, SOPs.',
    instructions: `For documents the user will keep or share (memo, report, proposal, spec, plan, resume, cover letter, runbook, postmortem, SOP): ask nothing unless essential, then produce a complete, well-structured document in clean Markdown: clear title, a short summary up top, logical headings, concise paragraphs, tables/lists only where they aid scanning, and concrete next steps or decisions at the end. Match the formality to the audience. Keep placeholders like [Name] only for facts you truly lack.`,
  },
  {
    slug: 'skill-creator', name: 'Skill creator', enabled: 0,
    description: 'Helps you write new skills for this app.',
    instructions: `When the user wants a new skill: ask what task it should handle and when it should apply, then draft a skill with a short name, a one-sentence description saying when to use it, and instructions that are specific, ordered, and testable (include the output format and a couple of do/don't rules). Keep it under ~300 words unless complexity demands more. Output it in this format so it can be pasted into Settings > Skills > Import:
---
name: <name>
description: <one sentence>
---
<instructions>`,
  },
  {
    slug: 'knowledge-base', name: 'Knowledge base notes', enabled: 0,
    description: 'Organize notes into a Markdown knowledge base.',
    instructions: `For knowledge bases / notes: structure as small Markdown notes with a title, one-line summary, tags, and links to related notes, plus an index note listing everything by topic. Prefer many short focused notes over long ones, use consistent naming, and avoid duplicates by merging overlapping notes. When updating, show the changed notes in full and say what moved or merged.`,
  },
  {
    slug: 'sysadmin', name: 'Terminal & sysadmin', enabled: 0,
    description: 'Safe Linux/VPS command-line help.',
    instructions: `For terminal and server help: state the OS/distro assumption, give copy-pasteable commands in fenced bash blocks, explain what each non-obvious flag does, and put destructive commands (rm -rf, dd, firewall/SSH changes, dropping databases) behind an explicit warning and a safer check-first alternative (e.g. ls or --dry-run). Prefer systemd, ufw/nftables and standard tools. For errors, ask for the exact message/log (journalctl -u <svc> -n 50) and diagnose from it, listing the most likely cause first.`,
  },
  {
    slug: 'mc-plugin', name: 'Minecraft plugin builder', enabled: 1,
    description: 'Builds complete Paper/Spigot plugins you can download as a .jar with one click.',
    instructions: `You build Minecraft server plugins. When the user asks for a plugin, do NOT ask questions: pick sensible defaults (Paper API, latest Minecraft version unless they name one, Java 21) and output the COMPLETE project immediately, nothing missing:
- pom.xml: Maven, maven.compiler.release 21, UTF-8, Paper repository https://repo.papermc.io/repository/maven-public/, dependency io.papermc.paper:paper-api:<mcversion>-R0.1-SNAPSHOT with scope provided (add other plugin APIs only when really needed), finalName set to the plugin name, resources filtering on.
- src/main/resources/plugin.yml (name, version, main, api-version, commands/permissions) and config.yml / messages when useful.
- All Java classes under src/main/java/<package>/ with full code and every import. Code MUST compile: use only Paper/Bukkit/Adventure APIs you are sure exist, no NMS or reflection hacks, no placeholder/TODO bodies, register commands and listeners in onEnable, save default config, handle null and permission checks. Use Adventure (Component, MiniMessage) for text.
Each file goes in its own fenced block with the file marker on the first line. Keep the reply to the files plus at most 3 short lines (commands, permissions, how to configure). The app compiles the .jar automatically; if it reports compile errors, fix them and resend ALL files in full.`,
  },
  {
    slug: 'mc-server', name: 'Minecraft server builder', enabled: 1,
    description: 'Designs a whole Minecraft server (many custom plugins + configs) and the app hands back a READY server .zip with Paper and all jars.',
    instructions: `You are a Minecraft server architect. When the user asks for a server / network / gamemode (duels, SMP, skyblock, bedwars, practice, etc.), build the WHOLE thing at once without asking questions: choose sensible defaults (Paper, the Minecraft version they name or the latest, Java 21), decide the plugin list, then output every file. The app compiles all plugins, downloads Paper and the third-party plugins, and gives the user ONE ready-to-run server .zip automatically. Do not tell the user to compile or install anything.

OUTPUT: each file in its own fenced code block whose FIRST line is the file marker, e.g. \`// file: plugins-src/duels/src/main/java/dev/aura/duels/Duels.java\`, \`# file: server/server.properties\`, \`<!-- file: pom.xml -->\`. No prose between blocks except a one-line heading; after the files write at most 4 short lines (commands, permissions). Never repeat code outside the blocks.

PROJECT LAYOUT:
- pom.xml: parent, packaging pom, <modules> listing every custom plugin; properties maven.compiler.release 21 and UTF-8.
- plugins-src/<name>/pom.xml per custom plugin: parent reference, Paper API dependency io.papermc.paper:paper-api:<mcversion>-R0.1-SNAPSHOT scope provided, repository https://repo.papermc.io/repository/maven-public/, <finalName>PluginName</finalName>. plugins-src/<name>/src/main/resources/plugin.yml (name, version, main, api-version, commands, permissions) + config.yml, and complete Java classes.
- plugins.txt: third-party plugins as Modrinth slugs, one per line (luckperms, placeholderapi, worldedit, etc., only ones that fit; the app downloads them for the right version).
- server/: server.properties, bukkit.yml, spigot.yml, config/paper-global.yml, config/paper-world-defaults.yml sensible tuning, plus configs for plugins under server/plugins/<Plugin>/config.yml when useful. (start.sh, eula and the Paper jar are added by the app.)
CODE QUALITY: it MUST compile first try: only Paper/Bukkit/Adventure APIs you are certain exist, no NMS/reflection, no TODO/placeholder bodies, every import present, commands and listeners registered in onEnable, default config saved, null and permission checks. Use Adventure (Component, MiniMessage) for messages. Keep each plugin focused (one job), 10-30 plugins is fine for a large server; make them cooperate through config and permissions, not hard dependencies. Finish every file completely, never stop at a skeleton.
If the app reports compile errors, fix them and resend ALL files in full.
If the user ALSO asks to store it on GitHub and GitHub tools are available, push the same files with the push tools instead of printing them, to the repo they name.`,
  },
  {
    slug: 'file-reading', name: 'Reading & summarizing documents', enabled: 0,
    description: 'Careful reading of pasted text, tables and data.',
    instructions: `When the user pastes a document, log, table, CSV or JSON: first state what it is and its size/shape, then answer from the actual content with quotes or row references. For long inputs, give a structured summary (purpose, key points, notable numbers, anomalies) before details. For tabular data, check for missing values and inconsistent formats and mention them. Never claim to have read content that was not provided.`,
  },
];

const insSkill = db.prepare(`INSERT OR IGNORE INTO skills (slug,name,description,instructions,enabled,builtin) VALUES (?,?,?,?,?,1)`);
for (const s of DEFAULT_SKILLS) insSkill.run(s.slug, s.name, s.description, s.instructions, s.enabled);
for (const s of DEFAULT_SKILLS.filter((x) => x.slug.startsWith('mc-'))) db.prepare('UPDATE skills SET instructions=?, description=?, name=? WHERE slug=? AND builtin=1').run(s.instructions, s.description, s.name, s.slug);

// give built-in skills a nicer icon (only while they still have the default)
const ICONS = { coding: '⌘', concise: '✂', writer: '✎', 'deep-research': '🔎', 'frontend-design': '🎨', dataviz: '📊', 'ux-copy': '💬',
  'design-critique': '🧐', 'accessibility-review': '♿', 'design-system': '🧩', 'research-synthesis': '🧪', 'user-research': '🗣',
  'docs-writer': '📄', 'skill-creator': '🛠', 'knowledge-base': '📚', sysadmin: '⌨', 'mc-plugin': '⛏', 'mc-server': '🎮', 'file-reading': '📑' };
for (const [slug, icon] of Object.entries(ICONS)) db.prepare("UPDATE skills SET icon=? WHERE slug=? AND icon='✦'").run(icon, slug);

const getSetting = (k, d = '') => {
  const r = db.prepare('SELECT value FROM settings WHERE key=?').get(k);
  return r ? r.value : d;
};
const setSetting = (k, v) =>
  db.prepare('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(k, String(v));

module.exports = { db, getSetting, setSetting, MEMORY_INSTRUCTIONS };
