/**
 * WhatsApp Message Parser
 *
 * Extracts vehicle info, DTC codes, symptoms, and customer data
 * from natural-language WhatsApp messages.
 *
 * Examples:
 *   "2019 Civic 2.0L P0420 customer John 555-1234"
 *   "P0300 misfire on my 2018 Silverado 5.3L VIN 1GCUYDED..."
 *   "oil change 2020 Camry"
 *   "front brakes 2017 F150 customer Mike Smith 555-9876"
 */

const LOG = "[wa-parser]";

/**
 * Parse an incoming WhatsApp message into structured estimate params.
 *
 * @param {string} message - Raw WhatsApp message text
 * @returns {object} Parsed params for buildEstimate()
 */
function parseMessage(message) {
  const text = message.trim();
  const textLower = text.toLowerCase();

  const result = {
    year: null,
    make: null,
    model: null,
    engine: null,
    vin: null,
    mileage: null,
    query: text,
    customer: null,
  };

  // --- Extract VIN (17 alphanumeric, no I/O/Q) ---
  const vinMatch = text.match(/\b([A-HJ-NPR-Z0-9]{17})\b/i);
  if (vinMatch) {
    result.vin = vinMatch[1].toUpperCase();
  }

  // --- Extract Year (4 digits, 1990-2030) ---
  const yearMatch = text.match(/\b(19[9]\d|20[0-3]\d)\b/);
  if (yearMatch) {
    result.year = parseInt(yearMatch[1], 10);
  }

  // --- Extract DTC codes ---
  const dtcCodes = text.match(/[PBCU][0-9]{4}/gi) || [];
  if (dtcCodes.length > 0) {
    result.dtcCodes = dtcCodes.map((c) => c.toUpperCase());
  }

  // --- Extract Make/Model ---
  const makes = {
    honda: ["civic", "accord", "cr-v", "crv", "pilot", "odyssey", "fit", "hr-v", "hrv", "ridgeline", "element", "insight"],
    toyota: ["camry", "corolla", "rav4", "highlander", "tacoma", "tundra", "4runner", "prius", "sienna", "avalon", "venza", "supra"],
    ford: ["f150", "f-150", "f250", "f-250", "f350", "f-350", "mustang", "explorer", "escape", "edge", "fusion", "ranger", "bronco", "expedition", "focus", "fiesta"],
    chevrolet: ["silverado", "equinox", "malibu", "traverse", "tahoe", "suburban", "camaro", "corvette", "colorado", "blazer", "trax", "cruze", "impala"],
    chevy: ["silverado", "equinox", "malibu", "traverse", "tahoe", "suburban", "camaro", "corvette", "colorado", "blazer", "trax", "cruze", "impala"],
    nissan: ["altima", "sentra", "rogue", "pathfinder", "murano", "frontier", "titan", "maxima", "versa", "kicks", "armada"],
    hyundai: ["elantra", "sonata", "tucson", "santa fe", "santafe", "kona", "palisade", "venue", "accent", "veloster"],
    kia: ["optima", "forte", "sorento", "sportage", "telluride", "soul", "seltos", "k5", "stinger", "rio", "carnival"],
    bmw: ["3 series", "5 series", "x3", "x5", "x1", "m3", "m5", "330i", "530i", "x7"],
    mercedes: ["c-class", "e-class", "glc", "gle", "gla", "a-class", "s-class", "c300", "e350"],
    "mercedes-benz": ["c-class", "e-class", "glc", "gle", "gla", "a-class", "s-class", "c300", "e350"],
    volkswagen: ["jetta", "passat", "tiguan", "atlas", "golf", "gti", "arteon", "taos", "id.4"],
    vw: ["jetta", "passat", "tiguan", "atlas", "golf", "gti", "arteon", "taos"],
    subaru: ["outback", "forester", "crosstrek", "impreza", "wrx", "legacy", "ascent", "brz"],
    jeep: ["wrangler", "grand cherokee", "cherokee", "compass", "renegade", "gladiator"],
    dodge: ["charger", "challenger", "durango", "ram", "journey", "dart"],
    ram: ["1500", "2500", "3500"],
    gmc: ["sierra", "acadia", "terrain", "yukon", "canyon"],
    lexus: ["rx", "es", "nx", "is", "gx", "lx", "rx350", "es350", "nx300"],
    acura: ["tlx", "rdx", "mdx", "ilx", "integra"],
    infiniti: ["q50", "q60", "qx50", "qx60", "qx80"],
    mazda: ["cx-5", "cx5", "mazda3", "mazda6", "cx-9", "cx9", "cx-30", "cx30", "mx-5", "miata"],
    volvo: ["xc90", "xc60", "xc40", "s60", "s90", "v60"],
    audi: ["a4", "a6", "q5", "q7", "a3", "q3", "q8", "s4", "rs5"],
    buick: ["encore", "envision", "enclave", "regal"],
    cadillac: ["escalade", "xt5", "ct5", "xt4", "ct4"],
    chrysler: ["300", "pacifica", "voyager"],
    lincoln: ["navigator", "aviator", "corsair", "nautilus"],
    pontiac: ["g6", "g8", "grand prix", "firebird", "gto"],
    saturn: ["vue", "ion", "outlook", "aura"],
    mini: ["cooper", "countryman", "clubman"],
  };

  for (const [make, models] of Object.entries(makes)) {
    for (const model of models) {
      if (textLower.includes(model)) {
        result.make = make === "chevy" ? "Chevrolet" : make === "vw" ? "Volkswagen" : make.charAt(0).toUpperCase() + make.slice(1);
        if (make === "mercedes-benz") result.make = "Mercedes-Benz";
        result.model = model.charAt(0).toUpperCase() + model.slice(1);
        // Normalize common model names
        if (model === "crv") result.model = "CR-V";
        if (model === "hrv") result.model = "HR-V";
        if (model === "rav4") result.model = "RAV4";
        if (model === "f150" || model === "f-150") result.model = "F-150";
        if (model === "f250" || model === "f-250") result.model = "F-250";
        if (model === "cx5" || model === "cx-5") result.model = "CX-5";
        if (model === "santafe") result.model = "Santa Fe";
        break;
      }
    }
    if (result.make) break;
  }

  // If make found but no model, try to extract the word after the make
  if (!result.make) {
    for (const make of Object.keys(makes)) {
      const makeIdx = textLower.indexOf(make);
      if (makeIdx !== -1) {
        result.make = make === "chevy" ? "Chevrolet" : make === "vw" ? "Volkswagen" : make.charAt(0).toUpperCase() + make.slice(1);
        // Grab next word as model
        const afterMake = text.slice(makeIdx + make.length).trim();
        const nextWord = afterMake.match(/^(\S+)/);
        if (nextWord && nextWord[1].length > 1 && !nextWord[1].match(/\d{4}/)) {
          result.model = nextWord[1].charAt(0).toUpperCase() + nextWord[1].slice(1);
        }
        break;
      }
    }
  }

  // --- Extract Engine ---
  const engineMatch = text.match(/(\d\.\d)\s*[Ll](?:iter)?/i);
  if (engineMatch) {
    result.engine = engineMatch[1] + "L";
  }
  // Also catch "V6", "V8", "I4" style
  const cylMatch = text.match(/\b([VvIi])[\s-]?([468])\b/);
  if (cylMatch && !result.engine) {
    result.cylinders = parseInt(cylMatch[2], 10);
  }

  // --- Extract Mileage ---
  const mileMatch = text.match(/(\d{2,3})[,.]?(\d{3})\s*(?:mi(?:les?)?|km|k)\b/i);
  if (mileMatch) {
    result.mileage = parseInt(mileMatch[1] + mileMatch[2], 10);
  }
  // Also catch "87k miles" pattern
  const mileKMatch = text.match(/(\d{2,3})\s*k\s*(?:mi(?:les?)?)?/i);
  if (mileKMatch && !result.mileage) {
    result.mileage = parseInt(mileKMatch[1], 10) * 1000;
  }

  // --- Extract Customer ---
  const customerMatch = text.match(/customer\s+([A-Za-z]+(?:\s+[A-Za-z]+)?)\s*(\d{3}[-.\s]?\d{3,4}[-.\s]?\d{4})?/i);
  if (customerMatch) {
    result.customer = {
      name: customerMatch[1].trim(),
      phone: customerMatch[2] ? customerMatch[2].replace(/[-.\s]/g, "") : null,
    };
  }

  // --- Build query string ---
  const queryParts = [];
  if (result.dtcCodes?.length > 0) {
    queryParts.push(result.dtcCodes.join(" "));
  }
  // Keep the original text as the query but strip out vehicle/customer info
  let cleanQuery = text
    .replace(/\bcustomer\s+\S+(?:\s+\S+)?\s*\d*[-.\s]?\d*[-.\s]?\d*/gi, "")
    .replace(/\b[A-HJ-NPR-Z0-9]{17}\b/gi, "")
    .replace(/\b(19[9]\d|20[0-3]\d)\b/g, "")
    .trim();

  if (cleanQuery.length > 5) {
    result.query = cleanQuery;
  } else if (queryParts.length > 0) {
    result.query = queryParts.join(" ");
  }

  console.log(`${LOG} Parsed: ${result.year || "?"} ${result.make || "?"} ${result.model || "?"} ${result.engine || ""} — "${result.query}"`);

  return result;
}

/**
 * Detect if a message is a command rather than an estimate request.
 *
 * @param {string} message
 * @returns {{ type: string, data?: any } | null}
 */
function detectCommand(message) {
  const text = message.trim().toLowerCase();

  if (text === "order" || text === "order those parts" || text.startsWith("order parts")) {
    return { type: "order" };
  }

  if (text === "send" || text.startsWith("send estimate") || text.startsWith("send to customer")) {
    return { type: "send_estimate" };
  }

  if (text === "help" || text === "?") {
    return { type: "help" };
  }

  if (text === "status" || text === "ping") {
    return { type: "status" };
  }

  return null;
}

module.exports = { parseMessage, detectCommand };
