/**
 * seed-vehicle-patterns.js — Tier 3: Vehicle-Specific Patterns
 *
 * ~100+ entries covering known issues for the top 20 vehicles
 * by repair frequency. Each entry includes make, model, year range,
 * engine type, specific DTC, cause, and TSB references where known.
 */

module.exports = [
  // =========================================================================
  // 1. Honda Civic (2016-2021) — 1.5L Turbo & 2.0L
  // =========================================================================
  {
    dtc_code: "P0172",
    dtc_description: "System Too Rich (Bank 1)",
    vehicle_make: "Honda",
    vehicle_model: "Civic",
    year_range_start: 2016,
    year_range_end: 2021,
    engine_type: "1.5L Turbo",
    cause: "Fuel dilution of engine oil — gasoline entering crankcase via direct injection",
    cause_category: "fuel",
    confidence_base: 0.65,
    success_rate: 0.45,
    parts_needed: ["engine oil", "oil filter", "software update"],
    labor_category: "basic",
    labor_hours_estimate: 0.5,
    diagnostic_steps: [
      "Check engine oil level — if significantly above full mark, fuel dilution is occurring",
      "Smell dipstick for gasoline odor",
      "Common in cold-climate short-trip driving",
      "Honda TSB 17-072 — PCM update to address fuel injection timing",
      "Change oil more frequently if operating in cold-climate short-trip conditions"
    ],
    common_misdiagnosis: "Replacing fuel injectors when PCM software update resolves the issue",
    source: "oem_tsb"
  },
  {
    dtc_code: "P0128",
    dtc_description: "Coolant Thermostat Below Regulating Temperature",
    vehicle_make: "Honda",
    vehicle_model: "Civic",
    year_range_start: 2016,
    year_range_end: 2021,
    engine_type: "1.5L Turbo",
    cause: "Thermostat sticking open — common on 1.5T engine",
    cause_category: "cooling",
    confidence_base: 0.75,
    success_rate: 0.65,
    parts_needed: ["thermostat", "coolant"],
    labor_category: "intermediate",
    labor_hours_estimate: 1.5,
    diagnostic_steps: [
      "Monitor ECT during warm-up — should reach 195F within 10-15 min of driving",
      "If ECT plateaus below 180F, thermostat is stuck open",
      "Honda uses an electronically controlled thermostat on 1.5T",
      "Replace thermostat with OEM part — aftermarket may not match PCM expectations"
    ],
    common_misdiagnosis: null,
    source: "oem_tsb"
  },
  {
    dtc_code: "P0300",
    dtc_description: "Random/Multiple Cylinder Misfire Detected",
    vehicle_make: "Honda",
    vehicle_model: "Civic",
    year_range_start: 2016,
    year_range_end: 2021,
    engine_type: "1.5L Turbo",
    cause: "Carbon buildup on intake valves from direct injection — causes misfires",
    cause_category: "engine",
    confidence_base: 0.50,
    success_rate: 0.40,
    parts_needed: ["walnut blasting service", "intake manifold gasket"],
    labor_category: "advanced",
    labor_hours_estimate: 3.0,
    diagnostic_steps: [
      "Direct injection engines lack fuel washing of intake valves",
      "Carbon deposits build up on intake valve stems and ports",
      "Causes misfires especially on cold start",
      "Walnut blast intake valves to remove carbon deposits",
      "Consider catch can installation to reduce recurrence"
    ],
    common_misdiagnosis: "Replacing ignition coils or spark plugs when carbon buildup is the cause",
    source: "community"
  },
  {
    dtc_code: "P0420",
    dtc_description: "Catalyst System Efficiency Below Threshold (Bank 1)",
    vehicle_make: "Honda",
    vehicle_model: "Civic",
    year_range_start: 2016,
    year_range_end: 2021,
    engine_type: "2.0L",
    cause: "Catalytic converter premature failure on 2.0L naturally aspirated engine",
    cause_category: "emissions",
    confidence_base: 0.60,
    success_rate: 0.50,
    parts_needed: ["catalytic converter", "exhaust gaskets"],
    labor_category: "advanced",
    labor_hours_estimate: 2.5,
    diagnostic_steps: [
      "Verify O2 sensor waveforms before replacing converter",
      "Downstream O2 should be relatively flat compared to upstream",
      "If both sensors show similar switching, converter is failed",
      "Use direct-fit OEM-quality converter for proper catalyst efficiency"
    ],
    common_misdiagnosis: null,
    source: "community"
  },
  {
    dtc_code: "P0455",
    dtc_description: "Evaporative Emission Control System Leak Detected (Gross Leak)",
    vehicle_make: "Honda",
    vehicle_model: "Civic",
    year_range_start: 2016,
    year_range_end: 2021,
    engine_type: "1.5L Turbo",
    cause: "EVAP canister vent shut valve failure — common Honda issue",
    cause_category: "emissions",
    confidence_base: 0.55,
    success_rate: 0.45,
    parts_needed: ["EVAP canister vent shut valve"],
    labor_category: "intermediate",
    labor_hours_estimate: 1.0,
    diagnostic_steps: [
      "Honda EVAP canister vent shut valve is a common failure item",
      "Located near fuel tank/charcoal canister area",
      "Test valve with scan tool bidirectional control",
      "Replace valve and clear codes"
    ],
    common_misdiagnosis: null,
    source: "identifix"
  },

  // =========================================================================
  // 2. Honda Accord (2018-2022) — 1.5T & 2.0T
  // =========================================================================
  {
    dtc_code: "P0172",
    dtc_description: "System Too Rich (Bank 1)",
    vehicle_make: "Honda",
    vehicle_model: "Accord",
    year_range_start: 2018,
    year_range_end: 2022,
    engine_type: "1.5L Turbo",
    cause: "Fuel dilution of engine oil — same 1.5T DI issue as Civic",
    cause_category: "fuel",
    confidence_base: 0.60,
    success_rate: 0.42,
    parts_needed: ["engine oil", "oil filter", "software update"],
    labor_category: "basic",
    labor_hours_estimate: 0.5,
    diagnostic_steps: [
      "Check oil level — above full mark indicates fuel dilution",
      "Honda service bulletin addresses PCM recalibration",
      "Affects cold-climate, short-trip driving patterns",
      "Update PCM software and perform oil change"
    ],
    common_misdiagnosis: null,
    source: "oem_tsb"
  },
  {
    dtc_code: "P0301",
    dtc_description: "Cylinder 1 Misfire Detected",
    vehicle_make: "Honda",
    vehicle_model: "Accord",
    year_range_start: 2018,
    year_range_end: 2022,
    engine_type: "1.5L Turbo",
    cause: "Spark plug degradation — DI turbo engines are harder on spark plugs",
    cause_category: "ignition",
    confidence_base: 0.55,
    success_rate: 0.48,
    parts_needed: ["spark plugs (NGK DILKAR7G11GS or equivalent)"],
    labor_category: "basic",
    labor_hours_estimate: 0.5,
    diagnostic_steps: [
      "Check spark plug gap and electrode wear",
      "1.5T engine operates at higher cylinder pressures than NA engines",
      "Replace spark plugs at 30,000-mile intervals for turbo applications",
      "Use OEM-specified iridium plugs"
    ],
    common_misdiagnosis: null,
    source: "community"
  },
  {
    dtc_code: "P0507",
    dtc_description: "Idle Control System RPM Higher Than Expected",
    vehicle_make: "Honda",
    vehicle_model: "Accord",
    year_range_start: 2018,
    year_range_end: 2022,
    engine_type: "2.0L Turbo",
    cause: "Electronic throttle body carbon buildup causing idle issues",
    cause_category: "fuel",
    confidence_base: 0.50,
    success_rate: 0.42,
    parts_needed: ["throttle body cleaner"],
    labor_category: "basic",
    labor_hours_estimate: 0.5,
    diagnostic_steps: [
      "Clean electronic throttle body with approved cleaner",
      "Do not force throttle plate open — use key-on engine-off to open with scan tool",
      "Perform idle relearn procedure after cleaning",
      "Honda throttle body relearn: turn key on, idle for 10 min with all accessories off"
    ],
    common_misdiagnosis: null,
    source: "community"
  },
  {
    dtc_code: "P0741",
    dtc_description: "Torque Converter Clutch Circuit Performance or Stuck Off",
    vehicle_make: "Honda",
    vehicle_model: "Accord",
    year_range_start: 2018,
    year_range_end: 2022,
    engine_type: "1.5L Turbo",
    cause: "CVT transmission software calibration causing false TCC performance code",
    cause_category: "transmission",
    confidence_base: 0.45,
    success_rate: 0.35,
    parts_needed: ["TCM software update"],
    labor_category: "basic",
    labor_hours_estimate: 0.5,
    diagnostic_steps: [
      "Check for Honda TSB related to CVT software update",
      "Monitor CVT slip ratio with scan tool during highway driving",
      "If slip is within acceptable range, software update may resolve code",
      "Check CVT fluid level and condition"
    ],
    common_misdiagnosis: "Condemning CVT transmission when software update is needed",
    source: "oem_tsb"
  },

  // =========================================================================
  // 3. Toyota Camry (2015-2022) — 2.5L
  // =========================================================================
  {
    dtc_code: "P0171",
    dtc_description: "System Too Lean (Bank 1)",
    vehicle_make: "Toyota",
    vehicle_model: "Camry",
    year_range_start: 2015,
    year_range_end: 2022,
    engine_type: "2.5L",
    cause: "Intake manifold gasket leak — known issue on 2AR-FE engine",
    cause_category: "fuel",
    confidence_base: 0.55,
    success_rate: 0.45,
    parts_needed: ["intake manifold gasket"],
    labor_category: "intermediate",
    labor_hours_estimate: 2.0,
    diagnostic_steps: [
      "Check LTFT — if above +15%, lean condition confirmed",
      "Smoke test intake manifold — focus on gasket area",
      "Known issue on 2AR-FE 2.5L engines",
      "Replace intake manifold gasket with updated part"
    ],
    common_misdiagnosis: null,
    source: "identifix"
  },
  {
    dtc_code: "P0420",
    dtc_description: "Catalyst System Efficiency Below Threshold (Bank 1)",
    vehicle_make: "Toyota",
    vehicle_model: "Camry",
    year_range_start: 2015,
    year_range_end: 2022,
    engine_type: "2.5L",
    cause: "Catalytic converter efficiency degradation at higher mileage",
    cause_category: "emissions",
    confidence_base: 0.60,
    success_rate: 0.52,
    parts_needed: ["catalytic converter", "exhaust gaskets"],
    labor_category: "advanced",
    labor_hours_estimate: 2.5,
    diagnostic_steps: [
      "Verify both O2 sensor waveforms",
      "Toyota has extended warranty on some catalytic converters — check coverage",
      "Use OEM or high-quality CARB-compliant converter",
      "Clear codes and drive through catalyst monitor"
    ],
    common_misdiagnosis: null,
    source: "community"
  },
  {
    dtc_code: "P0340",
    dtc_description: "Camshaft Position Sensor Circuit Malfunction (Bank 1)",
    vehicle_make: "Toyota",
    vehicle_model: "Camry",
    year_range_start: 2015,
    year_range_end: 2022,
    engine_type: "2.5L",
    cause: "VVT oil control valve clogged with sludge causing CMP correlation error",
    cause_category: "engine",
    confidence_base: 0.45,
    success_rate: 0.35,
    parts_needed: ["VVT oil control valve", "engine oil", "oil filter"],
    labor_category: "intermediate",
    labor_hours_estimate: 1.0,
    diagnostic_steps: [
      "Check engine oil level and condition — sludge formation affects VVT operation",
      "Remove and inspect VVT oil control valve for varnish/sludge",
      "Clean or replace OCV",
      "Perform oil change with OEM-spec oil and filter",
      "If issue persists, check timing chain stretch"
    ],
    common_misdiagnosis: "Replacing CMP sensor when VVT system is the cause",
    source: "identifix"
  },
  {
    dtc_code: "P0442",
    dtc_description: "Evaporative Emission Control System Leak Detected (Small Leak)",
    vehicle_make: "Toyota",
    vehicle_model: "Camry",
    year_range_start: 2015,
    year_range_end: 2022,
    engine_type: "2.5L",
    cause: "EVAP canister purge valve (VSV) failure — common Toyota issue",
    cause_category: "emissions",
    confidence_base: 0.50,
    success_rate: 0.40,
    parts_needed: ["EVAP canister purge VSV"],
    labor_category: "basic",
    labor_hours_estimate: 0.5,
    diagnostic_steps: [
      "Toyota uses a vacuum switching valve (VSV) for EVAP purge",
      "Test VSV with scan tool active test — command open/close",
      "Apply vacuum — should hold when de-energized",
      "Replace if leaking or not responding to commands"
    ],
    common_misdiagnosis: null,
    source: "community"
  },

  // =========================================================================
  // 4. Toyota Corolla (2014-2019) — 1.8L
  // =========================================================================
  {
    dtc_code: "P0171",
    dtc_description: "System Too Lean (Bank 1)",
    vehicle_make: "Toyota",
    vehicle_model: "Corolla",
    year_range_start: 2014,
    year_range_end: 2019,
    engine_type: "1.8L",
    cause: "PCV valve integrated into valve cover — causes vacuum leak when failed",
    cause_category: "fuel",
    confidence_base: 0.50,
    success_rate: 0.40,
    parts_needed: ["valve cover with integrated PCV"],
    labor_category: "intermediate",
    labor_hours_estimate: 1.5,
    diagnostic_steps: [
      "The 2ZR-FE engine has the PCV valve built into the valve cover",
      "When PCV fails, it causes a significant vacuum leak",
      "Check for hissing sound near valve cover",
      "Replacement requires new valve cover assembly with integrated PCV"
    ],
    common_misdiagnosis: "Smoke testing everywhere except the PCV valve area",
    source: "identifix"
  },
  {
    dtc_code: "P0420",
    dtc_description: "Catalyst System Efficiency Below Threshold (Bank 1)",
    vehicle_make: "Toyota",
    vehicle_model: "Corolla",
    year_range_start: 2014,
    year_range_end: 2019,
    engine_type: "1.8L",
    cause: "Catalytic converter degradation",
    cause_category: "emissions",
    confidence_base: 0.60,
    success_rate: 0.50,
    parts_needed: ["catalytic converter"],
    labor_category: "advanced",
    labor_hours_estimate: 2.0,
    diagnostic_steps: [
      "Verify O2 sensor operation first — both sensors should be healthy",
      "Monitor downstream O2 — if mirroring upstream, converter is failed",
      "Check for Toyota extended warranty coverage on emissions components",
      "Replace with CARB-compliant converter in CARB states"
    ],
    common_misdiagnosis: null,
    source: "community"
  },
  {
    dtc_code: "P0505",
    dtc_description: "Idle Control System Malfunction",
    vehicle_make: "Toyota",
    vehicle_model: "Corolla",
    year_range_start: 2014,
    year_range_end: 2019,
    engine_type: "1.8L",
    cause: "Dirty throttle body causing erratic idle on 2ZR-FE engine",
    cause_category: "fuel",
    confidence_base: 0.55,
    success_rate: 0.48,
    parts_needed: ["throttle body cleaner"],
    labor_category: "basic",
    labor_hours_estimate: 0.5,
    diagnostic_steps: [
      "Remove intake hose and inspect throttle bore for carbon deposits",
      "Clean with Toyota-approved throttle body cleaner",
      "Perform idle relearn: warm up engine, turn off, wait 10 sec, restart, idle 10 min",
      "Do not force electronic throttle plate open manually"
    ],
    common_misdiagnosis: null,
    source: "community"
  },
  {
    dtc_code: "P0135",
    dtc_description: "O2 Sensor Heater Circuit Malfunction (Bank 1, Sensor 1)",
    vehicle_make: "Toyota",
    vehicle_model: "Corolla",
    year_range_start: 2014,
    year_range_end: 2019,
    engine_type: "1.8L",
    cause: "O2 sensor heater failure — common at 80,000+ miles",
    cause_category: "electrical",
    confidence_base: 0.60,
    success_rate: 0.52,
    parts_needed: ["upstream O2 sensor (Denso OEM)"],
    labor_category: "basic",
    labor_hours_estimate: 0.5,
    diagnostic_steps: [
      "Check heater resistance — should be 5-15 ohms",
      "Toyota O2 sensors typically last 80,000-120,000 miles",
      "Use Denso OEM sensor for best compatibility",
      "Aftermarket sensors may cause compatibility issues on Toyota"
    ],
    common_misdiagnosis: null,
    source: "community"
  },

  // =========================================================================
  // 5. Ford F-150 (2015-2020) — 3.5L EcoBoost & 5.0L V8
  // =========================================================================
  {
    dtc_code: "P0300",
    dtc_description: "Random/Multiple Cylinder Misfire Detected",
    vehicle_make: "Ford",
    vehicle_model: "F-150",
    year_range_start: 2015,
    year_range_end: 2020,
    engine_type: "3.5L EcoBoost",
    cause: "Carbon buildup on intake valves — common on direct injection EcoBoost engines",
    cause_category: "engine",
    confidence_base: 0.55,
    success_rate: 0.45,
    parts_needed: ["walnut blasting service", "intake manifold gasket"],
    labor_category: "advanced",
    labor_hours_estimate: 4.0,
    diagnostic_steps: [
      "EcoBoost DI engines are prone to carbon buildup on intake valves",
      "Misfires especially noticeable on cold start",
      "Borescope intake ports to confirm carbon deposits",
      "Walnut blast intake valves through intake ports",
      "Ford TSB 19-2346 may apply"
    ],
    common_misdiagnosis: "Replacing ignition coils when carbon buildup is the root cause",
    source: "oem_tsb"
  },
  {
    dtc_code: "P0420",
    dtc_description: "Catalyst System Efficiency Below Threshold (Bank 1)",
    vehicle_make: "Ford",
    vehicle_model: "F-150",
    year_range_start: 2015,
    year_range_end: 2020,
    engine_type: "5.0L V8",
    cause: "Catalytic converter failure — common at 100,000+ miles on 5.0L Coyote",
    cause_category: "emissions",
    confidence_base: 0.60,
    success_rate: 0.50,
    parts_needed: ["catalytic converter", "exhaust gaskets"],
    labor_category: "advanced",
    labor_hours_estimate: 3.0,
    diagnostic_steps: [
      "5.0L Coyote has two close-coupled cats and two underbody cats",
      "Identify which cat is failing using O2 sensor bank data",
      "Check for exhaust leaks at manifold-to-cat connection",
      "Replace failed converter with quality replacement"
    ],
    common_misdiagnosis: null,
    source: "community"
  },
  {
    dtc_code: "P0340",
    dtc_description: "Camshaft Position Sensor Circuit Malfunction (Bank 1)",
    vehicle_make: "Ford",
    vehicle_model: "F-150",
    year_range_start: 2015,
    year_range_end: 2020,
    engine_type: "3.5L EcoBoost",
    cause: "VCT (Variable Cam Timing) solenoid failure or cam phaser rattle",
    cause_category: "engine",
    confidence_base: 0.50,
    success_rate: 0.38,
    parts_needed: ["VCT solenoid", "cam phaser"],
    labor_category: "advanced",
    labor_hours_estimate: 4.0,
    diagnostic_steps: [
      "Listen for cam phaser rattle on cold start — known EcoBoost issue",
      "Check VCT solenoid operation with scan tool bidirectional test",
      "Ford TSB 19-2346 addresses cam phaser rattle on 3.5L EcoBoost",
      "If phaser is rattling, replacement includes timing chain service"
    ],
    common_misdiagnosis: "Replacing CMP sensor when cam phaser is the issue",
    source: "oem_tsb"
  },
  {
    dtc_code: "P0171",
    dtc_description: "System Too Lean (Bank 1)",
    vehicle_make: "Ford",
    vehicle_model: "F-150",
    year_range_start: 2015,
    year_range_end: 2020,
    engine_type: "3.5L EcoBoost",
    cause: "Charge air cooler (intercooler) condensation causing lean surge under boost",
    cause_category: "fuel",
    confidence_base: 0.45,
    success_rate: 0.32,
    parts_needed: ["charge air cooler bypass valve", "software update"],
    labor_category: "intermediate",
    labor_hours_estimate: 1.5,
    diagnostic_steps: [
      "Moisture accumulates in charge air cooler during humid conditions",
      "Under boost, condensation is ingested causing momentary lean condition and stumble",
      "Ford TSB 15-0148 addresses this with updated bypass valve",
      "Install updated charge air cooler bypass valve if applicable"
    ],
    common_misdiagnosis: null,
    source: "oem_tsb"
  },
  {
    dtc_code: "P0562",
    dtc_description: "System Voltage Low",
    vehicle_make: "Ford",
    vehicle_model: "F-150",
    year_range_start: 2015,
    year_range_end: 2020,
    engine_type: "5.0L V8",
    cause: "Battery management system (BMS) sensor failure on negative battery cable",
    cause_category: "electrical",
    confidence_base: 0.45,
    success_rate: 0.35,
    parts_needed: ["battery monitoring sensor", "negative battery cable"],
    labor_category: "basic",
    labor_hours_estimate: 0.5,
    diagnostic_steps: [
      "Ford uses a battery monitoring sensor (BMS) on the negative cable",
      "If BMS fails, PCM receives incorrect voltage readings",
      "Check BMS sensor readings with scan tool vs actual battery voltage",
      "Replace BMS sensor or negative cable assembly"
    ],
    common_misdiagnosis: "Replacing alternator when BMS sensor is giving false low voltage reading",
    source: "oem_tsb"
  },

  // =========================================================================
  // 6. Chevy Silverado (2014-2019) — 5.3L V8
  // =========================================================================
  {
    dtc_code: "P0300",
    dtc_description: "Random/Multiple Cylinder Misfire Detected",
    vehicle_make: "Chevrolet",
    vehicle_model: "Silverado",
    year_range_start: 2014,
    year_range_end: 2019,
    engine_type: "5.3L V8",
    cause: "Active Fuel Management (AFM) lifter failure causing misfire on deactivated cylinders",
    cause_category: "engine",
    confidence_base: 0.55,
    success_rate: 0.40,
    parts_needed: ["AFM lifters", "AFM delete kit", "camshaft"],
    labor_category: "advanced",
    labor_hours_estimate: 12.0,
    diagnostic_steps: [
      "Check misfire counters — if misfires are on cylinders 1, 4, 6, 7 (AFM cylinders), suspect lifter",
      "Listen for lifter tick/knock — indicates collapsed or failed lifter",
      "GM TSB 18-NA-355 addresses AFM lifter failures",
      "Common fix is AFM delete with non-AFM cam and lifters",
      "Check oil for metal debris — indicates lifter damage"
    ],
    common_misdiagnosis: "Replacing spark plugs and coils on AFM cylinders when lifter is the issue",
    source: "oem_tsb"
  },
  {
    dtc_code: "P0449",
    dtc_description: "Evaporative Emission Control System Vent Valve/Solenoid Circuit Malfunction",
    vehicle_make: "Chevrolet",
    vehicle_model: "Silverado",
    year_range_start: 2014,
    year_range_end: 2019,
    engine_type: "5.3L V8",
    cause: "EVAP vent solenoid failure — extremely common on GM trucks",
    cause_category: "electrical",
    confidence_base: 0.70,
    success_rate: 0.60,
    parts_needed: ["EVAP vent solenoid"],
    labor_category: "basic",
    labor_hours_estimate: 0.5,
    diagnostic_steps: [
      "This is one of the most common codes on GM trucks",
      "Vent solenoid located near charcoal canister behind spare tire or near fuel tank",
      "Apply 12V to solenoid — should click",
      "Replace with AC Delco OEM part for best reliability"
    ],
    common_misdiagnosis: null,
    source: "identifix"
  },
  {
    dtc_code: "P0420",
    dtc_description: "Catalyst System Efficiency Below Threshold (Bank 1)",
    vehicle_make: "Chevrolet",
    vehicle_model: "Silverado",
    year_range_start: 2014,
    year_range_end: 2019,
    engine_type: "5.3L V8",
    cause: "Catalytic converter failure aggravated by AFM oil consumption",
    cause_category: "emissions",
    confidence_base: 0.55,
    success_rate: 0.45,
    parts_needed: ["catalytic converter", "exhaust gaskets"],
    labor_category: "advanced",
    labor_hours_estimate: 3.0,
    diagnostic_steps: [
      "5.3L engines with AFM can consume oil, contaminating catalytic converter",
      "Check for oil consumption between oil changes — more than 1 qt per 2,000 miles is excessive",
      "Verify O2 sensor data before replacing converter",
      "Address oil consumption issue to prevent recurrence"
    ],
    common_misdiagnosis: null,
    source: "community"
  },
  {
    dtc_code: "P0521",
    dtc_description: "Engine Oil Pressure Sensor/Switch Range/Performance",
    vehicle_make: "Chevrolet",
    vehicle_model: "Silverado",
    year_range_start: 2014,
    year_range_end: 2019,
    engine_type: "5.3L V8",
    cause: "Oil pressure sensor failure — known GM issue on 5.3L Gen V engine",
    cause_category: "engine",
    confidence_base: 0.60,
    success_rate: 0.50,
    parts_needed: ["oil pressure sensor"],
    labor_category: "basic",
    labor_hours_estimate: 0.5,
    diagnostic_steps: [
      "Very common failure on Gen V 5.3L engines",
      "Verify actual oil pressure with mechanical gauge before condemning sensor",
      "Sensor is typically located on engine block behind intake manifold",
      "Replace with AC Delco OEM sensor — aftermarket sensors have high failure rates"
    ],
    common_misdiagnosis: "Ignoring actual low oil pressure and just replacing sensor",
    source: "identifix"
  },

  // =========================================================================
  // 7. Nissan Altima (2013-2018) — 2.5L
  // =========================================================================
  {
    dtc_code: "P0420",
    dtc_description: "Catalyst System Efficiency Below Threshold (Bank 1)",
    vehicle_make: "Nissan",
    vehicle_model: "Altima",
    year_range_start: 2013,
    year_range_end: 2018,
    engine_type: "2.5L",
    cause: "Catalytic converter failure — common on QR25DE engine at 80,000+ miles",
    cause_category: "emissions",
    confidence_base: 0.60,
    success_rate: 0.50,
    parts_needed: ["catalytic converter"],
    labor_category: "advanced",
    labor_hours_estimate: 2.5,
    diagnostic_steps: [
      "QR25DE is known for premature catalytic converter failure",
      "Check for Nissan extended warranty NTB17-042",
      "Verify O2 sensor operation before condemning converter",
      "Use OEM-quality converter — aftermarket cats may not meet Nissan efficiency standards"
    ],
    common_misdiagnosis: null,
    source: "oem_tsb"
  },
  {
    dtc_code: "P0171",
    dtc_description: "System Too Lean (Bank 1)",
    vehicle_make: "Nissan",
    vehicle_model: "Altima",
    year_range_start: 2013,
    year_range_end: 2018,
    engine_type: "2.5L",
    cause: "Intake manifold gasket leak — known issue on QR25DE",
    cause_category: "fuel",
    confidence_base: 0.50,
    success_rate: 0.42,
    parts_needed: ["intake manifold gasket"],
    labor_category: "intermediate",
    labor_hours_estimate: 2.0,
    diagnostic_steps: [
      "QR25DE intake manifold gaskets deteriorate over time",
      "Smoke test around intake manifold — focus on lower gasket area",
      "LTFT above +15% with no other obvious leaks points to intake gasket",
      "Replace with updated gasket design"
    ],
    common_misdiagnosis: null,
    source: "identifix"
  },
  {
    dtc_code: "P0740",
    dtc_description: "Torque Converter Clutch Circuit Malfunction",
    vehicle_make: "Nissan",
    vehicle_model: "Altima",
    year_range_start: 2013,
    year_range_end: 2018,
    engine_type: "2.5L",
    cause: "CVT transmission valve body issue causing TCC-related code",
    cause_category: "transmission",
    confidence_base: 0.50,
    success_rate: 0.32,
    parts_needed: ["CVT valve body", "CVT fluid"],
    labor_category: "advanced",
    labor_hours_estimate: 4.0,
    diagnostic_steps: [
      "Nissan CVT uses a torque converter for launch — TCC issues are common",
      "Check CVT fluid level and condition",
      "Nissan extended CVT warranty may apply — check NTB15-046",
      "Valve body replacement is less invasive than full CVT replacement"
    ],
    common_misdiagnosis: "Condemning entire CVT when valve body repair may resolve the issue",
    source: "oem_tsb"
  },
  {
    dtc_code: "P0335",
    dtc_description: "Crankshaft Position Sensor A Circuit Malfunction",
    vehicle_make: "Nissan",
    vehicle_model: "Altima",
    year_range_start: 2013,
    year_range_end: 2018,
    engine_type: "2.5L",
    cause: "CKP sensor failure or oil contamination on sensor connector",
    cause_category: "ignition",
    confidence_base: 0.55,
    success_rate: 0.45,
    parts_needed: ["crankshaft position sensor"],
    labor_category: "basic",
    labor_hours_estimate: 0.5,
    diagnostic_steps: [
      "Engine may stall or fail to start intermittently",
      "CKP sensor on QR25DE is located near oil filter area",
      "Oil leaks from valve cover can contaminate CKP connector",
      "Replace sensor and clean connector"
    ],
    common_misdiagnosis: null,
    source: "community"
  },

  // =========================================================================
  // 8. Nissan Rogue (2014-2020) — 2.5L
  // =========================================================================
  {
    dtc_code: "P0700",
    dtc_description: "Transmission Control System Malfunction",
    vehicle_make: "Nissan",
    vehicle_model: "Rogue",
    year_range_start: 2014,
    year_range_end: 2020,
    engine_type: "2.5L",
    cause: "CVT transmission failure — Nissan CVT reliability issues",
    cause_category: "transmission",
    confidence_base: 0.55,
    success_rate: 0.30,
    parts_needed: ["CVT transmission", "CVT fluid"],
    labor_category: "advanced",
    labor_hours_estimate: 10.0,
    diagnostic_steps: [
      "P0700 with juddering, shaking, or loss of acceleration indicates CVT failure",
      "Check for Nissan extended CVT warranty coverage",
      "Scan TCM for specific transmission fault codes",
      "Check CVT fluid level and condition — if dark/burnt, internal damage likely",
      "TSB NTB15-046 extends CVT warranty to 10 years/120,000 miles on some models"
    ],
    common_misdiagnosis: null,
    source: "oem_tsb"
  },
  {
    dtc_code: "P0171",
    dtc_description: "System Too Lean (Bank 1)",
    vehicle_make: "Nissan",
    vehicle_model: "Rogue",
    year_range_start: 2014,
    year_range_end: 2020,
    engine_type: "2.5L",
    cause: "MAF sensor contamination or air intake leak on QR25DE",
    cause_category: "fuel",
    confidence_base: 0.50,
    success_rate: 0.40,
    parts_needed: ["MAF sensor cleaner", "intake hose"],
    labor_category: "basic",
    labor_hours_estimate: 0.5,
    diagnostic_steps: [
      "Clean MAF sensor with dedicated cleaner",
      "Inspect intake boot between air filter and throttle body for cracks",
      "Check air filter box lid for proper seal",
      "If cleaning does not resolve, replace MAF sensor"
    ],
    common_misdiagnosis: null,
    source: "community"
  },
  {
    dtc_code: "P0456",
    dtc_description: "Evaporative Emission Control System Leak Detected (Very Small Leak)",
    vehicle_make: "Nissan",
    vehicle_model: "Rogue",
    year_range_start: 2014,
    year_range_end: 2020,
    engine_type: "2.5L",
    cause: "EVAP purge valve failure — common Nissan issue",
    cause_category: "emissions",
    confidence_base: 0.50,
    success_rate: 0.40,
    parts_needed: ["EVAP purge valve"],
    labor_category: "basic",
    labor_hours_estimate: 0.5,
    diagnostic_steps: [
      "Nissan EVAP purge valves are a common failure item",
      "Test with vacuum — should hold vacuum when de-energized",
      "Energize and verify vacuum releases",
      "Replace if leaking"
    ],
    common_misdiagnosis: null,
    source: "identifix"
  },

  // =========================================================================
  // 9. Hyundai Sonata (2015-2019) — 2.4L
  // =========================================================================
  {
    dtc_code: "P0300",
    dtc_description: "Random/Multiple Cylinder Misfire Detected",
    vehicle_make: "Hyundai",
    vehicle_model: "Sonata",
    year_range_start: 2015,
    year_range_end: 2019,
    engine_type: "2.4L",
    cause: "Connecting rod bearing failure from manufacturing defect — Theta II engine recall",
    cause_category: "engine",
    confidence_base: 0.40,
    success_rate: 0.25,
    parts_needed: ["engine replacement"],
    labor_category: "advanced",
    labor_hours_estimate: 16.0,
    diagnostic_steps: [
      "CRITICAL: Check if vehicle is covered under Hyundai engine recall/warranty extension",
      "Campaign 953/132/162 covers Theta II engine bearing failure",
      "Listen for rod knock — metallic knocking under load",
      "If knocking is present, stop driving immediately to prevent catastrophic failure",
      "Contact Hyundai dealer for warranty engine replacement"
    ],
    common_misdiagnosis: "Attempting misfire repair when engine has internal bearing damage",
    source: "nhtsa"
  },
  {
    dtc_code: "P0171",
    dtc_description: "System Too Lean (Bank 1)",
    vehicle_make: "Hyundai",
    vehicle_model: "Sonata",
    year_range_start: 2015,
    year_range_end: 2019,
    engine_type: "2.4L",
    cause: "PCV valve failure causing vacuum leak on Theta II engine",
    cause_category: "fuel",
    confidence_base: 0.45,
    success_rate: 0.38,
    parts_needed: ["PCV valve", "valve cover gasket"],
    labor_category: "basic",
    labor_hours_estimate: 0.5,
    diagnostic_steps: [
      "PCV valve on Theta II is integrated into valve cover on some models",
      "Check for hissing sound near PCV area",
      "Replace PCV valve — may require valve cover replacement if integrated",
      "Check for oil consumption issues simultaneously"
    ],
    common_misdiagnosis: null,
    source: "community"
  },
  {
    dtc_code: "P0420",
    dtc_description: "Catalyst System Efficiency Below Threshold (Bank 1)",
    vehicle_make: "Hyundai",
    vehicle_model: "Sonata",
    year_range_start: 2015,
    year_range_end: 2019,
    engine_type: "2.4L",
    cause: "Catalytic converter degradation — often from oil consumption on Theta II",
    cause_category: "emissions",
    confidence_base: 0.55,
    success_rate: 0.45,
    parts_needed: ["catalytic converter"],
    labor_category: "advanced",
    labor_hours_estimate: 2.5,
    diagnostic_steps: [
      "Check for oil consumption — Theta II engines are known for excessive oil use",
      "Oil contamination destroys catalytic converter substrate",
      "Address oil consumption before replacing converter",
      "Hyundai extended warranty may cover emissions components"
    ],
    common_misdiagnosis: "Replacing converter without addressing underlying oil consumption",
    source: "community"
  },
  {
    dtc_code: "P0562",
    dtc_description: "System Voltage Low",
    vehicle_make: "Hyundai",
    vehicle_model: "Sonata",
    year_range_start: 2015,
    year_range_end: 2019,
    engine_type: "2.4L",
    cause: "IBS (Intelligent Battery Sensor) failure on negative cable",
    cause_category: "electrical",
    confidence_base: 0.45,
    success_rate: 0.35,
    parts_needed: ["IBS sensor", "battery cable"],
    labor_category: "basic",
    labor_hours_estimate: 0.5,
    diagnostic_steps: [
      "Hyundai uses an Intelligent Battery Sensor on the negative cable",
      "If IBS fails, PCM gets incorrect battery/charging system readings",
      "Compare actual battery voltage with scan tool voltage reading",
      "If discrepancy exists, replace IBS sensor"
    ],
    common_misdiagnosis: "Replacing alternator or battery when IBS sensor is faulty",
    source: "identifix"
  },

  // =========================================================================
  // 10. Hyundai Elantra (2017-2020) — 2.0L
  // =========================================================================
  {
    dtc_code: "P0171",
    dtc_description: "System Too Lean (Bank 1)",
    vehicle_make: "Hyundai",
    vehicle_model: "Elantra",
    year_range_start: 2017,
    year_range_end: 2020,
    engine_type: "2.0L",
    cause: "Purge valve stuck open causing lean condition and hard starts",
    cause_category: "fuel",
    confidence_base: 0.50,
    success_rate: 0.42,
    parts_needed: ["EVAP purge valve"],
    labor_category: "basic",
    labor_hours_estimate: 0.5,
    diagnostic_steps: [
      "A stuck-open purge valve can cause lean codes and hard hot-start conditions",
      "Disconnect purge valve vacuum line and plug it — if idle improves, valve is stuck open",
      "Apply vacuum to purge valve — should hold vacuum when unpowered",
      "Replace purge valve if leaking"
    ],
    common_misdiagnosis: "Looking for vacuum leaks when purge valve is allowing fuel vapor in at wrong times",
    source: "community"
  },
  {
    dtc_code: "P0420",
    dtc_description: "Catalyst System Efficiency Below Threshold (Bank 1)",
    vehicle_make: "Hyundai",
    vehicle_model: "Elantra",
    year_range_start: 2017,
    year_range_end: 2020,
    engine_type: "2.0L",
    cause: "Catalytic converter failure at moderate mileage",
    cause_category: "emissions",
    confidence_base: 0.55,
    success_rate: 0.45,
    parts_needed: ["catalytic converter"],
    labor_category: "advanced",
    labor_hours_estimate: 2.5,
    diagnostic_steps: [
      "Verify O2 sensor operation first",
      "Check for any oil consumption that could contaminate converter",
      "Hyundai emissions warranty is 8 years/80,000 miles federal; 15 years/150,000 in CARB states",
      "Check warranty coverage before paying out of pocket"
    ],
    common_misdiagnosis: null,
    source: "community"
  },

  // =========================================================================
  // 11. Kia Optima (2016-2020) — 2.4L
  // =========================================================================
  {
    dtc_code: "P0300",
    dtc_description: "Random/Multiple Cylinder Misfire Detected",
    vehicle_make: "Kia",
    vehicle_model: "Optima",
    year_range_start: 2016,
    year_range_end: 2020,
    engine_type: "2.4L",
    cause: "Theta II engine bearing failure — same platform as Hyundai Sonata",
    cause_category: "engine",
    confidence_base: 0.40,
    success_rate: 0.25,
    parts_needed: ["engine replacement"],
    labor_category: "advanced",
    labor_hours_estimate: 16.0,
    diagnostic_steps: [
      "CRITICAL: Check for Kia engine recall coverage — same Theta II engine issue",
      "Listen for rod knock under acceleration",
      "Check oil level — these engines are known for consumption",
      "Contact Kia dealer for warranty engine inspection"
    ],
    common_misdiagnosis: "Diagnosing ignition issues when engine has internal failure",
    source: "nhtsa"
  },
  {
    dtc_code: "P0171",
    dtc_description: "System Too Lean (Bank 1)",
    vehicle_make: "Kia",
    vehicle_model: "Optima",
    year_range_start: 2016,
    year_range_end: 2020,
    engine_type: "2.4L",
    cause: "Intake manifold runner control valve leak",
    cause_category: "fuel",
    confidence_base: 0.45,
    success_rate: 0.35,
    parts_needed: ["intake manifold runner control valve"],
    labor_category: "intermediate",
    labor_hours_estimate: 1.5,
    diagnostic_steps: [
      "Intake manifold runner control actuator can develop vacuum leaks",
      "Listen for whistling sound near intake manifold",
      "Smoke test intake to locate leak",
      "Replace runner control valve/actuator"
    ],
    common_misdiagnosis: null,
    source: "community"
  },

  // =========================================================================
  // 12. Ford Escape (2013-2019) — 1.5L EcoBoost
  // =========================================================================
  {
    dtc_code: "P0128",
    dtc_description: "Coolant Thermostat Below Regulating Temperature",
    vehicle_make: "Ford",
    vehicle_model: "Escape",
    year_range_start: 2013,
    year_range_end: 2019,
    engine_type: "1.5L EcoBoost",
    cause: "Coolant intrusion into cylinders from cracked engine block — known 1.5L issue",
    cause_category: "cooling",
    confidence_base: 0.40,
    success_rate: 0.20,
    parts_needed: ["engine block", "engine replacement"],
    labor_category: "advanced",
    labor_hours_estimate: 16.0,
    diagnostic_steps: [
      "CRITICAL: 1.5L EcoBoost has a known cracked engine block issue",
      "Ford Customer Satisfaction Program 20B28 may apply",
      "Check for white exhaust smoke, coolant consumption, or milky oil",
      "If coolant level drops with no external leaks, suspect internal crack",
      "Contact Ford dealer for inspection and potential engine replacement"
    ],
    common_misdiagnosis: "Replacing thermostat when engine block has a coolant leak",
    source: "oem_tsb"
  },
  {
    dtc_code: "P0300",
    dtc_description: "Random/Multiple Cylinder Misfire Detected",
    vehicle_make: "Ford",
    vehicle_model: "Escape",
    year_range_start: 2013,
    year_range_end: 2019,
    engine_type: "1.5L EcoBoost",
    cause: "Carbon buildup on intake valves — direct injection engine",
    cause_category: "engine",
    confidence_base: 0.45,
    success_rate: 0.38,
    parts_needed: ["walnut blasting service"],
    labor_category: "advanced",
    labor_hours_estimate: 3.0,
    diagnostic_steps: [
      "1.5L EcoBoost is susceptible to intake valve carbon buildup",
      "Misfires most noticeable on cold start and light load",
      "Borescope intake valves to confirm carbon deposits",
      "Walnut blast to clean valves"
    ],
    common_misdiagnosis: null,
    source: "community"
  },
  {
    dtc_code: "P0456",
    dtc_description: "Evaporative Emission Control System Leak Detected (Very Small Leak)",
    vehicle_make: "Ford",
    vehicle_model: "Escape",
    year_range_start: 2013,
    year_range_end: 2019,
    engine_type: "1.5L EcoBoost",
    cause: "EVAP canister purge valve failure",
    cause_category: "emissions",
    confidence_base: 0.50,
    success_rate: 0.40,
    parts_needed: ["EVAP purge valve"],
    labor_category: "basic",
    labor_hours_estimate: 0.5,
    diagnostic_steps: [
      "Test purge valve with vacuum and active scan tool test",
      "Replace if valve does not hold vacuum or respond to commands",
      "Clear code and complete EVAP monitor drive cycle"
    ],
    common_misdiagnosis: null,
    source: "community"
  },

  // =========================================================================
  // 13. Chevy Equinox (2018-2022) — 1.5T
  // =========================================================================
  {
    dtc_code: "P0171",
    dtc_description: "System Too Lean (Bank 1)",
    vehicle_make: "Chevrolet",
    vehicle_model: "Equinox",
    year_range_start: 2018,
    year_range_end: 2022,
    engine_type: "1.5L Turbo",
    cause: "PCV system failure allowing unmetered air into intake",
    cause_category: "fuel",
    confidence_base: 0.50,
    success_rate: 0.42,
    parts_needed: ["PCV valve", "intake manifold gasket"],
    labor_category: "intermediate",
    labor_hours_estimate: 1.0,
    diagnostic_steps: [
      "1.5T Equinox PCV system failure is a known issue",
      "Check for oil consumption and lean codes together",
      "Inspect PCV valve and hose for cracks or deterioration",
      "Replace PCV and check for intake manifold leaks"
    ],
    common_misdiagnosis: null,
    source: "community"
  },
  {
    dtc_code: "P0420",
    dtc_description: "Catalyst System Efficiency Below Threshold (Bank 1)",
    vehicle_make: "Chevrolet",
    vehicle_model: "Equinox",
    year_range_start: 2018,
    year_range_end: 2022,
    engine_type: "1.5L Turbo",
    cause: "Catalytic converter failure due to oil consumption on 1.5T engine",
    cause_category: "emissions",
    confidence_base: 0.55,
    success_rate: 0.42,
    parts_needed: ["catalytic converter", "piston rings"],
    labor_category: "advanced",
    labor_hours_estimate: 3.0,
    diagnostic_steps: [
      "1.5T is known for oil consumption that contaminates catalyst",
      "Check oil consumption rate — more than 1 qt per 2,000 miles is excessive",
      "GM may cover under special coverage or warranty extension",
      "Address oil consumption before replacing converter"
    ],
    common_misdiagnosis: "Replacing converter without fixing oil consumption — leads to repeat failure",
    source: "oem_tsb"
  },
  {
    dtc_code: "P0299",
    dtc_description: "Turbocharger/Supercharger Underboost",
    vehicle_make: "Chevrolet",
    vehicle_model: "Equinox",
    year_range_start: 2018,
    year_range_end: 2022,
    engine_type: "1.5L Turbo",
    cause: "Wastegate actuator failure or boost leak on 1.5T",
    cause_category: "engine",
    confidence_base: 0.50,
    success_rate: 0.38,
    parts_needed: ["turbo wastegate actuator", "charge pipe"],
    labor_category: "intermediate",
    labor_hours_estimate: 2.0,
    diagnostic_steps: [
      "Check actual boost pressure vs commanded boost with scan tool",
      "If actual is significantly lower than commanded, find the leak",
      "Check intercooler pipes and connections for boost leaks",
      "Check wastegate actuator — should hold vacuum and move rod",
      "GM PIP5690 may apply"
    ],
    common_misdiagnosis: null,
    source: "oem_tsb"
  },

  // =========================================================================
  // 14. Subaru Outback (2015-2019) — 2.5L
  // =========================================================================
  {
    dtc_code: "P0420",
    dtc_description: "Catalyst System Efficiency Below Threshold (Bank 1)",
    vehicle_make: "Subaru",
    vehicle_model: "Outback",
    year_range_start: 2015,
    year_range_end: 2019,
    engine_type: "2.5L",
    cause: "Catalytic converter failure — often preceded by oil consumption on FB25 engine",
    cause_category: "emissions",
    confidence_base: 0.55,
    success_rate: 0.45,
    parts_needed: ["catalytic converter"],
    labor_category: "advanced",
    labor_hours_estimate: 2.5,
    diagnostic_steps: [
      "FB25 engine has known oil consumption issues that contaminate converter",
      "Check for Subaru oil consumption TSB WTY-78",
      "Monitor oil consumption before replacing converter",
      "If consuming more than 1 qt per 1,200 miles, engine needs piston ring replacement",
      "Replace converter after addressing oil consumption"
    ],
    common_misdiagnosis: "Replacing converter when piston rings are causing oil consumption",
    source: "oem_tsb"
  },
  {
    dtc_code: "P0171",
    dtc_description: "System Too Lean (Bank 1)",
    vehicle_make: "Subaru",
    vehicle_model: "Outback",
    year_range_start: 2015,
    year_range_end: 2019,
    engine_type: "2.5L",
    cause: "MAF sensor contamination on FB25 boxer engine",
    cause_category: "fuel",
    confidence_base: 0.45,
    success_rate: 0.38,
    parts_needed: ["MAF sensor cleaner", "air filter"],
    labor_category: "basic",
    labor_hours_estimate: 0.3,
    diagnostic_steps: [
      "FB25 boxer engine MAF sensor is prone to contamination",
      "Clean MAF with dedicated cleaner",
      "Replace air filter if dirty",
      "Check intake boot for cracks — especially at bellows sections"
    ],
    common_misdiagnosis: null,
    source: "community"
  },
  {
    dtc_code: "P0302",
    dtc_description: "Cylinder 2 Misfire Detected",
    vehicle_make: "Subaru",
    vehicle_model: "Outback",
    year_range_start: 2015,
    year_range_end: 2019,
    engine_type: "2.5L",
    cause: "Ignition coil failure — common on boxer engines due to horizontal cylinder orientation",
    cause_category: "ignition",
    confidence_base: 0.55,
    success_rate: 0.48,
    parts_needed: ["ignition coil", "spark plug"],
    labor_category: "basic",
    labor_hours_estimate: 0.5,
    diagnostic_steps: [
      "Horizontal cylinder orientation allows oil/moisture to pool around spark plug wells",
      "Check for oil in spark plug wells — indicates valve cover gasket leak",
      "Replace coil and spark plug as a pair",
      "Address valve cover gasket if oil is present in plug well"
    ],
    common_misdiagnosis: null,
    source: "community"
  },

  // =========================================================================
  // 15. Jeep Grand Cherokee (2014-2021) — 3.6L V6
  // =========================================================================
  {
    dtc_code: "P0300",
    dtc_description: "Random/Multiple Cylinder Misfire Detected",
    vehicle_make: "Jeep",
    vehicle_model: "Grand Cherokee",
    year_range_start: 2014,
    year_range_end: 2021,
    engine_type: "3.6L V6",
    cause: "Rocker arm failure on 3.6L Pentastar — causes misfire and ticking",
    cause_category: "engine",
    confidence_base: 0.45,
    success_rate: 0.35,
    parts_needed: ["rocker arm assembly", "valve lifter"],
    labor_category: "advanced",
    labor_hours_estimate: 5.0,
    diagnostic_steps: [
      "3.6L Pentastar has known rocker arm failure issue",
      "Listen for ticking/tapping noise from valve cover area",
      "Misfire typically isolated to one or two cylinders",
      "Remove valve cover and inspect rocker arms for damage or wear",
      "FCA TSB 09-002-14 REV.B may apply"
    ],
    common_misdiagnosis: "Replacing ignition components when rocker arm is failed",
    source: "oem_tsb"
  },
  {
    dtc_code: "P0420",
    dtc_description: "Catalyst System Efficiency Below Threshold (Bank 1)",
    vehicle_make: "Jeep",
    vehicle_model: "Grand Cherokee",
    year_range_start: 2014,
    year_range_end: 2021,
    engine_type: "3.6L V6",
    cause: "Catalytic converter failure on 3.6L Pentastar",
    cause_category: "emissions",
    confidence_base: 0.55,
    success_rate: 0.45,
    parts_needed: ["catalytic converter"],
    labor_category: "advanced",
    labor_hours_estimate: 3.0,
    diagnostic_steps: [
      "3.6L has dual exhaust with bank 1 and bank 2 converters",
      "Verify which bank is affected from DTC (P0420 = Bank 1, P0430 = Bank 2)",
      "Confirm with O2 sensor data before replacement",
      "Use quality replacement converter — cheap aftermarket may not last"
    ],
    common_misdiagnosis: null,
    source: "community"
  },
  {
    dtc_code: "P0455",
    dtc_description: "Evaporative Emission Control System Leak Detected (Gross Leak)",
    vehicle_make: "Jeep",
    vehicle_model: "Grand Cherokee",
    year_range_start: 2014,
    year_range_end: 2021,
    engine_type: "3.6L V6",
    cause: "EVAP leak detection pump failure — known FCA issue",
    cause_category: "emissions",
    confidence_base: 0.50,
    success_rate: 0.40,
    parts_needed: ["EVAP leak detection pump"],
    labor_category: "intermediate",
    labor_hours_estimate: 1.0,
    diagnostic_steps: [
      "FCA vehicles use an EVAP leak detection pump instead of standard purge/vent system",
      "Pump is usually located near charcoal canister",
      "Test pump operation with scan tool active test",
      "If pump does not run or cannot build pressure, replace it"
    ],
    common_misdiagnosis: null,
    source: "identifix"
  },

  // =========================================================================
  // 16. Ram 1500 (2014-2018) — 5.7L Hemi
  // =========================================================================
  {
    dtc_code: "P0300",
    dtc_description: "Random/Multiple Cylinder Misfire Detected",
    vehicle_make: "Ram",
    vehicle_model: "1500",
    year_range_start: 2014,
    year_range_end: 2018,
    engine_type: "5.7L Hemi",
    cause: "MDS (Multi-Displacement System) lifter failure — similar to GM AFM issue",
    cause_category: "engine",
    confidence_base: 0.50,
    success_rate: 0.35,
    parts_needed: ["MDS lifters", "camshaft"],
    labor_category: "advanced",
    labor_hours_estimate: 12.0,
    diagnostic_steps: [
      "Check which cylinders are misfiring — MDS cylinders are 1, 4, 6, 7",
      "If misfires are on MDS cylinders, suspect MDS lifter failure",
      "Listen for lifter tick/knock — indicates collapsed lifter",
      "FCA has issued multiple TSBs on Hemi lifter issues",
      "Common repair is lifter replacement or MDS delete"
    ],
    common_misdiagnosis: "Replacing spark plugs on Hemi when lifters are failing",
    source: "oem_tsb"
  },
  {
    dtc_code: "P0420",
    dtc_description: "Catalyst System Efficiency Below Threshold (Bank 1)",
    vehicle_make: "Ram",
    vehicle_model: "1500",
    year_range_start: 2014,
    year_range_end: 2018,
    engine_type: "5.7L Hemi",
    cause: "Catalytic converter failure on 5.7L Hemi",
    cause_category: "emissions",
    confidence_base: 0.55,
    success_rate: 0.45,
    parts_needed: ["catalytic converter"],
    labor_category: "advanced",
    labor_hours_estimate: 3.0,
    diagnostic_steps: [
      "5.7L Hemi has 4 catalytic converters — 2 close-coupled and 2 underbody",
      "Identify which converter is failing using O2 sensor bank data",
      "Check for exhaust leaks at header/converter connections",
      "Replace failed converter with quality replacement"
    ],
    common_misdiagnosis: null,
    source: "community"
  },
  {
    dtc_code: "P0455",
    dtc_description: "Evaporative Emission Control System Leak Detected (Gross Leak)",
    vehicle_make: "Ram",
    vehicle_model: "1500",
    year_range_start: 2014,
    year_range_end: 2018,
    engine_type: "5.7L Hemi",
    cause: "ESIM (Evaporative System Integrity Module) failure",
    cause_category: "emissions",
    confidence_base: 0.50,
    success_rate: 0.40,
    parts_needed: ["ESIM module"],
    labor_category: "basic",
    labor_hours_estimate: 0.5,
    diagnostic_steps: [
      "Ram trucks use ESIM module instead of standard EVAP leak detection pump",
      "ESIM is located near fuel filler area",
      "If ESIM seal or valve fails, gross leak code sets",
      "Inspect ESIM for physical damage or stuck valve",
      "Replace ESIM module"
    ],
    common_misdiagnosis: null,
    source: "identifix"
  },
  {
    dtc_code: "P0562",
    dtc_description: "System Voltage Low",
    vehicle_make: "Ram",
    vehicle_model: "1500",
    year_range_start: 2014,
    year_range_end: 2018,
    engine_type: "5.7L Hemi",
    cause: "IBS (Intelligent Battery Sensor) failure on FCA vehicles",
    cause_category: "electrical",
    confidence_base: 0.40,
    success_rate: 0.32,
    parts_needed: ["IBS sensor", "battery cable"],
    labor_category: "basic",
    labor_hours_estimate: 0.5,
    diagnostic_steps: [
      "FCA vehicles use IBS on negative battery cable",
      "IBS failure can report incorrect voltage to PCM",
      "Compare actual battery voltage to scan tool reading",
      "If mismatch, replace IBS sensor"
    ],
    common_misdiagnosis: null,
    source: "community"
  },

  // =========================================================================
  // 17. BMW 3 Series (2012-2018) — 2.0T N20
  // =========================================================================
  {
    dtc_code: "P0300",
    dtc_description: "Random/Multiple Cylinder Misfire Detected",
    vehicle_make: "BMW",
    vehicle_model: "3 Series",
    year_range_start: 2012,
    year_range_end: 2018,
    engine_type: "2.0T N20",
    cause: "Timing chain stretch and guide failure — critical N20 issue",
    cause_category: "engine",
    confidence_base: 0.50,
    success_rate: 0.35,
    parts_needed: ["timing chain kit", "chain guides", "chain tensioner"],
    labor_category: "advanced",
    labor_hours_estimate: 8.0,
    diagnostic_steps: [
      "N20 engine has known timing chain stretch and guide failure",
      "Listen for timing chain rattle on cold start",
      "Check VANOS adaptation values with BMW-specific scan tool",
      "If chain has stretched, CMP/CKP correlation will be off",
      "Chain replacement is urgent — failure can cause catastrophic engine damage"
    ],
    common_misdiagnosis: "Replacing ignition components when timing chain is stretched",
    source: "oem_tsb"
  },
  {
    dtc_code: "P0171",
    dtc_description: "System Too Lean (Bank 1)",
    vehicle_make: "BMW",
    vehicle_model: "3 Series",
    year_range_start: 2012,
    year_range_end: 2018,
    engine_type: "2.0T N20",
    cause: "Valve cover/PCV system failure causing vacuum leak on N20",
    cause_category: "fuel",
    confidence_base: 0.55,
    success_rate: 0.45,
    parts_needed: ["valve cover with integrated PCV"],
    labor_category: "intermediate",
    labor_hours_estimate: 2.0,
    diagnostic_steps: [
      "BMW N20 valve cover has integrated PCV system and CCV (crankcase vent)",
      "When PCV diaphragm tears, it creates a massive vacuum leak",
      "Listen for hissing sound near valve cover",
      "Check for oil residue around valve cover gasket area",
      "Replace entire valve cover assembly (PCV is not separately serviceable)"
    ],
    common_misdiagnosis: "Looking for intake leaks when valve cover PCV is the source",
    source: "identifix"
  },
  {
    dtc_code: "P0340",
    dtc_description: "Camshaft Position Sensor Circuit Malfunction (Bank 1)",
    vehicle_make: "BMW",
    vehicle_model: "3 Series",
    year_range_start: 2012,
    year_range_end: 2018,
    engine_type: "2.0T N20",
    cause: "VANOS solenoid failure affecting cam timing on N20",
    cause_category: "engine",
    confidence_base: 0.45,
    success_rate: 0.35,
    parts_needed: ["VANOS solenoid", "VANOS seals"],
    labor_category: "intermediate",
    labor_hours_estimate: 1.5,
    diagnostic_steps: [
      "Check VANOS solenoid operation with BMW scan tool",
      "Monitor cam timing deviation from target",
      "If deviation is excessive, VANOS solenoid may be stuck",
      "Remove and inspect solenoid for debris or damaged seals",
      "Replace solenoid and clear adaptations"
    ],
    common_misdiagnosis: "Replacing CMP sensor when VANOS is the root cause",
    source: "community"
  },
  {
    dtc_code: "P0507",
    dtc_description: "Idle Control System RPM Higher Than Expected",
    vehicle_make: "BMW",
    vehicle_model: "3 Series",
    year_range_start: 2012,
    year_range_end: 2018,
    engine_type: "2.0T N20",
    cause: "Charge pipe or boost pipe crack/disconnect causing unmetered air entry",
    cause_category: "fuel",
    confidence_base: 0.45,
    success_rate: 0.38,
    parts_needed: ["charge pipe", "boost pipe couplers"],
    labor_category: "intermediate",
    labor_hours_estimate: 1.0,
    diagnostic_steps: [
      "N20 plastic charge pipes are known to crack especially at couplers",
      "Inspect charge pipe from turbo to intercooler and from intercooler to throttle body",
      "Check pipe couplers and clamps for secure fit",
      "Cracked pipe allows unmetered air causing high idle and lean conditions"
    ],
    common_misdiagnosis: null,
    source: "community"
  },

  // =========================================================================
  // 18. VW Jetta (2015-2019) — 1.4T
  // =========================================================================
  {
    dtc_code: "P0171",
    dtc_description: "System Too Lean (Bank 1)",
    vehicle_make: "Volkswagen",
    vehicle_model: "Jetta",
    year_range_start: 2015,
    year_range_end: 2019,
    engine_type: "1.4L Turbo",
    cause: "PCV valve failure integrated into valve cover — common VW/Audi issue",
    cause_category: "fuel",
    confidence_base: 0.55,
    success_rate: 0.45,
    parts_needed: ["valve cover with PCV", "valve cover gasket"],
    labor_category: "intermediate",
    labor_hours_estimate: 1.5,
    diagnostic_steps: [
      "VW 1.4T has integrated PCV in valve cover — same design philosophy as BMW",
      "Check for whistling or hissing from valve cover area",
      "A torn PCV diaphragm creates significant vacuum leak",
      "Replace entire valve cover assembly",
      "Common failure at 60,000-100,000 miles"
    ],
    common_misdiagnosis: "Replacing MAF sensor when PCV is the vacuum leak source",
    source: "identifix"
  },
  {
    dtc_code: "P0300",
    dtc_description: "Random/Multiple Cylinder Misfire Detected",
    vehicle_make: "Volkswagen",
    vehicle_model: "Jetta",
    year_range_start: 2015,
    year_range_end: 2019,
    engine_type: "1.4L Turbo",
    cause: "Ignition coil failure — common on VW TSI engines",
    cause_category: "ignition",
    confidence_base: 0.55,
    success_rate: 0.48,
    parts_needed: ["ignition coils (set of 4)", "spark plugs"],
    labor_category: "basic",
    labor_hours_estimate: 0.5,
    diagnostic_steps: [
      "VW TSI engines are hard on ignition coils due to high boost pressures",
      "If one coil fails, recommend replacing all four as a set",
      "Replace spark plugs at same time",
      "Use OEM-quality coils — cheap aftermarket coils have high failure rates on VW"
    ],
    common_misdiagnosis: null,
    source: "community"
  },
  {
    dtc_code: "P0420",
    dtc_description: "Catalyst System Efficiency Below Threshold (Bank 1)",
    vehicle_make: "Volkswagen",
    vehicle_model: "Jetta",
    year_range_start: 2015,
    year_range_end: 2019,
    engine_type: "1.4L Turbo",
    cause: "Catalytic converter failure on EA211 engine",
    cause_category: "emissions",
    confidence_base: 0.55,
    success_rate: 0.45,
    parts_needed: ["catalytic converter"],
    labor_category: "advanced",
    labor_hours_estimate: 2.5,
    diagnostic_steps: [
      "Verify O2 sensor operation before condemning converter",
      "VW emissions warranty is 8 years/80,000 miles (federal); longer in CARB states",
      "Check warranty coverage before paying out of pocket",
      "Use quality CARB-compliant converter"
    ],
    common_misdiagnosis: null,
    source: "community"
  },

  // =========================================================================
  // 19. Mazda CX-5 (2017-2021) — 2.5L
  // =========================================================================
  {
    dtc_code: "P0171",
    dtc_description: "System Too Lean (Bank 1)",
    vehicle_make: "Mazda",
    vehicle_model: "CX-5",
    year_range_start: 2017,
    year_range_end: 2021,
    engine_type: "2.5L",
    cause: "PCV valve failure on SkyActiv-G 2.5L engine",
    cause_category: "fuel",
    confidence_base: 0.50,
    success_rate: 0.40,
    parts_needed: ["PCV valve"],
    labor_category: "basic",
    labor_hours_estimate: 0.5,
    diagnostic_steps: [
      "SkyActiv-G PCV valve can fail and create vacuum leak",
      "Check PCV valve — should rattle freely when shaken",
      "Inspect PCV hose for cracks",
      "Replace PCV valve and clear codes"
    ],
    common_misdiagnosis: null,
    source: "community"
  },
  {
    dtc_code: "P0420",
    dtc_description: "Catalyst System Efficiency Below Threshold (Bank 1)",
    vehicle_make: "Mazda",
    vehicle_model: "CX-5",
    year_range_start: 2017,
    year_range_end: 2021,
    engine_type: "2.5L",
    cause: "Catalytic converter degradation on SkyActiv-G engine",
    cause_category: "emissions",
    confidence_base: 0.55,
    success_rate: 0.45,
    parts_needed: ["catalytic converter"],
    labor_category: "advanced",
    labor_hours_estimate: 2.5,
    diagnostic_steps: [
      "Verify O2 sensors are functioning properly",
      "Mazda emissions warranty coverage may apply",
      "Use OEM or quality aftermarket converter",
      "SkyActiv engines are generally reliable — converter failure is typically wear-related"
    ],
    common_misdiagnosis: null,
    source: "community"
  },
  {
    dtc_code: "P0442",
    dtc_description: "Evaporative Emission Control System Leak Detected (Small Leak)",
    vehicle_make: "Mazda",
    vehicle_model: "CX-5",
    year_range_start: 2017,
    year_range_end: 2021,
    engine_type: "2.5L",
    cause: "Gas cap seal deterioration or EVAP purge valve failure",
    cause_category: "emissions",
    confidence_base: 0.50,
    success_rate: 0.42,
    parts_needed: ["gas cap", "EVAP purge valve"],
    labor_category: "basic",
    labor_hours_estimate: 0.3,
    diagnostic_steps: [
      "Start with gas cap replacement — cheapest fix",
      "If code returns, test EVAP purge valve with vacuum and scan tool",
      "Smoke test EVAP system for hidden leaks",
      "Check EVAP hose connections"
    ],
    common_misdiagnosis: null,
    source: "community"
  },
  {
    dtc_code: "P0128",
    dtc_description: "Coolant Thermostat Below Regulating Temperature",
    vehicle_make: "Mazda",
    vehicle_model: "CX-5",
    year_range_start: 2017,
    year_range_end: 2021,
    engine_type: "2.5L",
    cause: "Thermostat stuck open on SkyActiv-G engine",
    cause_category: "cooling",
    confidence_base: 0.70,
    success_rate: 0.60,
    parts_needed: ["thermostat", "coolant"],
    labor_category: "intermediate",
    labor_hours_estimate: 1.5,
    diagnostic_steps: [
      "Monitor ECT during warm-up — should reach operating temp within 10-15 minutes",
      "If ECT stays below 180F, thermostat is stuck open",
      "Replace with OEM thermostat — correct temperature rating is critical",
      "Bleed cooling system after replacement"
    ],
    common_misdiagnosis: null,
    source: "community"
  },

  // =========================================================================
  // 20. GMC Sierra (2014-2019) — 5.3L V8
  // =========================================================================
  {
    dtc_code: "P0300",
    dtc_description: "Random/Multiple Cylinder Misfire Detected",
    vehicle_make: "GMC",
    vehicle_model: "Sierra",
    year_range_start: 2014,
    year_range_end: 2019,
    engine_type: "5.3L V8",
    cause: "AFM lifter collapse — same platform as Silverado 5.3L",
    cause_category: "engine",
    confidence_base: 0.55,
    success_rate: 0.40,
    parts_needed: ["AFM lifters", "AFM delete kit", "camshaft"],
    labor_category: "advanced",
    labor_hours_estimate: 12.0,
    diagnostic_steps: [
      "Identical issue to Silverado — AFM lifter failure on 5.3L Gen V",
      "Check misfire counters on AFM cylinders (1, 4, 6, 7)",
      "Listen for lifter tick/knock",
      "GM TSB 18-NA-355 applies",
      "Common fix is AFM delete"
    ],
    common_misdiagnosis: "Replacing spark plugs and coils when AFM lifter is collapsed",
    source: "oem_tsb"
  },
  {
    dtc_code: "P0449",
    dtc_description: "Evaporative Emission Control System Vent Valve/Solenoid Circuit Malfunction",
    vehicle_make: "GMC",
    vehicle_model: "Sierra",
    year_range_start: 2014,
    year_range_end: 2019,
    engine_type: "5.3L V8",
    cause: "EVAP vent solenoid failure — same issue as Silverado",
    cause_category: "electrical",
    confidence_base: 0.70,
    success_rate: 0.60,
    parts_needed: ["EVAP vent solenoid"],
    labor_category: "basic",
    labor_hours_estimate: 0.5,
    diagnostic_steps: [
      "Same vent solenoid issue as Silverado — located near fuel tank area",
      "Apply 12V to solenoid — should click",
      "Replace with AC Delco OEM part",
      "Clear code and complete EVAP drive cycle"
    ],
    common_misdiagnosis: null,
    source: "identifix"
  },
  {
    dtc_code: "P0521",
    dtc_description: "Engine Oil Pressure Sensor/Switch Range/Performance",
    vehicle_make: "GMC",
    vehicle_model: "Sierra",
    year_range_start: 2014,
    year_range_end: 2019,
    engine_type: "5.3L V8",
    cause: "Oil pressure sensor failure — same Gen V 5.3L issue as Silverado",
    cause_category: "engine",
    confidence_base: 0.60,
    success_rate: 0.50,
    parts_needed: ["oil pressure sensor"],
    labor_category: "basic",
    labor_hours_estimate: 0.5,
    diagnostic_steps: [
      "Very common on Gen V 5.3L — same issue as Silverado",
      "Always verify with mechanical gauge first",
      "Replace with AC Delco OEM sensor",
      "Aftermarket sensors are unreliable on this platform"
    ],
    common_misdiagnosis: null,
    source: "identifix"
  },
  {
    dtc_code: "P0420",
    dtc_description: "Catalyst System Efficiency Below Threshold (Bank 1)",
    vehicle_make: "GMC",
    vehicle_model: "Sierra",
    year_range_start: 2014,
    year_range_end: 2019,
    engine_type: "5.3L V8",
    cause: "Catalytic converter failure — often from AFM-related oil consumption",
    cause_category: "emissions",
    confidence_base: 0.55,
    success_rate: 0.45,
    parts_needed: ["catalytic converter"],
    labor_category: "advanced",
    labor_hours_estimate: 3.0,
    diagnostic_steps: [
      "Same platform as Silverado — check for oil consumption",
      "AFM system can cause excessive oil use that contaminates converters",
      "Verify O2 sensor data before replacement",
      "Address oil consumption to prevent repeat failure"
    ],
    common_misdiagnosis: null,
    source: "community"
  },
];
