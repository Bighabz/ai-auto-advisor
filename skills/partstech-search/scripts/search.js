/**
 * PartsTech — REST API Integration (Enhanced)
 *
 * Searches PartsTech for auto parts with live pricing and inventory.
 * Includes vendor comparison and best-value ranking.
 *
 * API Docs: https://api-docs.partstech.com/
 * Free account: https://partstech.com
 */

const PARTSTECH_API_KEY = process.env.PARTSTECH_API_KEY;
const PARTSTECH_BASE_URL = "https://api.partstech.com/v1";

/**
 * Search for parts by vehicle + part type with vendor comparison
 * @param {object} params
 * @param {string} params.vin - Vehicle VIN
 * @param {string} params.partType - Part name or category
 * @param {string} [params.partNumber] - Specific part number
 * @param {string} [params.position] - Location (e.g., "upstream", "downstream", "bank 1", "bank 2", "front", "rear")
 * @param {boolean} [params.includeOEM] - Include OEM parts
 * @param {boolean} [params.includeAftermarket] - Include aftermarket parts
 * @returns {object} Parts with vendor comparison and best-value picks
 */
async function searchParts({
  vin,
  partType,
  partNumber,
  position,
  includeOEM = true,
  includeAftermarket = true,
}) {
  const fetch = (await import("node-fetch")).default;

  // Build search term with position if provided
  let searchTerm = partNumber || partType;
  if (position) {
    searchTerm = `${partType} ${position}`;
  }

  const searchBody = {
    vin,
    searchTerm,
    filters: {
      includeOEM,
      includeAftermarket,
    },
  };

  try {
    const response = await fetch(`${PARTSTECH_BASE_URL}/parts/search`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${PARTSTECH_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(searchBody),
    });

    if (!response.ok) {
      throw new Error(`PartsTech API error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    const rawResults = data.results || [];

    // Format and enrich results
    const formattedResults = rawResults.map((part) => ({
      description: part.description,
      partNumber: part.partNumber,
      brand: part.brand,
      manufacturer: part.manufacturer || part.brand,
      price: parseFloat(part.price) || 0,
      coreCharge: parseFloat(part.coreCharge) || 0,
      totalCost: (parseFloat(part.price) || 0) + (parseFloat(part.coreCharge) || 0),
      availability: part.inStock ? "In Stock" : part.eta || "Order",
      quantityAvailable: part.quantityAvailable || null,
      supplier: part.supplierName,
      supplierLocation: part.supplierLocation,
      supplierDistance: part.distanceMiles || null,
      type: part.isOEM ? "OEM" : "Aftermarket",
      warranty: part.warranty || "Standard",
      position: position || part.position || null,
      fitmentNotes: part.fitmentNotes || null,
      // For ordering
      supplierId: part.supplierId,
      partId: part.partId,
      canOrder: part.canOrder !== false,
    }));

    // Separate OEM and Aftermarket
    const oemParts = formattedResults.filter((p) => p.type === "OEM");
    const aftermarketParts = formattedResults.filter((p) => p.type === "Aftermarket");

    // Find best value in each category
    const bestOEM = findBestValue(oemParts);
    const bestAftermarket = findBestValue(aftermarketParts);
    const overallBest = findBestValue(formattedResults);

    // Group by supplier for comparison
    const bySupplier = groupBySupplier(formattedResults);

    return {
      source: "PartsTech",
      vin,
      searchTerm,
      position,
      resultCount: formattedResults.length,

      // Best picks (ready to add to estimate)
      bestValue: {
        overall: overallBest,
        oem: bestOEM,
        aftermarket: bestAftermarket,
      },

      // All options grouped
      oemOptions: oemParts.sort((a, b) => a.totalCost - b.totalCost),
      aftermarketOptions: aftermarketParts.sort((a, b) => a.totalCost - b.totalCost),

      // Supplier comparison
      supplierComparison: bySupplier,

      // Raw for custom filtering
      allParts: formattedResults,
    };
  } catch (error) {
    console.error(`[partstech] Search failed: ${error.message}`);
    return {
      source: "PartsTech",
      error: error.message,
      bestValue: null,
      oemOptions: [],
      aftermarketOptions: [],
      allParts: [],
    };
  }
}

/**
 * Find best value part (in stock, lowest total cost, good warranty)
 */
function findBestValue(parts) {
  if (!parts || parts.length === 0) return null;

  // Filter to in-stock only first
  const inStock = parts.filter((p) => p.availability === "In Stock" && p.canOrder);

  // If nothing in stock, use all parts
  const candidates = inStock.length > 0 ? inStock : parts;

  // Sort by total cost (price + core)
  const sorted = [...candidates].sort((a, b) => a.totalCost - b.totalCost);

  // Return cheapest
  return sorted[0] || null;
}

/**
 * Group parts by supplier for comparison view
 */
function groupBySupplier(parts) {
  const groups = {};
  for (const part of parts) {
    const key = part.supplier || "Unknown";
    if (!groups[key]) {
      groups[key] = {
        supplier: key,
        location: part.supplierLocation,
        distance: part.supplierDistance,
        parts: [],
        lowestPrice: Infinity,
      };
    }
    groups[key].parts.push(part);
    if (part.totalCost < groups[key].lowestPrice) {
      groups[key].lowestPrice = part.totalCost;
    }
  }

  // Convert to array and sort by lowest price
  return Object.values(groups).sort((a, b) => a.lowestPrice - b.lowestPrice);
}

/**
 * Search multiple parts at once (for complete repair jobs)
 * @param {string} vin
 * @param {Array} partsList - [{partType, position}, ...]
 * @returns {object} Combined results with best-value bundle
 */
async function searchMultipleParts(vin, partsList) {
  const results = await Promise.all(
    partsList.map((p) =>
      searchParts({
        vin,
        partType: p.partType,
        partNumber: p.partNumber,
        position: p.position,
      })
    )
  );

  // Calculate best-value bundle (cheapest in-stock option for each part)
  const bundle = {
    parts: [],
    totalCost: 0,
    allInStock: true,
    suppliers: new Set(),
  };

  for (let i = 0; i < results.length; i++) {
    const best = results[i].bestValue?.overall || results[i].bestValue?.aftermarket;
    if (best) {
      bundle.parts.push({
        requested: partsList[i],
        selected: best,
      });
      bundle.totalCost += best.totalCost;
      bundle.suppliers.add(best.supplier);
      if (best.availability !== "In Stock") {
        bundle.allInStock = false;
      }
    } else {
      bundle.parts.push({
        requested: partsList[i],
        selected: null,
        error: "No parts found",
      });
      bundle.allInStock = false;
    }
  }

  bundle.suppliers = [...bundle.suppliers];
  bundle.supplierCount = bundle.suppliers.length;

  return {
    individualResults: results,
    bestValueBundle: bundle,
  };
}

/**
 * Format parts for AutoLeap line item creation
 * @param {object} part - Part object from search results
 * @param {number} quantity - How many needed
 * @param {number} markupPercent - Shop markup percentage
 * @returns {object} Formatted for AutoLeap API
 */
function formatForAutoLeap(part, quantity = 1, markupPercent = 40) {
  const costEach = part.totalCost;
  const retailEach = costEach * (1 + markupPercent / 100);

  return {
    type: "part",
    description: `${part.brand} ${part.description}${part.position ? ` (${part.position})` : ""}`,
    partNumber: part.partNumber,
    brand: part.brand,
    supplier: part.supplier,
    quantity,
    costEach: costEach.toFixed(2),
    retailEach: retailEach.toFixed(2),
    totalCost: (costEach * quantity).toFixed(2),
    totalRetail: (retailEach * quantity).toFixed(2),
    coreCharge: part.coreCharge,
    // For ordering through PartsTech
    partstechPartId: part.partId,
    partstechSupplierId: part.supplierId,
    canOrder: part.canOrder,
    inStock: part.availability === "In Stock",
  };
}

/**
 * Lookup vehicle info from VIN via PartsTech
 */
async function lookupVehicle(vin) {
  const fetch = (await import("node-fetch")).default;

  const response = await fetch(`${PARTSTECH_BASE_URL}/vehicles/vin/${vin}`, {
    headers: {
      Authorization: `Bearer ${PARTSTECH_API_KEY}`,
    },
  });

  if (!response.ok) {
    throw new Error(`PartsTech vehicle lookup failed: ${response.status}`);
  }

  return response.json();
}

module.exports = {
  searchParts,
  searchMultipleParts,
  findBestValue,
  formatForAutoLeap,
  lookupVehicle,
};
