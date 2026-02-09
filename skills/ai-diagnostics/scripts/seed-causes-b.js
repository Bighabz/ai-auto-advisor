/**
 * seed-causes-b.js — Cause mappings part B
 * Additional high-frequency DTCs: P0101, P0106, P0110, P0115, P0120,
 * P0200-P0204, P0230, P0320, P0350-P0354, P0402, P0410, P0444-P0448,
 * P0450-P0453, P0457, P0460-P0463, P0500-P0503, P0520-P0523, P0530-P0533,
 * P0563, P0600-P0606, P0705, P0710, P0725, P0730, P0750, P0751, P0755,
 * P0760, P0765, P0770
 */

module.exports = [
  // =========================================================================
  // P0101 — MAF Range/Performance
  // =========================================================================
  {
    dtc_code: "P0101",
    dtc_description: "Mass or Volume Air Flow Circuit Range/Performance",
    cause: "Contaminated MAF sensor element — incorrect airflow readings",
    cause_category: "fuel",
    confidence_base: 0.55,
    success_rate: 0.45,
    parts_needed: ["MAF sensor cleaner", "MAF sensor"],
    labor_category: "basic",
    labor_hours_estimate: 0.3,
    diagnostic_steps: [
      "Check MAF sensor reading at idle and compare to spec (typically 2-7 g/s for 4-cyl)",
      "Clean MAF element with dedicated MAF cleaner — never touch the element",
      "Check for oiled aftermarket air filter contaminating MAF element",
      "If cleaning does not resolve, replace MAF sensor"
    ],
    common_misdiagnosis: "Replacing MAF without checking for air leaks downstream",
    source: "community"
  },
  {
    dtc_code: "P0101",
    dtc_description: "Mass or Volume Air Flow Circuit Range/Performance",
    cause: "Air leak in intake ducting between MAF and throttle body",
    cause_category: "fuel",
    confidence_base: 0.35,
    success_rate: 0.28,
    parts_needed: ["intake hose", "hose clamps"],
    labor_category: "basic",
    labor_hours_estimate: 0.5,
    diagnostic_steps: [
      "Inspect intake boot/hose between MAF and throttle body for cracks or loose clamps",
      "Air entering after MAF is unmetered and causes range/performance error",
      "Check air filter box lid seal and any bellows sections",
      "Replace damaged hose sections and tighten clamps"
    ],
    common_misdiagnosis: null,
    source: "community"
  },

  // =========================================================================
  // P0106 — MAP Sensor Range/Performance
  // =========================================================================
  {
    dtc_code: "P0106",
    dtc_description: "Manifold Absolute Pressure/Barometric Pressure Circuit Range/Performance",
    cause: "Failed or drifted MAP sensor",
    cause_category: "fuel",
    confidence_base: 0.50,
    success_rate: 0.40,
    parts_needed: ["MAP sensor"],
    labor_category: "basic",
    labor_hours_estimate: 0.3,
    diagnostic_steps: [
      "Check MAP sensor reading at key-on engine-off — should read barometric pressure (~29 inHg at sea level)",
      "At idle, should read 15-22 inHg vacuum depending on engine",
      "Compare reading to actual vacuum gauge reading",
      "If readings are incorrect or erratic, replace sensor"
    ],
    common_misdiagnosis: null,
    source: "community"
  },
  {
    dtc_code: "P0106",
    dtc_description: "Manifold Absolute Pressure/Barometric Pressure Circuit Range/Performance",
    cause: "Vacuum hose to MAP sensor cracked, kinked, or disconnected",
    cause_category: "fuel",
    confidence_base: 0.35,
    success_rate: 0.28,
    parts_needed: ["vacuum hose"],
    labor_category: "basic",
    labor_hours_estimate: 0.3,
    diagnostic_steps: [
      "If MAP sensor is remote-mounted (not on manifold), check vacuum reference hose",
      "Look for cracks, kinks, or disconnections",
      "Apply vacuum to MAP sensor — reading should change smoothly",
      "Replace hose if damaged"
    ],
    common_misdiagnosis: null,
    source: "community"
  },

  // =========================================================================
  // P0115 — ECT Circuit Malfunction
  // =========================================================================
  {
    dtc_code: "P0115",
    dtc_description: "Engine Coolant Temperature Circuit Malfunction",
    cause: "Failed ECT sensor — open or shorted internally",
    cause_category: "cooling",
    confidence_base: 0.60,
    success_rate: 0.50,
    parts_needed: ["ECT sensor"],
    labor_category: "basic",
    labor_hours_estimate: 0.5,
    diagnostic_steps: [
      "Measure ECT sensor resistance — should match temperature/resistance chart",
      "Cold engine (70F): typically 2000-3000 ohms; hot engine (200F): typically 200-300 ohms",
      "If resistance is open or shorted, replace sensor",
      "Check for coolant leak at sensor threads"
    ],
    common_misdiagnosis: null,
    source: "community"
  },
  {
    dtc_code: "P0115",
    dtc_description: "Engine Coolant Temperature Circuit Malfunction",
    cause: "Wiring or connector damage to ECT circuit",
    cause_category: "electrical",
    confidence_base: 0.30,
    success_rate: 0.20,
    parts_needed: ["wiring repair", "connector"],
    labor_category: "basic",
    labor_hours_estimate: 0.5,
    diagnostic_steps: [
      "Check wiring from ECT sensor to PCM for continuity",
      "Inspect connector for coolant contamination or corrosion",
      "Wiggle test wiring while monitoring ECT reading on scan tool",
      "Repair damaged wiring"
    ],
    common_misdiagnosis: null,
    source: "community"
  },

  // =========================================================================
  // P0120 — TPS Circuit Malfunction
  // =========================================================================
  {
    dtc_code: "P0120",
    dtc_description: "Throttle/Pedal Position Sensor/Switch A Circuit Malfunction",
    cause: "Failed TPS — worn internal resistive element",
    cause_category: "fuel",
    confidence_base: 0.55,
    success_rate: 0.45,
    parts_needed: ["TPS sensor"],
    labor_category: "basic",
    labor_hours_estimate: 0.5,
    diagnostic_steps: [
      "Monitor TPS voltage while slowly opening throttle — should sweep smoothly from ~0.5V to ~4.5V",
      "If voltage drops out or has dead spots, TPS internal track is worn",
      "Check for 5V reference and ground at connector",
      "Replace TPS and verify smooth signal sweep"
    ],
    common_misdiagnosis: null,
    source: "community"
  },
  {
    dtc_code: "P0120",
    dtc_description: "Throttle/Pedal Position Sensor/Switch A Circuit Malfunction",
    cause: "Wiring issue in TPS circuit — intermittent open or short",
    cause_category: "electrical",
    confidence_base: 0.30,
    success_rate: 0.20,
    parts_needed: ["wiring repair", "connector"],
    labor_category: "basic",
    labor_hours_estimate: 0.5,
    diagnostic_steps: [
      "Check 5V reference voltage at TPS connector",
      "Check ground circuit continuity",
      "Wiggle wiring while monitoring TPS signal for dropouts",
      "On electronic throttle vehicles, also check APP (accelerator pedal position) sensor"
    ],
    common_misdiagnosis: null,
    source: "community"
  },

  // =========================================================================
  // P0200–P0204 — Injector Circuit Codes
  // =========================================================================
  ...[0, 1, 2, 3, 4].map((n) => {
    const desc = n === 0
      ? "Injector Circuit Malfunction"
      : `Injector Circuit Malfunction - Cylinder ${n}`;
    const cylLabel = n === 0 ? "one or more cylinders" : `cylinder ${n}`;
    return [
      {
        dtc_code: `P020${n}`,
        dtc_description: desc,
        cause: `Failed fuel injector — open or shorted coil (${cylLabel})`,
        cause_category: "fuel",
        confidence_base: 0.50,
        success_rate: 0.40,
        parts_needed: [`fuel injector${n === 0 ? "s" : ` cylinder ${n}`}`],
        labor_category: "intermediate",
        labor_hours_estimate: 1.5,
        diagnostic_steps: [
          `Check injector resistance on ${cylLabel} — typically 12-16 ohms for high-impedance injectors`,
          "If resistance is open (infinite) or very low (shorted), replace injector",
          "Use noid light to verify PCM is sending pulse signal",
          "If noid light flashes but injector does not click, injector coil is dead"
        ],
        common_misdiagnosis: null,
        source: "community"
      },
      {
        dtc_code: `P020${n}`,
        dtc_description: desc,
        cause: `Wiring harness damage to injector connector (${cylLabel})`,
        cause_category: "electrical",
        confidence_base: 0.35,
        success_rate: 0.25,
        parts_needed: ["wiring repair", "injector connector"],
        labor_category: "intermediate",
        labor_hours_estimate: 1.0,
        diagnostic_steps: [
          "Check wiring from PCM to injector connector for continuity",
          "Inspect connector for corrosion, oil contamination, or melting",
          "Injector connectors are exposed to engine heat and can degrade",
          "Wiggle test wiring while monitoring injector operation"
        ],
        common_misdiagnosis: null,
        source: "community"
      }
    ];
  }).flat(),

  // =========================================================================
  // P0230 — Fuel Pump Primary Circuit
  // =========================================================================
  {
    dtc_code: "P0230",
    dtc_description: "Fuel Pump Primary Circuit Malfunction",
    cause: "Failed fuel pump relay",
    cause_category: "electrical",
    confidence_base: 0.50,
    success_rate: 0.40,
    parts_needed: ["fuel pump relay"],
    labor_category: "basic",
    labor_hours_estimate: 0.3,
    diagnostic_steps: [
      "Locate fuel pump relay in fuse/relay box",
      "Swap with identical relay (horn, A/C, etc.) to test",
      "Listen for fuel pump prime with key on — 2-second buzz from rear",
      "If pump runs with swapped relay, original relay is faulty"
    ],
    common_misdiagnosis: null,
    source: "community"
  },
  {
    dtc_code: "P0230",
    dtc_description: "Fuel Pump Primary Circuit Malfunction",
    cause: "Fuel pump motor failure",
    cause_category: "fuel",
    confidence_base: 0.35,
    success_rate: 0.25,
    parts_needed: ["fuel pump assembly"],
    labor_category: "intermediate",
    labor_hours_estimate: 2.0,
    diagnostic_steps: [
      "Check for voltage at fuel pump connector with key on (should see battery voltage briefly)",
      "If voltage is present but pump does not run, motor is dead",
      "Check fuel pump fuse",
      "Some vehicles have inertia switch that trips in collision — check and reset",
      "Fuel pump replacement usually requires dropping fuel tank"
    ],
    common_misdiagnosis: null,
    source: "community"
  },

  // =========================================================================
  // P0320 — Ignition/Distributor Engine Speed Input Circuit
  // =========================================================================
  {
    dtc_code: "P0320",
    dtc_description: "Ignition/Distributor Engine Speed Input Circuit Malfunction",
    cause: "Failed crankshaft position sensor or distributor pickup",
    cause_category: "ignition",
    confidence_base: 0.55,
    success_rate: 0.45,
    parts_needed: ["crankshaft position sensor", "distributor pickup"],
    labor_category: "intermediate",
    labor_hours_estimate: 1.0,
    diagnostic_steps: [
      "Check for RPM signal on scan tool while cranking",
      "Measure sensor resistance — compare to specification",
      "On distributor-equipped vehicles, check pickup coil inside distributor",
      "Check air gap between sensor and reluctor"
    ],
    common_misdiagnosis: null,
    source: "community"
  },
  {
    dtc_code: "P0320",
    dtc_description: "Ignition/Distributor Engine Speed Input Circuit Malfunction",
    cause: "Wiring or connector issue in engine speed circuit",
    cause_category: "electrical",
    confidence_base: 0.30,
    success_rate: 0.20,
    parts_needed: ["wiring repair"],
    labor_category: "intermediate",
    labor_hours_estimate: 1.0,
    diagnostic_steps: [
      "Check wiring from sensor to PCM for continuity",
      "Inspect for chafed or broken wires near engine",
      "Check shield/drain wire integrity if present",
      "Repair wiring and retest"
    ],
    common_misdiagnosis: null,
    source: "community"
  },

  // =========================================================================
  // P0350–P0354 — Ignition Coil Circuits
  // =========================================================================
  ...[0, 1, 2, 3, 4].map((n) => {
    const coilLetter = String.fromCharCode(65 + n); // A, B, C, D, E
    const desc = n === 0
      ? "Ignition Coil Primary/Secondary Circuit Malfunction"
      : `Ignition Coil ${coilLetter} Primary/Secondary Circuit Malfunction`;
    const cylLabel = n === 0 ? "affected cylinder" : `cylinder ${n}`;
    return [
      {
        dtc_code: `P035${n}`,
        dtc_description: desc,
        cause: `Failed ignition coil ${n === 0 ? "" : coilLetter + " "}— internal short or open`,
        cause_category: "ignition",
        confidence_base: 0.60,
        success_rate: 0.50,
        parts_needed: [`ignition coil${n === 0 ? "s" : ` ${coilLetter}`}`],
        labor_category: "basic",
        labor_hours_estimate: 0.5,
        diagnostic_steps: [
          "Measure coil primary resistance (typically 0.5-2.0 ohms) and secondary resistance (typically 6,000-15,000 ohms)",
          "If out of range, coil is failed",
          "Check for arcing or carbon tracking on coil boot",
          `Swap coil to another cylinder — if misfire/code follows coil, confirm replacement needed`
        ],
        common_misdiagnosis: null,
        source: "community"
      },
      {
        dtc_code: `P035${n}`,
        dtc_description: desc,
        cause: `Wiring or connector issue in coil ${n === 0 ? "" : coilLetter + " "}driver circuit`,
        cause_category: "electrical",
        confidence_base: 0.25,
        success_rate: 0.18,
        parts_needed: ["wiring repair", "coil connector"],
        labor_category: "basic",
        labor_hours_estimate: 0.5,
        diagnostic_steps: [
          "Check for 12V power at coil connector with key on",
          "Check PCM trigger signal with scope or noid light",
          "Inspect connector for corrosion, spread pins, or heat damage",
          "Repair wiring if damaged"
        ],
        common_misdiagnosis: "Replacing coil when connector or wiring is the issue",
        source: "community"
      }
    ];
  }).flat(),

  // =========================================================================
  // P0402 — EGR Flow Excessive
  // =========================================================================
  {
    dtc_code: "P0402",
    dtc_description: "Exhaust Gas Recirculation Flow Excessive Detected",
    cause: "EGR valve stuck partially open",
    cause_category: "emissions",
    confidence_base: 0.55,
    success_rate: 0.45,
    parts_needed: ["EGR valve"],
    labor_category: "intermediate",
    labor_hours_estimate: 1.0,
    diagnostic_steps: [
      "Excessive EGR flow causes rough idle, surging, or stalling",
      "Remove EGR valve and check for carbon preventing full closure",
      "Check valve diaphragm or electronic actuator",
      "If valve does not fully close, replace it"
    ],
    common_misdiagnosis: null,
    source: "community"
  },
  {
    dtc_code: "P0402",
    dtc_description: "Exhaust Gas Recirculation Flow Excessive Detected",
    cause: "Faulty EGR position/pressure feedback sensor",
    cause_category: "emissions",
    confidence_base: 0.30,
    success_rate: 0.22,
    parts_needed: ["DPFE sensor", "EGR position sensor"],
    labor_category: "basic",
    labor_hours_estimate: 0.5,
    diagnostic_steps: [
      "If feedback sensor reads higher than actual flow, PCM thinks excessive EGR is present",
      "Check DPFE sensor voltage — should be ~0.5V with EGR closed",
      "Replace sensor if voltage is abnormally high at rest"
    ],
    common_misdiagnosis: null,
    source: "oem_tsb"
  },

  // =========================================================================
  // P0410 — Secondary Air Injection System
  // =========================================================================
  {
    dtc_code: "P0410",
    dtc_description: "Secondary Air Injection System Malfunction",
    cause: "Secondary AIR pump motor failure",
    cause_category: "emissions",
    confidence_base: 0.50,
    success_rate: 0.40,
    parts_needed: ["secondary air injection pump"],
    labor_category: "intermediate",
    labor_hours_estimate: 1.5,
    diagnostic_steps: [
      "AIR pump should run on cold start for 30-120 seconds",
      "If no pump noise on cold start, check fuse and relay first",
      "Apply 12V directly to pump motor — if it doesn't run, motor is dead",
      "Pumps commonly fail from moisture ingestion"
    ],
    common_misdiagnosis: null,
    source: "community"
  },
  {
    dtc_code: "P0410",
    dtc_description: "Secondary Air Injection System Malfunction",
    cause: "AIR pump relay or fuse failure",
    cause_category: "electrical",
    confidence_base: 0.30,
    success_rate: 0.25,
    parts_needed: ["AIR pump relay", "fuse"],
    labor_category: "basic",
    labor_hours_estimate: 0.3,
    diagnostic_steps: [
      "Check AIR pump fuse — replace if blown",
      "Check AIR pump relay — swap with known-good relay",
      "If fuse keeps blowing, check for shorted pump motor or wiring"
    ],
    common_misdiagnosis: null,
    source: "community"
  },

  // =========================================================================
  // P0460–P0463 — Fuel Level Sensor
  // =========================================================================
  {
    dtc_code: "P0460",
    dtc_description: "Fuel Level Sensor Circuit Malfunction",
    cause: "Failed fuel level sender unit inside fuel tank",
    cause_category: "electrical",
    confidence_base: 0.55,
    success_rate: 0.45,
    parts_needed: ["fuel level sender", "fuel pump module"],
    labor_category: "intermediate",
    labor_hours_estimate: 2.0,
    diagnostic_steps: [
      "Check fuel gauge operation — erratic, stuck, or always reading empty/full",
      "Measure sender resistance at connector — should change with fuel level",
      "If resistance is stuck or erratic, sender float mechanism is likely failed",
      "On most modern vehicles, sender is part of fuel pump module"
    ],
    common_misdiagnosis: "Replacing instrument cluster when sender is the issue",
    source: "community"
  },
  {
    dtc_code: "P0461",
    dtc_description: "Fuel Level Sensor Circuit Range/Performance",
    cause: "Stuck or binding fuel level sender float arm",
    cause_category: "electrical",
    confidence_base: 0.55,
    success_rate: 0.45,
    parts_needed: ["fuel level sender"],
    labor_category: "intermediate",
    labor_hours_estimate: 2.0,
    diagnostic_steps: [
      "Fuel gauge reads erratically or is stuck at one position",
      "Float arm may be binding on tank baffles or deformed",
      "Check sender resistance range — should sweep full range as float moves",
      "Replace sender unit"
    ],
    common_misdiagnosis: null,
    source: "community"
  },
  {
    dtc_code: "P0462",
    dtc_description: "Fuel Level Sensor Circuit Low Input",
    cause: "Open circuit in fuel level sender wiring or shorted sender",
    cause_category: "electrical",
    confidence_base: 0.50,
    success_rate: 0.40,
    parts_needed: ["fuel level sender", "wiring repair"],
    labor_category: "intermediate",
    labor_hours_estimate: 1.5,
    diagnostic_steps: [
      "Low input means PCM sees very low resistance or voltage",
      "Check wiring from sender to PCM for shorts to ground",
      "Measure sender resistance directly",
      "If sender resistance is near 0 ohms, it is shorted internally"
    ],
    common_misdiagnosis: null,
    source: "community"
  },
  {
    dtc_code: "P0463",
    dtc_description: "Fuel Level Sensor Circuit High Input",
    cause: "Open circuit in fuel level sender or wiring",
    cause_category: "electrical",
    confidence_base: 0.50,
    success_rate: 0.40,
    parts_needed: ["fuel level sender", "wiring repair"],
    labor_category: "intermediate",
    labor_hours_estimate: 1.5,
    diagnostic_steps: [
      "High input means PCM sees very high resistance (open circuit)",
      "Check sender connector for disconnection or corrosion",
      "Measure sender resistance — should not be infinite",
      "Check wiring for breaks between sender and PCM"
    ],
    common_misdiagnosis: null,
    source: "community"
  },

  // =========================================================================
  // P0500–P0503 — Vehicle Speed Sensor
  // =========================================================================
  {
    dtc_code: "P0500",
    dtc_description: "Vehicle Speed Sensor Malfunction",
    cause: "Failed vehicle speed sensor",
    cause_category: "transmission",
    confidence_base: 0.55,
    success_rate: 0.45,
    parts_needed: ["vehicle speed sensor"],
    labor_category: "basic",
    labor_hours_estimate: 0.5,
    diagnostic_steps: [
      "Check if speedometer is working — if not, VSS may be the source",
      "Monitor VSS reading on scan tool while driving — should match actual speed",
      "Measure sensor resistance or check for proper signal output",
      "Some vehicles use ABS wheel speed sensors as VSS input"
    ],
    common_misdiagnosis: null,
    source: "community"
  },
  {
    dtc_code: "P0500",
    dtc_description: "Vehicle Speed Sensor Malfunction",
    cause: "Damaged VSS drive gear in transmission",
    cause_category: "transmission",
    confidence_base: 0.20,
    success_rate: 0.12,
    parts_needed: ["VSS drive gear"],
    labor_category: "intermediate",
    labor_hours_estimate: 1.5,
    diagnostic_steps: [
      "If new sensor still does not produce signal, check drive gear",
      "Remove sensor and inspect drive gear for stripped teeth",
      "Some vehicles use a gear that meshes with the output shaft",
      "Replace gear if damaged"
    ],
    common_misdiagnosis: null,
    source: "community"
  },
  {
    dtc_code: "P0501",
    dtc_description: "Vehicle Speed Sensor Range/Performance",
    cause: "Intermittent VSS signal or sensor calibration drift",
    cause_category: "transmission",
    confidence_base: 0.50,
    success_rate: 0.40,
    parts_needed: ["vehicle speed sensor"],
    labor_category: "basic",
    labor_hours_estimate: 0.5,
    diagnostic_steps: [
      "Monitor VSS reading for erratic behavior during driving",
      "Check sensor connector for intermittent connection",
      "Compare VSS to wheel speed sensor readings if available",
      "Replace sensor if readings are erratic"
    ],
    common_misdiagnosis: null,
    source: "community"
  },
  {
    dtc_code: "P0502",
    dtc_description: "Vehicle Speed Sensor Circuit Low Input",
    cause: "VSS circuit shorted to ground or sensor failure",
    cause_category: "electrical",
    confidence_base: 0.50,
    success_rate: 0.40,
    parts_needed: ["vehicle speed sensor", "wiring repair"],
    labor_category: "basic",
    labor_hours_estimate: 0.5,
    diagnostic_steps: [
      "Check VSS wiring for short to ground",
      "Measure sensor output — should produce AC voltage when spinning",
      "Check connector for damage or corrosion",
      "Replace sensor or repair wiring as needed"
    ],
    common_misdiagnosis: null,
    source: "community"
  },
  {
    dtc_code: "P0503",
    dtc_description: "Vehicle Speed Sensor Intermittent/Erratic/High",
    cause: "Intermittent wiring connection or electromagnetic interference",
    cause_category: "electrical",
    confidence_base: 0.50,
    success_rate: 0.35,
    parts_needed: ["wiring repair", "vehicle speed sensor"],
    labor_category: "basic",
    labor_hours_estimate: 0.5,
    diagnostic_steps: [
      "Check for erratic speed readings on scan tool — spikes or dropouts",
      "Inspect wiring for chafing against other wires or metal",
      "Ensure sensor wiring is routed away from ignition wires",
      "Check for aftermarket equipment causing electromagnetic interference"
    ],
    common_misdiagnosis: null,
    source: "community"
  },

  // =========================================================================
  // P0520–P0523 — Oil Pressure Sensor
  // =========================================================================
  {
    dtc_code: "P0520",
    dtc_description: "Engine Oil Pressure Sensor/Switch Circuit Malfunction",
    cause: "Failed oil pressure sensor or sending unit",
    cause_category: "engine",
    confidence_base: 0.55,
    success_rate: 0.45,
    parts_needed: ["oil pressure sensor"],
    labor_category: "basic",
    labor_hours_estimate: 0.5,
    diagnostic_steps: [
      "Verify actual oil pressure with mechanical gauge before condemning sensor",
      "Compare mechanical gauge to scan tool reading",
      "If mechanical pressure is good but scan tool reads wrong, sensor is faulty",
      "Replace sensor — use thread sealant"
    ],
    common_misdiagnosis: "Ignoring actual low oil pressure and just replacing the sensor",
    source: "community"
  },
  {
    dtc_code: "P0521",
    dtc_description: "Engine Oil Pressure Sensor/Switch Range/Performance",
    cause: "Oil pressure sensor reading outside expected range for engine conditions",
    cause_category: "engine",
    confidence_base: 0.45,
    success_rate: 0.35,
    parts_needed: ["oil pressure sensor"],
    labor_category: "basic",
    labor_hours_estimate: 0.5,
    diagnostic_steps: [
      "Verify oil level is correct",
      "Verify correct oil viscosity is being used",
      "Compare sensor reading to mechanical gauge",
      "If sensor is out of range but actual pressure is normal, replace sensor"
    ],
    common_misdiagnosis: null,
    source: "community"
  },
  {
    dtc_code: "P0522",
    dtc_description: "Engine Oil Pressure Sensor/Switch Low Voltage",
    cause: "Low oil pressure — worn oil pump, low oil level, or wrong viscosity",
    cause_category: "engine",
    confidence_base: 0.40,
    success_rate: 0.25,
    parts_needed: ["engine oil", "oil pump", "oil pressure sensor"],
    labor_category: "intermediate",
    labor_hours_estimate: 1.0,
    diagnostic_steps: [
      "CRITICAL: Check oil level immediately — low oil can cause engine damage",
      "Verify with mechanical gauge — if pressure is actually low, this is serious",
      "Check for oil leaks",
      "If oil level is fine and pressure is actually low, oil pump may be worn",
      "If mechanical pressure is normal, replace the sensor"
    ],
    common_misdiagnosis: "Replacing sensor when oil pressure is actually dangerously low",
    source: "community"
  },
  {
    dtc_code: "P0523",
    dtc_description: "Engine Oil Pressure Sensor/Switch High Voltage",
    cause: "Open circuit in oil pressure sensor wiring or failed sensor",
    cause_category: "electrical",
    confidence_base: 0.55,
    success_rate: 0.45,
    parts_needed: ["oil pressure sensor", "wiring repair"],
    labor_category: "basic",
    labor_hours_estimate: 0.5,
    diagnostic_steps: [
      "High voltage usually indicates open circuit — sensor or wiring",
      "Check sensor connector for disconnection or corrosion",
      "Measure sensor resistance or voltage output",
      "If wiring is intact, replace sensor"
    ],
    common_misdiagnosis: null,
    source: "community"
  },

  // =========================================================================
  // P0530–P0533 — A/C Refrigerant Pressure
  // =========================================================================
  {
    dtc_code: "P0530",
    dtc_description: "A/C Refrigerant Pressure Sensor Circuit Malfunction",
    cause: "Failed A/C pressure sensor or transducer",
    cause_category: "electrical",
    confidence_base: 0.50,
    success_rate: 0.40,
    parts_needed: ["A/C pressure sensor"],
    labor_category: "basic",
    labor_hours_estimate: 0.5,
    diagnostic_steps: [
      "Check A/C pressure sensor reading on scan tool — compare to gauge readings",
      "Sensor should read ambient/static pressure with A/C off",
      "If reading is stuck or implausible, sensor may be failed",
      "Some sensors are Schrader-valve-mounted and do not require system discharge to replace"
    ],
    common_misdiagnosis: null,
    source: "community"
  },
  {
    dtc_code: "P0532",
    dtc_description: "A/C Refrigerant Pressure Sensor Circuit Low Input",
    cause: "Low or no refrigerant charge causing low pressure reading",
    cause_category: "electrical",
    confidence_base: 0.50,
    success_rate: 0.35,
    parts_needed: ["refrigerant", "A/C leak repair"],
    labor_category: "intermediate",
    labor_hours_estimate: 1.5,
    diagnostic_steps: [
      "Low pressure sensor reading may indicate actual low refrigerant charge",
      "Connect A/C gauges — check high and low side pressures",
      "If system is low, find and repair leak before recharging",
      "If pressures are normal but sensor reads low, replace sensor"
    ],
    common_misdiagnosis: null,
    source: "community"
  },

  // =========================================================================
  // P0563 — System Voltage High
  // =========================================================================
  {
    dtc_code: "P0563",
    dtc_description: "System Voltage High",
    cause: "Faulty voltage regulator in alternator — overcharging",
    cause_category: "electrical",
    confidence_base: 0.60,
    success_rate: 0.50,
    parts_needed: ["alternator", "voltage regulator"],
    labor_category: "intermediate",
    labor_hours_estimate: 1.5,
    diagnostic_steps: [
      "Check charging voltage at battery — should be 13.5-14.5V",
      "If above 15V, alternator is overcharging",
      "Overcharging can damage battery and electronic modules",
      "On some vehicles, voltage regulator is separate from alternator",
      "Replace alternator or regulator as applicable"
    ],
    common_misdiagnosis: null,
    source: "community"
  },
  {
    dtc_code: "P0563",
    dtc_description: "System Voltage High",
    cause: "Poor ground connection causing voltage reference error",
    cause_category: "electrical",
    confidence_base: 0.25,
    success_rate: 0.18,
    parts_needed: ["ground cable", "ground strap"],
    labor_category: "basic",
    labor_hours_estimate: 0.5,
    diagnostic_steps: [
      "A poor ground can cause the voltage regulator to read low voltage and compensate by overcharging",
      "Check battery negative cable connections at battery, engine block, and body",
      "Perform voltage drop test on ground circuits — should be less than 0.3V",
      "Clean and tighten all ground connections"
    ],
    common_misdiagnosis: "Replacing alternator when a poor ground is causing the issue",
    source: "community"
  },

  // =========================================================================
  // P0600–P0606 — PCM/Computer Codes
  // =========================================================================
  {
    dtc_code: "P0600",
    dtc_description: "Serial Communication Link Malfunction",
    cause: "CAN bus communication failure between PCM and other modules",
    cause_category: "electrical",
    confidence_base: 0.45,
    success_rate: 0.30,
    parts_needed: ["wiring repair"],
    labor_category: "advanced",
    labor_hours_estimate: 2.0,
    diagnostic_steps: [
      "Check for other communication DTCs in multiple modules",
      "Measure CAN bus resistance — should be approximately 60 ohms between CAN-H and CAN-L",
      "If resistance is wrong, there is a bus fault (open or shorted)",
      "Check for damaged CAN bus wiring, especially at connectors",
      "Disconnect modules one at a time to isolate fault"
    ],
    common_misdiagnosis: "Replacing PCM when CAN bus wiring is damaged",
    source: "identifix"
  },
  {
    dtc_code: "P0601",
    dtc_description: "Internal Control Module Memory Check Sum Error",
    cause: "PCM internal memory corruption — needs reprogramming or replacement",
    cause_category: "electrical",
    confidence_base: 0.70,
    success_rate: 0.55,
    parts_needed: ["PCM reprogramming", "PCM"],
    labor_category: "advanced",
    labor_hours_estimate: 1.5,
    diagnostic_steps: [
      "Try clearing code and monitoring — if it returns, PCM has a permanent fault",
      "Attempt PCM reflash/reprogramming with latest calibration",
      "If reflash fails or code persists, PCM replacement is needed",
      "New PCM typically requires programming with VIN and anti-theft relearn"
    ],
    common_misdiagnosis: null,
    source: "oem_tsb"
  },
  {
    dtc_code: "P0602",
    dtc_description: "Control Module Programming Error",
    cause: "Incomplete or failed PCM reprogramming event",
    cause_category: "electrical",
    confidence_base: 0.60,
    success_rate: 0.50,
    parts_needed: ["PCM reprogramming"],
    labor_category: "advanced",
    labor_hours_estimate: 1.0,
    diagnostic_steps: [
      "Check if PCM was recently reprogrammed or battery was disconnected during programming",
      "Attempt to reprogram PCM with correct calibration file",
      "Ensure stable power supply during reprogramming — use battery charger",
      "If reprogramming fails repeatedly, PCM may need replacement"
    ],
    common_misdiagnosis: null,
    source: "oem_tsb"
  },
  {
    dtc_code: "P0603",
    dtc_description: "Internal Control Module Keep Alive Memory (KAM) Error",
    cause: "Battery disconnection or low battery voltage corrupted KAM",
    cause_category: "electrical",
    confidence_base: 0.55,
    success_rate: 0.45,
    parts_needed: ["battery"],
    labor_category: "basic",
    labor_hours_estimate: 0.3,
    diagnostic_steps: [
      "KAM stores learned values — lost when battery is disconnected or goes dead",
      "Clear code and drive vehicle to allow PCM to relearn",
      "If code returns without battery issues, PCM may have internal fault",
      "Check battery and charging system for intermittent voltage drops"
    ],
    common_misdiagnosis: null,
    source: "community"
  },
  {
    dtc_code: "P0604",
    dtc_description: "Internal Control Module Random Access Memory (RAM) Error",
    cause: "PCM internal hardware failure — RAM chip defective",
    cause_category: "electrical",
    confidence_base: 0.70,
    success_rate: 0.55,
    parts_needed: ["PCM"],
    labor_category: "advanced",
    labor_hours_estimate: 1.5,
    diagnostic_steps: [
      "Clear code and monitor — if code returns immediately, RAM is defective",
      "Check PCM power and ground circuits before condemning PCM",
      "Verify no water intrusion into PCM housing",
      "PCM replacement and programming required"
    ],
    common_misdiagnosis: null,
    source: "community"
  },
  {
    dtc_code: "P0605",
    dtc_description: "Internal Control Module Read Only Memory (ROM) Error",
    cause: "PCM internal hardware failure — ROM chip defective",
    cause_category: "electrical",
    confidence_base: 0.70,
    success_rate: 0.55,
    parts_needed: ["PCM"],
    labor_category: "advanced",
    labor_hours_estimate: 1.5,
    diagnostic_steps: [
      "ROM stores the operating program — cannot be field-repaired",
      "Try reflashing PCM — may restore ROM if corruption is minor",
      "If reflash fails, PCM replacement is necessary",
      "Program new PCM with VIN and perform anti-theft relearn"
    ],
    common_misdiagnosis: null,
    source: "community"
  },
  {
    dtc_code: "P0606",
    dtc_description: "PCM Processor Fault",
    cause: "PCM internal processor failure or power supply issue",
    cause_category: "electrical",
    confidence_base: 0.55,
    success_rate: 0.40,
    parts_needed: ["PCM"],
    labor_category: "advanced",
    labor_hours_estimate: 2.0,
    diagnostic_steps: [
      "Check PCM power supply — verify battery voltage at all PCM power pins",
      "Check PCM ground circuits — perform voltage drop test",
      "If power and grounds are good and code persists, PCM is internally failed",
      "Check for TSBs — some vehicles have known PCM failure patterns",
      "Replace and program PCM"
    ],
    common_misdiagnosis: "Replacing PCM when power supply or ground issue is the root cause",
    source: "identifix"
  },

  // =========================================================================
  // P0705 — Transmission Range Sensor
  // =========================================================================
  {
    dtc_code: "P0705",
    dtc_description: "Transmission Range Sensor Circuit Malfunction (PRNDL Input)",
    cause: "Failed transmission range sensor (neutral safety switch)",
    cause_category: "transmission",
    confidence_base: 0.55,
    success_rate: 0.45,
    parts_needed: ["transmission range sensor"],
    labor_category: "intermediate",
    labor_hours_estimate: 1.5,
    diagnostic_steps: [
      "Check gear position indication on scan tool vs actual shifter position",
      "If scan tool shows wrong gear or no gear, sensor is faulty",
      "On external sensors, check adjustment — may just need repositioning",
      "Measure sensor resistance in each gear position — compare to spec",
      "Some vehicles will not start or have harsh shifts with faulty TR sensor"
    ],
    common_misdiagnosis: null,
    source: "community"
  },
  {
    dtc_code: "P0705",
    dtc_description: "Transmission Range Sensor Circuit Malfunction (PRNDL Input)",
    cause: "Misadjusted shift linkage or transmission range sensor",
    cause_category: "transmission",
    confidence_base: 0.30,
    success_rate: 0.22,
    parts_needed: ["shift linkage bushing"],
    labor_category: "basic",
    labor_hours_estimate: 0.5,
    diagnostic_steps: [
      "Check that shifter fully engages each gear position",
      "Inspect shift cable or linkage for worn bushings or binding",
      "Adjust transmission range sensor alignment if adjustable",
      "A worn shift cable bushing can prevent full engagement"
    ],
    common_misdiagnosis: null,
    source: "community"
  },

  // =========================================================================
  // P0710 — Transmission Fluid Temperature Sensor
  // =========================================================================
  {
    dtc_code: "P0710",
    dtc_description: "Transmission Fluid Temperature Sensor Circuit Malfunction",
    cause: "Failed transmission fluid temperature sensor",
    cause_category: "transmission",
    confidence_base: 0.55,
    success_rate: 0.45,
    parts_needed: ["transmission fluid temperature sensor"],
    labor_category: "intermediate",
    labor_hours_estimate: 1.0,
    diagnostic_steps: [
      "Check TFT reading on scan tool — should be close to ECT when cold-soaked",
      "If reading is stuck at extreme hot or cold, sensor is likely failed",
      "Measure sensor resistance and compare to temperature chart",
      "Sensor is often inside transmission — may require pan removal"
    ],
    common_misdiagnosis: null,
    source: "community"
  },

  // =========================================================================
  // P0725 — Engine Speed Input Circuit
  // =========================================================================
  {
    dtc_code: "P0725",
    dtc_description: "Engine Speed Input Circuit Malfunction",
    cause: "TCM not receiving engine RPM signal from CKP sensor",
    cause_category: "transmission",
    confidence_base: 0.45,
    success_rate: 0.35,
    parts_needed: ["crankshaft position sensor"],
    labor_category: "intermediate",
    labor_hours_estimate: 1.0,
    diagnostic_steps: [
      "TCM uses engine RPM to calculate slip and shift points",
      "If CKP signal is weak or intermittent, TCM sets this code",
      "Check CKP sensor and circuit — may also have P0335",
      "Check CAN bus communication if TCM gets RPM via CAN from PCM"
    ],
    common_misdiagnosis: null,
    source: "community"
  },

  // =========================================================================
  // P0730 — Incorrect Gear Ratio
  // =========================================================================
  {
    dtc_code: "P0730",
    dtc_description: "Incorrect Gear Ratio",
    cause: "Internal transmission component failure — clutch pack, band, or gear damage",
    cause_category: "transmission",
    confidence_base: 0.45,
    success_rate: 0.25,
    parts_needed: ["transmission rebuild kit", "clutch packs"],
    labor_category: "advanced",
    labor_hours_estimate: 12.0,
    diagnostic_steps: [
      "TCM compares input and output shaft speed to determine gear ratio",
      "If ratio does not match expected for commanded gear, this code sets",
      "Check transmission fluid level and condition — burnt fluid indicates internal damage",
      "Check for slipping during acceleration — RPM rises without speed increase",
      "May require transmission rebuild or replacement"
    ],
    common_misdiagnosis: "Replacing solenoids when internal hard parts are damaged",
    source: "identifix"
  },
  {
    dtc_code: "P0730",
    dtc_description: "Incorrect Gear Ratio",
    cause: "Low transmission fluid level or contaminated fluid",
    cause_category: "transmission",
    confidence_base: 0.30,
    success_rate: 0.22,
    parts_needed: ["ATF", "transmission filter"],
    labor_category: "basic",
    labor_hours_estimate: 1.0,
    diagnostic_steps: [
      "Check transmission fluid level on dipstick (if equipped) or through fill plug",
      "Check fluid condition — should be red/pink and not smell burnt",
      "If low, check for leaks — pan gasket, cooler lines, axle seals",
      "Top off with correct specification ATF"
    ],
    common_misdiagnosis: null,
    source: "community"
  },

  // =========================================================================
  // P0750, P0751 — Shift Solenoid A
  // =========================================================================
  {
    dtc_code: "P0750",
    dtc_description: "Shift Solenoid A Malfunction",
    cause: "Shift solenoid A electrical failure — open or shorted coil",
    cause_category: "transmission",
    confidence_base: 0.50,
    success_rate: 0.40,
    parts_needed: ["shift solenoid A", "ATF", "transmission filter"],
    labor_category: "intermediate",
    labor_hours_estimate: 2.5,
    diagnostic_steps: [
      "Measure solenoid resistance — compare to specification (typically 12-25 ohms)",
      "Check for 12V power and PCM/TCM ground signal at connector",
      "Solenoid is usually inside transmission — requires pan drop to access",
      "Check transmission fluid for contamination that could block solenoid"
    ],
    common_misdiagnosis: null,
    source: "community"
  },
  {
    dtc_code: "P0751",
    dtc_description: "Shift Solenoid A Performance or Stuck Off",
    cause: "Shift solenoid A stuck or restricted by debris",
    cause_category: "transmission",
    confidence_base: 0.50,
    success_rate: 0.38,
    parts_needed: ["shift solenoid A", "transmission filter", "ATF"],
    labor_category: "intermediate",
    labor_hours_estimate: 2.5,
    diagnostic_steps: [
      "Performance/stuck off means solenoid is not performing mechanically",
      "Electrical tests may pass but solenoid valve is physically stuck",
      "Contaminated transmission fluid is common cause of stuck solenoids",
      "Replace solenoid and change filter/fluid",
      "Check for other transmission codes — may indicate broader internal issue"
    ],
    common_misdiagnosis: null,
    source: "community"
  },

  // =========================================================================
  // P0755 — Shift Solenoid B
  // =========================================================================
  {
    dtc_code: "P0755",
    dtc_description: "Shift Solenoid B Malfunction",
    cause: "Shift solenoid B electrical failure",
    cause_category: "transmission",
    confidence_base: 0.50,
    success_rate: 0.40,
    parts_needed: ["shift solenoid B", "ATF", "transmission filter"],
    labor_category: "intermediate",
    labor_hours_estimate: 2.5,
    diagnostic_steps: [
      "Measure solenoid B resistance — compare to specification",
      "Check for power and ground at solenoid connector",
      "Solenoid B controls specific gear ranges — check which gears are affected",
      "Replace solenoid with transmission fluid and filter service"
    ],
    common_misdiagnosis: null,
    source: "community"
  },

  // =========================================================================
  // P0760 — Shift Solenoid C
  // =========================================================================
  {
    dtc_code: "P0760",
    dtc_description: "Shift Solenoid C Malfunction",
    cause: "Shift solenoid C electrical failure",
    cause_category: "transmission",
    confidence_base: 0.50,
    success_rate: 0.40,
    parts_needed: ["shift solenoid C", "ATF", "transmission filter"],
    labor_category: "intermediate",
    labor_hours_estimate: 2.5,
    diagnostic_steps: [
      "Measure solenoid C resistance",
      "Check wiring from TCM to solenoid connector",
      "Solenoid C typically controls higher gear ratios (3rd, 4th, overdrive)",
      "Replace solenoid and perform fluid service"
    ],
    common_misdiagnosis: null,
    source: "community"
  },

  // =========================================================================
  // P0765 — Shift Solenoid D
  // =========================================================================
  {
    dtc_code: "P0765",
    dtc_description: "Shift Solenoid D Malfunction",
    cause: "Shift solenoid D electrical failure",
    cause_category: "transmission",
    confidence_base: 0.50,
    success_rate: 0.40,
    parts_needed: ["shift solenoid D", "ATF", "transmission filter"],
    labor_category: "intermediate",
    labor_hours_estimate: 2.5,
    diagnostic_steps: [
      "Measure solenoid D resistance",
      "Verify power and ground circuits",
      "Check which gears are affected — solenoid D varies by transmission type",
      "Replace solenoid and perform full fluid service"
    ],
    common_misdiagnosis: null,
    source: "community"
  },

  // =========================================================================
  // P0770 — Shift Solenoid E
  // =========================================================================
  {
    dtc_code: "P0770",
    dtc_description: "Shift Solenoid E Malfunction",
    cause: "Shift solenoid E electrical failure",
    cause_category: "transmission",
    confidence_base: 0.50,
    success_rate: 0.40,
    parts_needed: ["shift solenoid E", "ATF", "transmission filter"],
    labor_category: "intermediate",
    labor_hours_estimate: 2.5,
    diagnostic_steps: [
      "Measure solenoid E resistance",
      "Verify power and ground circuits",
      "Solenoid E is typically used in newer 6+ speed transmissions",
      "Replace solenoid and service transmission fluid"
    ],
    common_misdiagnosis: null,
    source: "community"
  },

  // =========================================================================
  // P0457 — EVAP Leak (Fuel Cap Loose/Off)
  // =========================================================================
  {
    dtc_code: "P0457",
    dtc_description: "Evaporative Emission Control System Leak Detected (Fuel Cap Loose/Off)",
    cause: "Gas cap not properly tightened or left off after fueling",
    cause_category: "emissions",
    confidence_base: 0.80,
    success_rate: 0.70,
    parts_needed: ["gas cap"],
    labor_category: "basic",
    labor_hours_estimate: 0.1,
    diagnostic_steps: [
      "This code specifically indicates PCM detected cap-related leak",
      "Tighten gas cap until it clicks 3 times",
      "If cap seal is cracked or deformed, replace cap",
      "Clear code — may take 2-3 drive cycles to complete EVAP monitor"
    ],
    common_misdiagnosis: null,
    source: "community"
  },

  // =========================================================================
  // P0110 — IAT Circuit
  // =========================================================================
  {
    dtc_code: "P0110",
    dtc_description: "Intake Air Temperature Circuit Malfunction",
    cause: "Failed IAT sensor — open or shorted",
    cause_category: "fuel",
    confidence_base: 0.55,
    success_rate: 0.45,
    parts_needed: ["IAT sensor"],
    labor_category: "basic",
    labor_hours_estimate: 0.3,
    diagnostic_steps: [
      "Check IAT reading on scan tool — should reflect actual air temp",
      "Measure sensor resistance — compare to temp/resistance chart",
      "At 70F, typical resistance is 2000-3000 ohms",
      "If resistance is open or shorted, replace sensor"
    ],
    common_misdiagnosis: null,
    source: "community"
  },
  {
    dtc_code: "P0110",
    dtc_description: "Intake Air Temperature Circuit Malfunction",
    cause: "Wiring or connector fault in IAT circuit",
    cause_category: "electrical",
    confidence_base: 0.30,
    success_rate: 0.22,
    parts_needed: ["wiring repair"],
    labor_category: "basic",
    labor_hours_estimate: 0.3,
    diagnostic_steps: [
      "Check wiring from IAT sensor to PCM for breaks or shorts",
      "On some vehicles, IAT is integrated into MAF sensor",
      "Check connector for corrosion",
      "Repair or replace damaged wiring"
    ],
    common_misdiagnosis: null,
    source: "community"
  },
];
