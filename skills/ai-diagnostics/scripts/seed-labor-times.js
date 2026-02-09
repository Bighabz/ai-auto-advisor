/**
 * seed-labor-times.js — Seed ARI Labor Times for Top 50 Procedures
 *
 * Populates the labor_cache table with realistic labor hour estimates
 * for the top 50 most common repair procedures across 20 popular vehicles.
 *
 * Not every vehicle gets every procedure — exclusions are applied for
 * timing belt/chain, clutch (manual only), etc.
 *
 * Labor hours vary by vehicle type, engine layout, and accessibility.
 * Source is "estimated" since this is pre-seeded reference data.
 *
 * Run once during setup:  node seed-labor-times.js
 */

const { getSupabase } = require("./embeddings");

// ---------------------------------------------------------------------------
// Vehicle definitions (top 20 by repair frequency)
// ---------------------------------------------------------------------------

const VEHICLES = [
  { make: "Honda",     model: "Civic",           year: 2018, engine: "I4",  layout: "transverse", drivetrain: "FWD",  timing: "chain", hasManual: true  },
  { make: "Honda",     model: "Accord",          year: 2020, engine: "I4",  layout: "transverse", drivetrain: "FWD",  timing: "chain", hasManual: false },
  { make: "Toyota",    model: "Camry",           year: 2019, engine: "I4",  layout: "transverse", drivetrain: "FWD",  timing: "chain", hasManual: false },
  { make: "Toyota",    model: "Corolla",         year: 2017, engine: "I4",  layout: "transverse", drivetrain: "FWD",  timing: "chain", hasManual: true  },
  { make: "Ford",      model: "F-150",           year: 2018, engine: "V6",  layout: "longitudinal", drivetrain: "4WD", timing: "chain", hasManual: false },
  { make: "Chevrolet", model: "Silverado",       year: 2017, engine: "V8",  layout: "longitudinal", drivetrain: "4WD", timing: "chain", hasManual: false },
  { make: "Nissan",    model: "Altima",          year: 2016, engine: "I4",  layout: "transverse", drivetrain: "FWD",  timing: "chain", hasManual: false },
  { make: "Nissan",    model: "Rogue",           year: 2017, engine: "I4",  layout: "transverse", drivetrain: "AWD",  timing: "chain", hasManual: false },
  { make: "Hyundai",   model: "Sonata",          year: 2017, engine: "I4",  layout: "transverse", drivetrain: "FWD",  timing: "chain", hasManual: false },
  { make: "Hyundai",   model: "Elantra",         year: 2019, engine: "I4",  layout: "transverse", drivetrain: "FWD",  timing: "chain", hasManual: true  },
  { make: "Kia",       model: "Optima",          year: 2018, engine: "I4",  layout: "transverse", drivetrain: "FWD",  timing: "chain", hasManual: false },
  { make: "Ford",      model: "Escape",          year: 2016, engine: "I4",  layout: "transverse", drivetrain: "FWD",  timing: "chain", hasManual: false },
  { make: "Chevrolet", model: "Equinox",         year: 2020, engine: "I4",  layout: "transverse", drivetrain: "FWD",  timing: "chain", hasManual: false },
  { make: "Subaru",    model: "Outback",         year: 2017, engine: "H4",  layout: "longitudinal", drivetrain: "AWD", timing: "chain", hasManual: false },
  { make: "Jeep",      model: "Grand Cherokee",  year: 2018, engine: "V6",  layout: "longitudinal", drivetrain: "4WD", timing: "chain", hasManual: false },
  { make: "Ram",       model: "1500",            year: 2016, engine: "V8",  layout: "longitudinal", drivetrain: "4WD", timing: "chain", hasManual: false },
  { make: "BMW",       model: "3 Series",        year: 2015, engine: "I4T", layout: "longitudinal", drivetrain: "RWD", timing: "chain", hasManual: true  },
  { make: "Volkswagen",model: "Jetta",           year: 2017, engine: "I4T", layout: "transverse", drivetrain: "FWD",  timing: "chain", hasManual: true  },
  { make: "Mazda",     model: "CX-5",            year: 2019, engine: "I4",  layout: "transverse", drivetrain: "AWD",  timing: "chain", hasManual: false },
  { make: "GMC",       model: "Sierra",          year: 2017, engine: "V8",  layout: "longitudinal", drivetrain: "4WD", timing: "chain", hasManual: false },
];

// ---------------------------------------------------------------------------
// Procedure definitions with per-vehicle labor hours
// ---------------------------------------------------------------------------
// Each procedure has a base labor function that returns { hours, notes }
// given a vehicle object, or null if the procedure doesn't apply.
// ---------------------------------------------------------------------------

/**
 * Helper to build a labor entry
 */
function entry(hours, notes) {
  return { hours: Math.round(hours * 10) / 10, notes: notes || null };
}

/**
 * Master procedure map: procedure_name -> function(vehicle) => { hours, notes } | null
 */
const PROCEDURES = {

  // --- 1. Oil change ---
  "Oil change": (v) => {
    if (v.engine === "V8") return entry(0.5, "Drain plug and filter easily accessible on trucks");
    if (v.engine === "H4") return entry(0.5, "Subaru boxer — top-mounted oil filter");
    if (v.make === "BMW") return entry(0.6, "Requires oil filter housing cap tool");
    return entry(0.4, null);
  },

  // --- 2-7. Brake procedures ---
  "Brake pads - front": (v) => {
    if (v.engine === "V8" || v.model === "Grand Cherokee") return entry(0.8, "Larger caliper hardware on truck/SUV");
    return entry(0.6, null);
  },

  "Brake pads - rear": (v) => {
    if (v.engine === "V8" || v.model === "Grand Cherokee") return entry(0.9, "Rear electronic parking brake caliper on some models");
    if (v.make === "Subaru") return entry(0.8, "Rear caliper with integrated parking brake mechanism");
    return entry(0.7, null);
  },

  "Brake rotors - front": (v) => {
    if (v.engine === "V8" || v.model === "Grand Cherokee") return entry(1.0, "Heavy-duty rotors, may require hub removal");
    return entry(0.8, null);
  },

  "Brake rotors - rear": (v) => {
    if (v.engine === "V8" || v.model === "Grand Cherokee") return entry(1.1, "Includes parking brake shoe inspection on drum-in-hat");
    if (v.make === "Subaru") return entry(1.0, "Integrated parking brake drum in hat rotor");
    return entry(0.9, null);
  },

  "Brake pads and rotors - front": (v) => {
    if (v.engine === "V8" || v.model === "Grand Cherokee") return entry(1.4, "Larger components, heavier rotors");
    return entry(1.1, null);
  },

  "Brake pads and rotors - rear": (v) => {
    if (v.engine === "V8" || v.model === "Grand Cherokee") return entry(1.6, "Includes parking brake adjustment");
    if (v.make === "Subaru") return entry(1.5, "Parking brake shoe inspection required");
    return entry(1.2, null);
  },

  // --- 8-9. Filters ---
  "Air filter replacement": (v) => {
    return entry(0.2, null);
  },

  "Cabin air filter replacement": (v) => {
    if (v.make === "Mazda") return entry(0.3, "Behind glove box, requires glove box removal");
    if (v.make === "BMW") return entry(0.4, "Located under cowl panel, requires wiper assembly removal");
    if (v.make === "Subaru") return entry(0.3, "Behind glove box with restrictor clip");
    return entry(0.2, null);
  },

  // --- 10. Battery ---
  "Battery replacement": (v) => {
    if (v.make === "BMW") return entry(1.0, "Battery in trunk, requires registration/coding with scan tool");
    if (v.make === "Chevrolet" && v.model === "Equinox") return entry(0.5, "Battery under rear seat on some trims");
    if (v.make === "Ford" && v.model === "Escape") return entry(0.5, "Battery under cowl requires fender liner removal on some years");
    return entry(0.3, null);
  },

  // --- 11. Alternator ---
  "Alternator replacement": (v) => {
    if (v.engine === "V8") return entry(1.5, "Accessible from top on trucks");
    if (v.engine === "V6" && v.layout === "longitudinal") return entry(1.8, "Requires removal of accessories for access");
    if (v.engine === "H4") return entry(2.2, "Subaru boxer layout — alternator at bottom, limited clearance");
    if (v.make === "BMW") return entry(2.0, "Requires intake duct removal and tensioner release");
    if (v.layout === "transverse") return entry(1.8, "Lower access, may require removal from below");
    return entry(1.5, null);
  },

  // --- 12. Starter motor ---
  "Starter motor replacement": (v) => {
    if (v.engine === "V8") return entry(1.2, "Accessible from underneath on trucks");
    if (v.engine === "V6" && v.model === "Grand Cherokee") return entry(1.8, "Limited access between engine and firewall");
    if (v.engine === "H4") return entry(2.5, "Subaru starter buried under intake manifold");
    if (v.make === "BMW") return entry(2.0, "Requires intake manifold removal for access");
    if (v.layout === "transverse") return entry(1.5, "Accessible from below in most transverse layouts");
    return entry(1.3, null);
  },

  // --- 13. Water pump ---
  "Water pump replacement": (v) => {
    if (v.engine === "V8") return entry(3.5, "Chain-driven water pump, requires significant front-end disassembly");
    if (v.engine === "V6" && v.layout === "longitudinal") return entry(3.0, "Timing cover removal required");
    if (v.engine === "H4") return entry(4.5, "Subaru — timing cover removal, recommend replacing timing chain tensioners");
    if (v.make === "BMW") return entry(3.5, "Electric water pump on some models, bolt-on replacement; mechanical pump requires timing cover");
    if (v.make === "Volkswagen") return entry(3.0, "Internal water pump driven by timing chain");
    if (v.layout === "transverse") return entry(2.5, "Belt-driven water pump, accessible from front");
    return entry(2.5, null);
  },

  // --- 14. Spark plugs ---
  "Spark plugs replacement": (v) => {
    if (v.engine === "V8") return entry(1.8, "8 plugs, accessible with extensions from top");
    if (v.engine === "V6" && v.layout === "longitudinal") return entry(2.2, "6 plugs, rear bank requires intake manifold removal on some models");
    if (v.engine === "V6" && v.layout === "transverse") return entry(2.5, "Rear bank plugs very difficult to access");
    if (v.engine === "H4") return entry(1.5, "Subaru boxer — plugs accessible from top with extensions");
    if (v.engine === "I4T") return entry(0.8, "Direct access through coil-on-plug");
    return entry(0.8, "4 plugs, coil-on-plug design");
  },

  // --- 15. Ignition coil (single) ---
  "Ignition coil replacement (single)": (v) => {
    if (v.engine === "V6" && v.layout === "transverse") return entry(0.8, "Rear bank coils require intake manifold movement");
    if (v.engine === "V6" && v.layout === "longitudinal") return entry(0.5, "Accessible from top");
    if (v.engine === "V8") return entry(0.4, "Direct access coil-on-plug");
    if (v.engine === "H4") return entry(0.5, "Accessible from top on Subaru boxer");
    return entry(0.3, "Coil-on-plug, accessible from top");
  },

  // --- 16. Serpentine belt ---
  "Serpentine belt replacement": (v) => {
    if (v.engine === "V8") return entry(0.5, "Good clearance, single belt routing");
    if (v.engine === "H4") return entry(0.8, "Limited clearance around boxer engine accessories");
    if (v.make === "BMW") return entry(0.7, "Requires special tool for hydraulic tensioner");
    return entry(0.4, null);
  },

  // --- 17. Timing belt (only applies to belt-equipped engines) ---
  // Note: All 20 vehicles in our list use timing chains, not belts.
  // This procedure is excluded for all listed vehicles.
  "Timing belt replacement": (v) => {
    // None of the top 20 vehicles in this year range use timing belts
    // (all use timing chains). Return null to skip.
    return null;
  },

  // --- 18. Timing chain ---
  "Timing chain replacement": (v) => {
    if (v.engine === "V8") return entry(8.0, "Requires front cover removal, crankshaft positioning, oil pump chain; recommend replacing tensioners and guides");
    if (v.engine === "V6" && v.layout === "longitudinal") return entry(7.0, "Front timing cover, multiple chain sets on DOHC V6");
    if (v.engine === "H4") return entry(7.5, "Subaru — requires engine support bracket removal, front cover removal");
    if (v.make === "BMW") return entry(6.5, "Requires valve cover removal, VANOS unit service; replace guides and tensioners");
    if (v.make === "Volkswagen") return entry(6.0, "TSI chain at rear of engine, requires transmission separation on some models");
    if (v.make === "Nissan") return entry(5.5, "QR25DE — front-mounted chain, straightforward but time-consuming");
    if (v.make === "Hyundai" || v.make === "Kia") return entry(5.0, "Theta II engine chain at front, replace tensioner and guides");
    return entry(5.0, "Requires front cover removal, recommend replacing guides and tensioners");
  },

  // --- 19. Catalytic converter ---
  "Catalytic converter replacement": (v) => {
    if (v.engine === "V8") return entry(2.5, "Dual catalytic converters, price per side");
    if (v.engine === "V6") return entry(2.2, "May have front and rear cats depending on configuration");
    if (v.engine === "H4") return entry(2.0, "Subaru — front pipe with integrated cat");
    if (v.make === "Honda") return entry(1.5, "Manifold-mounted cat, accessible from below");
    if (v.make === "Toyota") return entry(1.5, "Close-coupled cat near exhaust manifold");
    return entry(1.8, null);
  },

  // --- 20-21. O2 sensors ---
  "O2 sensor replacement - upstream": (v) => {
    if (v.engine === "V8") return entry(0.8, "Per bank, accessible from below");
    if (v.engine === "V6") return entry(0.7, "Front bank accessible; rear may require Y-pipe removal");
    if (v.engine === "H4") return entry(0.8, "Subaru — tight access on boxer headers");
    return entry(0.5, null);
  },

  "O2 sensor replacement - downstream": (v) => {
    if (v.engine === "V8") return entry(0.6, "Post-cat sensor, accessible from below");
    if (v.engine === "V6") return entry(0.6, null);
    return entry(0.5, null);
  },

  // --- 22. MAF sensor ---
  "MAF sensor replacement": (v) => {
    return entry(0.3, "Intake tube sensor, bolt-on replacement");
  },

  // --- 23. Thermostat ---
  "Thermostat replacement": (v) => {
    if (v.engine === "V8") return entry(1.5, "Requires coolant drain, located behind water pump housing");
    if (v.engine === "V6" && v.layout === "longitudinal") return entry(1.5, "Buried under intake components");
    if (v.engine === "H4") return entry(1.8, "Subaru — thermostat housing under intake manifold");
    if (v.make === "BMW") return entry(1.2, "Thermostat housing is plastic, recommend replacing housing with thermostat");
    if (v.make === "Volkswagen") return entry(1.5, "Integrated thermostat housing assembly, includes temperature sensor");
    return entry(1.0, "Includes coolant drain and refill");
  },

  // --- 24. Radiator ---
  "Radiator replacement": (v) => {
    if (v.engine === "V8") return entry(2.5, "Large radiator, requires fan shroud and transmission cooler line disconnect");
    if (v.engine === "V6" && v.layout === "longitudinal") return entry(2.2, "Fan shroud removal, may include transmission cooler lines");
    if (v.make === "BMW") return entry(2.5, "Requires bumper support and fan removal, plastic end tanks prone to cracking");
    if (v.make === "Subaru") return entry(2.0, "AC condenser must be moved forward for access");
    return entry(1.8, "Includes coolant drain, refill, and bleed");
  },

  // --- 25. Coolant flush ---
  "Coolant flush": (v) => {
    if (v.make === "BMW") return entry(0.8, "Requires proper bleeding procedure with bleed screw");
    if (v.make === "Subaru") return entry(0.8, "Boxer engines require extra bleed time to purge air pockets");
    return entry(0.6, "Drain, flush, refill, and bleed air");
  },

  // --- 26. Fuel pump ---
  "Fuel pump replacement": (v) => {
    if (v.engine === "V8" && (v.make === "Ford" || v.make === "Chevrolet" || v.make === "GMC" || v.make === "Ram")) {
      return entry(2.0, "In-tank pump, bed must be lowered or removed for tank access");
    }
    if (v.make === "Subaru") return entry(1.5, "Access panel under rear seat");
    if (v.make === "Toyota" || v.make === "Honda") return entry(1.2, "Access panel under rear seat cushion");
    if (v.make === "BMW") return entry(2.0, "Access through trunk floor, requires fuel line disconnect tools");
    return entry(1.5, "In-tank fuel pump assembly, access from above or tank drop");
  },

  // --- 27. Fuel filter ---
  "Fuel filter replacement": (v) => {
    // Many modern vehicles (2012+) have lifetime in-tank filters integrated with fuel pump
    // Trucks and some older designs still have serviceable inline filters
    if (v.make === "Ford" && v.model === "F-150") return entry(0.5, "Frame-mounted inline filter");
    if (v.make === "Chevrolet" && v.model === "Silverado") return entry(0.5, "Frame-mounted inline filter");
    if (v.make === "GMC") return entry(0.5, "Frame-mounted inline filter");
    if (v.make === "Ram") return entry(0.5, "Frame-mounted inline filter");
    if (v.make === "Jeep") return entry(0.5, "Frame-mounted inline filter");
    if (v.make === "BMW") return entry(0.8, "Underbody inline filter, requires fuel line quick-disconnects");
    if (v.make === "Volkswagen") return entry(0.6, "Underbody mounted filter");
    if (v.make === "Subaru") return entry(0.4, "Underbody inline filter");
    // Most modern FWD sedans have non-serviceable in-tank filter (part of pump assembly)
    return null;
  },

  // --- 28. EGR valve ---
  "EGR valve replacement": (v) => {
    // Modern gasoline direct-injection engines often omit traditional EGR
    // Trucks and larger engines tend to have EGR systems
    if (v.engine === "V8") return entry(1.5, "EGR valve on intake manifold, includes passage cleaning");
    if (v.engine === "V6" && v.layout === "longitudinal") return entry(1.5, "Mounted on intake plenum");
    if (v.make === "Volkswagen") return entry(1.2, "TSI engines have EGR on intake manifold");
    if (v.make === "Nissan") return entry(1.0, "Mounted on intake manifold, accessible from top");
    if (v.make === "Hyundai" || v.make === "Kia") return entry(1.0, null);
    if (v.make === "Subaru") return entry(1.2, "EGR on top of engine, accessible");
    // Many modern I4 cars don't have external EGR
    if (v.make === "Honda" || v.make === "Toyota" || v.make === "Mazda") return null;
    return entry(1.0, null);
  },

  // --- 29. EVAP purge valve ---
  "EVAP purge valve replacement": (v) => {
    if (v.make === "Chevrolet" || v.make === "GMC") return entry(0.5, "Common failure on GM vehicles, mounted on intake manifold");
    if (v.make === "Hyundai" || v.make === "Kia") return entry(0.5, "Mounted on intake manifold near throttle body");
    return entry(0.4, "Solenoid valve on intake manifold or engine bay");
  },

  // --- 30. EVAP canister ---
  "EVAP canister replacement": (v) => {
    if (v.engine === "V8" && (v.make === "Ford" || v.make === "Chevrolet" || v.make === "GMC" || v.make === "Ram")) {
      return entry(1.5, "Mounted near fuel tank, requires partial tank or shield removal");
    }
    if (v.make === "Subaru") return entry(1.2, "Under rear of vehicle near fuel tank");
    if (v.make === "BMW") return entry(1.5, "Mounted under vehicle, requires underbody shield removal");
    return entry(1.0, "Mounted near fuel tank or rear axle area");
  },

  // --- 31-32. Wheel bearings ---
  "Wheel bearing replacement - front": (v) => {
    if (v.engine === "V8" || v.model === "Grand Cherokee" || v.model === "1500") {
      return entry(1.5, "Hub assembly replacement, 4WD requires axle nut and ABS sensor disconnect");
    }
    if (v.drivetrain === "AWD") return entry(1.8, "Press-in bearing, requires knuckle removal and hydraulic press");
    if (v.make === "Honda") return entry(1.8, "Press-in bearing, requires knuckle removal");
    if (v.make === "Toyota") return entry(1.5, "Bolt-on hub assembly on most models");
    if (v.make === "Subaru") return entry(2.0, "Hub/bearing assembly, requires axle nut removal and hub press");
    if (v.make === "BMW") return entry(2.0, "Press-in bearing, requires special hub puller and press");
    return entry(1.5, "Hub assembly or press-in bearing depending on design");
  },

  "Wheel bearing replacement - rear": (v) => {
    if (v.engine === "V8" || v.model === "Grand Cherokee" || v.model === "1500") {
      return entry(1.5, "Bolt-on hub assembly, includes ABS sensor");
    }
    if (v.drivetrain === "AWD") return entry(2.0, "Press-in bearing, requires hub removal from knuckle");
    if (v.make === "Subaru") return entry(2.2, "Press-in bearing, AWD axle nut removal required");
    if (v.make === "BMW") return entry(2.0, "Press-in bearing with integrated ABS sensor");
    if (v.make === "Honda" || v.make === "Toyota") return entry(1.0, "Bolt-on hub assembly on FWD models");
    return entry(1.2, null);
  },

  // --- 33-34. Tie rod ends ---
  "Tie rod end replacement (inner)": (v) => {
    if (v.engine === "V8" || v.model === "Grand Cherokee") return entry(1.5, "Heavier steering components, requires alignment after");
    if (v.make === "BMW") return entry(1.5, "Requires special inner tie rod tool, alignment required");
    return entry(1.2, "Requires inner tie rod removal tool and alignment after replacement");
  },

  "Tie rod end replacement (outer)": (v) => {
    if (v.engine === "V8" || v.model === "Grand Cherokee") return entry(1.0, "Heavier components, alignment required");
    return entry(0.8, "Includes alignment recommendation");
  },

  // --- 35. Ball joint ---
  "Ball joint replacement - lower": (v) => {
    if (v.engine === "V8" || v.model === "Grand Cherokee" || v.model === "1500") {
      return entry(2.0, "Heavy-duty ball joint, press-in type, requires ball joint press");
    }
    if (v.make === "BMW") return entry(2.5, "Riveted ball joint, requires drilling rivets and control arm disassembly");
    if (v.make === "Subaru") return entry(2.0, "Bolt-on ball joint, easier than press-in designs");
    if (v.make === "Honda") return entry(1.5, "Press-in ball joint, recommend control arm replacement");
    return entry(1.5, "Press-in or bolt-on depending on design, alignment required");
  },

  // --- 36. Control arm ---
  "Control arm replacement - front lower": (v) => {
    if (v.engine === "V8" || v.model === "Grand Cherokee") return entry(2.0, "Heavy-duty control arm with integrated ball joint");
    if (v.make === "BMW") return entry(1.8, "Aluminum control arm, includes ball joint and bushings");
    if (v.make === "Honda") return entry(1.5, "Includes ball joint and compliance bushing");
    if (v.make === "Subaru") return entry(1.8, "Lower control arm with separate ball joint");
    return entry(1.5, "Includes ball joint, alignment required");
  },

  // --- 37. Transmission fluid ---
  "Transmission fluid change": (v) => {
    if (v.engine === "V8") return entry(1.0, "Drain and fill, filter change if applicable");
    if (v.make === "Honda") return entry(0.6, "Drain and fill, Honda recommends 3x drain-fill method");
    if (v.make === "Toyota") return entry(0.8, "Drain, refill, and WS fluid required");
    if (v.make === "BMW") return entry(1.2, "Requires fluid level check at specific temperature with scan tool");
    if (v.make === "Volkswagen") return entry(1.0, "DSG fluid and filter change requires scan tool for adaptation");
    if (v.make === "Nissan") return entry(0.8, "CVT fluid drain and fill, requires NS-3 CVT fluid");
    if (v.make === "Subaru") return entry(0.8, "CVT fluid replacement, Subaru-specific fluid required");
    return entry(0.8, "Drain and fill, use manufacturer-specified fluid");
  },

  // --- 38. CV axle ---
  "CV axle replacement": (v) => {
    if (v.drivetrain === "4WD" && v.layout === "longitudinal") return entry(1.5, "Front CV axle on 4WD truck/SUV");
    if (v.drivetrain === "AWD") return entry(1.5, "Axle nut removal, lower ball joint or strut separation");
    if (v.make === "Subaru") return entry(1.5, "AWD — requires axle nut, ball joint separation");
    if (v.make === "BMW") return entry(1.8, "RWD half shaft, requires rear subframe bolt loosening on some models");
    return entry(1.2, "Axle nut removal, ball joint or strut separation, pry from transaxle");
  },

  // --- 39. Power steering pump ---
  "Power steering pump replacement": (v) => {
    // Many newer vehicles have electric power steering (no pump)
    if (v.make === "Honda" && v.year >= 2016) return null; // EPS
    if (v.make === "Toyota" && v.year >= 2015) return null; // EPS
    if (v.make === "Hyundai" && v.year >= 2016) return null; // EPS
    if (v.make === "Kia" && v.year >= 2016) return null; // EPS
    if (v.make === "Mazda" && v.year >= 2017) return null; // EPS
    if (v.make === "BMW") return null; // Electric power steering
    if (v.make === "Volkswagen") return null; // Electric power steering
    if (v.make === "Nissan" && v.model === "Altima" && v.year >= 2013) return null; // EPS
    if (v.make === "Nissan" && v.model === "Rogue") return null; // EPS
    if (v.make === "Chevrolet" && v.model === "Equinox") return null; // EPS
    if (v.make === "Ford" && v.model === "Escape" && v.year >= 2013) return null; // EPS
    if (v.make === "Subaru" && v.year >= 2015) return null; // EPS
    // Trucks and body-on-frame vehicles still commonly use hydraulic PS
    if (v.engine === "V8") return entry(2.0, "Hydraulic pump, requires belt removal and line disconnect, flush system");
    if (v.model === "Grand Cherokee") return entry(2.0, "Hydraulic pump, includes fluid flush");
    if (v.make === "Ford" && v.model === "F-150") return entry(1.8, "Hydraulic pump, accessible from top");
    return entry(1.5, "Hydraulic pump replacement with system flush");
  },

  // --- 40. AC compressor ---
  "AC compressor replacement": (v) => {
    if (v.engine === "V8") return entry(3.0, "Includes refrigerant recovery, compressor replacement, and recharge");
    if (v.engine === "V6" && v.layout === "longitudinal") return entry(3.0, "Accessible from top on most longitudinal layouts");
    if (v.engine === "H4") return entry(3.5, "Subaru boxer — compressor at bottom, limited access");
    if (v.make === "BMW") return entry(3.5, "Requires bumper or fan assembly removal for access");
    if (v.layout === "transverse") return entry(2.8, "Lower-mounted compressor, accessible from below");
    return entry(2.8, "Includes refrigerant recovery, oil charge, and system recharge");
  },

  // --- 41. AC recharge ---
  "AC recharge": (v) => {
    return entry(0.5, "Recover existing refrigerant, vacuum system, recharge to specification");
  },

  // --- 42. Heater core ---
  "Heater core replacement": (v) => {
    if (v.engine === "V8") return entry(6.0, "Dashboard removal required on trucks, extensive disassembly");
    if (v.model === "Grand Cherokee") return entry(7.0, "Full dash removal, HVAC box disassembly");
    if (v.make === "Honda") return entry(5.5, "Dashboard removal, steering column drop, HVAC box disassembly");
    if (v.make === "Toyota") return entry(5.5, "Dashboard removal required, extensive interior disassembly");
    if (v.make === "BMW") return entry(7.0, "Full dashboard and center console removal required");
    if (v.make === "Subaru") return entry(5.0, "Dashboard removal, HVAC box split");
    if (v.make === "Volkswagen") return entry(6.0, "Full dash removal required, labor intensive");
    return entry(5.0, "Dashboard removal and HVAC box disassembly required");
  },

  // --- 43. Clutch (manual transmission only) ---
  "Clutch replacement": (v) => {
    if (!v.hasManual) return null;
    if (v.make === "BMW") return entry(6.0, "RWD — transmission removal from rear, dual-mass flywheel recommended");
    if (v.make === "Volkswagen") return entry(5.5, "FWD — transmission removal, recommend replacing dual-mass flywheel");
    if (v.make === "Honda" && v.model === "Civic") return entry(4.5, "FWD — transaxle removal, replace throwout bearing and pilot bearing");
    if (v.make === "Toyota" && v.model === "Corolla") return entry(4.5, "FWD — transaxle removal");
    if (v.make === "Hyundai" && v.model === "Elantra") return entry(4.5, "FWD — transaxle removal, includes throwout bearing");
    return entry(4.5, "Transmission removal, replace clutch disc, pressure plate, and throwout bearing");
  },

  // --- 44. Brake caliper ---
  "Brake caliper replacement": (v) => {
    if (v.engine === "V8" || v.model === "Grand Cherokee") return entry(1.0, "Larger caliper, includes brake hose disconnect and bleed");
    return entry(0.8, "Includes brake fluid bleed at wheel");
  },

  // --- 45. Brake hose ---
  "Brake hose replacement": (v) => {
    if (v.engine === "V8" || v.model === "Grand Cherokee") return entry(0.8, "Includes brake fluid bleed");
    return entry(0.6, "Includes brake fluid bleed at wheel");
  },

  // --- 46. Exhaust manifold gasket ---
  "Exhaust manifold gasket": (v) => {
    if (v.engine === "V8") return entry(3.0, "Per side, exhaust manifold bolts often corroded, budget for broken bolt extraction");
    if (v.engine === "V6" && v.layout === "longitudinal") return entry(2.5, "Per side, rear manifold more difficult");
    if (v.engine === "V6" && v.layout === "transverse") return entry(3.0, "Rear manifold against firewall, very limited access");
    if (v.engine === "H4") return entry(2.5, "Subaru boxer — headers accessible from below but tight clearance");
    if (v.make === "BMW") return entry(2.0, "Turbo-back exhaust manifold, studs may require extraction");
    return entry(1.5, "Includes manifold bolt inspection and replacement if corroded");
  },

  // --- 47. Valve cover gasket ---
  "Valve cover gasket replacement": (v) => {
    if (v.engine === "V8") return entry(3.0, "Both valve covers, requires ignition coil and wiring harness removal");
    if (v.engine === "V6" && v.layout === "transverse") return entry(3.5, "Rear valve cover against firewall, extremely limited access");
    if (v.engine === "V6" && v.layout === "longitudinal") return entry(2.5, "Both covers, rear cover more difficult");
    if (v.engine === "H4") return entry(3.0, "Subaru boxer — both covers, limited clearance at frame rails");
    if (v.make === "BMW") return entry(2.5, "Includes eccentric shaft sensor reseal, replace gasket and grommets");
    if (v.make === "Volkswagen") return entry(1.5, "Single cover on I4, includes PCV diaphragm inspection");
    return entry(1.2, "Single valve cover on I4, includes spark plug tube seals");
  },

  // --- 48. Head gasket ---
  "Head gasket replacement": (v) => {
    if (v.engine === "V8") return entry(14.0, "Both heads, includes head bolt replacement and machine shop resurfacing");
    if (v.engine === "V6" && v.layout === "longitudinal") return entry(12.0, "Both heads, timing chain removal required");
    if (v.engine === "V6" && v.layout === "transverse") return entry(14.0, "Both heads, rear head against firewall, engine support required");
    if (v.engine === "H4") return entry(9.0, "Subaru boxer — engine removal recommended for proper access, both heads");
    if (v.make === "BMW") return entry(10.0, "Requires timing chain removal, VANOS service, head bolt stretch check");
    return entry(7.0, "Includes head bolt replacement, head resurfacing, timing components removal");
  },

  // --- 49. Oil pan gasket ---
  "Oil pan gasket replacement": (v) => {
    if (v.engine === "V8" && v.drivetrain === "4WD") return entry(4.0, "Requires front axle lowering or removal for pan clearance");
    if (v.engine === "V8") return entry(3.0, "Engine support required, may need to loosen motor mounts");
    if (v.engine === "V6" && v.layout === "longitudinal") return entry(3.5, "May require front axle lowering on 4WD");
    if (v.engine === "H4") return entry(4.0, "Subaru boxer — requires engine lifting, exhaust and crossmember removal");
    if (v.make === "BMW") return entry(3.5, "Requires engine support, front subframe lowering");
    if (v.layout === "transverse") return entry(2.5, "Requires engine support from above, subframe may need lowering");
    return entry(2.5, null);
  },

  // --- 50. PCV valve ---
  "PCV valve replacement": (v) => {
    if (v.make === "BMW") return entry(0.5, "Integrated in valve cover on many BMW models, may require cover replacement");
    if (v.make === "Volkswagen") return entry(0.5, "PCV diaphragm integrated in valve cover, common failure point");
    if (v.engine === "V8") return entry(0.3, "Accessible from top of engine");
    if (v.engine === "H4") return entry(0.4, "Located on top of engine, accessible");
    return entry(0.2, null);
  },
};

// ---------------------------------------------------------------------------
// Build the full dataset
// ---------------------------------------------------------------------------

function buildLaborData() {
  const data = [];
  const procedureNames = Object.keys(PROCEDURES);

  for (const vehicle of VEHICLES) {
    for (const procName of procedureNames) {
      const fn = PROCEDURES[procName];
      const result = fn(vehicle);

      // null means this procedure doesn't apply to this vehicle
      if (!result) continue;

      data.push({
        vehicle_make: vehicle.make,
        vehicle_model: vehicle.model,
        vehicle_year: vehicle.year,
        procedure_name: procName,
        labor_hours: result.hours,
        labor_source: "estimated",
        notes: result.notes,
      });
    }
  }

  return data;
}

// ---------------------------------------------------------------------------
// Seed function — idempotent (delete then insert)
// ---------------------------------------------------------------------------

async function seedLaborTimes() {
  const db = getSupabase();
  const laborData = buildLaborData();

  console.log(`[ai-diagnostics] Built ${laborData.length} labor time entries for ${VEHICLES.length} vehicles`);

  // --- Step 1: Delete existing estimated seed data to make this idempotent ---
  console.log("[ai-diagnostics] Clearing existing estimated labor data...");
  const { error: deleteError } = await db
    .from("labor_cache")
    .delete()
    .eq("labor_source", "estimated");

  if (deleteError) {
    console.error(`[ai-diagnostics] Failed to clear existing data: ${deleteError.message}`);
    throw new Error(`Delete failed: ${deleteError.message}`);
  }
  console.log("[ai-diagnostics] Existing estimated data cleared");

  // --- Step 2: Insert in batches of 50 ---
  const batchSize = 50;
  let inserted = 0;
  let errors = 0;

  for (let i = 0; i < laborData.length; i += batchSize) {
    const batch = laborData.slice(i, i + batchSize);

    const { error } = await db.from("labor_cache").insert(batch);

    if (error) {
      console.error(`[ai-diagnostics] Batch insert failed at index ${i}: ${error.message}`);
      errors += batch.length;
    } else {
      inserted += batch.length;
      const pct = ((inserted / laborData.length) * 100).toFixed(0);
      console.log(`[ai-diagnostics] Labor times: ${inserted}/${laborData.length} inserted (${pct}%)`);
    }
  }

  // --- Step 3: Summary ---
  console.log("[ai-diagnostics] ========================================");
  console.log(`[ai-diagnostics] Labor time seeding complete`);
  console.log(`[ai-diagnostics]   Total entries: ${laborData.length}`);
  console.log(`[ai-diagnostics]   Inserted: ${inserted}`);
  console.log(`[ai-diagnostics]   Errors: ${errors}`);
  console.log(`[ai-diagnostics]   Vehicles: ${VEHICLES.length}`);
  console.log(`[ai-diagnostics]   Procedures available: ${Object.keys(PROCEDURES).length}`);

  // Log per-vehicle breakdown
  const vehicleCounts = {};
  for (const row of laborData) {
    const key = `${row.vehicle_make} ${row.vehicle_model} (${row.vehicle_year})`;
    vehicleCounts[key] = (vehicleCounts[key] || 0) + 1;
  }
  console.log("[ai-diagnostics] Per-vehicle procedure counts:");
  for (const [veh, count] of Object.entries(vehicleCounts)) {
    console.log(`[ai-diagnostics]   ${veh}: ${count} procedures`);
  }

  return { inserted, errors, total: laborData.length };
}

// ---------------------------------------------------------------------------
// CLI entrypoint
// ---------------------------------------------------------------------------

if (require.main === module) {
  seedLaborTimes()
    .then((result) => {
      console.log(`[ai-diagnostics] Done — ${result.inserted} labor time entries seeded`);
      process.exit(0);
    })
    .catch((err) => {
      console.error(`[ai-diagnostics] Seed failed: ${err.message}`);
      process.exit(1);
    });
}

module.exports = { seedLaborTimes, buildLaborData, VEHICLES, PROCEDURES };
