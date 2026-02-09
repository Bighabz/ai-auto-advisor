/**
 * Vehicle Specs — Technical Reference Data Extraction
 *
 * Extracts detailed vehicle specs from repair databases:
 * - Sensor locations (bank 1/2, upstream/downstream)
 * - Fluid capacities and types
 * - Torque specifications
 * - Special tools required
 */

const { execSync } = require("child_process");

// Common specs database (cache for frequent lookups)
// In production, this would be populated from AllData/ProDemand extractions
const COMMON_SPECS_CACHE = {
  // Example: Honda 2.0L K20 engine specs
  "K20C2": {
    oil: { withFilter: "4.4 quarts", withoutFilter: "4.0 quarts", weight: "0W-20", spec: "API SN" },
    coolant: { capacity: "6.4 quarts", type: "Honda Type 2 Blue (OAT)" },
    sparkPlugGap: "0.039-0.043 in",
    firingOrder: "1-3-4-2",
  },
  // Add more engine codes as extracted
};

// Bank identification for common engine configurations
const BANK_CONFIG = {
  "inline-4": {
    banks: 1,
    description: "Inline 4-cylinder - Bank 1 only (no Bank 2)",
    bank1Location: "Front of engine (exhaust side)",
  },
  "inline-6": {
    banks: 1,
    description: "Inline 6-cylinder - Bank 1 only (no Bank 2)",
    bank1Location: "Front of engine (exhaust side)",
  },
  "v6-transverse": {
    banks: 2,
    description: "V6 Transverse - Bank 1 is rear (firewall side), Bank 2 is front (radiator side)",
    bank1Location: "Rear bank (toward firewall)",
    bank2Location: "Front bank (toward radiator)",
  },
  "v6-longitudinal": {
    banks: 2,
    description: "V6 Longitudinal - Bank 1 is passenger side, Bank 2 is driver side (typically)",
    bank1Location: "Passenger side (right)",
    bank2Location: "Driver side (left)",
  },
  "v8-longitudinal": {
    banks: 2,
    description: "V8 Longitudinal - Bank 1 is passenger side (cylinders 1-3-5-7), Bank 2 is driver side (2-4-6-8)",
    bank1Location: "Passenger side (right)",
    bank2Location: "Driver side (left)",
  },
};

/**
 * Get engine configuration type from vehicle info
 */
function getEngineConfig(cylinders, layout, driveType) {
  const cyl = parseInt(cylinders) || 4;
  const isTransverse = driveType === "FWD" || layout?.toLowerCase().includes("transverse");

  if (cyl === 4) return "inline-4";
  if (cyl === 6 && layout?.toLowerCase().includes("inline")) return "inline-6";
  if (cyl === 6) return isTransverse ? "v6-transverse" : "v6-longitudinal";
  if (cyl === 8) return "v8-longitudinal";
  return "inline-4"; // default
}

/**
 * Get O2 sensor locations for a vehicle
 */
function getO2SensorLocations(engineConfig, hasDualExhaust = false) {
  const config = BANK_CONFIG[engineConfig] || BANK_CONFIG["inline-4"];
  const sensors = {};

  // Bank 1 sensors (all vehicles have these)
  sensors.bank1Sensor1 = {
    name: "Bank 1 Sensor 1 (B1S1)",
    position: "Upstream",
    location: `${config.bank1Location || "Exhaust manifold"} - before catalytic converter`,
    access: "Usually accessible from above or side of engine",
    function: "Air-fuel ratio monitoring (pre-cat)",
  };

  sensors.bank1Sensor2 = {
    name: "Bank 1 Sensor 2 (B1S2)",
    position: "Downstream",
    location: "After catalytic converter (Bank 1 side)",
    access: "Usually from below vehicle, behind cat",
    function: "Catalyst efficiency monitoring (post-cat)",
  };

  // Bank 2 sensors (V6/V8 only)
  if (config.banks === 2) {
    sensors.bank2Sensor1 = {
      name: "Bank 2 Sensor 1 (B2S1)",
      position: "Upstream",
      location: `${config.bank2Location} - before catalytic converter`,
      access: "May require removing intake components",
      function: "Air-fuel ratio monitoring (pre-cat)",
    };

    sensors.bank2Sensor2 = {
      name: "Bank 2 Sensor 2 (B2S2)",
      position: "Downstream",
      location: "After catalytic converter (Bank 2 side)",
      access: "From below vehicle",
      function: "Catalyst efficiency monitoring (post-cat)",
    };
  }

  // Dual exhaust adds more downstream sensors
  if (hasDualExhaust) {
    sensors.notes = "Dual exhaust system - each bank has separate catalytic converter";
  }

  return {
    sensors,
    bankIdentification: config.description,
    totalO2Sensors: Object.keys(sensors).filter((k) => k.startsWith("bank")).length,
  };
}

/**
 * Get common fluid specs (enhanced with browser extraction when available)
 */
function getFluidSpecs(vehicle) {
  // Base specs - would be enhanced by AllData/ProDemand lookup
  return {
    engineOil: {
      capacityWithFilter: vehicle.oilCapacity || "Check service manual",
      capacityWithoutFilter: "Approximately 0.5 qt less",
      weight: vehicle.oilWeight || "Check oil cap or manual",
      specification: "Check owner's manual for OEM spec",
      drainPlugTorque: "25-30 ft-lb (typical - verify)",
      filterTorque: "Hand tight + 3/4 turn (typical)",
    },
    coolant: {
      capacity: vehicle.coolantCapacity || "Check service manual",
      type: vehicle.coolantType || "Check reservoir cap for type",
      mixRatio: "50/50 with distilled water",
    },
    transmission: {
      type: vehicle.transType === "CVT" ? "CVT Fluid (vehicle-specific)" :
            vehicle.transType === "Auto" ? "ATF (check spec on dipstick)" :
            "Manual trans fluid (check manual)",
      checkProcedure: vehicle.transType === "CVT" ?
        "Most CVTs are sealed - dealer service" :
        "Check with engine warm, in Park",
    },
    brakeFluid: {
      type: "DOT 3 or DOT 4 (check reservoir cap)",
      note: "Do not mix DOT 3/4 with DOT 5",
    },
  };
}

/**
 * Get torque specs for common fasteners
 */
function getTorqueSpecs(vehicle) {
  return {
    wheelLugNuts: {
      value: vehicle.lugTorque || "80-100 ft-lb (verify for your vehicle)",
      pattern: "Star pattern, 2-3 passes",
      note: "Retorque after 50-100 miles",
    },
    oilDrainPlug: {
      value: "25-30 ft-lb (typical aluminum pan)",
      note: "Use new crush washer, don't overtighten",
    },
    o2Sensor: {
      value: "30-37 ft-lb",
      note: "Apply anti-seize to threads (avoid sensor tip)",
    },
    sparkPlugs: {
      value: "13-18 ft-lb (typical for aluminum head)",
      note: "Verify for your application - varies significantly",
    },
    brakeCaliper: {
      bracket: "70-90 ft-lb (typical)",
      slide: "25-35 ft-lb (typical)",
    },
  };
}

/**
 * Get special tools needed for common repairs
 */
function getSpecialTools(repairType) {
  const toolsByRepair = {
    "o2-sensor": [
      "22mm O2 sensor socket (slotted/offset for wire harness)",
      "3/8\" ratchet with extension",
      "Penetrating oil (PB Blaster, etc.)",
      "Anti-seize compound",
      "Wire brush for threads",
    ],
    "oil-change": [
      "Drain pan (6+ quart capacity)",
      "Appropriate drain plug socket/wrench",
      "Oil filter wrench (cap style or strap)",
      "Funnel",
      "Torque wrench",
      "New drain plug washer",
    ],
    "brakes": [
      "Brake caliper piston compressor (or C-clamp)",
      "Brake cleaner",
      "Caliper bracket bolts socket set",
      "Torque wrench",
      "Wire brush",
      "Brake grease (for slide pins)",
      "Catch pan for fluid",
    ],
    "spark-plugs": [
      "Spark plug socket (5/8\" or 16mm typical)",
      "Extension bars",
      "Torque wrench",
      "Gap gauge (if not pre-gapped)",
      "Dielectric grease",
      "Compressed air (blow out wells first)",
    ],
    "coolant": [
      "Drain pan (2+ gallon)",
      "Funnel with no-spill adapter",
      "Coolant pressure tester (for leak check)",
      "Distilled water",
      "OEM-spec coolant",
    ],
  };

  return toolsByRepair[repairType] || ["Refer to service manual for special tools"];
}

/**
 * Main function: Get complete vehicle specs for a repair
 */
async function getVehicleSpecs({ vehicle, repairType }) {
  const engineConfig = getEngineConfig(
    vehicle.engine?.cylinders,
    vehicle.engine?.configuration,
    vehicle.driveType
  );

  const specs = {
    // Exact vehicle identification
    vehicle: {
      year: vehicle.year,
      make: vehicle.make,
      model: vehicle.model,
      trim: vehicle.trim || "Base",
      engine: {
        displacement: vehicle.engine?.displacement,
        cylinders: vehicle.engine?.cylinders,
        fuelType: vehicle.engine?.fuelType,
        code: vehicle.engine?.code || "See VIN position 8",
        configuration: engineConfig,
      },
      transmission: vehicle.transmission,
      driveType: vehicle.driveType,
      vin: vehicle.vin,
    },

    // Sensor locations
    sensorLocations: getO2SensorLocations(engineConfig),

    // Fluid specs
    fluids: getFluidSpecs(vehicle),

    // Torque specs
    torqueSpecs: getTorqueSpecs(vehicle),

    // Special tools for this repair
    specialTools: getSpecialTools(repairType),

    // Parts accuracy note
    partsNote: `Always verify parts fitment using exact specs:
      ${vehicle.year} ${vehicle.make} ${vehicle.model} ${vehicle.trim || ""}
      Engine: ${vehicle.engine?.displacement || "?"} ${vehicle.engine?.cylinders || "?"}-cyl
      VIN: ${vehicle.vin || "N/A"}`,
  };

  // TODO: Enhance with live extraction from AllData/ProDemand
  // This would call the browser automation skills to get vehicle-specific values

  return specs;
}

module.exports = {
  getVehicleSpecs,
  getO2SensorLocations,
  getFluidSpecs,
  getTorqueSpecs,
  getSpecialTools,
  getEngineConfig,
  BANK_CONFIG,
};
