/**
 * VIN Decoder — NHTSA vPIC API (Free, no key required)
 *
 * Decodes a VIN into Year/Make/Model/Engine and other vehicle specs.
 * API Docs: https://vpic.nhtsa.dot.gov/api/
 */

const NHTSA_BASE_URL = "https://vpic.nhtsa.dot.gov/api/vehicles";

/**
 * Decode a VIN
 * @param {string} vin - 17-character VIN
 * @returns {object} Decoded vehicle info
 */
async function decodeVin(vin) {
  if (!vin || vin.length !== 17) {
    throw new Error(`Invalid VIN: "${vin}" — must be 17 characters`);
  }

  const fetch = (await import("node-fetch")).default;
  const url = `${NHTSA_BASE_URL}/DecodeVinValues/${vin}?format=json`;
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`NHTSA API error: ${response.status}`);
  }

  const data = await response.json();
  const result = data.Results?.[0];

  if (!result) {
    throw new Error("No results returned from NHTSA");
  }

  // Extract the key fields
  const vehicle = {
    vin,
    year: result.ModelYear,
    make: result.Make,
    model: result.Model,
    trim: result.Trim || "N/A",
    engine: {
      displacement: result.DisplacementL ? `${result.DisplacementL}L` : "N/A",
      cylinders: result.EngineCylinders || "N/A",
      fuelType: result.FuelTypePrimary || "N/A",
      configuration: result.EngineConfiguration || "N/A",
      horsepower: result.EngineHP || "N/A",
    },
    transmission: result.TransmissionStyle || "N/A",
    driveType: result.DriveType || "N/A",
    bodyClass: result.BodyClass || "N/A",
    doors: result.Doors || "N/A",
    plant: {
      city: result.PlantCity || "N/A",
      country: result.PlantCountry || "N/A",
    },
    // Useful for searching repair databases
    ymme: `${result.ModelYear} ${result.Make} ${result.Model} ${result.DisplacementL ? result.DisplacementL + "L" : ""}`.trim(),
  };

  console.log(`[vin-decoder] Decoded: ${vehicle.ymme}`);
  return vehicle;
}

/**
 * Validate a VIN format (basic check)
 * @param {string} vin
 * @returns {boolean}
 */
function isValidVin(vin) {
  if (!vin || vin.length !== 17) return false;
  // VINs don't contain I, O, or Q
  return /^[A-HJ-NPR-Z0-9]{17}$/i.test(vin);
}

module.exports = { decodeVin, isValidVin };
