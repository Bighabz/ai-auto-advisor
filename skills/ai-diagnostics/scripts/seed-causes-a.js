/**
 * seed-causes-a.js — Cause mappings part A
 * Covers: P0420/P0430 catalyst, P0171/P0172/P0174/P0175 fuel trim,
 *         P0131/P0133/P0135/P0137/P0141 O2 sensors,
 *         P0128 thermostat, P0325 knock sensor, P0335/P0340/P0341 crank/cam,
 *         P0401/P0411 EGR/AIR, P0440-P0456 EVAP
 */

module.exports = [
  // =========================================================================
  // P0420 — Catalyst System Efficiency Below Threshold (Bank 1)
  // =========================================================================
  {
    dtc_code: "P0420",
    dtc_description: "Catalyst System Efficiency Below Threshold (Bank 1)",
    cause: "Catalytic converter failure — substrate deterioration or contamination",
    cause_category: "emissions",
    confidence_base: 0.70,
    success_rate: 0.65,
    parts_needed: ["catalytic converter", "exhaust gaskets"],
    labor_category: "advanced",
    labor_hours_estimate: 2.5,
    diagnostic_steps: [
      "Read freeze frame data for operating conditions when code set",
      "Check for other DTCs — misfire or fuel trim codes must be repaired first",
      "Monitor upstream and downstream O2 sensor waveforms with scan tool",
      "Upstream should oscillate rapidly; downstream should be relatively flat",
      "If downstream mirrors upstream, catalyst is not storing oxygen — replacement needed",
      "Check exhaust for leaks before the catalytic converter"
    ],
    common_misdiagnosis: "Replacing catalytic converter when the root cause is an upstream O2 sensor or an exhaust leak",
    source: "identifix"
  },
  {
    dtc_code: "P0420",
    dtc_description: "Catalyst System Efficiency Below Threshold (Bank 1)",
    cause: "Downstream O2 sensor failure — providing incorrect efficiency signal",
    cause_category: "emissions",
    confidence_base: 0.50,
    success_rate: 0.20,
    parts_needed: ["downstream O2 sensor"],
    labor_category: "basic",
    labor_hours_estimate: 0.5,
    diagnostic_steps: [
      "Monitor downstream O2 sensor voltage with scan tool",
      "At steady cruise, downstream should read 0.5-0.8V and be relatively stable",
      "If downstream sensor is erratic, slow to respond, or stuck, replace sensor",
      "Check sensor wiring and connector for damage or corrosion",
      "Clear code and drive through two complete drive cycles to verify"
    ],
    common_misdiagnosis: "Replacing sensor when catalytic converter is genuinely failed",
    source: "community"
  },
  {
    dtc_code: "P0420",
    dtc_description: "Catalyst System Efficiency Below Threshold (Bank 1)",
    cause: "Exhaust leak before catalytic converter allowing false air readings",
    cause_category: "emissions",
    confidence_base: 0.30,
    success_rate: 0.08,
    parts_needed: ["exhaust gasket", "exhaust flange bolts"],
    labor_category: "intermediate",
    labor_hours_estimate: 1.0,
    diagnostic_steps: [
      "Visually inspect exhaust manifold and downpipe for cracks or rust-through",
      "Check exhaust manifold gasket and downpipe flange connection",
      "Use smoke machine or propane enrichment to find leaks",
      "Listen for exhaust ticking sound on cold start (indicates manifold leak)",
      "Repair leak, clear code, and complete drive cycle"
    ],
    common_misdiagnosis: null,
    source: "community"
  },
  {
    dtc_code: "P0420",
    dtc_description: "Catalyst System Efficiency Below Threshold (Bank 1)",
    cause: "ECU calibration issue — software update needed",
    cause_category: "emissions",
    confidence_base: 0.20,
    success_rate: 0.05,
    parts_needed: [],
    labor_category: "basic",
    labor_hours_estimate: 0.5,
    diagnostic_steps: [
      "Check for applicable TSBs for the specific vehicle",
      "Verify PCM software is at latest calibration level",
      "If TSB exists, reprogram PCM with updated calibration",
      "Clear code and drive through complete drive cycle"
    ],
    common_misdiagnosis: null,
    source: "oem_tsb"
  },
  {
    dtc_code: "P0420",
    dtc_description: "Catalyst System Efficiency Below Threshold (Bank 1)",
    cause: "Upstream O2 sensor degraded — sending inaccurate fuel trim data",
    cause_category: "emissions",
    confidence_base: 0.15,
    success_rate: 0.02,
    parts_needed: ["upstream O2 sensor"],
    labor_category: "basic",
    labor_hours_estimate: 0.5,
    diagnostic_steps: [
      "Monitor upstream O2 sensor switching rate — should toggle 6-8 times per 10 seconds",
      "Check for slow response time (should switch within 100ms)",
      "If sluggish, contaminated, or lazy, replace upstream sensor",
      "After replacement, clear codes and allow complete drive cycle"
    ],
    common_misdiagnosis: "Overlooking upstream sensor when downstream sensor appears fine",
    source: "community"
  },

  // =========================================================================
  // P0430 — Catalyst System Efficiency Below Threshold (Bank 2)
  // =========================================================================
  {
    dtc_code: "P0430",
    dtc_description: "Catalyst System Efficiency Below Threshold (Bank 2)",
    cause: "Catalytic converter failure (bank 2)",
    cause_category: "emissions",
    confidence_base: 0.70,
    success_rate: 0.65,
    parts_needed: ["catalytic converter bank 2", "exhaust gaskets"],
    labor_category: "advanced",
    labor_hours_estimate: 3.0,
    diagnostic_steps: [
      "Confirm which bank is bank 2 for this engine configuration",
      "Monitor bank 2 upstream and downstream O2 sensors with scan tool",
      "Compare waveform patterns — downstream mirroring upstream indicates failed cat",
      "Check for exhaust leaks on bank 2 exhaust manifold and downpipe",
      "Verify no misfire codes on bank 2 cylinders"
    ],
    common_misdiagnosis: "Replacing bank 1 converter instead of bank 2",
    source: "identifix"
  },
  {
    dtc_code: "P0430",
    dtc_description: "Catalyst System Efficiency Below Threshold (Bank 2)",
    cause: "Downstream O2 sensor failure (bank 2, sensor 2)",
    cause_category: "emissions",
    confidence_base: 0.45,
    success_rate: 0.18,
    parts_needed: ["downstream O2 sensor bank 2"],
    labor_category: "basic",
    labor_hours_estimate: 0.5,
    diagnostic_steps: [
      "Monitor bank 2 sensor 2 voltage and switching behavior",
      "Compare with bank 1 sensor 2 if available",
      "If sensor is lazy or stuck, replace",
      "Check wiring and connector for damage"
    ],
    common_misdiagnosis: null,
    source: "community"
  },
  {
    dtc_code: "P0430",
    dtc_description: "Catalyst System Efficiency Below Threshold (Bank 2)",
    cause: "Exhaust leak on bank 2 manifold or downpipe",
    cause_category: "emissions",
    confidence_base: 0.25,
    success_rate: 0.07,
    parts_needed: ["exhaust gasket bank 2", "exhaust bolts"],
    labor_category: "intermediate",
    labor_hours_estimate: 1.5,
    diagnostic_steps: [
      "Inspect bank 2 exhaust manifold for cracks",
      "Check downpipe connection at catalytic converter",
      "Use smoke machine to find small leaks",
      "Repair and clear codes"
    ],
    common_misdiagnosis: null,
    source: "community"
  },

  // =========================================================================
  // P0171 — System Too Lean (Bank 1)
  // =========================================================================
  {
    dtc_code: "P0171",
    dtc_description: "System Too Lean (Bank 1)",
    cause: "Vacuum leak — cracked or disconnected intake hose, intake manifold gasket leak",
    cause_category: "fuel",
    confidence_base: 0.65,
    success_rate: 0.55,
    parts_needed: ["intake manifold gasket", "vacuum hoses"],
    labor_category: "intermediate",
    labor_hours_estimate: 1.5,
    diagnostic_steps: [
      "Check long-term fuel trim (LTFT) — should be above +10% to confirm lean",
      "Spray carb cleaner around intake manifold gasket and vacuum hose connections",
      "If RPM changes, leak is present at that location",
      "Use smoke machine for thorough leak detection",
      "Inspect PCV valve and hose, brake booster line, and all vacuum connections",
      "Check intake boot between MAF sensor and throttle body for cracks"
    ],
    common_misdiagnosis: "Replacing O2 sensor or MAF sensor when a simple vacuum leak is the cause",
    source: "identifix"
  },
  {
    dtc_code: "P0171",
    dtc_description: "System Too Lean (Bank 1)",
    cause: "Dirty or faulty MAF sensor — underreporting airflow",
    cause_category: "fuel",
    confidence_base: 0.45,
    success_rate: 0.30,
    parts_needed: ["MAF sensor", "MAF sensor cleaner"],
    labor_category: "basic",
    labor_hours_estimate: 0.5,
    diagnostic_steps: [
      "Check MAF sensor readings at idle — typically 2-7 g/s for most 4-cylinder engines",
      "Compare MAF reading to calculated airflow (RPM x displacement / 2)",
      "Inspect MAF sensor element for contamination or oil film",
      "Clean MAF with dedicated MAF cleaner spray — never touch element",
      "If cleaning does not resolve, replace MAF sensor",
      "Check air filter and air filter box for proper sealing"
    ],
    common_misdiagnosis: "Replacing MAF without checking for intake leaks downstream of the sensor",
    source: "community"
  },
  {
    dtc_code: "P0171",
    dtc_description: "System Too Lean (Bank 1)",
    cause: "Weak fuel pump or clogged fuel filter — insufficient fuel pressure",
    cause_category: "fuel",
    confidence_base: 0.30,
    success_rate: 0.15,
    parts_needed: ["fuel pump", "fuel filter"],
    labor_category: "intermediate",
    labor_hours_estimate: 2.0,
    diagnostic_steps: [
      "Connect fuel pressure gauge to fuel rail",
      "Check fuel pressure at idle — compare to spec (typically 35-65 PSI depending on vehicle)",
      "Monitor fuel pressure under load (snap throttle test)",
      "If pressure drops under load, suspect weak pump",
      "Check fuel filter if serviceable (many modern vehicles have non-serviceable in-tank filters)",
      "Listen for fuel pump operation with key on engine off"
    ],
    common_misdiagnosis: "Ignoring fuel pressure and focusing only on air-side issues",
    source: "community"
  },
  {
    dtc_code: "P0171",
    dtc_description: "System Too Lean (Bank 1)",
    cause: "Faulty or stuck-open PCV valve allowing unmetered air into intake",
    cause_category: "fuel",
    confidence_base: 0.20,
    success_rate: 0.10,
    parts_needed: ["PCV valve"],
    labor_category: "basic",
    labor_hours_estimate: 0.3,
    diagnostic_steps: [
      "Remove PCV valve and shake — should rattle freely",
      "Check PCV hose for cracks or disconnection",
      "With engine running, place finger over PCV valve — should feel strong vacuum",
      "If valve is stuck open, excessive crankcase air enters intake unmetered",
      "Replace PCV valve and clear codes"
    ],
    common_misdiagnosis: null,
    source: "community"
  },

  // =========================================================================
  // P0172 — System Too Rich (Bank 1)
  // =========================================================================
  {
    dtc_code: "P0172",
    dtc_description: "System Too Rich (Bank 1)",
    cause: "Leaking or stuck-open fuel injector flooding cylinder(s)",
    cause_category: "fuel",
    confidence_base: 0.55,
    success_rate: 0.40,
    parts_needed: ["fuel injectors", "injector O-rings"],
    labor_category: "intermediate",
    labor_hours_estimate: 2.0,
    diagnostic_steps: [
      "Check LTFT — should be below -10% to confirm rich condition",
      "Perform injector balance test with scan tool if available",
      "Check for fuel-fouled spark plugs (black, wet deposits)",
      "With key on engine off, check fuel pressure bleed-down (leaking injector will cause rapid drop)",
      "Inspect injector O-rings for damage causing external leaks",
      "If one cylinder consistently runs rich, swap injectors to confirm"
    ],
    common_misdiagnosis: "Replacing O2 sensors when injectors are the root cause",
    source: "identifix"
  },
  {
    dtc_code: "P0172",
    dtc_description: "System Too Rich (Bank 1)",
    cause: "Contaminated or faulty MAF sensor over-reporting airflow",
    cause_category: "fuel",
    confidence_base: 0.40,
    success_rate: 0.25,
    parts_needed: ["MAF sensor"],
    labor_category: "basic",
    labor_hours_estimate: 0.5,
    diagnostic_steps: [
      "Check MAF readings at idle and compare to specifications",
      "If MAF reads higher than expected, PCM adds more fuel than needed",
      "Inspect MAF element for contamination from oiled aftermarket air filter",
      "Try cleaning MAF with dedicated cleaner",
      "Verify air filter is correct type and properly installed"
    ],
    common_misdiagnosis: null,
    source: "community"
  },
  {
    dtc_code: "P0172",
    dtc_description: "System Too Rich (Bank 1)",
    cause: "High fuel pressure from faulty fuel pressure regulator",
    cause_category: "fuel",
    confidence_base: 0.30,
    success_rate: 0.18,
    parts_needed: ["fuel pressure regulator"],
    labor_category: "intermediate",
    labor_hours_estimate: 1.0,
    diagnostic_steps: [
      "Connect fuel pressure gauge — compare reading to specification",
      "If fuel pressure is 10+ PSI over spec, regulator is likely faulty",
      "On vacuum-referenced regulators, disconnect vacuum line and check for fuel in line (indicates ruptured diaphragm)",
      "Replace regulator if pressure is too high or diaphragm is leaking"
    ],
    common_misdiagnosis: null,
    source: "community"
  },
  {
    dtc_code: "P0172",
    dtc_description: "System Too Rich (Bank 1)",
    cause: "Faulty upstream O2 sensor reporting false lean causing PCM to over-fuel",
    cause_category: "fuel",
    confidence_base: 0.25,
    success_rate: 0.12,
    parts_needed: ["upstream O2 sensor"],
    labor_category: "basic",
    labor_hours_estimate: 0.5,
    diagnostic_steps: [
      "Monitor upstream O2 sensor waveform",
      "Sensor stuck lean (low voltage) will cause PCM to add fuel",
      "Check O2 sensor response time — should switch within 100ms",
      "Compare with known-good sensor data",
      "Replace if sensor is biased lean or slow to respond"
    ],
    common_misdiagnosis: "Replacing downstream sensor instead of upstream",
    source: "community"
  },

  // =========================================================================
  // P0174 — System Too Lean (Bank 2)
  // =========================================================================
  {
    dtc_code: "P0174",
    dtc_description: "System Too Lean (Bank 2)",
    cause: "Vacuum leak on bank 2 intake runner or manifold gasket",
    cause_category: "fuel",
    confidence_base: 0.60,
    success_rate: 0.50,
    parts_needed: ["intake manifold gasket", "vacuum hoses"],
    labor_category: "intermediate",
    labor_hours_estimate: 2.0,
    diagnostic_steps: [
      "Compare bank 1 and bank 2 LTFT — if bank 2 is significantly higher, leak is bank-specific",
      "Spray carb cleaner around bank 2 intake runners",
      "Check for cracked or deteriorated vacuum lines on bank 2 side",
      "Use smoke machine focusing on bank 2 intake area",
      "On V-engines, check valley gasket or intake manifold gasket at bank 2"
    ],
    common_misdiagnosis: "Treating both banks when only bank 2 has the leak",
    source: "identifix"
  },
  {
    dtc_code: "P0174",
    dtc_description: "System Too Lean (Bank 2)",
    cause: "Dirty MAF sensor (affects both banks but bank 2 more sensitive on some engines)",
    cause_category: "fuel",
    confidence_base: 0.40,
    success_rate: 0.25,
    parts_needed: ["MAF sensor cleaner", "MAF sensor"],
    labor_category: "basic",
    labor_hours_estimate: 0.5,
    diagnostic_steps: [
      "Check if P0171 is also present — if both banks lean, issue is upstream of intake split",
      "Clean MAF sensor element with dedicated cleaner",
      "Inspect intake ducting between air filter and throttle body",
      "If cleaning does not resolve, replace MAF sensor"
    ],
    common_misdiagnosis: null,
    source: "community"
  },
  {
    dtc_code: "P0174",
    dtc_description: "System Too Lean (Bank 2)",
    cause: "Low fuel pressure affecting all cylinders",
    cause_category: "fuel",
    confidence_base: 0.30,
    success_rate: 0.15,
    parts_needed: ["fuel pump", "fuel filter"],
    labor_category: "intermediate",
    labor_hours_estimate: 2.0,
    diagnostic_steps: [
      "Test fuel pressure at rail — compare to specification",
      "Monitor pressure under load",
      "If both banks are lean, fuel delivery issue is more likely than vacuum leak",
      "Check fuel filter and pump operation"
    ],
    common_misdiagnosis: null,
    source: "community"
  },

  // =========================================================================
  // P0175 — System Too Rich (Bank 2)
  // =========================================================================
  {
    dtc_code: "P0175",
    dtc_description: "System Too Rich (Bank 2)",
    cause: "Leaking fuel injector(s) on bank 2",
    cause_category: "fuel",
    confidence_base: 0.55,
    success_rate: 0.40,
    parts_needed: ["fuel injectors bank 2", "injector O-rings"],
    labor_category: "intermediate",
    labor_hours_estimate: 2.5,
    diagnostic_steps: [
      "Compare LTFT for both banks — if only bank 2 is rich, injector issue is bank-specific",
      "Perform injector balance test on bank 2 cylinders",
      "Check spark plugs on bank 2 for fuel fouling",
      "Check fuel pressure bleed-down with key on engine off"
    ],
    common_misdiagnosis: null,
    source: "identifix"
  },
  {
    dtc_code: "P0175",
    dtc_description: "System Too Rich (Bank 2)",
    cause: "Faulty upstream O2 sensor bank 2 biased lean",
    cause_category: "fuel",
    confidence_base: 0.35,
    success_rate: 0.20,
    parts_needed: ["upstream O2 sensor bank 2"],
    labor_category: "basic",
    labor_hours_estimate: 0.7,
    diagnostic_steps: [
      "Monitor bank 2 sensor 1 waveform with scan tool",
      "If sensor is stuck lean or slow to switch to rich, PCM over-fuels",
      "Check response time and amplitude of switching",
      "Replace if degraded"
    ],
    common_misdiagnosis: null,
    source: "community"
  },

  // =========================================================================
  // P0300 — Random/Multiple Cylinder Misfire
  // =========================================================================
  {
    dtc_code: "P0300",
    dtc_description: "Random/Multiple Cylinder Misfire Detected",
    cause: "Worn or fouled spark plugs",
    cause_category: "ignition",
    confidence_base: 0.55,
    success_rate: 0.45,
    parts_needed: ["spark plugs (full set)"],
    labor_category: "basic",
    labor_hours_estimate: 1.0,
    diagnostic_steps: [
      "Check misfire counters for all cylinders with scan tool",
      "Remove and inspect spark plugs — check gap, electrode wear, fouling",
      "If plugs are worn past service interval, replace full set",
      "Use OEM-specified plug type and gap",
      "Check for oil contamination on plugs (valve cover gasket leak)"
    ],
    common_misdiagnosis: "Replacing ignition coils when plugs are the issue",
    source: "community"
  },
  {
    dtc_code: "P0300",
    dtc_description: "Random/Multiple Cylinder Misfire Detected",
    cause: "Vacuum leak causing lean misfire across multiple cylinders",
    cause_category: "fuel",
    confidence_base: 0.40,
    success_rate: 0.25,
    parts_needed: ["intake manifold gasket", "vacuum hoses"],
    labor_category: "intermediate",
    labor_hours_estimate: 1.5,
    diagnostic_steps: [
      "Check fuel trim data — lean condition suggests vacuum leak",
      "Random misfire across multiple cylinders often points to a common cause",
      "Smoke test intake system for leaks",
      "Check intake manifold gaskets, throttle body gasket, and all vacuum connections",
      "Inspect PCV system and brake booster hose"
    ],
    common_misdiagnosis: "Replacing ignition components when intake leak is the cause",
    source: "identifix"
  },
  {
    dtc_code: "P0300",
    dtc_description: "Random/Multiple Cylinder Misfire Detected",
    cause: "Low fuel pressure — fuel pump or filter restriction",
    cause_category: "fuel",
    confidence_base: 0.25,
    success_rate: 0.15,
    parts_needed: ["fuel pump", "fuel filter"],
    labor_category: "intermediate",
    labor_hours_estimate: 2.0,
    diagnostic_steps: [
      "Connect fuel pressure gauge — monitor pressure at idle and under load",
      "If pressure drops during acceleration, pump may be weak",
      "Check for fuel filter restriction if accessible",
      "Misfire under load is a classic low fuel pressure symptom"
    ],
    common_misdiagnosis: null,
    source: "community"
  },
  {
    dtc_code: "P0300",
    dtc_description: "Random/Multiple Cylinder Misfire Detected",
    cause: "Compression loss — head gasket, valve, or piston ring issues",
    cause_category: "engine",
    confidence_base: 0.15,
    success_rate: 0.10,
    parts_needed: ["head gasket", "valve job", "piston rings"],
    labor_category: "advanced",
    labor_hours_estimate: 12.0,
    diagnostic_steps: [
      "Perform compression test on all cylinders",
      "Look for cylinders below 100 PSI or more than 20% variation between cylinders",
      "If low compression found, perform leak-down test to determine if valves, rings, or head gasket",
      "Check coolant for combustion gases with block test",
      "Inspect for white exhaust smoke or coolant consumption"
    ],
    common_misdiagnosis: "Spending time on ignition and fuel when internal engine damage is present",
    source: "community"
  },

  // =========================================================================
  // P0301–P0305 — Individual Cylinder Misfires
  // =========================================================================
  ...[1, 2, 3, 4, 5].map((cyl) => ([
    {
      dtc_code: `P030${cyl}`,
      dtc_description: `Cylinder ${cyl} Misfire Detected`,
      cause: `Ignition coil failure on cylinder ${cyl}`,
      cause_category: "ignition",
      confidence_base: 0.55,
      success_rate: 0.50,
      parts_needed: [`ignition coil cylinder ${cyl}`],
      labor_category: "basic",
      labor_hours_estimate: 0.5,
      diagnostic_steps: [
        `Confirm misfire is isolated to cylinder ${cyl} using scan tool misfire counters`,
        `Swap ignition coil from cylinder ${cyl} to a known-good cylinder`,
        "If misfire moves with the coil, coil is faulty — replace it",
        "Check coil connector for corrosion or damage",
        "Inspect coil boot for carbon tracking or tears"
      ],
      common_misdiagnosis: "Replacing spark plug when coil is the issue, or vice versa",
      source: "community"
    },
    {
      dtc_code: `P030${cyl}`,
      dtc_description: `Cylinder ${cyl} Misfire Detected`,
      cause: `Worn or fouled spark plug on cylinder ${cyl}`,
      cause_category: "ignition",
      confidence_base: 0.50,
      success_rate: 0.45,
      parts_needed: [`spark plug cylinder ${cyl}`],
      labor_category: "basic",
      labor_hours_estimate: 0.3,
      diagnostic_steps: [
        `Remove spark plug from cylinder ${cyl} and inspect`,
        "Check electrode wear, gap, and fouling condition",
        "Oil-fouled plug indicates valve seal or ring issue",
        "Carbon-fouled plug indicates rich condition",
        "Replace with OEM-specified plug type and gap"
      ],
      common_misdiagnosis: null,
      source: "community"
    },
    {
      dtc_code: `P030${cyl}`,
      dtc_description: `Cylinder ${cyl} Misfire Detected`,
      cause: `Fuel injector failure or clog on cylinder ${cyl}`,
      cause_category: "fuel",
      confidence_base: 0.30,
      success_rate: 0.20,
      parts_needed: [`fuel injector cylinder ${cyl}`],
      labor_category: "intermediate",
      labor_hours_estimate: 1.0,
      diagnostic_steps: [
        "Perform injector balance test or use noid light to verify injector pulse",
        `Swap injector from cylinder ${cyl} to a known-good cylinder`,
        "If misfire follows injector, replace it",
        "Check injector connector and wiring for damage",
        "Consider professional injector cleaning before replacement"
      ],
      common_misdiagnosis: "Replacing injector when coil or plug is the actual failure",
      source: "community"
    },
    {
      dtc_code: `P030${cyl}`,
      dtc_description: `Cylinder ${cyl} Misfire Detected`,
      cause: `Low compression on cylinder ${cyl} — valve or ring failure`,
      cause_category: "engine",
      confidence_base: 0.15,
      success_rate: 0.08,
      parts_needed: ["valves", "valve seals", "piston rings", "head gasket"],
      labor_category: "advanced",
      labor_hours_estimate: 10.0,
      diagnostic_steps: [
        `Perform compression test on cylinder ${cyl}`,
        "Compare to adjacent cylinders — more than 20% difference indicates problem",
        "If low, perform leak-down test to isolate valves vs rings vs head gasket",
        "Air escaping from oil filler = rings; from exhaust = exhaust valve; from intake = intake valve",
        "Air bubbles in coolant = head gasket"
      ],
      common_misdiagnosis: "Spending money on ignition parts when engine has internal mechanical damage",
      source: "community"
    }
  ])).flat(),

  // =========================================================================
  // P0128 — Coolant Thermostat Below Regulating Temperature
  // =========================================================================
  {
    dtc_code: "P0128",
    dtc_description: "Coolant Thermostat (Coolant Temperature Below Thermostat Regulating Temperature)",
    cause: "Thermostat stuck open — coolant never reaches operating temperature",
    cause_category: "cooling",
    confidence_base: 0.80,
    success_rate: 0.75,
    parts_needed: ["thermostat", "thermostat gasket", "coolant"],
    labor_category: "intermediate",
    labor_hours_estimate: 1.5,
    diagnostic_steps: [
      "Monitor ECT with scan tool during warm-up",
      "ECT should reach 195-220F within 10-15 minutes of driving",
      "If ECT plateaus below 185F, thermostat is stuck open",
      "Check upper radiator hose temperature — should be cool until thermostat opens",
      "If hose gets warm immediately, thermostat is not closing properly",
      "Replace thermostat — always use OEM-temperature-rated replacement"
    ],
    common_misdiagnosis: "Replacing ECT sensor when thermostat is the actual problem",
    source: "identifix"
  },
  {
    dtc_code: "P0128",
    dtc_description: "Coolant Thermostat (Coolant Temperature Below Thermostat Regulating Temperature)",
    cause: "Faulty ECT sensor giving incorrect temperature reading",
    cause_category: "cooling",
    confidence_base: 0.30,
    success_rate: 0.15,
    parts_needed: ["ECT sensor"],
    labor_category: "basic",
    labor_hours_estimate: 0.5,
    diagnostic_steps: [
      "Compare ECT scan tool reading with infrared thermometer reading on thermostat housing",
      "If readings differ by more than 10F, sensor may be faulty",
      "Check sensor resistance against temperature spec chart",
      "Inspect sensor connector for corrosion",
      "Replace sensor if readings are inaccurate"
    ],
    common_misdiagnosis: "Replacing thermostat when ECT sensor is reading low",
    source: "community"
  },
  {
    dtc_code: "P0128",
    dtc_description: "Coolant Thermostat (Coolant Temperature Below Thermostat Regulating Temperature)",
    cause: "Low coolant level preventing proper temperature regulation",
    cause_category: "cooling",
    confidence_base: 0.15,
    success_rate: 0.10,
    parts_needed: ["coolant"],
    labor_category: "basic",
    labor_hours_estimate: 0.3,
    diagnostic_steps: [
      "Check coolant level in reservoir and radiator (when cold)",
      "Low coolant can prevent ECT sensor from being submerged properly",
      "If low, check for leaks — pressure test cooling system",
      "Top off coolant with correct spec fluid and bleed air from system"
    ],
    common_misdiagnosis: null,
    source: "community"
  },

  // =========================================================================
  // P0131 — O2 Sensor Low Voltage (B1S1)
  // =========================================================================
  {
    dtc_code: "P0131",
    dtc_description: "O2 Sensor Circuit Low Voltage (Bank 1, Sensor 1)",
    cause: "Failed upstream O2 sensor — internal open circuit or contamination",
    cause_category: "emissions",
    confidence_base: 0.60,
    success_rate: 0.50,
    parts_needed: ["upstream O2 sensor bank 1"],
    labor_category: "basic",
    labor_hours_estimate: 0.5,
    diagnostic_steps: [
      "Monitor O2 sensor voltage with scan tool — should oscillate 0.1-0.9V",
      "If voltage stays below 0.2V, sensor may be stuck lean or have open circuit",
      "Check sensor heater circuit operation (related P0135)",
      "Inspect wiring and connector for damage or moisture",
      "Replace sensor if electrically open or contaminated"
    ],
    common_misdiagnosis: "Replacing sensor when wiring damage is the cause",
    source: "community"
  },
  {
    dtc_code: "P0131",
    dtc_description: "O2 Sensor Circuit Low Voltage (Bank 1, Sensor 1)",
    cause: "Exhaust leak before O2 sensor introducing ambient air",
    cause_category: "emissions",
    confidence_base: 0.30,
    success_rate: 0.20,
    parts_needed: ["exhaust manifold gasket"],
    labor_category: "intermediate",
    labor_hours_estimate: 1.5,
    diagnostic_steps: [
      "Listen for exhaust ticking at cold start — indicates manifold leak",
      "Inspect exhaust manifold for cracks, especially on cast iron manifolds",
      "Check exhaust manifold bolts for tightness",
      "Leak before sensor causes it to read lean due to outside air"
    ],
    common_misdiagnosis: null,
    source: "community"
  },
  {
    dtc_code: "P0131",
    dtc_description: "O2 Sensor Circuit Low Voltage (Bank 1, Sensor 1)",
    cause: "Actual lean condition — vacuum leak or low fuel pressure",
    cause_category: "fuel",
    confidence_base: 0.25,
    success_rate: 0.15,
    parts_needed: ["vacuum hoses", "intake gasket"],
    labor_category: "intermediate",
    labor_hours_estimate: 1.0,
    diagnostic_steps: [
      "Check for accompanying P0171 (lean bank 1) code",
      "If fuel trims are high, the sensor is reading correctly — fix the lean condition",
      "Smoke test intake system for vacuum leaks",
      "Check fuel pressure"
    ],
    common_misdiagnosis: "Replacing O2 sensor when the engine actually has a lean condition",
    source: "identifix"
  },

  // =========================================================================
  // P0133 — O2 Sensor Slow Response (B1S1)
  // =========================================================================
  {
    dtc_code: "P0133",
    dtc_description: "O2 Sensor Circuit Slow Response (Bank 1, Sensor 1)",
    cause: "Aged or contaminated O2 sensor with slow switching response",
    cause_category: "emissions",
    confidence_base: 0.70,
    success_rate: 0.60,
    parts_needed: ["upstream O2 sensor bank 1"],
    labor_category: "basic",
    labor_hours_estimate: 0.5,
    diagnostic_steps: [
      "Monitor O2 sensor switching rate with scan tool — should switch 6-8 times per 10 seconds",
      "If response time exceeds 100ms lean-to-rich or rich-to-lean, sensor is lazy",
      "Check sensor age — O2 sensors typically last 60,000-100,000 miles",
      "Replace with OEM-quality sensor for best PCM compatibility"
    ],
    common_misdiagnosis: null,
    source: "community"
  },
  {
    dtc_code: "P0133",
    dtc_description: "O2 Sensor Circuit Slow Response (Bank 1, Sensor 1)",
    cause: "Exhaust leak diluting exhaust gas sample",
    cause_category: "emissions",
    confidence_base: 0.20,
    success_rate: 0.12,
    parts_needed: ["exhaust manifold gasket"],
    labor_category: "intermediate",
    labor_hours_estimate: 1.5,
    diagnostic_steps: [
      "Inspect exhaust manifold for cracks and loose bolts",
      "Check downpipe connection for leaks",
      "Exhaust leak introduces ambient air that slows sensor switching",
      "Repair leak and re-test sensor response time"
    ],
    common_misdiagnosis: null,
    source: "community"
  },

  // =========================================================================
  // P0135 — O2 Sensor Heater Circuit (B1S1)
  // =========================================================================
  {
    dtc_code: "P0135",
    dtc_description: "O2 Sensor Heater Circuit Malfunction (Bank 1, Sensor 1)",
    cause: "O2 sensor internal heater element failure",
    cause_category: "electrical",
    confidence_base: 0.65,
    success_rate: 0.55,
    parts_needed: ["upstream O2 sensor bank 1"],
    labor_category: "basic",
    labor_hours_estimate: 0.5,
    diagnostic_steps: [
      "Measure heater circuit resistance at sensor connector — typically 5-15 ohms",
      "If open (infinite resistance), heater element is burned out",
      "Check for 12V power supply at heater circuit connector with key on",
      "Verify ground circuit continuity to PCM",
      "Replace sensor if heater is open circuit"
    ],
    common_misdiagnosis: "Replacing sensor when the fuse or wiring is the issue",
    source: "community"
  },
  {
    dtc_code: "P0135",
    dtc_description: "O2 Sensor Heater Circuit Malfunction (Bank 1, Sensor 1)",
    cause: "Blown O2 sensor heater fuse or relay failure",
    cause_category: "electrical",
    confidence_base: 0.30,
    success_rate: 0.20,
    parts_needed: ["fuse", "relay"],
    labor_category: "basic",
    labor_hours_estimate: 0.3,
    diagnostic_steps: [
      "Check O2 sensor heater fuse in fuse box — consult vehicle fuse diagram",
      "If fuse is blown, check for short circuit in wiring before replacing",
      "Check heater relay if applicable",
      "Multiple O2 heater codes may share the same fuse/circuit"
    ],
    common_misdiagnosis: null,
    source: "community"
  },

  // =========================================================================
  // P0137 — O2 Sensor Low Voltage (B1S2)
  // =========================================================================
  {
    dtc_code: "P0137",
    dtc_description: "O2 Sensor Circuit Low Voltage (Bank 1, Sensor 2)",
    cause: "Failed downstream O2 sensor",
    cause_category: "emissions",
    confidence_base: 0.60,
    success_rate: 0.50,
    parts_needed: ["downstream O2 sensor bank 1"],
    labor_category: "basic",
    labor_hours_estimate: 0.5,
    diagnostic_steps: [
      "Monitor downstream O2 voltage — at steady cruise should read 0.5-0.8V",
      "If stuck low (below 0.2V), sensor may be failed or have wiring issue",
      "Check sensor connector and wiring for damage",
      "Measure sensor resistance if accessible"
    ],
    common_misdiagnosis: null,
    source: "community"
  },
  {
    dtc_code: "P0137",
    dtc_description: "O2 Sensor Circuit Low Voltage (Bank 1, Sensor 2)",
    cause: "Exhaust leak between catalytic converter and downstream sensor",
    cause_category: "emissions",
    confidence_base: 0.25,
    success_rate: 0.15,
    parts_needed: ["exhaust gasket"],
    labor_category: "intermediate",
    labor_hours_estimate: 1.0,
    diagnostic_steps: [
      "Inspect exhaust pipe connections near downstream sensor",
      "Check for rust-through or cracked welds",
      "Leak after cat but before sensor can skew readings lean"
    ],
    common_misdiagnosis: null,
    source: "community"
  },

  // =========================================================================
  // P0141 — O2 Sensor Heater Circuit (B1S2)
  // =========================================================================
  {
    dtc_code: "P0141",
    dtc_description: "O2 Sensor Heater Circuit Malfunction (Bank 1, Sensor 2)",
    cause: "Downstream O2 sensor heater element failure",
    cause_category: "electrical",
    confidence_base: 0.65,
    success_rate: 0.55,
    parts_needed: ["downstream O2 sensor bank 1"],
    labor_category: "basic",
    labor_hours_estimate: 0.5,
    diagnostic_steps: [
      "Measure heater resistance at sensor connector (5-15 ohms typical)",
      "If open circuit, heater is burned out — replace sensor",
      "Check for 12V power and ground at connector",
      "Verify fuse is intact"
    ],
    common_misdiagnosis: null,
    source: "community"
  },
  {
    dtc_code: "P0141",
    dtc_description: "O2 Sensor Heater Circuit Malfunction (Bank 1, Sensor 2)",
    cause: "Wiring or connector damage to downstream O2 sensor heater circuit",
    cause_category: "electrical",
    confidence_base: 0.25,
    success_rate: 0.15,
    parts_needed: ["wiring repair", "connector"],
    labor_category: "intermediate",
    labor_hours_estimate: 1.0,
    diagnostic_steps: [
      "Inspect wiring from O2 sensor to PCM for chafing, melting, or rodent damage",
      "Check connector pins for corrosion or spread terminals",
      "Downstream sensor wiring is exposed to road debris and heat",
      "Repair wiring and retest before replacing sensor"
    ],
    common_misdiagnosis: "Replacing sensor when corroded connector is the actual problem",
    source: "community"
  },

  // =========================================================================
  // P0325 — Knock Sensor 1 Circuit (Bank 1)
  // =========================================================================
  {
    dtc_code: "P0325",
    dtc_description: "Knock Sensor 1 Circuit Malfunction (Bank 1)",
    cause: "Failed knock sensor — internal piezoelectric element degradation",
    cause_category: "engine",
    confidence_base: 0.55,
    success_rate: 0.45,
    parts_needed: ["knock sensor", "knock sensor gasket"],
    labor_category: "intermediate",
    labor_hours_estimate: 2.0,
    diagnostic_steps: [
      "Check knock sensor resistance — varies by manufacturer but typically 100K-500K ohms",
      "Verify sensor produces voltage when engine block is tapped near sensor",
      "Inspect sensor for physical damage or corrosion",
      "Must be torqued to exact specification — improper torque causes false readings"
    ],
    common_misdiagnosis: "Over-torquing replacement sensor causing immediate return of code",
    source: "identifix"
  },
  {
    dtc_code: "P0325",
    dtc_description: "Knock Sensor 1 Circuit Malfunction (Bank 1)",
    cause: "Wiring harness damage between knock sensor and PCM",
    cause_category: "electrical",
    confidence_base: 0.35,
    success_rate: 0.25,
    parts_needed: ["wiring harness repair"],
    labor_category: "intermediate",
    labor_hours_estimate: 1.5,
    diagnostic_steps: [
      "Knock sensor is often buried under intake manifold — wiring is vulnerable",
      "Check wiring continuity from sensor connector to PCM",
      "Look for chafed, melted, or corroded wiring",
      "Repair or replace damaged wiring section"
    ],
    common_misdiagnosis: "Replacing sensor when wiring is damaged under the intake manifold",
    source: "community"
  },

  // =========================================================================
  // P0335 — Crankshaft Position Sensor A Circuit
  // =========================================================================
  {
    dtc_code: "P0335",
    dtc_description: "Crankshaft Position Sensor A Circuit Malfunction",
    cause: "Failed crankshaft position sensor",
    cause_category: "ignition",
    confidence_base: 0.65,
    success_rate: 0.55,
    parts_needed: ["crankshaft position sensor", "sensor O-ring"],
    labor_category: "intermediate",
    labor_hours_estimate: 1.0,
    diagnostic_steps: [
      "Engine may crank but not start, or stall intermittently",
      "Check for CKP signal with scan tool while cranking",
      "Measure sensor resistance — compare to specification (typically 200-2000 ohms)",
      "Check air gap between sensor and reluctor ring",
      "Inspect sensor tip for metal debris contamination",
      "Check sensor connector for corrosion"
    ],
    common_misdiagnosis: "Diagnosing as fuel pump issue when engine cranks but has no spark/injection due to no CKP signal",
    source: "identifix"
  },
  {
    dtc_code: "P0335",
    dtc_description: "Crankshaft Position Sensor A Circuit Malfunction",
    cause: "Damaged reluctor ring (tone ring) on crankshaft",
    cause_category: "engine",
    confidence_base: 0.20,
    success_rate: 0.12,
    parts_needed: ["reluctor ring", "harmonic balancer"],
    labor_category: "advanced",
    labor_hours_estimate: 3.0,
    diagnostic_steps: [
      "If new sensor still produces erratic signal, inspect reluctor ring",
      "Remove timing cover or use borescope to check for missing or damaged teeth",
      "On some engines, reluctor is part of harmonic balancer — check for separation",
      "Damaged ring produces erratic or no signal"
    ],
    common_misdiagnosis: null,
    source: "community"
  },
  {
    dtc_code: "P0335",
    dtc_description: "Crankshaft Position Sensor A Circuit Malfunction",
    cause: "Wiring or connector issue in CKP circuit",
    cause_category: "electrical",
    confidence_base: 0.25,
    success_rate: 0.18,
    parts_needed: ["wiring repair", "connector"],
    labor_category: "intermediate",
    labor_hours_estimate: 1.0,
    diagnostic_steps: [
      "Check wiring from sensor to PCM for breaks, chafing, or shorts",
      "CKP sensor wiring near engine block is exposed to heat and vibration",
      "Wiggle test wiring while monitoring signal on scan tool",
      "Check connector pins for spread, corrosion, or oil contamination"
    ],
    common_misdiagnosis: null,
    source: "community"
  },

  // =========================================================================
  // P0340 — Camshaft Position Sensor Circuit (Bank 1)
  // =========================================================================
  {
    dtc_code: "P0340",
    dtc_description: "Camshaft Position Sensor Circuit Malfunction (Bank 1)",
    cause: "Failed camshaft position sensor",
    cause_category: "ignition",
    confidence_base: 0.60,
    success_rate: 0.50,
    parts_needed: ["camshaft position sensor", "sensor O-ring"],
    labor_category: "basic",
    labor_hours_estimate: 0.5,
    diagnostic_steps: [
      "Check for CMP signal with scan tool while cranking",
      "Measure sensor resistance — compare to specification",
      "Engine may start and run but with reduced performance (PCM falls back to batch fire injection)",
      "Inspect sensor for contamination with oil or metallic debris",
      "Check air gap if adjustable"
    ],
    common_misdiagnosis: null,
    source: "community"
  },
  {
    dtc_code: "P0340",
    dtc_description: "Camshaft Position Sensor Circuit Malfunction (Bank 1)",
    cause: "Timing chain/belt stretch causing CMP/CKP correlation error",
    cause_category: "engine",
    confidence_base: 0.25,
    success_rate: 0.15,
    parts_needed: ["timing chain kit", "timing belt kit"],
    labor_category: "advanced",
    labor_hours_estimate: 6.0,
    diagnostic_steps: [
      "Check CMP/CKP correlation with oscilloscope if available",
      "On interference engines, timing chain/belt stretch causes correlation codes",
      "Listen for timing chain rattle on startup (especially with VVT engines)",
      "If chain has stretched, CMP signal arrives at wrong time relative to CKP",
      "Check timing marks if accessible"
    ],
    common_misdiagnosis: "Replacing CMP sensor when timing chain is stretched",
    source: "identifix"
  },
  {
    dtc_code: "P0340",
    dtc_description: "Camshaft Position Sensor Circuit Malfunction (Bank 1)",
    cause: "Wiring or connector failure in CMP circuit",
    cause_category: "electrical",
    confidence_base: 0.20,
    success_rate: 0.12,
    parts_needed: ["wiring repair", "connector"],
    labor_category: "intermediate",
    labor_hours_estimate: 1.0,
    diagnostic_steps: [
      "Inspect wiring from CMP sensor to PCM",
      "Check for oil contamination at connector (common with valve cover-mounted sensors)",
      "Check connector pins for corrosion or spread terminals",
      "Wiggle test wiring while monitoring CMP signal"
    ],
    common_misdiagnosis: null,
    source: "community"
  },

  // =========================================================================
  // P0341 — Camshaft Position Sensor Range/Performance (Bank 1)
  // =========================================================================
  {
    dtc_code: "P0341",
    dtc_description: "Camshaft Position Sensor Circuit Range/Performance (Bank 1)",
    cause: "Timing chain stretch causing CMP/CKP signal correlation out of range",
    cause_category: "engine",
    confidence_base: 0.50,
    success_rate: 0.35,
    parts_needed: ["timing chain kit", "chain tensioner", "guides"],
    labor_category: "advanced",
    labor_hours_estimate: 6.0,
    diagnostic_steps: [
      "Compare CMP to CKP signal timing with scan tool or scope",
      "Check timing chain tensioner for proper operation",
      "Listen for chain rattle on cold start",
      "On VVT engines, check VVT solenoid and oil passages",
      "Verify oil level and quality — sludge can affect chain tensioner"
    ],
    common_misdiagnosis: "Replacing CMP sensor when timing chain is stretched",
    source: "identifix"
  },
  {
    dtc_code: "P0341",
    dtc_description: "Camshaft Position Sensor Circuit Range/Performance (Bank 1)",
    cause: "Faulty CMP sensor producing erratic or weak signal",
    cause_category: "ignition",
    confidence_base: 0.35,
    success_rate: 0.28,
    parts_needed: ["camshaft position sensor"],
    labor_category: "basic",
    labor_hours_estimate: 0.5,
    diagnostic_steps: [
      "Monitor CMP signal amplitude with oscilloscope",
      "Weak or erratic signal indicates degraded sensor",
      "Check sensor air gap — excessive gap reduces signal strength",
      "Replace sensor and retest"
    ],
    common_misdiagnosis: null,
    source: "community"
  },

  // =========================================================================
  // P0401 — EGR Flow Insufficient
  // =========================================================================
  {
    dtc_code: "P0401",
    dtc_description: "Exhaust Gas Recirculation Flow Insufficient Detected",
    cause: "Carbon buildup clogging EGR passages in intake manifold",
    cause_category: "emissions",
    confidence_base: 0.60,
    success_rate: 0.50,
    parts_needed: ["EGR gasket", "intake manifold cleaning"],
    labor_category: "intermediate",
    labor_hours_estimate: 2.0,
    diagnostic_steps: [
      "Remove EGR valve and inspect passages for carbon buildup",
      "Check EGR pipe/tube for blockage",
      "Clean or ream out carbon deposits from intake manifold EGR ports",
      "On Ford vehicles, check DPFE sensor and hoses",
      "Reinstall with new gasket and verify flow"
    ],
    common_misdiagnosis: "Replacing EGR valve when passages are clogged",
    source: "identifix"
  },
  {
    dtc_code: "P0401",
    dtc_description: "Exhaust Gas Recirculation Flow Insufficient Detected",
    cause: "EGR valve stuck closed or not opening fully",
    cause_category: "emissions",
    confidence_base: 0.40,
    success_rate: 0.30,
    parts_needed: ["EGR valve"],
    labor_category: "intermediate",
    labor_hours_estimate: 1.0,
    diagnostic_steps: [
      "Command EGR valve open with scan tool — engine should stumble/stall",
      "If no change in idle, EGR is not flowing",
      "Remove and inspect valve diaphragm or electronic actuator",
      "Check for carbon deposits on valve pintle preventing full opening",
      "Replace if valve does not respond to commands"
    ],
    common_misdiagnosis: null,
    source: "community"
  },
  {
    dtc_code: "P0401",
    dtc_description: "Exhaust Gas Recirculation Flow Insufficient Detected",
    cause: "Faulty DPFE sensor (Ford) or EGR position sensor giving false readings",
    cause_category: "emissions",
    confidence_base: 0.30,
    success_rate: 0.20,
    parts_needed: ["DPFE sensor", "EGR position sensor"],
    labor_category: "basic",
    labor_hours_estimate: 0.5,
    diagnostic_steps: [
      "On Ford vehicles, DPFE sensor is the most common cause",
      "Check DPFE sensor voltage — should be 0.4-0.6V at idle with EGR closed",
      "Command EGR open and watch DPFE voltage change",
      "If voltage does not change or is out of range, replace DPFE sensor",
      "Check DPFE hoses for cracking or disconnection"
    ],
    common_misdiagnosis: null,
    source: "oem_tsb"
  },

  // =========================================================================
  // P0411 — Secondary Air Injection Incorrect Flow
  // =========================================================================
  {
    dtc_code: "P0411",
    dtc_description: "Secondary Air Injection System Incorrect Flow Detected",
    cause: "AIR pump failure — not producing sufficient airflow",
    cause_category: "emissions",
    confidence_base: 0.50,
    success_rate: 0.40,
    parts_needed: ["secondary air pump"],
    labor_category: "intermediate",
    labor_hours_estimate: 1.5,
    diagnostic_steps: [
      "Listen for AIR pump operation on cold start — should run for 30-120 seconds",
      "If pump does not activate or sounds weak/noisy, check pump motor",
      "Verify pump relay and fuse",
      "Check pump electrical connector and ground",
      "Some pumps fail due to moisture ingestion"
    ],
    common_misdiagnosis: null,
    source: "community"
  },
  {
    dtc_code: "P0411",
    dtc_description: "Secondary Air Injection System Incorrect Flow Detected",
    cause: "Check valve stuck closed or one-way valve failed",
    cause_category: "emissions",
    confidence_base: 0.35,
    success_rate: 0.25,
    parts_needed: ["secondary air check valve"],
    labor_category: "intermediate",
    labor_hours_estimate: 1.0,
    diagnostic_steps: [
      "Check valve prevents exhaust from flowing back into AIR pump",
      "If stuck closed, air cannot reach exhaust manifold",
      "Remove and inspect — should flow air in one direction only",
      "Check for rust, carbon buildup, or moisture damage"
    ],
    common_misdiagnosis: null,
    source: "community"
  },

  // =========================================================================
  // P0440 — EVAP System Malfunction
  // =========================================================================
  {
    dtc_code: "P0440",
    dtc_description: "Evaporative Emission Control System Malfunction",
    cause: "Loose, damaged, or missing gas cap",
    cause_category: "emissions",
    confidence_base: 0.50,
    success_rate: 0.40,
    parts_needed: ["gas cap"],
    labor_category: "basic",
    labor_hours_estimate: 0.1,
    diagnostic_steps: [
      "Check gas cap for cracks, damage, or worn seal",
      "Verify cap clicks when tightened",
      "Replace cap if seal is cracked or deformed",
      "Clear code and drive through EVAP monitor drive cycle"
    ],
    common_misdiagnosis: null,
    source: "community"
  },
  {
    dtc_code: "P0440",
    dtc_description: "Evaporative Emission Control System Malfunction",
    cause: "Purge valve (solenoid) stuck open or closed",
    cause_category: "emissions",
    confidence_base: 0.30,
    success_rate: 0.20,
    parts_needed: ["EVAP purge solenoid"],
    labor_category: "basic",
    labor_hours_estimate: 0.5,
    diagnostic_steps: [
      "Apply vacuum to purge valve — should hold vacuum when de-energized",
      "Energize purge valve — vacuum should release",
      "Check valve operation with scan tool active test if available",
      "If valve leaks or does not actuate, replace it"
    ],
    common_misdiagnosis: null,
    source: "community"
  },

  // =========================================================================
  // P0441 — EVAP Incorrect Purge Flow
  // =========================================================================
  {
    dtc_code: "P0441",
    dtc_description: "Evaporative Emission Control System Incorrect Purge Flow",
    cause: "Faulty EVAP purge valve not flowing correctly",
    cause_category: "emissions",
    confidence_base: 0.55,
    success_rate: 0.45,
    parts_needed: ["EVAP purge solenoid"],
    labor_category: "basic",
    labor_hours_estimate: 0.5,
    diagnostic_steps: [
      "Command purge valve open with scan tool — monitor fuel trims",
      "Opening purge valve should cause a temporary lean shift in fuel trims",
      "If no change, purge valve is stuck closed or line is blocked",
      "Apply vacuum to valve and verify it holds/releases properly"
    ],
    common_misdiagnosis: null,
    source: "community"
  },
  {
    dtc_code: "P0441",
    dtc_description: "Evaporative Emission Control System Incorrect Purge Flow",
    cause: "Blocked or kinked EVAP purge line",
    cause_category: "emissions",
    confidence_base: 0.25,
    success_rate: 0.18,
    parts_needed: ["EVAP hose"],
    labor_category: "basic",
    labor_hours_estimate: 0.5,
    diagnostic_steps: [
      "Trace EVAP purge line from valve to intake manifold",
      "Check for kinks, collapse, or disconnection",
      "Blow through line with compressed air to check for blockage",
      "Replace damaged hose sections"
    ],
    common_misdiagnosis: null,
    source: "community"
  },

  // =========================================================================
  // P0442 — EVAP Small Leak
  // =========================================================================
  {
    dtc_code: "P0442",
    dtc_description: "Evaporative Emission Control System Leak Detected (Small Leak)",
    cause: "Deteriorated gas cap seal allowing small evaporative leak",
    cause_category: "emissions",
    confidence_base: 0.45,
    success_rate: 0.35,
    parts_needed: ["gas cap"],
    labor_category: "basic",
    labor_hours_estimate: 0.1,
    diagnostic_steps: [
      "Inspect gas cap O-ring seal for cracking or deformation",
      "Try tightening cap until it clicks 3 times",
      "Replace cap with OEM-quality replacement",
      "Clear code and complete EVAP drive cycle"
    ],
    common_misdiagnosis: null,
    source: "community"
  },
  {
    dtc_code: "P0442",
    dtc_description: "Evaporative Emission Control System Leak Detected (Small Leak)",
    cause: "Cracked or deteriorated EVAP hose or fitting",
    cause_category: "emissions",
    confidence_base: 0.35,
    success_rate: 0.25,
    parts_needed: ["EVAP hoses", "hose clamps"],
    labor_category: "intermediate",
    labor_hours_estimate: 1.0,
    diagnostic_steps: [
      "Perform EVAP smoke test — introduce smoke into EVAP system",
      "Watch for smoke leaking from hoses, fittings, or connections",
      "Check all EVAP hose connections from tank to canister to purge valve",
      "Rubber hoses deteriorate over time especially near heat sources",
      "Replace cracked or brittle hoses"
    ],
    common_misdiagnosis: "Replacing gas cap when hose has a small crack",
    source: "identifix"
  },

  // =========================================================================
  // P0443 — EVAP Purge Control Valve Circuit
  // =========================================================================
  {
    dtc_code: "P0443",
    dtc_description: "Evaporative Emission Control System Purge Control Valve Circuit Malfunction",
    cause: "Failed purge solenoid — open or shorted coil",
    cause_category: "electrical",
    confidence_base: 0.55,
    success_rate: 0.45,
    parts_needed: ["EVAP purge solenoid"],
    labor_category: "basic",
    labor_hours_estimate: 0.5,
    diagnostic_steps: [
      "Measure purge solenoid coil resistance — typically 20-40 ohms",
      "If open (infinite) or shorted (near 0), replace solenoid",
      "Check for 12V power and PCM ground signal at connector",
      "Use scan tool to command purge valve — listen for click"
    ],
    common_misdiagnosis: null,
    source: "community"
  },
  {
    dtc_code: "P0443",
    dtc_description: "Evaporative Emission Control System Purge Control Valve Circuit Malfunction",
    cause: "Wiring fault between PCM and purge solenoid",
    cause_category: "electrical",
    confidence_base: 0.30,
    success_rate: 0.20,
    parts_needed: ["wiring repair", "connector"],
    labor_category: "intermediate",
    labor_hours_estimate: 1.0,
    diagnostic_steps: [
      "Check wiring from PCM to purge solenoid connector for continuity",
      "Look for chafed wires, corroded connectors, or rodent damage",
      "Check ground circuit",
      "Repair and retest"
    ],
    common_misdiagnosis: null,
    source: "community"
  },

  // =========================================================================
  // P0446 — EVAP Vent Control Circuit
  // =========================================================================
  {
    dtc_code: "P0446",
    dtc_description: "Evaporative Emission Control System Vent Control Circuit Malfunction",
    cause: "Failed EVAP vent solenoid",
    cause_category: "electrical",
    confidence_base: 0.55,
    success_rate: 0.45,
    parts_needed: ["EVAP vent solenoid"],
    labor_category: "basic",
    labor_hours_estimate: 0.5,
    diagnostic_steps: [
      "Locate vent solenoid — usually near charcoal canister",
      "Apply 12V to solenoid — should click and change position",
      "Measure coil resistance — compare to spec",
      "On GM vehicles, vent solenoid is often mounted on charcoal canister"
    ],
    common_misdiagnosis: null,
    source: "community"
  },
  {
    dtc_code: "P0446",
    dtc_description: "Evaporative Emission Control System Vent Control Circuit Malfunction",
    cause: "Blocked or restricted vent filter on charcoal canister",
    cause_category: "emissions",
    confidence_base: 0.30,
    success_rate: 0.20,
    parts_needed: ["charcoal canister", "vent filter"],
    labor_category: "intermediate",
    labor_hours_estimate: 1.0,
    diagnostic_steps: [
      "Inspect charcoal canister vent filter for dirt or debris blockage",
      "Spider webs, mud, or debris can block vent port",
      "Try blowing air through vent port — should flow freely",
      "If canister is saturated with fuel, it needs replacement"
    ],
    common_misdiagnosis: null,
    source: "community"
  },

  // =========================================================================
  // P0449 — EVAP Vent Valve/Solenoid Circuit
  // =========================================================================
  {
    dtc_code: "P0449",
    dtc_description: "Evaporative Emission Control System Vent Valve/Solenoid Circuit Malfunction",
    cause: "Faulty EVAP vent valve solenoid (common on GM vehicles)",
    cause_category: "electrical",
    confidence_base: 0.60,
    success_rate: 0.50,
    parts_needed: ["EVAP vent valve solenoid"],
    labor_category: "basic",
    labor_hours_estimate: 0.5,
    diagnostic_steps: [
      "Very common on GM trucks and SUVs",
      "Vent solenoid located near charcoal canister (usually rear of vehicle)",
      "Test solenoid by applying 12V — should click",
      "Check resistance — typically 20-30 ohms",
      "Replace solenoid and clear code"
    ],
    common_misdiagnosis: null,
    source: "identifix"
  },
  {
    dtc_code: "P0449",
    dtc_description: "Evaporative Emission Control System Vent Valve/Solenoid Circuit Malfunction",
    cause: "Corroded or damaged wiring to vent solenoid",
    cause_category: "electrical",
    confidence_base: 0.25,
    success_rate: 0.18,
    parts_needed: ["wiring repair", "connector"],
    labor_category: "intermediate",
    labor_hours_estimate: 1.0,
    diagnostic_steps: [
      "Vent solenoid wiring runs along frame rail — exposed to road salt and debris",
      "Check wiring for corrosion, breaks, or damaged insulation",
      "Check ground connection",
      "Repair wiring and verify solenoid operates correctly"
    ],
    common_misdiagnosis: null,
    source: "community"
  },

  // =========================================================================
  // P0455 — EVAP Gross Leak
  // =========================================================================
  {
    dtc_code: "P0455",
    dtc_description: "Evaporative Emission Control System Leak Detected (Gross Leak)",
    cause: "Gas cap left off, loose, or completely failed",
    cause_category: "emissions",
    confidence_base: 0.55,
    success_rate: 0.45,
    parts_needed: ["gas cap"],
    labor_category: "basic",
    labor_hours_estimate: 0.1,
    diagnostic_steps: [
      "Gross leak = large leak — often obvious cause",
      "Check if gas cap is present and tightened",
      "Inspect cap seal — replace if damaged",
      "If cap is fine, perform smoke test to find large leak"
    ],
    common_misdiagnosis: null,
    source: "community"
  },
  {
    dtc_code: "P0455",
    dtc_description: "Evaporative Emission Control System Leak Detected (Gross Leak)",
    cause: "Disconnected or broken EVAP hose",
    cause_category: "emissions",
    confidence_base: 0.35,
    success_rate: 0.25,
    parts_needed: ["EVAP hose"],
    labor_category: "basic",
    labor_hours_estimate: 0.5,
    diagnostic_steps: [
      "Visually inspect all EVAP hoses for disconnection",
      "Check hose connections at canister, purge valve, and fuel tank",
      "Recent underbody work or exhaust work may have dislodged a hose",
      "Perform smoke test to quickly identify large leaks"
    ],
    common_misdiagnosis: null,
    source: "community"
  },
  {
    dtc_code: "P0455",
    dtc_description: "Evaporative Emission Control System Leak Detected (Gross Leak)",
    cause: "Cracked EVAP canister or fuel filler neck",
    cause_category: "emissions",
    confidence_base: 0.20,
    success_rate: 0.12,
    parts_needed: ["EVAP charcoal canister", "fuel filler neck"],
    labor_category: "intermediate",
    labor_hours_estimate: 1.5,
    diagnostic_steps: [
      "Inspect charcoal canister for physical cracks",
      "Check fuel filler neck for rust-through or cracks (common in rust-belt vehicles)",
      "Smoke test will show leak location clearly for gross leaks",
      "Replace damaged component"
    ],
    common_misdiagnosis: null,
    source: "community"
  },

  // =========================================================================
  // P0456 — EVAP Very Small Leak
  // =========================================================================
  {
    dtc_code: "P0456",
    dtc_description: "Evaporative Emission Control System Leak Detected (Very Small Leak)",
    cause: "Gas cap seal degradation — very small leak past gasket",
    cause_category: "emissions",
    confidence_base: 0.50,
    success_rate: 0.40,
    parts_needed: ["gas cap"],
    labor_category: "basic",
    labor_hours_estimate: 0.1,
    diagnostic_steps: [
      "Very small leaks are the hardest to find in EVAP systems",
      "Start with gas cap replacement — cheapest and most common fix",
      "Clear code and drive through EVAP monitor cycle (usually requires specific temp and fuel level conditions)",
      "If code returns, proceed to smoke test"
    ],
    common_misdiagnosis: null,
    source: "community"
  },
  {
    dtc_code: "P0456",
    dtc_description: "Evaporative Emission Control System Leak Detected (Very Small Leak)",
    cause: "Hairline crack in EVAP hose or connector O-ring",
    cause_category: "emissions",
    confidence_base: 0.35,
    success_rate: 0.25,
    parts_needed: ["EVAP hoses", "O-rings"],
    labor_category: "intermediate",
    labor_hours_estimate: 1.5,
    diagnostic_steps: [
      "Perform EVAP smoke test with machine that can detect very small leaks",
      "Very small leaks may require higher smoke pressure to detect",
      "Check all O-ring connections and quick-connect fittings",
      "Pay attention to hose-to-metal connections where rubber meets metal tubing"
    ],
    common_misdiagnosis: "Spending excessive time looking for a leak that a new gas cap would fix",
    source: "identifix"
  },

  // =========================================================================
  // P0505 — Idle Control System
  // =========================================================================
  {
    dtc_code: "P0505",
    dtc_description: "Idle Control System Malfunction",
    cause: "Carbon buildup on IAC valve or throttle body idle air passages",
    cause_category: "fuel",
    confidence_base: 0.55,
    success_rate: 0.45,
    parts_needed: ["throttle body cleaner", "IAC valve gasket"],
    labor_category: "basic",
    labor_hours_estimate: 0.5,
    diagnostic_steps: [
      "Remove IAC valve and inspect for carbon buildup",
      "Clean IAC valve pintle and seat with throttle body cleaner",
      "Clean throttle body bore and idle air bypass passages",
      "On electronic throttle bodies, clean throttle plate and bore",
      "Reinstall and perform idle relearn procedure"
    ],
    common_misdiagnosis: "Replacing IAC valve when cleaning would have resolved the issue",
    source: "identifix"
  },
  {
    dtc_code: "P0505",
    dtc_description: "Idle Control System Malfunction",
    cause: "Failed IAC valve motor",
    cause_category: "fuel",
    confidence_base: 0.35,
    success_rate: 0.28,
    parts_needed: ["IAC valve"],
    labor_category: "basic",
    labor_hours_estimate: 0.5,
    diagnostic_steps: [
      "Command IAC valve open/closed with scan tool — listen for stepper motor movement",
      "Measure IAC motor resistance — compare to specification",
      "If motor does not respond to commands or has abnormal resistance, replace",
      "Perform idle relearn after replacement"
    ],
    common_misdiagnosis: null,
    source: "community"
  },
  {
    dtc_code: "P0505",
    dtc_description: "Idle Control System Malfunction",
    cause: "Vacuum leak affecting idle control",
    cause_category: "fuel",
    confidence_base: 0.25,
    success_rate: 0.15,
    parts_needed: ["vacuum hoses", "intake gasket"],
    labor_category: "intermediate",
    labor_hours_estimate: 1.0,
    diagnostic_steps: [
      "A vacuum leak adds unmetered air that the IAC cannot compensate for",
      "Check for accompanying lean codes (P0171/P0174)",
      "Smoke test intake system",
      "Fix leak and perform idle relearn"
    ],
    common_misdiagnosis: null,
    source: "community"
  },

  // =========================================================================
  // P0506 — Idle Control RPM Lower Than Expected
  // =========================================================================
  {
    dtc_code: "P0506",
    dtc_description: "Idle Control System RPM Lower Than Expected",
    cause: "Dirty throttle body restricting airflow at idle",
    cause_category: "fuel",
    confidence_base: 0.55,
    success_rate: 0.45,
    parts_needed: ["throttle body cleaner"],
    labor_category: "basic",
    labor_hours_estimate: 0.5,
    diagnostic_steps: [
      "Remove intake boot and inspect throttle plate for carbon deposits",
      "Clean throttle body bore and plate with approved cleaner",
      "On electronic throttle bodies, do not manually move throttle plate",
      "Perform throttle body/idle relearn procedure after cleaning",
      "Test drive and monitor idle RPM"
    ],
    common_misdiagnosis: null,
    source: "community"
  },
  {
    dtc_code: "P0506",
    dtc_description: "Idle Control System RPM Lower Than Expected",
    cause: "IAC valve stuck or restricted — cannot open enough for proper idle",
    cause_category: "fuel",
    confidence_base: 0.35,
    success_rate: 0.25,
    parts_needed: ["IAC valve"],
    labor_category: "basic",
    labor_hours_estimate: 0.5,
    diagnostic_steps: [
      "Check IAC valve counts with scan tool — if at maximum and idle is still low, valve may be stuck",
      "Remove and clean or replace IAC valve",
      "Perform idle relearn after service"
    ],
    common_misdiagnosis: null,
    source: "community"
  },

  // =========================================================================
  // P0507 — Idle Control RPM Higher Than Expected
  // =========================================================================
  {
    dtc_code: "P0507",
    dtc_description: "Idle Control System RPM Higher Than Expected",
    cause: "Vacuum leak allowing unmetered air past throttle plate",
    cause_category: "fuel",
    confidence_base: 0.55,
    success_rate: 0.45,
    parts_needed: ["intake gasket", "vacuum hoses", "PCV valve"],
    labor_category: "intermediate",
    labor_hours_estimate: 1.0,
    diagnostic_steps: [
      "High idle is almost always caused by air entering after the throttle plate",
      "Check for cracked or disconnected vacuum hoses",
      "Inspect intake manifold gasket, throttle body gasket",
      "Check PCV valve and hose",
      "Smoke test intake system for leaks",
      "After repair, perform idle relearn"
    ],
    common_misdiagnosis: "Replacing throttle body or IAC when a vacuum leak is the cause",
    source: "identifix"
  },
  {
    dtc_code: "P0507",
    dtc_description: "Idle Control System RPM Higher Than Expected",
    cause: "IAC valve stuck open or throttle plate stuck slightly open",
    cause_category: "fuel",
    confidence_base: 0.30,
    success_rate: 0.20,
    parts_needed: ["IAC valve", "throttle body"],
    labor_category: "basic",
    labor_hours_estimate: 0.5,
    diagnostic_steps: [
      "Check IAC valve counts — if at 0 and idle is still high, excess air is entering",
      "Inspect throttle plate for binding or deposits preventing full closure",
      "On cable-throttle vehicles, check throttle cable adjustment",
      "Clean throttle body and check IAC valve operation"
    ],
    common_misdiagnosis: null,
    source: "community"
  },

  // =========================================================================
  // P0562 — System Voltage Low
  // =========================================================================
  {
    dtc_code: "P0562",
    dtc_description: "System Voltage Low",
    cause: "Failing alternator — reduced charging output",
    cause_category: "electrical",
    confidence_base: 0.60,
    success_rate: 0.50,
    parts_needed: ["alternator", "serpentine belt"],
    labor_category: "intermediate",
    labor_hours_estimate: 1.5,
    diagnostic_steps: [
      "Check charging voltage at battery with engine running — should be 13.5-14.5V",
      "If below 13V, alternator is likely undercharging",
      "Load test alternator — voltage should stay above 13V with loads on",
      "Check serpentine belt tension and condition",
      "Inspect alternator connections for corrosion"
    ],
    common_misdiagnosis: "Replacing battery when alternator is undercharging",
    source: "community"
  },
  {
    dtc_code: "P0562",
    dtc_description: "System Voltage Low",
    cause: "Weak or failing battery not holding charge",
    cause_category: "electrical",
    confidence_base: 0.35,
    success_rate: 0.25,
    parts_needed: ["battery"],
    labor_category: "basic",
    labor_hours_estimate: 0.5,
    diagnostic_steps: [
      "Load test battery — should maintain voltage above 9.6V under load",
      "Check battery age — most batteries last 3-5 years",
      "Inspect battery terminals for corrosion",
      "Check for parasitic drain that may be killing battery"
    ],
    common_misdiagnosis: null,
    source: "community"
  },
  {
    dtc_code: "P0562",
    dtc_description: "System Voltage Low",
    cause: "Corroded or loose battery cable connections causing voltage drop",
    cause_category: "electrical",
    confidence_base: 0.25,
    success_rate: 0.20,
    parts_needed: ["battery terminals", "battery cables"],
    labor_category: "basic",
    labor_hours_estimate: 0.3,
    diagnostic_steps: [
      "Perform voltage drop test on battery cables — should be less than 0.5V",
      "Clean battery terminals and cable ends",
      "Check ground cable connection at engine block and body",
      "Tighten all connections and apply anti-corrosion spray"
    ],
    common_misdiagnosis: null,
    source: "community"
  },

  // =========================================================================
  // P0700 — Transmission Control System
  // =========================================================================
  {
    dtc_code: "P0700",
    dtc_description: "Transmission Control System Malfunction",
    cause: "Companion code — indicates TCM has stored a specific transmission DTC",
    cause_category: "transmission",
    confidence_base: 0.90,
    success_rate: 0.10,
    parts_needed: [],
    labor_category: "basic",
    labor_hours_estimate: 0.5,
    diagnostic_steps: [
      "P0700 is an informational code — it means the TCM has a stored code",
      "Scan TCM module separately to retrieve the actual transmission fault code",
      "The companion code (P07xx) provides the actual diagnosis",
      "Do NOT diagnose based on P0700 alone — always find the underlying code",
      "Check transmission fluid level and condition while diagnosing"
    ],
    common_misdiagnosis: "Treating P0700 as a standalone diagnosis instead of finding the actual TCM code",
    source: "identifix"
  },

  // =========================================================================
  // P0715 — Input/Turbine Speed Sensor
  // =========================================================================
  {
    dtc_code: "P0715",
    dtc_description: "Input/Turbine Speed Sensor Circuit Malfunction",
    cause: "Failed input speed sensor",
    cause_category: "transmission",
    confidence_base: 0.55,
    success_rate: 0.45,
    parts_needed: ["input speed sensor", "transmission filter", "ATF"],
    labor_category: "intermediate",
    labor_hours_estimate: 1.5,
    diagnostic_steps: [
      "Check for erratic or no input speed reading on scan tool while driving",
      "Measure sensor resistance — compare to specification (typically 200-800 ohms)",
      "Inspect sensor for metal debris contamination on magnetic tip",
      "Check sensor connector for corrosion or ATF contamination",
      "Some sensors require partial transmission disassembly to access"
    ],
    common_misdiagnosis: null,
    source: "community"
  },
  {
    dtc_code: "P0715",
    dtc_description: "Input/Turbine Speed Sensor Circuit Malfunction",
    cause: "Wiring damage between speed sensor and TCM",
    cause_category: "electrical",
    confidence_base: 0.30,
    success_rate: 0.20,
    parts_needed: ["wiring repair"],
    labor_category: "intermediate",
    labor_hours_estimate: 1.0,
    diagnostic_steps: [
      "Check wiring from sensor to TCM for continuity",
      "Wiring near transmission is exposed to heat, vibration, and fluid",
      "Check connector at transmission case for ATF leakage into connector",
      "Repair or replace damaged wiring"
    ],
    common_misdiagnosis: null,
    source: "community"
  },

  // =========================================================================
  // P0720 — Output Speed Sensor
  // =========================================================================
  {
    dtc_code: "P0720",
    dtc_description: "Output Speed Sensor Circuit Malfunction",
    cause: "Failed output speed sensor",
    cause_category: "transmission",
    confidence_base: 0.55,
    success_rate: 0.45,
    parts_needed: ["output speed sensor"],
    labor_category: "intermediate",
    labor_hours_estimate: 1.0,
    diagnostic_steps: [
      "Check output speed reading on scan tool — should match vehicle speed",
      "If reading is zero or erratic while driving, sensor is likely failed",
      "Measure sensor resistance — compare to specification",
      "Inspect sensor tip for contamination",
      "On some vehicles, output speed sensor also drives speedometer"
    ],
    common_misdiagnosis: "Confusing with input speed sensor",
    source: "community"
  },
  {
    dtc_code: "P0720",
    dtc_description: "Output Speed Sensor Circuit Malfunction",
    cause: "Damaged sensor drive gear or reluctor ring in transmission",
    cause_category: "transmission",
    confidence_base: 0.20,
    success_rate: 0.12,
    parts_needed: ["sensor drive gear", "reluctor ring"],
    labor_category: "advanced",
    labor_hours_estimate: 4.0,
    diagnostic_steps: [
      "If new sensor still produces erratic readings, inspect drive mechanism",
      "Remove sensor and check reluctor ring through sensor bore if possible",
      "Stripped or damaged teeth will cause erratic or no signal",
      "May require transmission removal for repair"
    ],
    common_misdiagnosis: null,
    source: "community"
  },

  // =========================================================================
  // P0740 — Torque Converter Clutch Circuit
  // =========================================================================
  {
    dtc_code: "P0740",
    dtc_description: "Torque Converter Clutch Circuit Malfunction",
    cause: "Failed TCC solenoid — electrical or mechanical failure",
    cause_category: "transmission",
    confidence_base: 0.50,
    success_rate: 0.40,
    parts_needed: ["TCC solenoid", "transmission filter", "ATF"],
    labor_category: "advanced",
    labor_hours_estimate: 3.0,
    diagnostic_steps: [
      "Check TCC solenoid resistance — compare to spec (typically 10-25 ohms)",
      "Command TCC solenoid with scan tool — monitor converter lockup",
      "If solenoid does not engage lockup, check electrical circuit first",
      "Solenoid is usually inside transmission — requires pan drop or valve body removal",
      "Check transmission fluid condition — burnt fluid indicates internal damage"
    ],
    common_misdiagnosis: "Replacing solenoid when torque converter itself is failing",
    source: "identifix"
  },
  {
    dtc_code: "P0740",
    dtc_description: "Torque Converter Clutch Circuit Malfunction",
    cause: "Wiring or connector issue in TCC circuit",
    cause_category: "electrical",
    confidence_base: 0.30,
    success_rate: 0.20,
    parts_needed: ["transmission connector", "wiring repair"],
    labor_category: "intermediate",
    labor_hours_estimate: 1.5,
    diagnostic_steps: [
      "Check wiring from TCM to transmission case connector",
      "Inspect transmission external connector for corrosion or fluid intrusion",
      "On some vehicles, internal wiring harness inside transmission degrades",
      "Check for voltage at solenoid connector when commanded on"
    ],
    common_misdiagnosis: null,
    source: "community"
  },

  // =========================================================================
  // P0741 — TCC Stuck Off
  // =========================================================================
  {
    dtc_code: "P0741",
    dtc_description: "Torque Converter Clutch Circuit Performance or Stuck Off",
    cause: "Worn torque converter clutch material — converter not locking up",
    cause_category: "transmission",
    confidence_base: 0.50,
    success_rate: 0.35,
    parts_needed: ["torque converter", "ATF", "transmission filter"],
    labor_category: "advanced",
    labor_hours_estimate: 6.0,
    diagnostic_steps: [
      "Monitor TCC slip with scan tool — at highway speed in lockup, slip should be near 0 RPM",
      "If 50+ RPM slip with TCC commanded on, converter clutch is worn",
      "Check transmission fluid — burnt smell or dark color indicates friction material damage",
      "Torque converter replacement requires transmission removal",
      "Consider transmission rebuild if fluid is contaminated"
    ],
    common_misdiagnosis: "Replacing TCC solenoid when converter clutch disc is worn out",
    source: "identifix"
  },
  {
    dtc_code: "P0741",
    dtc_description: "Torque Converter Clutch Circuit Performance or Stuck Off",
    cause: "TCC solenoid stuck or restricted preventing lockup engagement",
    cause_category: "transmission",
    confidence_base: 0.35,
    success_rate: 0.25,
    parts_needed: ["TCC solenoid", "transmission filter", "ATF"],
    labor_category: "advanced",
    labor_hours_estimate: 3.0,
    diagnostic_steps: [
      "Check if TCC solenoid is receiving command from TCM (voltage test)",
      "If commanded but not engaging, solenoid may be stuck from debris",
      "Check transmission fluid for contamination",
      "Replace solenoid — usually requires valve body removal",
      "Flush transmission and install new filter"
    ],
    common_misdiagnosis: null,
    source: "community"
  },
  {
    dtc_code: "P0741",
    dtc_description: "Torque Converter Clutch Circuit Performance or Stuck Off",
    cause: "Valve body issue — stuck TCC apply valve or worn bore",
    cause_category: "transmission",
    confidence_base: 0.20,
    success_rate: 0.12,
    parts_needed: ["valve body", "valve body rebuild kit"],
    labor_category: "advanced",
    labor_hours_estimate: 4.0,
    diagnostic_steps: [
      "If solenoid tests good electrically and mechanically, check valve body",
      "TCC apply valve can stick from varnish or debris",
      "Worn valve body bore allows pressure bypass",
      "May require valve body rebuild or replacement",
      "Check line pressure with gauge — low pressure can prevent TCC engagement"
    ],
    common_misdiagnosis: null,
    source: "community"
  },
];
