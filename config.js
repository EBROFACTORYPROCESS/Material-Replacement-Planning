// ============================================================
//  Configuration: platforms, field schema, format rules
// ============================================================

const PLATFORM_STORAGE = 'ai_platform';
const API_KEY_STORAGE_PREFIX = 'api_key_';
const GEMINI_MODEL_STORAGE = 'gemini_model';
const PATH_PREFIX_STORAGE = 'source_path_prefix';
const MAX_SIZE_STORAGE = 'max_image_size';
const LOCAL_MODE_STORAGE = 'local_mode_enabled';
const LOCAL_HANDLE_DB = 'ebro_fs_handles';
const INPUT_METHOD_STORAGE = 'input_method';
const RATE_LIMITS_OVERRIDE_KEY = 'rate_limits_override';

// ---- Key parameters that must be present for a form to be considered valid ----
const KEY_PARAMETERS = [
  { path: 'section_1.codigo_conjunto',    label: 'Código Conjunto' },
  { path: 'section_1.codigo_rechaz',      label: 'Código Rechazo' },
  { path: 'section_1.cantidad',           label: 'Cantidad' },
  { path: 'section_1.codigo_componente',  label: 'Código Componente' },
  { path: 'section_1.origen_area_zona',   label: 'Origen Área/Zona' },
  { path: 'section_2.fecha',              label: 'Fecha' },
  { path: 'section_2.operario',           label: 'Operario' },
  { path: 'section_2.motivo_rechace',     label: 'Motivo Rechace' },
  { path: 'signatures.encargado_linea',   label: 'Signature Encargado Línea' }
];

// Fields that should NEVER be classified as "missing" even when empty.
const OPTIONAL_FIELDS = [
  'section_2.observaciones'
];

// Fields to hide from the result table and KPI summary.
const HIDDEN_FIELDS = [
  'header.company',
  'header.document_type'
];

// ---- AI Platform configs ----
const PLATFORMS = {
  gemini: {
    name: 'Gemini',
    defaultModel: 'gemini-3.6-flash',
    endpoint: (model) => `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
    keyHint: 'Get a free key at <a href="https://aistudio.google.com" target="_blank" rel="noopener noreferrer">aistudio.google.com</a>',
    placeholder: 'Paste your Gemini API Key...',
    badgeClass: 'gemini',
    models: [
      {
        id: 'gemini-3.6-flash',
        label: 'Gemini 3.6 Flash',
        note: 'Free tier: ~5 RPM, ~20 RPD — best quality, very limited daily quota',
        limits: { rpm: 5, tpm: 250000, rpd: 20 }
      },
      {
        id: 'gemini-3.5-flash',
        label: 'Gemini 3.5 Flash',
        note: 'Free tier: ~10 RPM, ~250 RPD — good balance of quality and quota',
        limits: { rpm: 10, tpm: 250000, rpd: 250 }
      },
      {
        id: 'gemini-3.5-flash-lite',
        label: 'Gemini 3.5 Flash-Lite',
        note: 'Free tier: ~30 RPM, ~500 RPD — fastest, recommended for high-volume batches',
        limits: { rpm: 30, tpm: 1000000, rpd: 500 }
      },
      {
        id: 'gemini-3.1-flash-lite',
        label: 'Gemini 3.1 Flash-Lite',
        note: 'Free tier: ~30 RPM, ~500 RPD — stable fallback, good for fixed-template forms',
        limits: { rpm: 30, tpm: 1000000, rpd: 500 }
      },
      {
        id: 'gemini-3.6-pro',
        label: 'Gemini 3.6 Pro',
        note: 'Paid tier only — highest quality, no free daily quota',
        limits: { rpm: 60, tpm: 2000000, rpd: 10000 }
      }
    ]
  },
  deepseek: {
    name: 'DeepSeek',
    defaultModel: 'deepseek-chat',
    endpoint: () => `https://api.deepseek.com/chat/completions`,
    keyHint: 'Get a key at platform.deepseek.com',
    placeholder: 'Paste your DeepSeek API Key...',
    badgeClass: 'deepseek',
  }
};

// ---- Field schema (descriptions sent to the AI) ----
const FIELD_SCHEMA = {
  header: {
    _validity: {
      type: 'string',
      description: 'Determine whether this image is a valid EBRO "Control Calidad" form. Return EXACTLY one of these two strings: "valid" or "invalid". Return "valid" if the image contains the EBRO form (even partially, damaged, torn, crumpled, folded, or obscured). The form is recognizable by the EBRO logo, the "CONTROL CALIDAD" title, or any of the field labels such as "CÓDIGO CONJUNTO", "CÓDIGO COMPONENTE", "FECHA", "OPERARIO", "MOTIVO RECHACE", etc. Return "invalid" ONLY if the image is completely unrelated to the form — for example: a photo of equipment, a person, a landscape, a screenshot, a white page, or any image with no visible form elements. IMPORTANT: A torn, damaged, partially visible, or badly photographed form is STILL "valid" and must be processed normally.'
    },
    ticket_category: {
      type: 'string',
      description: 'The category of the ticket, determined by the color of the TOP HEADER BAND of the form. Look at the broad colored strip across the top of the form, just below the EBRO logo area. If that header band is GREEN, return exactly "Process Scrap Parts". If that header band is ORANGE, return exactly "Supplier Claim Parts". Return exactly one of those two strings.'
    },
    ticket_id: {
      type: 'string',
      description: 'The large red printed number in the white box on the right side of the colored band, e.g. "173432". This is the unique ticket identifier printed at the top-right of the form.'
    }
  },
  section_1: {
    codigo_conjunto: {
      type: 'string',
      description: 'The handwritten value inside the box labeled "CÓDIGO CONJUNTO", in the first row of the form body directly under the colored header band. This is a MATERIAL CODE. RULES: (1) REMOVE ALL EMPTY SPACES — join all character groups into a single string. Example: "60 200 57 84 AAAUH" → "602005784AAAUH". (2) TYPICAL LENGTH: material codes are usually 12-14 characters long. If your reading is shorter than 11 characters, you are probably DROPPING characters — re-check the image carefully. (3) COMMON PATTERNS: · Pattern A: 8-9 digits + "AA" + optional suffix (e.g. 555001255AA, 609000503AA). · Pattern B: 8-9 digits + "AAA" + 2 letters (e.g. 403018592AAAGY, 403013064AAABE). In this pattern there are usually FOUR or FIVE consecutive letter-A characters in the middle (AAA or AAAA), followed by 1-2 final letters. · Pattern C: numeric prefix + "-" + longer body (e.g. 60-3611061AB). · Pattern D: letter prefix + digits (e.g. J686107113). (4) CHARACTER DISAMBIGUATION — READ THE STROKE SHAPE, NOT THE FAMILIAR PATTERN: · "4" vs "6" — CRITICAL: a handwritten "4" has a SHARP ANGLE with a vertical stroke and a horizontal cross-bar. A handwritten "6" has a CLOSED LOOP at the bottom with a curved top. If the first character of a code looks like a sharp angular shape, it is "4" (not "6"). Material codes almost always START with "4" or a letter prefix — the digit "6" is RARE at the start. · "0" vs "O" — inside a numeric body, it is almost always the digit ZERO. · "1" vs "I" vs "l" — inside a numeric body, it is the digit ONE. · "5" vs "S" — inside a numeric body, it is the digit FIVE. · "8" vs "B" — inside a numeric body, it is the digit EIGHT. · "A" vs "D" — "A" has a triangular peak with a cross-bar; "D" has a rounded right side. When in doubt in a code suffix, it is "A". · "Y" vs "M" — "Y" has TWO diagonal strokes meeting at a single point with a stem below; "M" has TWO VERTICAL strokes connected by two diagonals. Look at whether the strokes are parallel (M) or converging to a point (Y). (5) MULTIPLE CODES ON ONE LINE: sometimes the operator writes TWO OR MORE material codes on the same line, separated by "/", "-", "|", "+", or "&". Return ALL codes joined by the original separator, without spaces. Example: "609000503AA / 609000504BB" → "609000503AA/609000504BB". (6) Do NOT read PRINTED form lines or grid borders as part of the code. ONLY read the BLUE or BLACK handwriting. (7) DO NOT DROP OR DUPLICATE CHARACTERS: count the characters of your reading and compare with what is visibly written.'
    },
    codigo_componente: {
      type: 'string',
      description: 'The handwritten value inside the box labeled "CÓDIGO COMPONENTE". Usually contains "/" separators, e.g. "Pilar B/Sup/Der".'
    },
    codigo_rechaz: {
      type: 'string',
      description: 'The handwritten value inside the small box labeled "CÓDIGO RECHAZ", on the LEFT side below "CÓDIGO COMPONENTE". This is a SHORT reject code of 3-5 characters. It commonly contains BOTH digits AND letters, e.g. "221M", "2216", "22M4", "A104", "2214", "221R", "22P1". IMPORTANT — COMMON MISREADINGS: · Handwritten "M" can look like "04" — but "M" has two vertical strokes connected by diagonals, while "04" is a round zero followed by a separate digit. Read the STROKE SHAPE: if you see a connected zigzag pattern, it is an "M", not "04". · Handwritten "R" can look like "12" — but "R" has a rounded top and a diagonal leg, while "12" is two separate digits. · Handwritten "P" can look like "1o" or "10" — but "P" has a rounded top and a vertical stem. · The digit "0" must NOT be read as the letter "O" in a numeric body. Return the exact alphanumeric string as written.'
    },
    cantidad: {
      type: 'string',
      description: 'A number handwritten INSIDE the box labeled "CANTIDAD". It is often followed by a horizontal PRINTED LINE (a guard line that prevents someone from adding extra digits later, e.g. converting "1" into "10" or "100"). Do NOT include this line or any trailing dashes in the value — only the digits. SPECIAL CASE: the operator may write a math expression using "+" or "-" between numbers, for example "1+1", "2+3", or "1+1+1". This is NORMAL — return the full expression exactly as written, including the "+" or "-" signs. Do NOT collapse "1+1" into "11", and do NOT compute the result. Return the raw string exactly as written on the form.'
    },
    origen_area_zona: {
      type: 'string',
      description: 'A location code written in the LEFT-MIDDLE of the form. This field can be sourced from THREE different boxes, in this priority order: (1) FIRST, check the box under the header "ORIGEN" — it has TWO adjacent sub-boxes labeled "AREA" (left) and "ZONA" (right). If both are filled, concatenate them with NO separator, e.g. AREA="M1", ZONA="M3" → "M1M3". If only one is filled, return just that value. (2) SECOND, if the ORIGEN boxes are empty, check the box labeled "ZONA O LÍNEA" located in the LOWER-LEFT of the form, just above the FECHA box. This box is often handwritten with a short code like "LF", "M2", "15A", "221R". (3) THIRD, if the ZONA O LÍNEA box is also empty, check the small box labeled "DETECTADO" (located immediately to the right of ZONA O LÍNEA). Return its value. Return null only if ALL of these boxes are empty.'
    }
  },
  section_2: {
    motivo_rechace: {
      type: 'string',
      description: 'The rejection reason written INSIDE the box labeled "MOTIVO RECHACE", in the LOWER-LEFT of the form. The value is EITHER: (a) a KNOWN REJECT CODE from the list below, OR (b) a short brief description of the defect, e.g. "DESCASCARADA CON GOLPE DE CAJAS", "RAYADO", "GOLPE", "ROTO". The KNOWN REJECT CODES are: 2276, 2272, 2250, 2213, 2210, 22F0, 2263, 22P1, 22B1, 221R, 221K, 221P, 221L, 221M, 221N, 6100. RULES: · If the value matches one of these codes EXACTLY (including letter+digit mixes like "221M" or "22P1"), return the code as-is. · If the value is a description instead of a code, return the description text as written. · Do NOT confuse a printed form line with handwriting. · NEVER return a date, an operator ID, or a generic word like "FECHA". The value must be physically written INSIDE the MOTIVO RECHACE box.'
    },
    fecha: {
      type: 'string',
      description: 'A DATE handwritten INSIDE the small box labeled "FECHA" at the BOTTOM-LEFT of the form. The box is small and bordered by printed lines. A valid value MUST look like a date: "DD/MM/YY", "D/M/YY", "D-M-YY", "DD-MM-YYYY" (e.g. "22/4/26", "15-9-26"). If the box contains anything that is NOT a date — for example a word, a defect description, or an operator ID — return null. Do NOT invent a value. Do NOT copy the date into the OPERARIO box below.'
    },
    observaciones: {
      type: 'string',
      description: 'Free-text comments handwritten INSIDE the wide box labeled "OBSERVACIONES" at the BOTTOM-CENTER of the form. This box is OFTEN EMPTY. If empty, return null. The value must be physically written INSIDE the OBSERVACIONES box — do NOT copy text from MOTIVO RECHACE, FECHA, or OPERARIO.'
    },
    operario: {
      type: 'string',
      description: 'A short OPERATOR ID handwritten INSIDE the small box labeled "OPERARIO". This box sits DIRECTLY BELOW the "FECHA" box at the BOTTOM-LEFT of the form. Valid values are 3 or 4 digits (e.g. "897", "1234"). IMPORTANT: This box is VERY OFTEN EMPTY. If empty, return null. If the only handwriting in that area is the date (in the FECHA box above), do NOT copy it down — operario must stay null. It is NEVER a date, NEVER a defect description, NEVER a word.'
    }
  },
  signatures: {
    inspector: {
      type: 'string',
      description: 'Look INSIDE the box labeled "Inspector" at the BOTTOM-LEFT of the form. Return "Signed" ONLY if the box contains one of the following: (a) a handwritten CURSIVE signature (continuous flowing strokes forming a name or initials), or (b) a RUBBER STAMP mark consisting of approximately 5 characters (e.g. "JE673" = 2 letters + 3 digits, or a similar stamped identifier). Return "Not Signed" if the box contains: only a printed red line/underline, only a single isolated letter (e.g. "A"), only a short numeric code, only the printed label, or nothing at all.'
    },
    visto_bueno_calidad: {
      type: 'string',
      description: 'Look INSIDE the box labeled "Calidad" or "Vº Bº C. CALIDAD" at the BOTTOM-CENTER of the form. Return "Signed" ONLY if the box contains one of the following: (a) a handwritten CURSIVE signature (continuous flowing strokes forming a name or initials), or (b) a RUBBER STAMP mark consisting of approximately 5 characters (e.g. "JE673" = 2 letters + 3 digits). Return "Not Signed" if the box contains: only a printed red line/underline, only a single isolated letter, only a short numeric code, only the printed label, or nothing at all.'
    },
    encargado_linea: {
      type: 'string',
      description: 'Look INSIDE the box labeled "Encargado" or "ENCARGADO LÍNEA" at the BOTTOM-RIGHT of the form. Return "Signed" ONLY if the box contains one of the following: (a) a handwritten CURSIVE signature (continuous flowing strokes forming a name or initials), or (b) a RUBBER STAMP mark consisting of approximately 5 characters (e.g. "JE673" = 2 letters + 3 digits). Return "Not Signed" if the box contains: only a printed red line/underline, only a single isolated letter, only a short numeric code, only the printed label, or nothing at all. Each of the three signature boxes is INDEPENDENT — a signature in one box does NOT imply the others are signed.'
    }
  }
};

// ---- Format validation rules ----
const FORMAT_RULES = {
  'header._validity': {
    test: v => /^(valid|invalid)$/i.test(v.trim()),
    hint: 'Expected "valid" or "invalid"'
  },
  'header.ticket_category': {
    test: v => /^(Process Scrap Parts|Supplier Claim Parts)$/i.test(v.trim()),
    hint: 'Expected "Process Scrap Parts" or "Supplier Claim Parts"'
  },
  'section_1.codigo_conjunto': {
    test: v => {
      const s = v.trim().replace(/\s+/g, '');
      if (s.length < 11 || s.length > 20) return false;
      if (/[?!@#$%&*()\[\]{}<>"';:`~^|\\]/.test(s)) return false;
      if (!/\d/.test(s)) return false;
      const parts = s.split(/[\/|&+]/);
      for (const part of parts) {
        const ok =
          /^[0-9]{8,9}AA[A-Z]{0,3}$/i.test(part) ||
          /^[0-9]{6,8}-[0-9A-Z]{6,12}$/i.test(part) ||
          /^[A-Z][0-9]{6,12}$/i.test(part) ||
          /^[0-9A-Z]{11,20}$/i.test(part);
        if (!ok) return false;
      }
      return true;
    },
    hint: 'Expected a material code 11-20 characters long (e.g. 555001255AA, 403018592AAAGY, 60-3611061AB, J686107113) with no spaces.'
  },
  'section_1.codigo_componente': {
    test: v => /[A-Za-z]/.test(v) && v.trim().length >= 4,
    hint: 'Expected a text description like "Pilar B/Sup/Der"'
  },
  'section_1.codigo_rechaz': {
    test: v => {
      const s = v.trim().replace(/\s+/g, '');
      if (!/^[A-Z0-9]{3,5}$/i.test(s)) return false;
      if (!/\d/.test(s)) return false;
      return true;
    },
    hint: 'Expected a 3-5 character alphanumeric reject code (digits + letters), e.g. "2216", "221M", "A104".'
  },
  'section_1.cantidad': {
    test: v => {
      const s = v.trim();
      if (/^[0-9]{1,3}$/.test(s)) return true;
      if (/^[0-9]{1,2}(\s*[\+\-]\s*[0-9]{1,2})+$/.test(s)) return true;
      return false;
    },
    hint: 'Expected a small number like "2", or a math expression like "1+1".'
  },
  'section_1.origen_area_zona': {
    test: v => /^[A-Z0-9][A-Z0-9\s\-]{1,11}$/i.test(v.trim()),
    hint: 'Expected a short alphanumeric code like "M1M3" or "M1" or "15A".'
  },
  'section_2.motivo_rechace': {
    test: v => {
      const s = v.trim().toUpperCase();
      const KNOWN_CODES = [
        '2276','2272','2250','2213','2210','22F0','2263','22P1','22B1',
        '221R','221K','221P','221L','221M','221N','6100'
      ];
      if (KNOWN_CODES.includes(s.replace(/\s+/g, ''))) return true;
      if (s.length >= 3 && /[A-Z]/i.test(s)) return true;
      return false;
    },
    hint: 'Expected a known reject code (e.g. 221M, 22P1, 6100) or a short description like "RAYADO".'
  },
  'section_2.fecha': {
    test: v => /^\d{1,2}[\/\-\.]\d{1,2}[\/\-\.]\d{2,4}$/.test(v.trim()),
    hint: 'Expected a date like "22/4/26"'
  },
  'section_2.operario': {
    test: v => /^[0-9]{3,4}$/.test(v.trim()),
    hint: 'Expected a 3 or 4 digit operator ID'
  },
  'section_2.observaciones': {
    test: v => /[A-Za-zÀ-ÿ]/.test(v) && !/^\d+$/.test(v.trim()),
    hint: 'Expected a text comment, not a number'
  },
  'signatures.inspector': {
    test: v => /^(Signed|Not Signed)$/i.test(v.trim()),
    hint: 'Expected "Signed" or "Not Signed"'
  },
  'signatures.visto_bueno_calidad': {
    test: v => /^(Signed|Not Signed)$/i.test(v.trim()),
    hint: 'Expected "Signed" or "Not Signed"'
  },
  'signatures.encargado_linea': {
    test: v => /^(Signed|Not Signed)$/i.test(v.trim()),
    hint: 'Expected "Signed" or "Not Signed"'
  }
};

// ---- Prompt builders ----
function buildPromptText() {
  const lines = [];
  lines.push('You are a data extraction assistant. Extract all information from this EBRO Factory "Control Calidad" form image.');
  lines.push('');
  lines.push('CRITICAL RULES:');
  lines.push('');
  lines.push('1. VALIDITY CHECK (DO THIS FIRST, BEFORE ANYTHING ELSE):');
  lines.push('   Determine whether this image shows an EBRO "Control Calidad" form.');
  lines.push('   Return the result in the "header._validity" field:');
  lines.push('     - Return "valid" if the image contains ANY part of the form:');
  lines.push('         · the EBRO logo,');
  lines.push('         · the "CONTROL CALIDAD" title,');
  lines.push('         · the colored header band,');
  lines.push('         · any field label such as "CÓDIGO CONJUNTO", "CÓDIGO COMPONENTE", "FECHA", "OPERARIO", "MOTIVO RECHACE", "OBSERVACIONES", "INSPECTOR", "CALIDAD", "ENCARGADO LÍNEA",');
  lines.push('         · or any handwritten value inside a box.');
  lines.push('     - A torn, damaged, crumpled, folded, partially visible, badly lit, or blurred form is STILL "valid" — you must extract whatever is visible and use null for what is missing.');
  lines.push('     - Return "invalid" ONLY when the image has NO form at all. Examples:');
  lines.push('         · a photo of equipment, a machine, a vehicle, a person, a building, a landscape;');
  lines.push('         · a screenshot of a computer screen with no form;');
  lines.push('         · a blank white or black page;');
  lines.push('         · a photo of a document that is NOT the EBRO Control Calidad form.');
  lines.push('   If you return "invalid", still return the full JSON structure but set every other field to null.');
  lines.push('');
  lines.push('2. ORIENTATION: The image may be rotated. Before reading any field, mentally rotate so that the "EBRO" logo is TOP-LEFT and the colored header band runs horizontally across the top.');
  lines.push('');
  lines.push('3. TICKET CATEGORY (from the header band color):');
  lines.push('   - GREEN header band  → ticket_category = "Process Scrap Parts"');
  lines.push('   - ORANGE header band → ticket_category = "Supplier Claim Parts"');
  lines.push('   Return that exact string in header.ticket_category.');
  lines.push('');
  lines.push('4. ANTI-DUPLICATION RULE (MANDATORY):');
  lines.push('   A single piece of handwritten text can only belong to ONE field. It can NEVER appear in two or more fields.');
  lines.push('   Before returning the JSON, perform this verification step:');
  lines.push('     a) Build a list of all non-null values.');
  lines.push('     b) For each pair of fields, check whether their values are identical (case-insensitive, ignoring extra spaces).');
  lines.push('     c) If two fields have the same value, KEEP it only in the field whose printed box physically contains that handwriting, and set the other to null.');
  lines.push('   ');
  lines.push('   Concrete example — this is WRONG:');
  lines.push('     fecha:          "15-9-26"');
  lines.push('     operario:       "15-9-26"    ← WRONG, duplicated');
  lines.push('   ');
  lines.push('   Correct output:');
  lines.push('     fecha:          "15-9-26"');
  lines.push('     operario:       null         ← the OPERARIO box is empty');
  lines.push('');
  lines.push('5. STRICT FIELD-BOX READING:');
  lines.push('   Each value is written INSIDE a specific printed box on the form.');
  lines.push('   Use the box BORDERS (the printed lines) to decide which field a value belongs to.');
  lines.push('   Do NOT guess or "spread" a value to fill empty fields.');
  lines.push('   If a box is EMPTY, return null for that field. An empty box is a valid answer.');
  lines.push('');
  lines.push('5a. DISTINGUISH HANDWRITING FROM PRINTED FORM LINES:');
  lines.push('   The form contains many PRINTED elements: box borders, grid lines, underlines, tick marks, and small printed reference numbers in the corners.');
  lines.push('   These PRINTED elements are PART OF THE FORM — they are NOT data. Do NOT read them as field values.');
  lines.push('   HANDWRITING looks different: it is in BLUE or BLACK INK, usually cursive or loose, with variable stroke width and uneven spacing.');
  lines.push('   PRINTED lines are uniform, thin, gray/black, and perfectly straight or perfectly box-shaped.');
  lines.push('   If you see a straight line inside a box, it is the form line — NOT a digit "1".');
  lines.push('   ONLY read the HANDWRITTEN ink as field values.');
  lines.push('');
  lines.push('5b. MULTI-BOX FIELD — origen_area_zona (exception to rule 4):');
  lines.push('   The field "origen_area_zona" reads from THREE possible boxes, checked in order of priority:');
  lines.push('     Priority 1 — ORIGEN row: this row has TWO adjacent sub-boxes labeled "AREA" (left) and "ZONA" (right).');
  lines.push('       If both are filled: concatenate with NO separator. Example: AREA="M1", ZONA="M3" → "M1M3".');
  lines.push('       If only one is filled: use only that value.');
  lines.push('     Priority 2 — ZONA O LÍNEA box: located in the LOWER-LEFT of the form, just above the FECHA box.');
  lines.push('       Use this value ONLY IF the ORIGEN boxes are both empty.');
  lines.push('     Priority 3 — DETECTADO box: a small box immediately to the RIGHT of ZONA O LÍNEA.');
  lines.push('       Use this value ONLY IF both ORIGEN and ZONA O LÍNEA are empty.');
  lines.push('   Return null only if ALL of the above are empty.');
  lines.push('');
  lines.push('5c. CÓDIGO CONJUNTO — SPACES AND MULTIPLE CODES:');
  lines.push('   The "codigo_conjunto" field must have ALL EMPTY SPACES REMOVED.');
  lines.push('   Example: "60 200 57 84 AAAUH" → "602005784AAAUH".');
  lines.push('   Sometimes the operator writes TWO OR MORE material codes on the SAME LINE, separated by "/", "-", "|", "+", or "&".');
  lines.push('   In that case, return ALL codes joined by the original separator, WITHOUT any spaces.');
  lines.push('   Do NOT split or drop any code.');
  lines.push('   DO NOT DROP CHARACTERS: after reading, count the characters and compare with what is visibly written.');
  lines.push('');
  lines.push('5d. MATERIAL CODE GRAMMAR — codigo_conjunto and codigo_rechaz:');
  lines.push('   The material codes follow SPECIFIC PATTERNS. Use them to double-check your reading:');
  lines.push('');
  lines.push('   TYPICAL LENGTH: material codes are usually 12 to 14 characters long.');
  lines.push('   If your reading has fewer than 11 characters, you are probably DROPPING characters — re-check the image.');
  lines.push('');
  lines.push('   PATTERN A (numeric-body + AA-suffix): 8-9 digits followed by "AA".');
  lines.push('     Examples: 555001255AA, 609000503AA.');
  lines.push('     The "AA" suffix is almost ALWAYS two letter As — NOT "AD", NOT "AB", NOT "AE".');
  lines.push('');
  lines.push('   PATTERN B (numeric-body + AAA-suffix + letters): 8-9 digits followed by THREE OR FOUR "A" characters, then 1-2 final letters.');
  lines.push('     Examples: 403018592AAAGY, 403013064AAABE.');
  lines.push('     IMPORTANT: this pattern frequently has FOUR consecutive A characters ("AAAA"), not three.');
  lines.push('     Do NOT collapse "AAAA" into "AAA". Count the visible A strokes carefully.');
  lines.push('     The FINAL letter(s) after the A-block are usually Y, M, E, F, or similar — read them carefully.');
  lines.push('');
  lines.push('   PATTERN C (with dash prefix): numeric prefix + dash + longer body.');
  lines.push('     Examples: 60-3611061AB, 368-6107118.');
  lines.push('');
  lines.push('   PATTERN D (letter prefix): starts with a letter followed by digits.');
  lines.push('     Examples: J686107113.');
  lines.push('');
  lines.push('   CRITICAL MISREADINGS TO AVOID — READ THE STROKE SHAPE:');
  lines.push('     · "4" vs "6": a handwritten "4" has a SHARP ANGLE with a vertical stroke and a horizontal cross-bar. A handwritten "6" has a CLOSED LOOP at the bottom with a curved top.');
  lines.push('       At the START of a material code, the first character is almost always "4" (or a letter prefix). The digit "6" is RARE at the start.');
  lines.push('     · "Y" vs "M": "Y" has TWO DIAGONAL strokes converging to a single point, with a stem below. "M" has TWO VERTICAL strokes connected by TWO diagonals, with parallel sides.');
  lines.push('     · "0" (zero) vs "O" (letter O): inside a numeric body, it is almost always a ZERO.');
  lines.push('     · "1" (one) vs "I" vs "l": inside a numeric body, it is a ONE.');
  lines.push('     · "5" (five) vs "S": inside a numeric body, it is a FIVE.');
  lines.push('     · "8" (eight) vs "B": inside a numeric body, it is an EIGHT.');
  lines.push('     · "A" (letter) vs "4" (four): "A" has a flat base and a triangular peak; "4" has a vertical stroke and a horizontal cross-bar.');
  lines.push('     · "A" vs "D": "A" is triangular with a cross-bar; "D" is rounded on the right with a straight left edge.');
  lines.push('');
  lines.push('6. POSITIONAL ANCHORS (use these to locate each field):');
  lines.push('   - motivo_rechace:   LOWER-LEFT area, under the label "MOTIVO RECHACE". Value is a KNOWN CODE or a BRIEF DESCRIPTION. Known codes: 2276, 2272, 2250, 2213, 2210, 22F0, 2263, 22P1, 22B1, 221R, 221K, 221P, 221L, 221M, 221N, 6100.');
  lines.push('   - fecha:            BOTTOM-LEFT, small box with label "FECHA"');
  lines.push('   - operario:         BOTTOM-LEFT, small box with label "OPERARIO" (DIRECTLY BELOW fecha)');
  lines.push('   - observaciones:    BOTTOM-CENTER, wide box with label "OBSERVACIONES"');
  lines.push('   - cantidad:         MIDDLE-RIGHT, box labeled "CANTIDAD". The value may include a "+" or "-" between numbers, e.g. "1+1". Return the full expression AS WRITTEN, do NOT collapse it into "11".');
  lines.push('   - codigo_rechaz:    MIDDLE-LEFT, small box labeled "CÓDIGO RECHAZ"');
  lines.push('   - origen_area_zona: LEFT-MIDDLE, sourced from ORIGEN (AREA+ZONA) or ZONA O LÍNEA or DETECTADO. See rule 5b.');
  lines.push('   - codigo_conjunto:  TOP-LEFT of the form body, first row under the colored header band. See rules 5c and 5d.');
  lines.push('');
  lines.push('7. Each field description below tells you exactly where its label is and what its value should look like.');
  lines.push('8. For handwritten values, transcribe exactly what you see.');
  lines.push('9. SIGNATURE FIELDS — READ CAREFULLY:');
  lines.push('   The form has THREE independent signature boxes near the bottom:');
  lines.push('     - "Inspector"       (bottom-left)');
  lines.push('     - "Calidad" / "Vº Bº C. CALIDAD"  (bottom-center)');
  lines.push('     - "Encargado" / "ENCARGADO LÍNEA" (bottom-right)');
  lines.push('   Return "Signed" ONLY IF the box contains one of:');
  lines.push('     (a) a handwritten CURSIVE signature,');
  lines.push('     (b) a RUBBER STAMP — about 5 characters, typically 2 letters + 3 digits.');
  lines.push('   Return "Not Signed" for ALL OTHER cases, including:');
  lines.push('     - the box is empty');
  lines.push('     - the box contains only a printed red line or underline');
  lines.push('     - the box contains only a single isolated letter');
  lines.push('     - the box contains only a short numeric code');
  lines.push('     - the box contains a defect word or description');
  lines.push('   The three boxes are INDEPENDENT.');
  lines.push('10. If a non-signature field is empty or illegible, use null. NEVER copy a neighbor value to fill it.');
  lines.push('');
  lines.push('Return a valid JSON object with the structure below:');
  lines.push('');

  const obj = {};
  const sections = Object.keys(FIELD_SCHEMA);
  sections.forEach(section => {
    obj[section] = {};
    Object.keys(FIELD_SCHEMA[section]).forEach(field => {
      obj[section][field] = FIELD_SCHEMA[section][field].description;
    });
  });
  lines.push(JSON.stringify(obj, null, 2));
  lines.push('');
  lines.push('Return ONLY the JSON object. No markdown fences, no explanations.');
  return lines.join('\n');
}

function buildJsonSchema() {
  const properties = {};
  const sections = Object.keys(FIELD_SCHEMA);
  sections.forEach(section => {
    properties[section] = {
      type: 'object',
      properties: {},
      required: Object.keys(FIELD_SCHEMA[section])
    };
    Object.keys(FIELD_SCHEMA[section]).forEach(field => {
      properties[section].properties[field] = {
        type: FIELD_SCHEMA[section][field].type,
        description: FIELD_SCHEMA[section][field].description
      };
    });
  });
  return { type: 'object', properties, required: sections };
}

function checkFormat(path, value) {
  const rule = FORMAT_RULES[path];
  if (!rule) return 'ok';
  if (value === null || value === undefined || String(value).trim() === '') return 'missing';
  const s = String(value).trim();
  try { return rule.test(s) ? 'ok' : 'format-mismatch'; } catch (e) { return 'ok'; }
}
