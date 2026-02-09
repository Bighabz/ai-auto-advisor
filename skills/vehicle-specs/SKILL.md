---
emoji: 📊
name: vehicle-specs
description: >
  Get detailed vehicle specifications for mechanics: sensor locations (bank 1/2,
  upstream/downstream), fluid capacities, torque specs, special tools, and
  exact YMME+trim for parts accuracy.
requires:
  bins:
    - node
  env:
    - ALLDATA_USERNAME
    - PRODEMAND_USERNAME
---

# Vehicle Specs — Mechanic Reference Data

Retrieves all the technical specs a mechanic needs for a repair job.

## When to Use

Use this skill when you need:
- Exact vehicle identification (Year/Make/Model/Engine/Trim/VIN breakdown)
- Sensor locations (O2 sensor bank 1 vs bank 2, upstream vs downstream)
- Fluid capacities (oil with filter, coolant, transmission, etc.)
- Torque specifications for the repair
- Special tools required
- Bolt sizes and thread pitches
- Wiring connector pinouts

## Output Data

### Vehicle Identification (Exact)
- Year, Make, Model, Trim Level
- Engine (displacement, cylinders, fuel type, engine code)
- Transmission type and code
- Drive type (FWD/RWD/AWD/4WD)
- Production plant and build date (from VIN)
- ACES ID (for parts catalog accuracy)

### Sensor Locations
- O2/A-F sensors: Bank 1 Sensor 1, Bank 1 Sensor 2, Bank 2 Sensor 1, Bank 2 Sensor 2
- Bank identification (which side is bank 1 vs bank 2 for this engine)
- Sensor access notes (from top, from bottom, remove heat shield, etc.)

### Fluid Specifications
- Engine oil: capacity with filter, capacity without filter, oil weight (e.g., 0W-20)
- Coolant: capacity, type (OAT, HOAT, IAT), color
- Transmission fluid: capacity, type (ATF, CVT fluid, manual trans), check procedure
- Brake fluid: type (DOT 3, DOT 4)
- Power steering fluid: type
- Differential fluid: front/rear capacity and type
- Transfer case fluid (if applicable)

### Torque Specifications
- Drain plug torque (oil pan, transmission)
- Wheel lug nut torque
- Spark plug torque
- Intake manifold bolts
- Exhaust manifold bolts
- Sensor torque values (O2 sensors, knock sensors, etc.)
- Brake caliper bracket bolts
- Suspension components

### Special Tools Required
- Specific socket sizes (e.g., 22mm O2 sensor socket)
- Specialty tools (serpentine belt tool, fuel line disconnect, etc.)
- Torx/E-Torx sizes
- Required adapters

## Example Output

```json
{
  "vehicle": {
    "year": 2019,
    "make": "Honda",
    "model": "Civic",
    "trim": "EX",
    "engine": "2.0L 4-Cylinder DOHC i-VTEC",
    "engineCode": "K20C2",
    "transmission": "CVT",
    "driveType": "FWD",
    "acesId": "12345678"
  },
  "sensorLocations": {
    "o2Sensors": {
      "bank1Sensor1": {
        "location": "Upstream (before catalytic converter)",
        "access": "From above, near exhaust manifold",
        "partNumber": "36531-5BA-A01"
      },
      "bank1Sensor2": {
        "location": "Downstream (after catalytic converter)",
        "access": "From below, behind cat",
        "partNumber": "36532-5BA-A01"
      }
    },
    "bankIdentification": "Inline 4-cylinder - Bank 1 only (no Bank 2)"
  },
  "fluids": {
    "engineOil": {
      "capacityWithFilter": "4.4 quarts",
      "capacityWithoutFilter": "4.0 quarts",
      "weight": "0W-20",
      "specification": "API SN or ILSAC GF-5"
    },
    "coolant": {
      "capacity": "6.4 quarts",
      "type": "Honda Type 2 (blue) or equivalent OAT"
    }
  },
  "torqueSpecs": {
    "oilDrainPlug": "29 ft-lb",
    "wheelLugNuts": "80 ft-lb",
    "o2Sensor": "33 ft-lb"
  },
  "specialTools": [
    "22mm O2 sensor socket (slotted for wire)",
    "Oil filter wrench (64mm)",
    "Torque wrench (ft-lb)"
  ]
}
```

## Notes

- Specs are extracted from AllData/ProDemand via browser automation
- Some specs may be cached locally for common vehicles
- Always verify torque specs against repair procedure — values can vary by application
