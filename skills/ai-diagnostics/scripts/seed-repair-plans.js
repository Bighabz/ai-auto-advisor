/**
 * seed-repair-plans.js — Enrich Top 40 DTC+Vehicle Combos with Repair Plans
 *
 * Updates existing diagnostic_knowledge rows with detailed repair_plan jsonb
 * objects for the 40 highest-frequency DTC+vehicle combinations.
 *
 * Each repair_plan includes: parts, labor, tools, torque_specs, verification,
 * and diagrams_needed — all with realistic, accurate automotive data.
 *
 * Run via: node seed-repair-plans.js
 * Exports: { seedRepairPlans }
 */

const { getSupabase } = require("./embeddings");

// ---------------------------------------------------------------------------
// Top 40 Repair Plans — ordered by expected real-world frequency
// ---------------------------------------------------------------------------

const REPAIR_PLANS = [
  // =========================================================================
  // 1. P0420 — Honda Civic 2.0L — Catalytic Converter Replacement
  // =========================================================================
  {
    dtc_code: "P0420",
    vehicle_make: "Honda",
    vehicle_model: "Civic",
    engine_type: "2.0L",
    repair_plan: {
      parts: [
        {
          name: "catalytic converter",
          position: "front, underbody",
          qty: 1,
          type: "direct-fit",
          oem_preferred: true,
          conditional: false,
          condition: null,
          search_terms: ["catalytic converter Honda Civic 2.0L direct fit", "cat converter Civic"]
        },
        {
          name: "exhaust gaskets",
          position: "inlet and outlet flanges",
          qty: 2,
          type: "graphite ring gasket",
          oem_preferred: false,
          conditional: false,
          condition: null,
          search_terms: ["exhaust donut gasket Honda Civic", "catalytic converter gasket"]
        },
        {
          name: "exhaust flange bolts",
          position: "inlet and outlet flanges",
          qty: 4,
          type: "M10x1.25 flange bolt",
          oem_preferred: false,
          conditional: true,
          condition: "Replace if rusted or stretched during removal",
          search_terms: ["exhaust flange bolt M10 Honda", "catalytic converter bolt"]
        }
      ],
      labor: {
        hours: 2.5,
        source: "estimated",
        category: "advanced",
        requires_lift: true,
        special_notes: "Apply penetrating oil to all exhaust flange bolts 24 hrs prior. Use torch on rusted fasteners if needed."
      },
      tools: ["22mm O2 sensor socket", "penetrating oil (PB Blaster)", "14mm socket", "torque wrench", "jack stands or lift", "wire brush"],
      torque_specs: {
        "cat converter inlet flange bolts": "33 ft-lb",
        "cat converter outlet flange bolts": "33 ft-lb",
        "upstream O2 sensor": "33 ft-lb",
        "downstream O2 sensor": "33 ft-lb"
      },
      verification: {
        before_repair: "Compare upstream O2 (B1S1) vs downstream O2 (B1S2) waveforms. Upstream should oscillate rapidly 0.1-0.9V. If downstream mirrors upstream, converter is confirmed failed.",
        after_repair: "Clear all DTCs. Drive 50+ miles through mixed city/highway driving to complete catalyst monitor. Verify downstream O2 reads steady 0.5-0.8V at cruise. Confirm no P0420 return after 2 drive cycles."
      },
      diagrams_needed: ["catalytic converter location Honda Civic 10th gen", "O2 sensor wiring diagram B1S1 B1S2"]
    }
  },

  // =========================================================================
  // 2. P0420 — Toyota Camry 2.5L — Catalytic Converter Replacement
  // =========================================================================
  {
    dtc_code: "P0420",
    vehicle_make: "Toyota",
    vehicle_model: "Camry",
    engine_type: "2.5L",
    repair_plan: {
      parts: [
        {
          name: "catalytic converter",
          position: "front, underbody",
          qty: 1,
          type: "direct-fit CARB-compliant",
          oem_preferred: true,
          conditional: false,
          condition: null,
          search_terms: ["catalytic converter Toyota Camry 2.5L 2AR-FE", "cat converter Camry CARB"]
        },
        {
          name: "exhaust gaskets",
          position: "converter inlet and outlet",
          qty: 2,
          type: "multi-layer steel gasket",
          oem_preferred: false,
          conditional: false,
          condition: null,
          search_terms: ["exhaust gasket Toyota Camry catalytic converter", "2AR-FE exhaust gasket"]
        }
      ],
      labor: {
        hours: 2.5,
        source: "estimated",
        category: "advanced",
        requires_lift: true,
        special_notes: "Check for Toyota extended emissions warranty coverage before repair. Exhaust bolts are often seized — heat with torch."
      },
      tools: ["22mm O2 sensor socket", "14mm deep socket", "penetrating oil", "torque wrench", "pry bar", "wire brush", "anti-seize compound"],
      torque_specs: {
        "cat converter flange bolts": "32 ft-lb",
        "upstream O2 sensor (B1S1)": "30 ft-lb",
        "downstream O2 sensor (B1S2)": "30 ft-lb"
      },
      verification: {
        before_repair: "Monitor B1S1 and B1S2 waveforms. Upstream should oscillate 6-8 times per 10 seconds. If downstream mirrors upstream switching, converter is failed.",
        after_repair: "Clear DTCs and drive through complete catalyst monitor drive cycle (requires warm-up, cruise at 45-65 mph for 5+ min, decel). Confirm P0420 does not return after 3 drive cycles."
      },
      diagrams_needed: ["catalytic converter location Toyota Camry 2AR-FE", "O2 sensor connector locations Camry"]
    }
  },

  // =========================================================================
  // 3. P0420 — Chevrolet Silverado 5.3L — Catalytic Converter Replacement
  // =========================================================================
  {
    dtc_code: "P0420",
    vehicle_make: "Chevrolet",
    vehicle_model: "Silverado",
    engine_type: "5.3L V8",
    repair_plan: {
      parts: [
        {
          name: "catalytic converter",
          position: "bank 1 underbody",
          qty: 1,
          type: "direct-fit",
          oem_preferred: true,
          conditional: false,
          condition: null,
          search_terms: ["catalytic converter Silverado 5.3L bank 1", "cat converter GM 5.3 underbody"]
        },
        {
          name: "exhaust gaskets",
          position: "inlet and outlet flanges",
          qty: 2,
          type: "graphite donut gasket",
          oem_preferred: false,
          conditional: false,
          condition: null,
          search_terms: ["exhaust gasket Silverado catalytic converter", "GM truck exhaust gasket"]
        },
        {
          name: "exhaust clamp",
          position: "converter outlet to exhaust pipe",
          qty: 1,
          type: "band clamp 2.5 inch",
          oem_preferred: false,
          conditional: true,
          condition: "Required if outlet uses slip-fit connection instead of flange",
          search_terms: ["exhaust band clamp 2.5 inch GM truck"]
        }
      ],
      labor: {
        hours: 3.0,
        source: "estimated",
        category: "advanced",
        requires_lift: true,
        special_notes: "Dual exhaust system — identify which bank is triggering P0420 (bank 1 = driver side). Address AFM-related oil consumption before replacing to prevent repeat failure."
      },
      tools: ["22mm O2 sensor socket", "15mm socket", "18mm wrench", "penetrating oil", "torque wrench", "reciprocating saw (for seized bolts)", "exhaust hanger removal tool"],
      torque_specs: {
        "cat converter flange bolts": "37 ft-lb",
        "O2 sensor": "30 ft-lb",
        "exhaust band clamp": "40 ft-lb"
      },
      verification: {
        before_repair: "Confirm P0420 is bank 1 (not P0430 bank 2). Monitor B1S1 vs B1S2 O2 waveforms. Check oil consumption rate — if >1 qt per 2,000 miles, address AFM oil consumption first.",
        after_repair: "Clear codes. Drive 75+ miles mixed driving. Monitor downstream O2 — should be steady 0.6-0.7V at cruise. Confirm code does not return. Monitor oil consumption."
      },
      diagrams_needed: ["catalytic converter location Silverado 5.3L dual exhaust", "O2 sensor bank identification GM 5.3L"]
    }
  },

  // =========================================================================
  // 4. P0171 — Ford F-150 3.5L EcoBoost — Lean Condition
  // =========================================================================
  {
    dtc_code: "P0171",
    vehicle_make: "Ford",
    vehicle_model: "F-150",
    engine_type: "3.5L EcoBoost",
    repair_plan: {
      parts: [
        {
          name: "charge air cooler bypass valve",
          position: "intercooler outlet",
          qty: 1,
          type: "updated design per TSB 15-0148",
          oem_preferred: true,
          conditional: false,
          condition: null,
          search_terms: ["Ford F-150 EcoBoost charge air cooler bypass valve", "intercooler bypass valve 3.5 EcoBoost"]
        },
        {
          name: "intercooler boot/hose",
          position: "between intercooler and throttle body",
          qty: 1,
          type: "silicone reinforced",
          oem_preferred: false,
          conditional: true,
          condition: "Replace if cracked or collapsed — common failure point",
          search_terms: ["F-150 3.5 EcoBoost intercooler hose", "charge pipe boot 3.5 EcoBoost"]
        }
      ],
      labor: {
        hours: 1.5,
        source: "estimated",
        category: "intermediate",
        requires_lift: false,
        special_notes: "Ford TSB 15-0148 addresses charge air cooler condensation causing lean stumble. Check all intercooler piping connections for boost leaks."
      },
      tools: ["T30 Torx socket", "7mm socket", "8mm socket", "hose clamp pliers", "boost leak tester (optional)", "scan tool with Ford IDS capability"],
      torque_specs: {
        "charge air cooler bypass valve bolts": "89 in-lb",
        "intercooler hose clamps": "35 in-lb"
      },
      verification: {
        before_repair: "Check LTFT at idle and at cruise. If LTFT > +15%, lean condition confirmed. Compare bank 1 vs bank 2 fuel trims to determine if issue is bank-specific or systemic.",
        after_repair: "Clear codes and adaptations. Drive through multiple WOT pulls and decel events. Monitor LTFT — should return to +/-5%. Confirm no stumble under boost in humid conditions."
      },
      diagrams_needed: ["intercooler piping diagram F-150 3.5 EcoBoost", "charge air cooler bypass valve location"]
    }
  },

  // =========================================================================
  // 5. P0300 — Ford F-150 3.5L EcoBoost — Random Misfire
  // =========================================================================
  {
    dtc_code: "P0300",
    vehicle_make: "Ford",
    vehicle_model: "F-150",
    engine_type: "3.5L EcoBoost",
    repair_plan: {
      parts: [
        {
          name: "walnut blasting service",
          position: "intake valves all 6 cylinders",
          qty: 1,
          type: "professional carbon cleaning service",
          oem_preferred: false,
          conditional: false,
          condition: null,
          search_terms: ["walnut blast intake valve cleaning EcoBoost", "carbon cleaning direct injection 3.5"]
        },
        {
          name: "intake manifold gasket",
          position: "intake manifold to cylinder head",
          qty: 1,
          type: "multi-layer steel gasket",
          oem_preferred: true,
          conditional: false,
          condition: null,
          search_terms: ["intake manifold gasket Ford 3.5 EcoBoost", "F-150 EcoBoost intake gasket"]
        },
        {
          name: "spark plugs",
          position: "all 6 cylinders",
          qty: 6,
          type: "Motorcraft SP-534 iridium",
          oem_preferred: true,
          conditional: true,
          condition: "Replace if over 60,000 miles or found fouled during removal",
          search_terms: ["Motorcraft SP-534 spark plug EcoBoost", "F-150 3.5 EcoBoost spark plug"]
        }
      ],
      labor: {
        hours: 4.0,
        source: "estimated",
        category: "advanced",
        requires_lift: false,
        special_notes: "Intake manifold must be removed to access intake ports for walnut blasting. Use shop vac to collect walnut shell debris. Consider catch can installation to reduce future carbon buildup."
      },
      tools: ["walnut blasting media and gun", "shop vacuum", "10mm socket", "8mm socket", "T30 Torx", "intake manifold gasket scraper", "borescope (pre-inspection)", "spark plug socket 5/8 inch"],
      torque_specs: {
        "intake manifold bolts": "89 in-lb (sequence: center outward)",
        "spark plugs": "11 ft-lb",
        "ignition coil bolts": "53 in-lb"
      },
      verification: {
        before_repair: "Borescope intake ports to confirm carbon buildup. Check misfire counters on all cylinders — random/multiple cylinder misfires on cold start strongly suggest carbon deposits on DI engine.",
        after_repair: "Clear all codes and misfire counters. Perform cold start and monitor for misfires during first 60 seconds. Drive 30+ miles and verify no misfire codes return. Recheck misfire counters — all should be 0."
      },
      diagrams_needed: ["intake manifold removal Ford 3.5 EcoBoost", "intake manifold bolt torque sequence", "spark plug location EcoBoost 3.5L"]
    }
  },

  // =========================================================================
  // 6. P0300 — Honda Civic 1.5T — Random Misfire (Carbon Buildup)
  // =========================================================================
  {
    dtc_code: "P0300",
    vehicle_make: "Honda",
    vehicle_model: "Civic",
    engine_type: "1.5L Turbo",
    repair_plan: {
      parts: [
        {
          name: "walnut blasting service",
          position: "intake valves all 4 cylinders",
          qty: 1,
          type: "professional carbon cleaning service",
          oem_preferred: false,
          conditional: false,
          condition: null,
          search_terms: ["walnut blast intake cleaning Honda 1.5T", "carbon cleaning Honda Civic turbo"]
        },
        {
          name: "intake manifold gasket",
          position: "intake manifold to head",
          qty: 1,
          type: "OEM rubber gasket",
          oem_preferred: true,
          conditional: false,
          condition: null,
          search_terms: ["intake manifold gasket Honda Civic 1.5T L15B7", "Civic turbo intake gasket"]
        },
        {
          name: "spark plugs",
          position: "all 4 cylinders",
          qty: 4,
          type: "NGK DILKAR7G11GS (or equivalent iridium)",
          oem_preferred: true,
          conditional: true,
          condition: "Replace if over 30,000 miles on turbo application",
          search_terms: ["NGK DILKAR7G11GS Honda Civic 1.5T spark plug", "Honda Civic turbo spark plug"]
        }
      ],
      labor: {
        hours: 3.0,
        source: "estimated",
        category: "advanced",
        requires_lift: false,
        special_notes: "Direct injection engines lack fuel washing of intake valves. Remove intake manifold to access ports. Consider oil catch can installation (PCV re-route) to reduce recurrence."
      },
      tools: ["walnut blasting media and gun", "shop vacuum", "10mm socket", "12mm socket", "intake manifold gasket scraper", "borescope", "spark plug socket 14mm thin-wall", "torque wrench"],
      torque_specs: {
        "intake manifold bolts": "16 ft-lb",
        "spark plugs": "13 ft-lb",
        "ignition coil bolts": "9 ft-lb"
      },
      verification: {
        before_repair: "Borescope intake ports to visually confirm carbon buildup. Check misfire counters — cold start misfires are characteristic of carbon deposits on DI engines.",
        after_repair: "Clear all codes. Cold start the engine and monitor for smooth idle within first 30 seconds. Drive 20+ miles and verify misfire counters remain at 0. No codes should return."
      },
      diagrams_needed: ["intake manifold removal Honda Civic 1.5T L15B7", "spark plug access Honda 1.5T"]
    }
  },

  // =========================================================================
  // 7. P0300 — Chevrolet Silverado 5.3L — AFM Lifter Failure
  // =========================================================================
  {
    dtc_code: "P0300",
    vehicle_make: "Chevrolet",
    vehicle_model: "Silverado",
    engine_type: "5.3L V8",
    repair_plan: {
      parts: [
        {
          name: "AFM lifters (full set of 16)",
          position: "all cylinder lifter bores",
          qty: 1,
          type: "non-AFM lifter set (AFM delete) or OEM replacement",
          oem_preferred: false,
          conditional: false,
          condition: null,
          search_terms: ["5.3L AFM lifter set", "Silverado AFM delete lifter kit", "GM 5.3 DOD lifters"]
        },
        {
          name: "camshaft",
          position: "engine block center",
          qty: 1,
          type: "non-AFM performance cam or OEM replacement",
          oem_preferred: false,
          conditional: true,
          condition: "Required for AFM delete; inspect for wear if replacing lifters only",
          search_terms: ["5.3L AFM delete camshaft", "Silverado non-DOD cam"]
        },
        {
          name: "AFM delete kit",
          position: "valley cover area",
          qty: 1,
          type: "includes VLOM plate, valley cover gasket, updated oil pump",
          oem_preferred: false,
          conditional: true,
          condition: "Only if performing AFM delete rather than OEM lifter replacement",
          search_terms: ["GM 5.3 AFM delete kit", "Silverado DOD delete kit"]
        },
        {
          name: "engine oil and filter",
          position: "oil pan and filter housing",
          qty: 1,
          type: "8 quarts Dexos1 5W-30 + ACDelco PF64 filter",
          oem_preferred: true,
          conditional: false,
          condition: null,
          search_terms: ["ACDelco PF64 oil filter", "Dexos1 5W-30 8 quarts"]
        }
      ],
      labor: {
        hours: 12.0,
        source: "estimated",
        category: "advanced",
        requires_lift: true,
        special_notes: "Major engine repair. Requires intake manifold, valley cover, and lifter tray removal. If performing AFM delete, also need PCM tune to disable AFM. Check oil for metal debris before beginning — excessive debris may indicate further damage."
      },
      tools: ["intake manifold tool set", "lifter tray bolts (T55 Torx)", "valve spring compressor", "10mm socket", "8mm socket", "13mm socket", "15mm socket", "torque wrench (in-lb and ft-lb)", "magnetic pickup tool", "engine oil priming tool"],
      torque_specs: {
        "lifter tray bolts": "18 ft-lb",
        "intake manifold bolts": "44 in-lb first pass, 89 in-lb final",
        "valley cover bolts": "18 ft-lb",
        "valve cover bolts": "106 in-lb",
        "spark plugs": "11 ft-lb"
      },
      verification: {
        before_repair: "Check misfire counters — if misfires concentrate on AFM cylinders (1, 4, 6, 7), suspect AFM lifter. Listen for lifter tick with stethoscope. Check oil for metal flakes. Reference GM TSB 18-NA-355.",
        after_repair: "Prime oil system before first start. Start engine and check for oil pressure immediately. Run engine and verify no lifter tick. Clear codes and drive 50+ miles monitoring misfire counters — all should be 0. If AFM delete, verify PCM tune disables V4 mode."
      },
      diagrams_needed: ["GM 5.3L Gen V lifter tray removal", "intake manifold bolt torque sequence 5.3L", "AFM cylinder identification diagram"]
    }
  },

  // =========================================================================
  // 8. P0171 — Toyota Camry 2.5L — Lean Condition (Intake Gasket)
  // =========================================================================
  {
    dtc_code: "P0171",
    vehicle_make: "Toyota",
    vehicle_model: "Camry",
    engine_type: "2.5L",
    repair_plan: {
      parts: [
        {
          name: "intake manifold gasket",
          position: "between intake manifold and cylinder head",
          qty: 1,
          type: "updated multi-layer steel gasket",
          oem_preferred: true,
          conditional: false,
          condition: null,
          search_terms: ["intake manifold gasket Toyota Camry 2.5L 2AR-FE", "Toyota 2AR intake gasket"]
        },
        {
          name: "throttle body gasket",
          position: "between throttle body and intake manifold",
          qty: 1,
          type: "OEM rubber gasket",
          oem_preferred: true,
          conditional: true,
          condition: "Replace if disturbed during removal or if showing deterioration",
          search_terms: ["throttle body gasket Toyota Camry 2.5L", "2AR-FE throttle body gasket"]
        }
      ],
      labor: {
        hours: 2.0,
        source: "estimated",
        category: "intermediate",
        requires_lift: false,
        special_notes: "Known issue on 2AR-FE engine. Clean all gasket mating surfaces thoroughly. Inspect intake manifold for warping with straight edge."
      },
      tools: ["10mm socket", "12mm socket", "gasket scraper", "straight edge", "torque wrench", "shop vacuum", "throttle body cleaner"],
      torque_specs: {
        "intake manifold bolts": "22 ft-lb (tighten in sequence center outward)",
        "throttle body bolts": "80 in-lb"
      },
      verification: {
        before_repair: "Check LTFT — if above +15%, lean condition confirmed. Smoke test intake manifold focusing on lower gasket area. Compare LTFT at idle vs cruise to distinguish vacuum leak from fuel delivery issue.",
        after_repair: "Clear codes and fuel trim adaptations. Idle for 10 minutes monitoring STFT and LTFT. Drive 20+ miles — LTFT should return to +/-5%. Confirm P0171 does not return."
      },
      diagrams_needed: ["intake manifold removal 2AR-FE Toyota Camry", "intake manifold bolt torque sequence 2AR-FE"]
    }
  },

  // =========================================================================
  // 9. P0171 — Nissan Altima 2.5L — Lean Condition (Intake Gasket)
  // =========================================================================
  {
    dtc_code: "P0171",
    vehicle_make: "Nissan",
    vehicle_model: "Altima",
    engine_type: "2.5L",
    repair_plan: {
      parts: [
        {
          name: "intake manifold gasket",
          position: "between intake manifold and cylinder head",
          qty: 1,
          type: "updated design gasket",
          oem_preferred: true,
          conditional: false,
          condition: null,
          search_terms: ["intake manifold gasket Nissan Altima 2.5L QR25DE", "QR25DE intake gasket"]
        }
      ],
      labor: {
        hours: 2.0,
        source: "estimated",
        category: "intermediate",
        requires_lift: false,
        special_notes: "QR25DE intake manifold gaskets are a known failure item. Clean mating surfaces carefully. Inspect for vacuum hose deterioration while manifold is accessible."
      },
      tools: ["10mm socket", "12mm socket", "gasket scraper", "torque wrench", "shop vacuum", "smoke machine (pre-diagnosis)"],
      torque_specs: {
        "intake manifold bolts": "16 ft-lb (tighten in 2 steps, center outward)",
        "throttle body bolts": "80 in-lb"
      },
      verification: {
        before_repair: "Confirm LTFT > +15%. Smoke test intake manifold — focus on lower gasket area between runners and head. Compare bank fuel trims.",
        after_repair: "Clear DTCs and fuel trims. Idle 10 minutes, then drive 20+ miles. LTFT should normalize to +/-5%. Confirm no lean codes return after 2 drive cycles."
      },
      diagrams_needed: ["intake manifold removal QR25DE Nissan Altima", "intake manifold bolt sequence QR25DE"]
    }
  },

  // =========================================================================
  // 10. P0420 — Ford F-150 5.0L V8 — Catalytic Converter Replacement
  // =========================================================================
  {
    dtc_code: "P0420",
    vehicle_make: "Ford",
    vehicle_model: "F-150",
    engine_type: "5.0L V8",
    repair_plan: {
      parts: [
        {
          name: "catalytic converter",
          position: "bank 1 underbody (passenger side)",
          qty: 1,
          type: "direct-fit OEM-quality",
          oem_preferred: true,
          conditional: false,
          condition: null,
          search_terms: ["catalytic converter Ford F-150 5.0L Coyote bank 1", "cat converter F150 5.0 passenger"]
        },
        {
          name: "exhaust gaskets",
          position: "converter inlet and outlet flanges",
          qty: 2,
          type: "graphite donut gasket",
          oem_preferred: false,
          conditional: false,
          condition: null,
          search_terms: ["exhaust gasket Ford F-150 5.0L catalytic converter", "Coyote exhaust flange gasket"]
        }
      ],
      labor: {
        hours: 3.0,
        source: "estimated",
        category: "advanced",
        requires_lift: true,
        special_notes: "5.0L Coyote has 4 catalytic converters — 2 close-coupled and 2 underbody. Identify failing bank from O2 sensor data. Bank 1 = passenger side on Coyote V8."
      },
      tools: ["22mm O2 sensor socket", "15mm socket", "18mm socket", "penetrating oil", "torque wrench", "exhaust cutter (if needed)", "pry bar"],
      torque_specs: {
        "cat converter flange bolts": "35 ft-lb",
        "O2 sensor": "30 ft-lb"
      },
      verification: {
        before_repair: "Identify which bank — P0420 = bank 1 (passenger), P0430 = bank 2 (driver). Compare B1S1 vs B1S2 waveforms. Check for exhaust leaks at manifold-to-cat connection.",
        after_repair: "Clear codes. Drive 75+ miles mixed driving. Monitor B1S2 — should read steady 0.5-0.8V at cruise. Confirm P0420 does not return after 3 complete drive cycles."
      },
      diagrams_needed: ["catalytic converter location Ford F-150 5.0L Coyote", "bank identification Coyote V8", "O2 sensor locations F-150 5.0L"]
    }
  },

  // =========================================================================
  // 11. P0455 — Honda Civic 1.5T — EVAP Gross Leak
  // =========================================================================
  {
    dtc_code: "P0455",
    vehicle_make: "Honda",
    vehicle_model: "Civic",
    engine_type: "1.5L Turbo",
    repair_plan: {
      parts: [
        {
          name: "EVAP canister vent shut valve",
          position: "near charcoal canister, rear of vehicle",
          qty: 1,
          type: "OEM Honda vent shut valve",
          oem_preferred: true,
          conditional: false,
          condition: null,
          search_terms: ["Honda Civic EVAP canister vent shut valve", "Civic 1.5T EVAP vent valve"]
        }
      ],
      labor: {
        hours: 1.0,
        source: "estimated",
        category: "intermediate",
        requires_lift: true,
        special_notes: "Valve is located near the charcoal canister under the vehicle near the fuel tank. Test with bidirectional scan tool control before replacing."
      },
      tools: ["scan tool with Honda bidirectional control", "10mm socket", "Phillips screwdriver", "EVAP smoke machine (diagnosis)"],
      torque_specs: {
        "vent shut valve mounting bolt": "7 ft-lb",
        "EVAP hose clamps": "hand tight with spring clamps"
      },
      verification: {
        before_repair: "Use scan tool to command vent shut valve closed — listen for click. If no click or EVAP system cannot hold vacuum, valve is failed. Smoke test to confirm no other leaks.",
        after_repair: "Command vent shut valve with scan tool — verify click and proper operation. Clear codes. Drive through EVAP monitor cycle (requires 1/4-3/4 fuel tank, moderate ambient temp). Confirm code does not return."
      },
      diagrams_needed: ["EVAP system diagram Honda Civic 10th gen", "canister vent shut valve location"]
    }
  },

  // =========================================================================
  // 12. P0442 — Toyota Camry 2.5L — EVAP Small Leak
  // =========================================================================
  {
    dtc_code: "P0442",
    vehicle_make: "Toyota",
    vehicle_model: "Camry",
    engine_type: "2.5L",
    repair_plan: {
      parts: [
        {
          name: "EVAP canister purge VSV (vacuum switching valve)",
          position: "engine bay, near intake manifold",
          qty: 1,
          type: "OEM Toyota vacuum switching valve",
          oem_preferred: true,
          conditional: false,
          condition: null,
          search_terms: ["Toyota Camry EVAP purge VSV", "canister purge valve Toyota 2.5L"]
        },
        {
          name: "gas cap",
          position: "fuel filler neck",
          qty: 1,
          type: "OEM Toyota gas cap with seal",
          oem_preferred: true,
          conditional: true,
          condition: "Replace first as cheapest diagnostic step — if code returns, proceed to VSV",
          search_terms: ["Toyota Camry gas cap OEM", "fuel cap Camry"]
        }
      ],
      labor: {
        hours: 0.5,
        source: "estimated",
        category: "basic",
        requires_lift: false,
        special_notes: "Start with gas cap replacement. If code returns, test purge VSV. Toyota uses vacuum switching valves — test by applying vacuum and commanding with scan tool."
      },
      tools: ["scan tool with Toyota active test", "hand vacuum pump", "10mm socket"],
      torque_specs: {
        "purge VSV mounting bolt": "5 ft-lb",
        "gas cap": "tighten until 3 clicks"
      },
      verification: {
        before_repair: "Use scan tool active test to command purge VSV open/close. Apply vacuum to VSV — should hold when de-energized, release when energized. If leaks, replacement needed.",
        after_repair: "Clear codes. Drive through EVAP monitor drive cycle (cold start, warm up, cruise at 45-65 mph, tank between 1/4 and 3/4 full). Confirm no EVAP codes return after 2 cycles."
      },
      diagrams_needed: ["EVAP system diagram Toyota Camry 2AR-FE", "purge VSV location Camry engine bay"]
    }
  },

  // =========================================================================
  // 13. P0456 — Nissan Rogue 2.5L — EVAP Very Small Leak
  // =========================================================================
  {
    dtc_code: "P0456",
    vehicle_make: "Nissan",
    vehicle_model: "Rogue",
    engine_type: "2.5L",
    repair_plan: {
      parts: [
        {
          name: "EVAP purge valve",
          position: "engine bay, on or near intake manifold",
          qty: 1,
          type: "OEM Nissan purge valve",
          oem_preferred: true,
          conditional: false,
          condition: null,
          search_terms: ["Nissan Rogue EVAP purge valve", "EVAP canister purge solenoid QR25DE Rogue"]
        },
        {
          name: "gas cap",
          position: "fuel filler neck",
          qty: 1,
          type: "OEM Nissan gas cap",
          oem_preferred: true,
          conditional: true,
          condition: "Try replacing gas cap first — cheapest and most common fix for very small leaks",
          search_terms: ["Nissan Rogue gas cap OEM", "fuel filler cap Rogue"]
        }
      ],
      labor: {
        hours: 0.5,
        source: "estimated",
        category: "basic",
        requires_lift: false,
        special_notes: "Very small leaks are hardest to find. Start with gas cap. If code persists, test purge valve with vacuum and scan tool active test. Smoke test if needed."
      },
      tools: ["hand vacuum pump", "scan tool with Nissan active test", "10mm socket", "EVAP smoke machine"],
      torque_specs: {
        "purge valve bolts": "5 ft-lb",
        "gas cap": "tighten until clicks"
      },
      verification: {
        before_repair: "Apply vacuum to purge valve — should hold vacuum when de-energized. Energize valve and verify vacuum releases. If leaking, replace.",
        after_repair: "Clear codes. EVAP monitor requires specific conditions: cold start, fuel level 1/4-3/4, ambient temp 40-95F. Drive through 2 complete EVAP cycles. Confirm no return."
      },
      diagrams_needed: ["EVAP system diagram Nissan Rogue QR25DE", "purge valve location Rogue engine bay"]
    }
  },

  // =========================================================================
  // 14. P0128 — Hyundai Sonata 2.4L — Thermostat
  // =========================================================================
  {
    dtc_code: "P0128",
    vehicle_make: "Hyundai",
    vehicle_model: "Sonata",
    engine_type: "2.4L",
    repair_plan: {
      parts: [
        {
          name: "thermostat",
          position: "lower radiator hose housing on engine block",
          qty: 1,
          type: "OEM Hyundai thermostat (195F rating)",
          oem_preferred: true,
          conditional: false,
          condition: null,
          search_terms: ["Hyundai Sonata 2.4L thermostat Theta II", "thermostat Sonata 2015-2019"]
        },
        {
          name: "thermostat housing gasket",
          position: "thermostat housing to engine block",
          qty: 1,
          type: "O-ring seal",
          oem_preferred: true,
          conditional: false,
          condition: null,
          search_terms: ["thermostat housing gasket Hyundai Sonata 2.4L", "Theta II thermostat O-ring"]
        },
        {
          name: "engine coolant",
          position: "cooling system",
          qty: 1,
          type: "2 gallons Hyundai/Kia long-life coolant (blue or green depending on year)",
          oem_preferred: true,
          conditional: false,
          condition: null,
          search_terms: ["Hyundai long life coolant", "Kia coolant concentrate"]
        }
      ],
      labor: {
        hours: 1.5,
        source: "estimated",
        category: "intermediate",
        requires_lift: false,
        special_notes: "Drain coolant below thermostat level before removal. Theta II thermostat is in the lower radiator hose housing. Bleed cooling system thoroughly after refill — air pockets cause overheating."
      },
      tools: ["10mm socket", "12mm socket", "coolant drain pan", "funnel with spill-free adapter", "torque wrench", "pliers (for hose clamp)"],
      torque_specs: {
        "thermostat housing bolts": "14 ft-lb",
        "coolant drain plug": "hand tight"
      },
      verification: {
        before_repair: "Monitor ECT with scan tool during warm-up drive. If ECT does not reach 195F within 15 minutes of driving, thermostat is stuck open. Check upper radiator hose — should stay cool until thermostat opens.",
        after_repair: "Fill and bleed cooling system. Warm engine to operating temp — ECT should reach 195-210F and stabilize. Verify upper rad hose gets hot when thermostat opens. Clear codes and monitor for 2 drive cycles."
      },
      diagrams_needed: ["thermostat location Hyundai Sonata Theta II 2.4L", "cooling system bleed procedure Sonata"]
    }
  },

  // =========================================================================
  // 15. P0128 — Chevrolet Equinox 1.5T — Thermostat (hidden: check for
  //     Kia Optima P0128 pattern — same Theta II engine as Sonata)
  // =========================================================================
  {
    dtc_code: "P0171",
    vehicle_make: "Chevrolet",
    vehicle_model: "Equinox",
    engine_type: "1.5L Turbo",
    repair_plan: {
      parts: [
        {
          name: "PCV valve",
          position: "valve cover, integrated",
          qty: 1,
          type: "ACDelco OEM PCV valve",
          oem_preferred: true,
          conditional: false,
          condition: null,
          search_terms: ["Chevrolet Equinox 1.5T PCV valve", "Equinox PCV valve ACDelco"]
        },
        {
          name: "intake manifold gasket",
          position: "between intake manifold and cylinder head",
          qty: 1,
          type: "OEM multi-layer gasket",
          oem_preferred: true,
          conditional: true,
          condition: "Inspect and replace if showing deterioration during PCV service",
          search_terms: ["intake manifold gasket Chevy Equinox 1.5T", "Equinox 1.5 turbo intake gasket"]
        }
      ],
      labor: {
        hours: 1.0,
        source: "estimated",
        category: "intermediate",
        requires_lift: false,
        special_notes: "1.5T Equinox PCV system failure is a known issue. Check for oil consumption alongside lean codes. GM may cover under special coverage — check with dealer."
      },
      tools: ["10mm socket", "T30 Torx", "gasket scraper", "torque wrench", "smoke machine (diagnosis)"],
      torque_specs: {
        "PCV valve": "hand install, quarter-turn to seat",
        "intake manifold bolts": "18 ft-lb"
      },
      verification: {
        before_repair: "Check LTFT — if > +15%, lean confirmed. Smoke test around PCV valve and intake manifold. Check oil consumption rate between services.",
        after_repair: "Clear codes and fuel trims. Idle 10 min then drive 20+ miles. LTFT should normalize to +/-5%. Monitor oil consumption over next 3,000 miles."
      },
      diagrams_needed: ["PCV valve location Equinox 1.5T", "intake manifold removal Equinox 1.5L turbo"]
    }
  },

  // =========================================================================
  // 16. P0335 — Nissan Altima 2.5L — Crankshaft Position Sensor
  // =========================================================================
  {
    dtc_code: "P0335",
    vehicle_make: "Nissan",
    vehicle_model: "Altima",
    engine_type: "2.5L",
    repair_plan: {
      parts: [
        {
          name: "crankshaft position sensor",
          position: "engine block, near oil filter",
          qty: 1,
          type: "OEM Nissan CKP sensor",
          oem_preferred: true,
          conditional: false,
          condition: null,
          search_terms: ["crankshaft position sensor Nissan Altima QR25DE", "CKP sensor Altima 2.5L"]
        },
        {
          name: "CKP sensor O-ring",
          position: "sensor bore",
          qty: 1,
          type: "rubber O-ring seal",
          oem_preferred: true,
          conditional: false,
          condition: null,
          search_terms: ["CKP sensor O-ring Nissan QR25DE", "crankshaft sensor seal Altima"]
        }
      ],
      labor: {
        hours: 0.5,
        source: "estimated",
        category: "basic",
        requires_lift: false,
        special_notes: "CKP sensor is accessible from top on QR25DE. Clean connector thoroughly — oil leaks from valve cover can contaminate the connector and cause intermittent issues."
      },
      tools: ["10mm socket", "small flathead screwdriver (connector release)", "electrical contact cleaner", "dielectric grease"],
      torque_specs: {
        "CKP sensor bolt": "9 ft-lb"
      },
      verification: {
        before_repair: "Verify intermittent stalling or no-start condition correlates with code. Check CKP signal on scan tool while cranking. Measure sensor resistance (200-2000 ohms typical). Inspect connector for oil contamination.",
        after_repair: "Clear code. Start and idle — verify smooth running. Test drive with multiple starts and stops. Monitor CKP signal stability on scan tool. Confirm no stalling or code return over 50 miles."
      },
      diagrams_needed: ["crankshaft position sensor location QR25DE", "CKP sensor wiring diagram Nissan Altima"]
    }
  },

  // =========================================================================
  // 17. P0340 — BMW 3 Series N20 — VANOS Solenoid
  // =========================================================================
  {
    dtc_code: "P0340",
    vehicle_make: "BMW",
    vehicle_model: "3 Series",
    engine_type: "2.0T N20",
    repair_plan: {
      parts: [
        {
          name: "VANOS solenoid (intake)",
          position: "cylinder head, intake side",
          qty: 1,
          type: "OEM BMW VANOS solenoid with updated seals",
          oem_preferred: true,
          conditional: false,
          condition: null,
          search_terms: ["BMW N20 VANOS solenoid intake", "BMW 3 Series VANOS solenoid 2.0T"]
        },
        {
          name: "VANOS solenoid seals",
          position: "solenoid bore",
          qty: 1,
          type: "Viton O-ring set",
          oem_preferred: true,
          conditional: false,
          condition: null,
          search_terms: ["BMW N20 VANOS solenoid seal kit", "VANOS O-ring N20"]
        }
      ],
      labor: {
        hours: 1.5,
        source: "estimated",
        category: "intermediate",
        requires_lift: false,
        special_notes: "Check VANOS adaptation values with BMW ISTA/D or equivalent scan tool before replacing. If timing chain stretch is suspected (cold start rattle), do NOT replace solenoid alone — timing chain kit is needed."
      },
      tools: ["E10 E-Torx socket", "BMW-specific scan tool (ISTA or equivalent)", "magnetic pickup tool", "torque wrench", "clean shop rags"],
      torque_specs: {
        "VANOS solenoid bolt": "8 ft-lb",
        "valve cover bolts (if removed)": "7 ft-lb"
      },
      verification: {
        before_repair: "Read VANOS adaptation values with BMW scan tool. Monitor cam timing deviation from target during idle and part-throttle. If deviation > 5 degrees, VANOS solenoid is suspect. Listen for timing chain rattle on cold start to rule out chain stretch.",
        after_repair: "Clear adaptations and fault memory. Start engine and allow adaptations to relearn (10+ min idle). Drive 30+ miles monitoring VANOS adaptation values. Deviation should be < 2 degrees. Confirm no fault codes return."
      },
      diagrams_needed: ["VANOS solenoid location BMW N20", "VANOS system diagram N20 engine"]
    }
  },

  // =========================================================================
  // 18. P0740 — Nissan Altima 2.5L — CVT TCC Issue
  // =========================================================================
  {
    dtc_code: "P0740",
    vehicle_make: "Nissan",
    vehicle_model: "Altima",
    engine_type: "2.5L",
    repair_plan: {
      parts: [
        {
          name: "CVT valve body",
          position: "inside CVT transmission",
          qty: 1,
          type: "remanufactured or OEM Nissan valve body",
          oem_preferred: true,
          conditional: false,
          condition: null,
          search_terms: ["Nissan Altima CVT valve body", "Jatco CVT valve body RE0F10A"]
        },
        {
          name: "CVT fluid",
          position: "CVT transmission",
          qty: 1,
          type: "5 quarts Nissan NS-3 CVT fluid",
          oem_preferred: true,
          conditional: false,
          condition: null,
          search_terms: ["Nissan NS-3 CVT fluid", "Altima CVT transmission fluid"]
        },
        {
          name: "CVT filter",
          position: "inside CVT transmission pan",
          qty: 1,
          type: "internal strainer filter",
          oem_preferred: true,
          conditional: false,
          condition: null,
          search_terms: ["Nissan Altima CVT filter", "CVT internal filter RE0F10A"]
        }
      ],
      labor: {
        hours: 4.0,
        source: "estimated",
        category: "advanced",
        requires_lift: true,
        special_notes: "Check Nissan extended CVT warranty NTB15-046 (10 years/120,000 miles) before paying out of pocket. Use ONLY Nissan NS-3 CVT fluid — other fluids cause premature CVT failure. Valve body replacement is less invasive than full CVT replacement."
      },
      tools: ["transmission jack (support)", "10mm socket", "19mm drain plug socket", "torque wrench", "CVT fluid fill tool", "scan tool with Nissan Consult capability"],
      torque_specs: {
        "CVT pan bolts": "9 ft-lb",
        "valve body bolts": "7 ft-lb (critical — do not over-torque)",
        "CVT drain plug": "25 ft-lb"
      },
      verification: {
        before_repair: "Check CVT fluid level and condition (should be light green, not dark or burnt). Monitor TCC slip with scan tool at highway speed. Check warranty coverage first.",
        after_repair: "Fill CVT to proper level (check with engine running, fluid at operating temp). Clear codes. Drive highway for 20+ miles monitoring TCC lockup — slip should be near 0 RPM at steady cruise. Confirm no code return."
      },
      diagrams_needed: ["CVT valve body location Nissan Altima", "CVT fluid level check procedure Altima"]
    }
  },

  // =========================================================================
  // 19. P0741 — Honda Accord 1.5T — CVT TCC Stuck Off
  // =========================================================================
  {
    dtc_code: "P0741",
    vehicle_make: "Honda",
    vehicle_model: "Accord",
    engine_type: "1.5L Turbo",
    repair_plan: {
      parts: [
        {
          name: "TCM software update",
          position: "transmission control module",
          qty: 1,
          type: "Honda PCM/TCM flash update",
          oem_preferred: true,
          conditional: false,
          condition: null,
          search_terms: ["Honda Accord CVT software update", "Accord 1.5T TCM update TCC"]
        },
        {
          name: "CVT fluid",
          position: "CVT transmission",
          qty: 1,
          type: "3.5 quarts Honda HCF-2 CVT fluid",
          oem_preferred: true,
          conditional: true,
          condition: "Replace if dark or over 30,000 miles since last change",
          search_terms: ["Honda HCF-2 CVT fluid", "Accord CVT transmission fluid"]
        }
      ],
      labor: {
        hours: 0.5,
        source: "estimated",
        category: "basic",
        requires_lift: false,
        special_notes: "Check for Honda TSB related to CVT software calibration. Many P0741 codes on 10th gen Accord are resolved with TCM software update. Must be performed at Honda dealer or with Honda HDS scan tool."
      },
      tools: ["Honda HDS scan tool (dealer required for flash)", "17mm drain plug socket (if fluid change)", "torque wrench"],
      torque_specs: {
        "CVT drain plug": "29 ft-lb",
        "CVT fill plug": "33 ft-lb"
      },
      verification: {
        before_repair: "Monitor CVT slip ratio with scan tool during highway driving at steady 60 mph. If slip is within acceptable range (< 50 RPM) but code still sets, software calibration is likely needed.",
        after_repair: "Clear all DTCs. Drive 50+ miles including sustained highway driving at 55-65 mph. Monitor TCC lockup engagement. Confirm no P0741 return after 3 complete drive cycles."
      },
      diagrams_needed: ["CVT system diagram Honda Accord 10th gen", "TCM location Honda Accord"]
    }
  },

  // =========================================================================
  // 20. P0420 — Nissan Altima 2.5L — Catalytic Converter
  // =========================================================================
  {
    dtc_code: "P0420",
    vehicle_make: "Nissan",
    vehicle_model: "Altima",
    engine_type: "2.5L",
    repair_plan: {
      parts: [
        {
          name: "catalytic converter",
          position: "front, integrated with exhaust manifold (manifold converter)",
          qty: 1,
          type: "direct-fit manifold catalytic converter",
          oem_preferred: true,
          conditional: false,
          condition: null,
          search_terms: ["catalytic converter Nissan Altima 2.5L QR25DE", "manifold cat Altima 2013-2018"]
        },
        {
          name: "exhaust gaskets",
          position: "manifold-to-head and outlet flange",
          qty: 2,
          type: "multi-layer steel gasket",
          oem_preferred: false,
          conditional: false,
          condition: null,
          search_terms: ["exhaust manifold gasket Nissan Altima QR25DE", "cat converter gasket Altima"]
        }
      ],
      labor: {
        hours: 2.5,
        source: "estimated",
        category: "advanced",
        requires_lift: true,
        special_notes: "QR25DE uses a manifold-integrated catalytic converter. Check Nissan extended warranty NTB17-042 before paying out of pocket. Use OEM-quality converter — aftermarket may not meet Nissan efficiency standards."
      },
      tools: ["22mm O2 sensor socket", "14mm deep socket", "12mm socket", "penetrating oil", "torque wrench", "exhaust manifold stud extractor (if studs break)"],
      torque_specs: {
        "exhaust manifold nuts": "28 ft-lb (tighten center outward)",
        "cat converter outlet flange bolts": "32 ft-lb",
        "O2 sensors": "33 ft-lb"
      },
      verification: {
        before_repair: "Verify O2 sensor operation before condemning converter. Compare B1S1 vs B1S2 waveforms. Check Nissan extended warranty coverage NTB17-042.",
        after_repair: "Clear codes. Drive 60+ miles through mixed driving. Monitor downstream O2 — should be steady. Confirm P0420 does not return after 3 drive cycles. Check for exhaust leaks."
      },
      diagrams_needed: ["manifold catalytic converter location QR25DE", "exhaust manifold stud torque pattern QR25DE"]
    }
  },

  // =========================================================================
  // 21. P0505 — Toyota Corolla 1.8L — Idle Control
  // =========================================================================
  {
    dtc_code: "P0505",
    vehicle_make: "Toyota",
    vehicle_model: "Corolla",
    engine_type: "1.8L",
    repair_plan: {
      parts: [
        {
          name: "throttle body cleaner",
          position: "throttle body bore and plate",
          qty: 1,
          type: "CRC or Toyota-approved throttle body cleaner",
          oem_preferred: false,
          conditional: false,
          condition: null,
          search_terms: ["throttle body cleaner CRC", "Toyota throttle body cleaner"]
        },
        {
          name: "throttle body gasket",
          position: "between throttle body and intake manifold",
          qty: 1,
          type: "OEM rubber gasket",
          oem_preferred: true,
          conditional: true,
          condition: "Replace if throttle body is removed for cleaning — gasket is reusable if undamaged",
          search_terms: ["throttle body gasket Toyota Corolla 1.8L 2ZR-FE"]
        }
      ],
      labor: {
        hours: 0.5,
        source: "estimated",
        category: "basic",
        requires_lift: false,
        special_notes: "Clean throttle body in-place by removing intake hose. Do NOT force electronic throttle plate open manually — can damage throttle motor. Idle relearn: warm engine, turn off, wait 10 sec, restart, idle 10 min with all accessories off."
      },
      tools: ["10mm socket", "Phillips screwdriver", "throttle body cleaner", "clean shop towels", "hose clamp pliers"],
      torque_specs: {
        "throttle body bolts": "80 in-lb (if removed)",
        "intake hose clamp": "hand tight"
      },
      verification: {
        before_repair: "Inspect throttle bore for carbon buildup. Monitor idle RPM — should be 650-750 RPM when warm. If RPM is erratic or high/low, proceed with cleaning.",
        after_repair: "Perform idle relearn procedure. Clear codes. Idle for 10 minutes with all accessories off. Drive 20+ miles and verify stable idle at 650-750 RPM warm. Confirm no P0505 return."
      },
      diagrams_needed: ["throttle body location Toyota Corolla 2ZR-FE", "electronic throttle body cleaning procedure"]
    }
  },

  // =========================================================================
  // 22. P0507 — Honda Accord 2.0T — High Idle
  // =========================================================================
  {
    dtc_code: "P0507",
    vehicle_make: "Honda",
    vehicle_model: "Accord",
    engine_type: "2.0L Turbo",
    repair_plan: {
      parts: [
        {
          name: "throttle body cleaner",
          position: "electronic throttle body",
          qty: 1,
          type: "CRC or Honda-approved throttle body cleaner",
          oem_preferred: false,
          conditional: false,
          condition: null,
          search_terms: ["throttle body cleaner Honda Accord", "electronic throttle body cleaner"]
        }
      ],
      labor: {
        hours: 0.5,
        source: "estimated",
        category: "basic",
        requires_lift: false,
        special_notes: "Do NOT force throttle plate open manually on electronic throttle body. Use key-on engine-off with scan tool to open plate for cleaning. Honda idle relearn: turn key on, idle 10 min with all accessories off."
      },
      tools: ["Phillips screwdriver", "throttle body cleaner", "clean shop towels", "scan tool (to open throttle plate)", "hose clamp pliers"],
      torque_specs: {
        "intake hose clamp": "hand tight"
      },
      verification: {
        before_repair: "Monitor idle RPM. If idle > 900 RPM warm, high idle confirmed. Check for vacuum leaks first with smoke test. Inspect throttle bore for carbon deposits.",
        after_repair: "Perform Honda idle relearn: key on for 2 sec, start engine, idle 10 min with steering straight and all accessories off. Clear codes. Verify idle settles to 650-750 RPM. Drive 20+ miles and confirm no code return."
      },
      diagrams_needed: ["throttle body access Honda Accord 2.0T K20C4", "Honda idle relearn procedure"]
    }
  },

  // =========================================================================
  // 23. P0135 — Toyota Corolla 1.8L — O2 Sensor Heater
  // =========================================================================
  {
    dtc_code: "P0135",
    vehicle_make: "Toyota",
    vehicle_model: "Corolla",
    engine_type: "1.8L",
    repair_plan: {
      parts: [
        {
          name: "upstream O2 sensor (B1S1)",
          position: "exhaust manifold, pre-catalyst",
          qty: 1,
          type: "Denso OEM air-fuel ratio sensor",
          oem_preferred: true,
          conditional: false,
          condition: null,
          search_terms: ["upstream O2 sensor Toyota Corolla 1.8L Denso", "air fuel ratio sensor 2ZR-FE"]
        }
      ],
      labor: {
        hours: 0.5,
        source: "estimated",
        category: "basic",
        requires_lift: false,
        special_notes: "Toyota O2 sensors typically last 80,000-120,000 miles. Use Denso OEM for best compatibility — aftermarket sensors often cause drivability issues on Toyota. Apply anti-seize to new sensor threads."
      },
      tools: ["22mm O2 sensor socket", "penetrating oil", "wire brush (for bung threads)", "anti-seize compound", "torque wrench"],
      torque_specs: {
        "O2 sensor (B1S1)": "30 ft-lb"
      },
      verification: {
        before_repair: "Measure heater circuit resistance at sensor connector — should be 5-15 ohms. If open circuit (infinite resistance), heater element is burned out. Check for 12V power at heater connector with key on.",
        after_repair: "Clear codes. Start engine — sensor should reach operating temperature within 30 seconds (monitored via scan tool heater status). Drive 20+ miles and confirm P0135 does not return."
      },
      diagrams_needed: ["O2 sensor location Toyota Corolla 2ZR-FE B1S1", "O2 sensor connector pin identification Corolla"]
    }
  },

  // =========================================================================
  // 24. P0172 — Honda Civic 1.5T — System Too Rich (Fuel Dilution)
  // =========================================================================
  {
    dtc_code: "P0172",
    vehicle_make: "Honda",
    vehicle_model: "Civic",
    engine_type: "1.5L Turbo",
    repair_plan: {
      parts: [
        {
          name: "engine oil",
          position: "engine crankcase",
          qty: 1,
          type: "3.7 quarts Honda 0W-20 full synthetic",
          oem_preferred: true,
          conditional: false,
          condition: null,
          search_terms: ["Honda 0W-20 full synthetic oil Civic 1.5T", "engine oil Honda Civic turbo"]
        },
        {
          name: "oil filter",
          position: "engine block, bottom",
          qty: 1,
          type: "OEM Honda oil filter 15400-PLM-A02",
          oem_preferred: true,
          conditional: false,
          condition: null,
          search_terms: ["Honda Civic 1.5T oil filter OEM", "Honda oil filter 15400"]
        },
        {
          name: "PCM software update",
          position: "PCM/ECU",
          qty: 1,
          type: "Honda TSB 17-072 PCM calibration update",
          oem_preferred: true,
          conditional: false,
          condition: null,
          search_terms: ["Honda Civic 1.5T PCM update TSB 17-072", "fuel dilution software update Honda"]
        }
      ],
      labor: {
        hours: 0.5,
        source: "estimated",
        category: "basic",
        requires_lift: true,
        special_notes: "Fuel dilution of engine oil is common on 1.5T DI engine in cold-climate short-trip driving. Gasoline enters crankcase via direct injection overspray. Honda TSB 17-072 updates PCM injection timing. Oil change required after PCM update. Increase oil change frequency in cold/short-trip conditions."
      },
      tools: ["17mm drain plug socket", "oil filter wrench", "Honda HDS scan tool (dealer for PCM flash)", "torque wrench", "drain pan"],
      torque_specs: {
        "oil drain plug": "29 ft-lb (with new crush washer)",
        "oil filter": "hand tight, 3/4 turn after gasket contact"
      },
      verification: {
        before_repair: "Check oil level — if significantly above full mark on dipstick, fuel dilution is occurring. Smell dipstick for gasoline odor. Check LTFT — if below -10%, rich condition confirmed.",
        after_repair: "Update PCM calibration. Change oil with fresh 0W-20. Clear codes. Drive 500+ miles and recheck oil level. Oil should not be above full mark. Confirm P0172 does not return. Advise customer on driving habits."
      },
      diagrams_needed: ["PCM location Honda Civic 1.5T", "oil drain plug location Honda Civic 10th gen"]
    }
  },

  // =========================================================================
  // 25. P0449 — Chevrolet Silverado 5.3L — EVAP Vent Solenoid
  // =========================================================================
  {
    dtc_code: "P0449",
    vehicle_make: "Chevrolet",
    vehicle_model: "Silverado",
    engine_type: "5.3L V8",
    repair_plan: {
      parts: [
        {
          name: "EVAP vent solenoid",
          position: "near charcoal canister, rear of vehicle by fuel tank",
          qty: 1,
          type: "ACDelco OEM EVAP vent solenoid",
          oem_preferred: true,
          conditional: false,
          condition: null,
          search_terms: ["EVAP vent solenoid Chevy Silverado 5.3L ACDelco", "Silverado vent valve solenoid"]
        }
      ],
      labor: {
        hours: 0.5,
        source: "estimated",
        category: "basic",
        requires_lift: true,
        special_notes: "One of the most common codes on GM trucks. Vent solenoid is located near the charcoal canister behind the spare tire or near the fuel tank. Replace with ACDelco OEM — aftermarket solenoids have high failure rates on this platform."
      },
      tools: ["10mm socket", "flathead screwdriver (connector release)", "12V test light or multimeter"],
      torque_specs: {
        "vent solenoid mounting bolt": "5 ft-lb",
        "EVAP hose clamps": "spring clamp — hand install"
      },
      verification: {
        before_repair: "Apply 12V directly to solenoid — should click. If no click, solenoid coil is dead. Check resistance — should be 20-30 ohms. If open or shorted, replace.",
        after_repair: "Verify new solenoid clicks when energized. Clear codes. Drive through EVAP monitor cycle (1/4-3/4 tank, moderate ambient temp). Confirm P0449 does not return after 2 complete cycles."
      },
      diagrams_needed: ["EVAP vent solenoid location Silverado 5.3L", "charcoal canister location GM trucks"]
    }
  },

  // =========================================================================
  // 26. P0300 — Hyundai Sonata 2.4L — Misfire (Theta II Engine Check)
  // =========================================================================
  {
    dtc_code: "P0300",
    vehicle_make: "Hyundai",
    vehicle_model: "Sonata",
    engine_type: "2.4L",
    repair_plan: {
      parts: [
        {
          name: "engine replacement",
          position: "complete long block",
          qty: 1,
          type: "Hyundai remanufactured Theta II 2.4L engine",
          oem_preferred: true,
          conditional: false,
          condition: null,
          search_terms: ["Hyundai Sonata 2.4L engine replacement Theta II", "Theta II remanufactured engine"]
        },
        {
          name: "engine oil and filter",
          position: "new engine",
          qty: 1,
          type: "5 quarts Hyundai 5W-20 + OEM filter",
          oem_preferred: true,
          conditional: false,
          condition: null,
          search_terms: ["Hyundai Sonata 2.4L engine oil 5W-20", "Theta II oil filter"]
        }
      ],
      labor: {
        hours: 16.0,
        source: "estimated",
        category: "advanced",
        requires_lift: true,
        special_notes: "CRITICAL: Check if vehicle is covered under Hyundai engine recall/warranty extension Campaign 953/132/162 before paying out of pocket. Theta II engine bearing failure is a manufacturing defect. Listen for rod knock — metallic knocking under load. If knocking, stop driving immediately to prevent catastrophic failure."
      },
      tools: ["engine hoist/crane", "engine stand", "full socket set (metric)", "torque wrench set (in-lb and ft-lb)", "transmission jack", "coolant drain pan", "A/C recovery machine"],
      torque_specs: {
        "engine mount bolts": "58 ft-lb",
        "transmission-to-engine bolts": "39 ft-lb",
        "exhaust manifold nuts": "30 ft-lb",
        "motor mount bracket bolts": "50 ft-lb"
      },
      verification: {
        before_repair: "FIRST: Check Hyundai recall/warranty coverage. Listen for rod knock under acceleration. Check oil for metal debris (send sample for analysis if uncertain). Compression test all cylinders if no rod knock heard.",
        after_repair: "Break in new engine per Hyundai specifications (vary speed, no sustained high RPM for first 1,000 miles). Check for oil leaks. Verify oil pressure. Clear all codes. Drive 100+ miles and confirm no misfire codes. First oil change at 1,000 miles."
      },
      diagrams_needed: ["engine removal procedure Hyundai Sonata Theta II", "engine mount locations Sonata 2.4L", "Theta II engine recall campaign numbers"]
    }
  },

  // =========================================================================
  // 27. P0128 — Honda Civic 1.5T — Thermostat
  // =========================================================================
  {
    dtc_code: "P0128",
    vehicle_make: "Honda",
    vehicle_model: "Civic",
    engine_type: "1.5L Turbo",
    repair_plan: {
      parts: [
        {
          name: "thermostat",
          position: "lower radiator hose housing, engine block",
          qty: 1,
          type: "OEM Honda electronically controlled thermostat",
          oem_preferred: true,
          conditional: false,
          condition: null,
          search_terms: ["thermostat Honda Civic 1.5T L15B7", "Honda Civic turbo thermostat OEM"]
        },
        {
          name: "thermostat housing O-ring",
          position: "thermostat housing to block",
          qty: 1,
          type: "OEM rubber O-ring seal",
          oem_preferred: true,
          conditional: false,
          condition: null,
          search_terms: ["thermostat O-ring Honda Civic 1.5T", "thermostat gasket Civic turbo"]
        },
        {
          name: "engine coolant",
          position: "cooling system",
          qty: 1,
          type: "1 gallon Honda Type 2 blue coolant",
          oem_preferred: true,
          conditional: false,
          condition: null,
          search_terms: ["Honda Type 2 blue coolant", "Honda Civic coolant OEM"]
        }
      ],
      labor: {
        hours: 1.5,
        source: "estimated",
        category: "intermediate",
        requires_lift: false,
        special_notes: "Honda 1.5T uses an electronically controlled thermostat — PCM commands it based on coolant temp and driving conditions. Aftermarket thermostats may not match PCM expectations. Always use OEM part. Bleed cooling system thoroughly after refill."
      },
      tools: ["10mm socket", "12mm socket", "coolant drain pan", "funnel", "torque wrench", "pliers (hose clamp)"],
      torque_specs: {
        "thermostat housing bolts": "9 ft-lb"
      },
      verification: {
        before_repair: "Monitor ECT with scan tool during warm-up. Should reach 195F within 10-15 min of driving. If ECT plateaus below 180F, thermostat is stuck open.",
        after_repair: "Fill and bleed cooling system. Warm engine to operating temp — ECT should reach 195-210F and stabilize. Clear codes and confirm no return after 2 drive cycles."
      },
      diagrams_needed: ["thermostat location Honda Civic 1.5T L15B7", "cooling system bleed procedure Civic 10th gen"]
    }
  },

  // =========================================================================
  // 28. P0172 — Honda Accord 1.5T — System Too Rich (Fuel Dilution)
  // =========================================================================
  {
    dtc_code: "P0172",
    vehicle_make: "Honda",
    vehicle_model: "Accord",
    engine_type: "1.5L Turbo",
    repair_plan: {
      parts: [
        {
          name: "engine oil",
          position: "engine crankcase",
          qty: 1,
          type: "3.7 quarts Honda 0W-20 full synthetic",
          oem_preferred: true,
          conditional: false,
          condition: null,
          search_terms: ["Honda 0W-20 full synthetic oil Accord 1.5T", "engine oil Honda Accord turbo"]
        },
        {
          name: "oil filter",
          position: "engine block, bottom",
          qty: 1,
          type: "OEM Honda oil filter",
          oem_preferred: true,
          conditional: false,
          condition: null,
          search_terms: ["Honda Accord 1.5T oil filter OEM", "Honda oil filter Accord"]
        },
        {
          name: "PCM software update",
          position: "PCM/ECU",
          qty: 1,
          type: "Honda service bulletin PCM recalibration",
          oem_preferred: true,
          conditional: false,
          condition: null,
          search_terms: ["Honda Accord 1.5T PCM update fuel dilution", "Accord turbo software update"]
        }
      ],
      labor: {
        hours: 0.5,
        source: "estimated",
        category: "basic",
        requires_lift: true,
        special_notes: "Same 1.5T DI fuel dilution issue as Civic. Gasoline enters crankcase during cold-climate short-trip driving. Honda service bulletin addresses PCM recalibration. Oil change required after update."
      },
      tools: ["17mm drain plug socket", "oil filter wrench", "Honda HDS scan tool (dealer for flash)", "torque wrench", "drain pan"],
      torque_specs: {
        "oil drain plug": "29 ft-lb (with new crush washer)",
        "oil filter": "hand tight, 3/4 turn after gasket contact"
      },
      verification: {
        before_repair: "Check oil level — above full mark indicates fuel dilution. Smell dipstick for gasoline. Check LTFT — below -10% confirms rich condition.",
        after_repair: "Update PCM. Change oil. Clear codes. Drive 500+ miles and recheck oil level — should not rise above full mark. Confirm P0172 does not return. Advise on cold-weather driving habits."
      },
      diagrams_needed: ["PCM location Honda Accord 10th gen", "oil drain plug location Accord 1.5T"]
    }
  },

  // =========================================================================
  // 29. P0174 — Ford F-150 3.5L EcoBoost — Lean Bank 2
  // =========================================================================
  {
    dtc_code: "P0174",
    vehicle_make: "Ford",
    vehicle_model: "F-150",
    engine_type: "3.5L EcoBoost",
    repair_plan: {
      parts: [
        {
          name: "intake manifold gasket",
          position: "between intake manifold and cylinder head bank 2",
          qty: 1,
          type: "OEM multi-layer steel gasket",
          oem_preferred: true,
          conditional: false,
          condition: null,
          search_terms: ["intake manifold gasket Ford 3.5 EcoBoost", "F-150 EcoBoost intake gasket"]
        },
        {
          name: "vacuum hoses",
          position: "bank 2 intake area",
          qty: 1,
          type: "silicone vacuum hose set",
          oem_preferred: false,
          conditional: true,
          condition: "Replace any cracked or deteriorated hoses found during smoke test",
          search_terms: ["vacuum hose kit Ford F-150 EcoBoost", "3.5 EcoBoost vacuum hose"]
        }
      ],
      labor: {
        hours: 2.0,
        source: "estimated",
        category: "intermediate",
        requires_lift: false,
        special_notes: "Compare bank 1 vs bank 2 LTFT. If only bank 2 is lean, leak is bank-specific. If both banks lean, check common components (charge air cooler piping, MAF). Smoke test with turbo system pressurized."
      },
      tools: ["smoke machine", "boost leak tester", "10mm socket", "8mm socket", "torque wrench", "hose clamp pliers"],
      torque_specs: {
        "intake manifold bolts": "89 in-lb (sequence: center outward)"
      },
      verification: {
        before_repair: "Compare bank 1 vs bank 2 LTFT. If bank 2 LTFT is > +15% and bank 1 is normal, leak is bank-2 specific. Smoke test bank 2 intake runners and gasket area.",
        after_repair: "Clear codes and fuel trims. Drive 30+ miles monitoring both bank fuel trims. Both should be within +/-5%. Confirm no lean codes return after 2 drive cycles."
      },
      diagrams_needed: ["intake manifold gasket location F-150 3.5 EcoBoost", "bank identification 3.5 EcoBoost V6"]
    }
  },

  // =========================================================================
  // 30. P0302 — Ford F-150 EcoBoost — Cylinder 2 Misfire
  // =========================================================================
  {
    dtc_code: "P0302",
    vehicle_make: "Ford",
    vehicle_model: "F-150",
    engine_type: "3.5L EcoBoost",
    repair_plan: {
      parts: [
        {
          name: "ignition coil",
          position: "cylinder 2",
          qty: 1,
          type: "Motorcraft DG-549 (or equivalent)",
          oem_preferred: true,
          conditional: false,
          condition: null,
          search_terms: ["ignition coil Ford F-150 3.5 EcoBoost Motorcraft DG-549", "EcoBoost ignition coil"]
        },
        {
          name: "spark plug",
          position: "cylinder 2",
          qty: 1,
          type: "Motorcraft SP-534 iridium",
          oem_preferred: true,
          conditional: false,
          condition: null,
          search_terms: ["Motorcraft SP-534 spark plug EcoBoost 3.5L", "F-150 EcoBoost spark plug"]
        }
      ],
      labor: {
        hours: 0.5,
        source: "estimated",
        category: "basic",
        requires_lift: false,
        special_notes: "Swap coil from cylinder 2 to a known-good cylinder first. If misfire follows the coil, replace it. If misfire stays on cylinder 2, check spark plug, then injector, then compression."
      },
      tools: ["7mm socket", "spark plug socket 5/8 inch", "torque wrench", "dielectric grease", "compressed air (clean plug well)"],
      torque_specs: {
        "spark plug": "11 ft-lb",
        "ignition coil bolt": "53 in-lb"
      },
      verification: {
        before_repair: "Confirm misfire is isolated to cylinder 2 via misfire counters. Swap coil to another cylinder — if misfire follows, coil is confirmed bad. Check plug for fouling or wear.",
        after_repair: "Clear codes and misfire counters. Start engine and idle 5 min. Drive 20+ miles monitoring cylinder 2 misfire counter — should remain at 0. No codes should return."
      },
      diagrams_needed: ["cylinder numbering Ford 3.5L EcoBoost", "ignition coil access EcoBoost F-150"]
    }
  },

  // =========================================================================
  // 31. P0304 — Honda Civic 1.5T — Cylinder 4 Misfire
  // =========================================================================
  {
    dtc_code: "P0304",
    vehicle_make: "Honda",
    vehicle_model: "Civic",
    engine_type: "1.5L Turbo",
    repair_plan: {
      parts: [
        {
          name: "ignition coil",
          position: "cylinder 4",
          qty: 1,
          type: "OEM Honda ignition coil",
          oem_preferred: true,
          conditional: false,
          condition: null,
          search_terms: ["ignition coil Honda Civic 1.5T cylinder 4", "Honda L15B7 ignition coil"]
        },
        {
          name: "spark plug",
          position: "cylinder 4",
          qty: 1,
          type: "NGK DILKAR7G11GS iridium",
          oem_preferred: true,
          conditional: false,
          condition: null,
          search_terms: ["NGK DILKAR7G11GS Honda Civic 1.5T", "Honda Civic turbo spark plug"]
        }
      ],
      labor: {
        hours: 0.5,
        source: "estimated",
        category: "basic",
        requires_lift: false,
        special_notes: "Swap coil from cylinder 4 to another cylinder to confirm. Turbo engines are harder on ignition components — replace spark plugs every 30,000 miles on 1.5T application."
      },
      tools: ["10mm socket", "spark plug socket 14mm thin-wall", "torque wrench", "dielectric grease", "compressed air"],
      torque_specs: {
        "spark plug": "13 ft-lb",
        "ignition coil bolt": "9 ft-lb"
      },
      verification: {
        before_repair: "Confirm misfire isolated to cylinder 4 using scan tool misfire counters. Swap coil to known-good cylinder. Check plug for wear or carbon fouling (DI engine).",
        after_repair: "Clear codes and misfire counters. Drive 20+ miles — cylinder 4 misfire counter should be 0. No P0304 return."
      },
      diagrams_needed: ["cylinder numbering Honda Civic 1.5T L15B7", "ignition coil access Honda Civic turbo"]
    }
  },

  // =========================================================================
  // 32. P0128 — Kia Optima 2.4L — Thermostat (Theta II)
  // =========================================================================
  {
    dtc_code: "P0128",
    vehicle_make: "Kia",
    vehicle_model: "Optima",
    engine_type: "2.4L",
    repair_plan: {
      parts: [
        {
          name: "thermostat",
          position: "lower radiator hose housing on engine block",
          qty: 1,
          type: "OEM Kia/Hyundai thermostat (195F rating)",
          oem_preferred: true,
          conditional: false,
          condition: null,
          search_terms: ["Kia Optima 2.4L thermostat Theta II", "thermostat Optima 2016-2020"]
        },
        {
          name: "thermostat housing O-ring",
          position: "thermostat housing to block",
          qty: 1,
          type: "rubber O-ring seal",
          oem_preferred: true,
          conditional: false,
          condition: null,
          search_terms: ["thermostat O-ring Kia Optima 2.4L", "Theta II thermostat gasket"]
        },
        {
          name: "engine coolant",
          position: "cooling system",
          qty: 1,
          type: "2 gallons Kia/Hyundai long-life coolant",
          oem_preferred: true,
          conditional: false,
          condition: null,
          search_terms: ["Kia Hyundai long life coolant", "Optima coolant"]
        }
      ],
      labor: {
        hours: 1.5,
        source: "estimated",
        category: "intermediate",
        requires_lift: false,
        special_notes: "Same Theta II engine as Hyundai Sonata. Thermostat is in lower radiator hose housing. Bleed cooling system after refill — there is a bleed valve on the thermostat housing. Use only Kia/Hyundai-spec coolant."
      },
      tools: ["10mm socket", "12mm socket", "coolant drain pan", "funnel", "torque wrench", "pliers"],
      torque_specs: {
        "thermostat housing bolts": "14 ft-lb"
      },
      verification: {
        before_repair: "Monitor ECT during warm-up — should reach 195F within 15 min. If ECT stays below 185F, thermostat is stuck open. Check upper radiator hose — should stay cool until thermostat opens.",
        after_repair: "Fill and bleed cooling system using bleed valve. Run engine to operating temp — ECT should reach 195-210F. Check for leaks at housing. Clear codes and drive 2 cycles."
      },
      diagrams_needed: ["thermostat location Kia Optima Theta II 2.4L", "cooling system bleed procedure Optima"]
    }
  },

  // =========================================================================
  // 33. P0340 — Nissan Altima 2.5L — Camshaft Position Sensor
  // =========================================================================
  {
    dtc_code: "P0340",
    vehicle_make: "Nissan",
    vehicle_model: "Altima",
    engine_type: "2.5L",
    repair_plan: {
      parts: [
        {
          name: "camshaft position sensor",
          position: "cylinder head, exhaust side",
          qty: 1,
          type: "OEM Nissan CMP sensor",
          oem_preferred: true,
          conditional: false,
          condition: null,
          search_terms: ["camshaft position sensor Nissan Altima QR25DE", "CMP sensor Altima 2.5L"]
        }
      ],
      labor: {
        hours: 0.5,
        source: "estimated",
        category: "basic",
        requires_lift: false,
        special_notes: "CMP sensor on QR25DE is accessible from top of engine. Clean area around sensor before removal to prevent debris from entering bore. Check VVT oil control valve if CMP code persists after sensor replacement."
      },
      tools: ["10mm socket", "electrical contact cleaner", "dielectric grease", "torque wrench"],
      torque_specs: {
        "CMP sensor bolt": "9 ft-lb"
      },
      verification: {
        before_repair: "Check CMP signal with scan tool while cranking. Inspect sensor connector for oil contamination. If VVT system is suspect (sludge buildup), also inspect oil control valve.",
        after_repair: "Clear codes. Start engine — verify CMP signal is present and stable on scan tool. Drive 30+ miles and confirm no P0340 return. Monitor engine performance for smooth operation."
      },
      diagrams_needed: ["camshaft position sensor location QR25DE", "CMP sensor wiring diagram Nissan Altima"]
    }
  },

  // =========================================================================
  // 34. P0420 — Honda Civic 1.5T — Catalytic Converter
  // =========================================================================
  {
    dtc_code: "P0420",
    vehicle_make: "Honda",
    vehicle_model: "Civic",
    engine_type: "1.5L Turbo",
    repair_plan: {
      parts: [
        {
          name: "catalytic converter",
          position: "front, integrated turbo downpipe converter",
          qty: 1,
          type: "direct-fit turbo downpipe with catalytic converter",
          oem_preferred: true,
          conditional: false,
          condition: null,
          search_terms: ["catalytic converter Honda Civic 1.5T", "turbo downpipe cat converter Civic 1.5 turbo"]
        },
        {
          name: "exhaust gaskets",
          position: "turbo outlet flange and converter outlet",
          qty: 2,
          type: "multi-layer steel gasket",
          oem_preferred: true,
          conditional: false,
          condition: null,
          search_terms: ["exhaust gasket Honda Civic 1.5T downpipe", "turbo downpipe gasket Civic"]
        }
      ],
      labor: {
        hours: 2.8,
        source: "estimated",
        category: "advanced",
        requires_lift: true,
        special_notes: "1.5T uses a close-coupled converter in the turbo downpipe. Apply penetrating oil 24 hrs prior. Check for Honda emissions warranty coverage (8yr/80K federal, longer in CARB states)."
      },
      tools: ["22mm O2 sensor socket", "14mm deep socket", "penetrating oil", "torque wrench", "jack stands or lift", "wire brush", "anti-seize"],
      torque_specs: {
        "turbo-to-downpipe flange bolts": "33 ft-lb",
        "downpipe-to-exhaust flange bolts": "40 ft-lb",
        "upstream O2 sensor": "33 ft-lb",
        "downstream O2 sensor": "33 ft-lb"
      },
      verification: {
        before_repair: "Compare B1S1 vs B1S2 waveforms. If downstream mirrors upstream, converter is confirmed failed. Check Honda emissions warranty eligibility before proceeding.",
        after_repair: "Clear codes. Drive 50+ miles mixed city/highway. Monitor downstream O2 — should be steady 0.5-0.8V at cruise. Confirm no P0420 return after 2 complete catalyst monitor drive cycles."
      },
      diagrams_needed: ["turbo downpipe catalytic converter location Honda Civic 1.5T", "O2 sensor locations Civic 1.5T"]
    }
  },

  // =========================================================================
  // 35. P0171 — Ford F-150 3.5L EcoBoost (P0174 companion — both banks lean)
  // =========================================================================
  {
    dtc_code: "P0174",
    vehicle_make: "Ford",
    vehicle_model: "F-150",
    engine_type: "3.5L EcoBoost",
    repair_plan: {
      parts: [
        {
          name: "intake manifold gasket",
          position: "between intake manifold and cylinder heads",
          qty: 1,
          type: "OEM Ford multi-layer steel gasket",
          oem_preferred: true,
          conditional: false,
          condition: null,
          search_terms: ["intake manifold gasket Ford F-150 3.5 EcoBoost", "EcoBoost intake gasket F150"]
        },
        {
          name: "vacuum hose assortment",
          position: "various engine bay locations",
          qty: 1,
          type: "silicone vacuum hose kit",
          oem_preferred: false,
          conditional: true,
          condition: "Replace any cracked or hardened vacuum hoses found during diagnosis",
          search_terms: ["vacuum hose kit Ford F-150 EcoBoost", "silicone vacuum hose 3.5 EcoBoost"]
        }
      ],
      labor: {
        hours: 2.0,
        source: "estimated",
        category: "intermediate",
        requires_lift: false,
        special_notes: "If both P0171 and P0174 are present (both banks lean), the issue is upstream of the intake split — check intercooler piping, MAF sensor, or common vacuum source. If only P0174, see bank-2-specific entry."
      },
      tools: ["smoke machine", "boost leak tester", "10mm socket", "8mm socket", "T30 Torx", "torque wrench", "MAF cleaner"],
      torque_specs: {
        "intake manifold bolts": "89 in-lb (center outward sequence)"
      },
      verification: {
        before_repair: "Check both bank LTFTs. If both > +15%, issue is upstream of intake split. Boost leak test turbo piping. Clean MAF sensor. Smoke test intake manifold.",
        after_repair: "Clear codes and fuel trims. Drive 30+ miles monitoring both bank fuel trims. Both should be +/-5%. No lean codes should return after 2 drive cycles."
      },
      diagrams_needed: ["intake manifold bolt sequence F-150 3.5 EcoBoost", "boost piping diagram 3.5 EcoBoost"]
    }
  },

  // =========================================================================
  // 36. P0442 — Honda Civic 1.5T — EVAP Small Leak
  // =========================================================================
  {
    dtc_code: "P0442",
    vehicle_make: "Honda",
    vehicle_model: "Civic",
    engine_type: "1.5L Turbo",
    repair_plan: {
      parts: [
        {
          name: "gas cap",
          position: "fuel filler neck",
          qty: 1,
          type: "OEM Honda gas cap",
          oem_preferred: true,
          conditional: false,
          condition: null,
          search_terms: ["Honda Civic gas cap OEM", "fuel cap Honda Civic 1.5T"]
        },
        {
          name: "EVAP canister purge valve",
          position: "engine bay, near intake manifold",
          qty: 1,
          type: "OEM Honda purge solenoid",
          oem_preferred: true,
          conditional: true,
          condition: "Replace if gas cap does not resolve code and purge valve fails vacuum test",
          search_terms: ["EVAP purge valve Honda Civic 1.5T", "canister purge solenoid Civic turbo"]
        }
      ],
      labor: {
        hours: 0.5,
        source: "estimated",
        category: "basic",
        requires_lift: false,
        special_notes: "Start with gas cap — cheapest and most common fix. If code returns, test purge valve with hand vacuum pump and scan tool active test. Smoke test EVAP system for hidden leaks."
      },
      tools: ["hand vacuum pump", "scan tool", "EVAP smoke machine", "10mm socket"],
      torque_specs: {
        "purge valve bolts": "5 ft-lb",
        "gas cap": "tighten until clicks"
      },
      verification: {
        before_repair: "Replace gas cap first. Clear code. If code returns, test purge valve — apply vacuum, should hold when de-energized. Smoke test for any other leaks.",
        after_repair: "Clear codes. Drive through EVAP monitor cycle (1/4-3/4 tank, moderate temp). Confirm no EVAP codes return after 2 complete cycles."
      },
      diagrams_needed: ["EVAP system diagram Honda Civic 1.5T", "purge valve location Civic engine bay"]
    }
  },

  // =========================================================================
  // 37. P0301 — Honda Accord 1.5T — Cylinder 1 Misfire
  // =========================================================================
  {
    dtc_code: "P0301",
    vehicle_make: "Honda",
    vehicle_model: "Accord",
    engine_type: "1.5L Turbo",
    repair_plan: {
      parts: [
        {
          name: "spark plugs (full set of 4)",
          position: "all 4 cylinders",
          qty: 4,
          type: "NGK DILKAR7G11GS iridium (or Honda OEM equivalent)",
          oem_preferred: true,
          conditional: false,
          condition: null,
          search_terms: ["NGK DILKAR7G11GS Honda Accord 1.5T", "spark plug Honda Accord turbo"]
        },
        {
          name: "ignition coil",
          position: "cylinder 1",
          qty: 1,
          type: "OEM Honda ignition coil",
          oem_preferred: true,
          conditional: true,
          condition: "Replace if coil swap test confirms coil failure — misfire follows coil to new cylinder",
          search_terms: ["ignition coil Honda Accord 1.5T", "Honda Accord turbo coil pack"]
        }
      ],
      labor: {
        hours: 0.5,
        source: "estimated",
        category: "basic",
        requires_lift: false,
        special_notes: "1.5T engine operates at higher cylinder pressures than NA engines — spark plugs degrade faster. Replace all 4 plugs at 30,000-mile intervals for turbo applications. Use OEM-specified iridium plugs only."
      },
      tools: ["spark plug socket 14mm thin-wall", "10mm socket", "torque wrench", "dielectric grease", "compressed air (clean plug wells)", "gap gauge"],
      torque_specs: {
        "spark plugs": "13 ft-lb",
        "ignition coil bolts": "9 ft-lb"
      },
      verification: {
        before_repair: "Check misfire counters — confirm misfire isolated to cylinder 1. Swap coil from cylinder 1 to cylinder 3. If misfire moves to cylinder 3, coil is bad. If misfire stays on cylinder 1, replace plug.",
        after_repair: "Clear codes and misfire counters. Drive 20+ miles — cylinder 1 misfire counter should be 0. No P0301 should return. Verify smooth idle and acceleration."
      },
      diagrams_needed: ["spark plug access Honda Accord 1.5T", "cylinder numbering Honda 1.5T L15B7"]
    }
  },

  // =========================================================================
  // 38. P0340 — Ford F-150 3.5L EcoBoost — VCT/Cam Phaser
  // =========================================================================
  {
    dtc_code: "P0340",
    vehicle_make: "Ford",
    vehicle_model: "F-150",
    engine_type: "3.5L EcoBoost",
    repair_plan: {
      parts: [
        {
          name: "VCT solenoid (intake)",
          position: "cylinder head bank 1, front",
          qty: 1,
          type: "Motorcraft OEM VCT solenoid",
          oem_preferred: true,
          conditional: false,
          condition: null,
          search_terms: ["VCT solenoid Ford F-150 3.5 EcoBoost", "cam phaser solenoid EcoBoost 3.5L"]
        },
        {
          name: "cam phaser",
          position: "front of camshaft, bank 1",
          qty: 1,
          type: "Updated Ford cam phaser assembly",
          oem_preferred: true,
          conditional: true,
          condition: "Required if cam phaser rattle is present on cold start — VCT solenoid alone will not fix phaser rattle",
          search_terms: ["cam phaser Ford F-150 3.5 EcoBoost", "EcoBoost cam phaser kit"]
        },
        {
          name: "timing chain kit",
          position: "front engine cover",
          qty: 1,
          type: "timing chain, guides, and tensioners",
          oem_preferred: true,
          conditional: true,
          condition: "Replace if chain has stretched or guides are worn during phaser replacement",
          search_terms: ["timing chain kit Ford 3.5 EcoBoost", "EcoBoost timing chain set"]
        }
      ],
      labor: {
        hours: 8.0,
        source: "estimated",
        category: "advanced",
        requires_lift: true,
        special_notes: "Ford TSB 19-2346 addresses cam phaser rattle on 3.5L EcoBoost. If only VCT solenoid is replaced (no rattle), labor is ~1 hr. Full cam phaser + timing chain is a major repair requiring front cover removal. Listen for cold start rattle to determine scope."
      },
      tools: ["cam phaser holding tool", "E10 E-Torx socket", "front cover sealant (Motorcraft TA-357)", "timing chain alignment tools", "torque wrench (in-lb and ft-lb)", "10mm socket", "13mm socket"],
      torque_specs: {
        "VCT solenoid bolt": "89 in-lb",
        "cam phaser bolt": "30 ft-lb + 90 degrees",
        "front cover bolts": "89 in-lb (8mm), 18 ft-lb (10mm)",
        "timing chain tensioner": "18 ft-lb"
      },
      verification: {
        before_repair: "Check VCT solenoid operation with scan tool bidirectional test. Listen for cam phaser rattle on cold start (first 5 seconds). If rattle present, phaser replacement needed. If no rattle, try solenoid first.",
        after_repair: "Clear all codes and adaptations. Cold start engine — listen for any rattle (should be gone). Monitor CMP/CKP correlation on scan tool. Drive 50+ miles and confirm no P0340 return."
      },
      diagrams_needed: ["VCT solenoid location Ford 3.5 EcoBoost", "cam phaser removal procedure EcoBoost", "timing chain alignment marks 3.5 EcoBoost"]
    }
  },

  // =========================================================================
  // 39. P0171 — BMW 3 Series N20 — Lean (Valve Cover PCV)
  // =========================================================================
  {
    dtc_code: "P0171",
    vehicle_make: "BMW",
    vehicle_model: "3 Series",
    engine_type: "2.0T N20",
    repair_plan: {
      parts: [
        {
          name: "valve cover with integrated PCV/CCV",
          position: "top of cylinder head",
          qty: 1,
          type: "OEM BMW valve cover assembly with integrated PCV",
          oem_preferred: true,
          conditional: false,
          condition: null,
          search_terms: ["BMW N20 valve cover PCV", "BMW 3 Series N20 valve cover assembly CCV"]
        },
        {
          name: "valve cover gasket",
          position: "between valve cover and cylinder head",
          qty: 1,
          type: "OEM rubber perimeter gasket (usually included with valve cover)",
          oem_preferred: true,
          conditional: false,
          condition: null,
          search_terms: ["BMW N20 valve cover gasket", "valve cover seal N20"]
        },
        {
          name: "spark plug tube seals",
          position: "spark plug wells in valve cover",
          qty: 4,
          type: "rubber seals (usually included with valve cover)",
          oem_preferred: true,
          conditional: false,
          condition: null,
          search_terms: ["BMW N20 spark plug tube seal", "valve cover plug well seal N20"]
        }
      ],
      labor: {
        hours: 2.0,
        source: "estimated",
        category: "intermediate",
        requires_lift: false,
        special_notes: "BMW N20 has integrated PCV/CCV system in the valve cover. When the PCV diaphragm tears, it creates a massive vacuum leak. PCV is NOT separately serviceable — entire valve cover must be replaced. Check for oil residue around valve cover as a visual indicator."
      },
      tools: ["E10 E-Torx socket", "T30 Torx", "10mm socket", "valve cover bolt torque adapter", "torque wrench (in-lb)", "gasket scraper (plastic)", "brake cleaner"],
      torque_specs: {
        "valve cover bolts": "7 ft-lb (tighten in sequence)",
        "ignition coil bolts": "7 ft-lb"
      },
      verification: {
        before_repair: "Check LTFT — if > +20%, massive vacuum leak. Listen for hissing near valve cover. Smoke test — smoke will pour from torn PCV diaphragm. Check for oil film around valve cover perimeter.",
        after_repair: "Clear codes and fuel trims. Start engine — hissing should be gone. Idle 10 min monitoring STFT — should be within +/-3%. Drive 20+ miles — LTFT should normalize to +/-5%. No P0171 return."
      },
      diagrams_needed: ["valve cover removal BMW N20", "valve cover bolt torque sequence N20", "PCV system diagram N20 engine"]
    }
  },

  // =========================================================================
  // 40. P0456 — Ford Escape 1.5L EcoBoost — EVAP Very Small Leak
  // =========================================================================
  {
    dtc_code: "P0456",
    vehicle_make: "Ford",
    vehicle_model: "Escape",
    engine_type: "1.5L EcoBoost",
    repair_plan: {
      parts: [
        {
          name: "EVAP purge valve",
          position: "engine bay, on intake manifold",
          qty: 1,
          type: "Motorcraft EVAP canister purge valve",
          oem_preferred: true,
          conditional: false,
          condition: null,
          search_terms: ["EVAP purge valve Ford Escape 1.5 EcoBoost", "canister purge solenoid Escape Motorcraft"]
        },
        {
          name: "gas cap",
          position: "fuel filler neck",
          qty: 1,
          type: "OEM Ford gas cap",
          oem_preferred: true,
          conditional: true,
          condition: "Try replacing gas cap first — cheapest fix for very small EVAP leaks",
          search_terms: ["gas cap Ford Escape OEM", "fuel filler cap Escape"]
        }
      ],
      labor: {
        hours: 0.5,
        source: "estimated",
        category: "basic",
        requires_lift: false,
        special_notes: "Start with gas cap replacement. If code returns, test purge valve with vacuum pump and active scan tool test. Smoke test EVAP system if purge valve tests good."
      },
      tools: ["hand vacuum pump", "scan tool with Ford active test", "8mm socket", "EVAP smoke machine"],
      torque_specs: {
        "purge valve bolts": "5 ft-lb",
        "gas cap": "tighten until clicks"
      },
      verification: {
        before_repair: "Replace gas cap and clear code first. If code returns, test purge valve — should hold vacuum when de-energized, release when energized. Smoke test for hidden leaks.",
        after_repair: "Clear codes. Drive through EVAP monitor cycle (requires cold start, 1/4-3/4 tank, 40-95F ambient). Confirm no EVAP code return after 2 complete drive cycles."
      },
      diagrams_needed: ["EVAP system diagram Ford Escape 1.5L EcoBoost", "purge valve location Escape engine bay"]
    }
  }
];

// ---------------------------------------------------------------------------
// Database update logic
// ---------------------------------------------------------------------------

/**
 * Seed repair plans into existing diagnostic_knowledge rows.
 * Matches by dtc_code + vehicle_make + vehicle_model (and engine_type if present).
 * Updates the repair_plan jsonb column.
 *
 * @returns {{ updated: number, skipped: number, errors: number }}
 */
async function seedRepairPlans() {
  const db = getSupabase();
  let updated = 0;
  let skipped = 0;
  let errors = 0;

  console.log(`[ai-diagnostics] Seeding ${REPAIR_PLANS.length} repair plans...`);
  console.log("[ai-diagnostics] ========================================");

  for (const plan of REPAIR_PLANS) {
    const label = `${plan.dtc_code} / ${plan.vehicle_make} ${plan.vehicle_model} (${plan.engine_type || "any"})`;

    try {
      // Build query to find matching row(s)
      let query = db
        .from("diagnostic_knowledge")
        .select("id, dtc_code, vehicle_make, vehicle_model, engine_type")
        .eq("dtc_code", plan.dtc_code)
        .eq("vehicle_make", plan.vehicle_make)
        .eq("vehicle_model", plan.vehicle_model);

      // Filter by engine_type if specified
      if (plan.engine_type) {
        query = query.eq("engine_type", plan.engine_type);
      }

      const { data: matches, error: selectError } = await query;

      if (selectError) {
        console.error(`[ai-diagnostics]   ERROR querying ${label}: ${selectError.message}`);
        errors++;
        continue;
      }

      if (!matches || matches.length === 0) {
        console.log(`[ai-diagnostics]   SKIP ${label} — no matching row found`);
        skipped++;
        continue;
      }

      // Update all matching rows with the repair plan
      const ids = matches.map((m) => m.id);
      const { error: updateError } = await db
        .from("diagnostic_knowledge")
        .update({ repair_plan: plan.repair_plan })
        .in("id", ids);

      if (updateError) {
        console.error(`[ai-diagnostics]   ERROR updating ${label}: ${updateError.message}`);
        errors++;
        continue;
      }

      updated += matches.length;
      console.log(`[ai-diagnostics]   OK ${label} — updated ${matches.length} row(s)`);
    } catch (err) {
      console.error(`[ai-diagnostics]   ERROR ${label}: ${err.message}`);
      errors++;
    }
  }

  console.log("[ai-diagnostics] ========================================");
  console.log(`[ai-diagnostics] Repair plans complete: ${updated} rows updated, ${skipped} skipped, ${errors} errors`);
  return { updated, skipped, errors };
}

// ---------------------------------------------------------------------------
// CLI entry point
// ---------------------------------------------------------------------------

if (require.main === module) {
  seedRepairPlans()
    .then((result) => {
      console.log("[ai-diagnostics] Done.", result);
      process.exit(0);
    })
    .catch((err) => {
      console.error("[ai-diagnostics] Seed repair plans failed:", err);
      process.exit(1);
    });
}

module.exports = { seedRepairPlans };
