/**
 * Estimate PDF Generator
 *
 * Creates professional PDF estimates using PDFKit.
 * Install: npm install pdfkit
 */

const fs = require("fs");
const path = require("path");

// Lazy load PDFKit (installed via skill install command)
let PDFDocument;
try {
  PDFDocument = require("pdfkit");
} catch {
  console.warn("[estimate-pdf] PDFKit not installed. Run: npm install pdfkit");
}

/**
 * Generate a professional PDF estimate
 *
 * @param {object} params
 * @param {object} params.shop - Shop info from config
 * @param {object} params.customer - Customer name, phone, email
 * @param {object} params.vehicle - Year, make, model, trim, VIN, mileage
 * @param {string} params.diagnosis - Problem summary and recommended repair
 * @param {Array} params.laborLines - [{description, hours, rate, total}]
 * @param {Array} params.partLines - [{description, partNumber, qty, unitPrice, total, supplier}]
 * @param {object} params.partsOptions - {oem: {...}, aftermarket: {...}} for customer choice
 * @param {object} params.totals - {labor, parts, supplies, tax, total}
 * @param {object} params.mechanicSpecs - Sensor locations, fluids, torque, tools (internal use)
 * @param {string} params.outputPath - Where to save the PDF
 * @returns {string} Path to generated PDF
 */
async function generateEstimatePDF(params) {
  const {
    shop,
    customer,
    vehicle,
    diagnosis,
    laborLines = [],
    partLines = [],
    partsOptions,
    totals,
    mechanicSpecs,
    outputPath,
  } = params;

  if (!PDFDocument) {
    throw new Error("PDFKit not installed. Run: npm install pdfkit");
  }

  const estimateNumber = `EST-${Date.now().toString(36).toUpperCase()}`;
  const estimateDate = new Date().toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  // Create PDF document
  const doc = new PDFDocument({
    size: "LETTER",
    margins: { top: 50, bottom: 50, left: 50, right: 50 },
  });

  // Pipe to file
  const filePath = outputPath || path.join(require("os").tmpdir(), `estimate-${estimateNumber}.pdf`);
  const stream = fs.createWriteStream(filePath);
  doc.pipe(stream);

  // ═══════════════════════════════════════════════════════════════════
  // HEADER — Shop Info
  // ═══════════════════════════════════════════════════════════════════
  doc
    .fontSize(20)
    .font("Helvetica-Bold")
    .text(shop?.name || "Auto Repair Shop", { align: "center" });

  doc
    .fontSize(10)
    .font("Helvetica")
    .text(shop?.address || "", { align: "center" })
    .text(`Phone: ${shop?.phone || ""} | Email: ${shop?.email || ""}`, { align: "center" });

  doc.moveDown(0.5);
  doc.moveTo(50, doc.y).lineTo(562, doc.y).stroke();
  doc.moveDown(0.5);

  // Estimate number and date
  doc
    .fontSize(12)
    .font("Helvetica-Bold")
    .text(`ESTIMATE #${estimateNumber}`, { continued: true })
    .font("Helvetica")
    .text(`   Date: ${estimateDate}`, { align: "right" });

  doc.moveDown(1);

  // ═══════════════════════════════════════════════════════════════════
  // CUSTOMER & VEHICLE INFO
  // ═══════════════════════════════════════════════════════════════════
  doc.fontSize(11).font("Helvetica-Bold").text("CUSTOMER");
  doc.font("Helvetica").text(`${customer?.name || "N/A"}`);
  doc.text(`Phone: ${customer?.phone || "N/A"}`);
  if (customer?.email) doc.text(`Email: ${customer.email}`);

  doc.moveDown(0.5);

  doc.font("Helvetica-Bold").text("VEHICLE");
  doc.font("Helvetica");
  doc.text(
    `${vehicle?.year || ""} ${vehicle?.make || ""} ${vehicle?.model || ""} ${vehicle?.trim || ""}`.trim()
  );
  doc.text(`Engine: ${vehicle?.engine || "N/A"}`);
  doc.text(`VIN: ${vehicle?.vin || "N/A"}`);
  doc.text(`Mileage: ${vehicle?.mileage ? vehicle.mileage.toLocaleString() + " mi" : "N/A"}`);

  doc.moveDown(1);

  // ═══════════════════════════════════════════════════════════════════
  // DIAGNOSIS SUMMARY
  // ═══════════════════════════════════════════════════════════════════
  if (diagnosis) {
    doc.font("Helvetica-Bold").text("DIAGNOSIS & RECOMMENDATION");
    doc.font("Helvetica").text(diagnosis, { width: 500 });
    doc.moveDown(1);
  }

  // ═══════════════════════════════════════════════════════════════════
  // ITEMIZED ESTIMATE — TABLE
  // ═══════════════════════════════════════════════════════════════════
  doc.font("Helvetica-Bold").text("ITEMIZED ESTIMATE");
  doc.moveDown(0.5);

  // Table header
  const tableTop = doc.y;
  const col1 = 50; // Description
  const col2 = 300; // Qty/Hours
  const col3 = 370; // Unit Price
  const col4 = 450; // Total
  const colEnd = 562;

  doc.rect(col1, tableTop, colEnd - col1, 18).fill("#f0f0f0");
  doc
    .fill("#000")
    .fontSize(9)
    .font("Helvetica-Bold")
    .text("Description", col1 + 5, tableTop + 4)
    .text("Qty", col2 + 5, tableTop + 4)
    .text("Unit Price", col3 + 5, tableTop + 4)
    .text("Total", col4 + 5, tableTop + 4);

  let rowY = tableTop + 20;
  doc.font("Helvetica").fontSize(9);

  // Labor lines
  if (laborLines.length > 0) {
    doc.font("Helvetica-Bold").text("LABOR", col1 + 5, rowY);
    rowY += 14;

    for (const line of laborLines) {
      doc.font("Helvetica");
      doc.text(line.description || "", col1 + 10, rowY, { width: 240 });
      doc.text(`${line.hours || 0} hrs`, col2 + 5, rowY);
      doc.text(`$${parseFloat(line.rate || 0).toFixed(2)}/hr`, col3 + 5, rowY);
      doc.text(`$${parseFloat(line.total || 0).toFixed(2)}`, col4 + 5, rowY);
      rowY += 14;
    }
  }

  // Parts lines
  if (partLines.length > 0) {
    rowY += 5;
    doc.font("Helvetica-Bold").text("PARTS", col1 + 5, rowY);
    rowY += 14;

    for (const line of partLines) {
      doc.font("Helvetica");
      const desc = line.partNumber
        ? `${line.description} (${line.partNumber})`
        : line.description || "";
      doc.text(desc, col1 + 10, rowY, { width: 240 });
      doc.text(`${line.qty || 1}`, col2 + 5, rowY);
      doc.text(`$${parseFloat(line.unitPrice || 0).toFixed(2)}`, col3 + 5, rowY);
      doc.text(`$${parseFloat(line.total || 0).toFixed(2)}`, col4 + 5, rowY);

      if (line.supplier) {
        rowY += 11;
        doc.fontSize(8).fillColor("#666").text(`  Supplier: ${line.supplier}`, col1 + 10, rowY);
        doc.fillColor("#000").fontSize(9);
      }
      rowY += 14;
    }
  }

  // ═══════════════════════════════════════════════════════════════════
  // PARTS OPTIONS (OEM vs Aftermarket)
  // ═══════════════════════════════════════════════════════════════════
  if (partsOptions?.oem || partsOptions?.aftermarket) {
    rowY += 10;
    doc.font("Helvetica-Bold").fontSize(10).text("PARTS OPTIONS", col1, rowY);
    rowY += 14;
    doc.font("Helvetica").fontSize(9);

    if (partsOptions.oem) {
      doc.text(
        `☐ OEM (${partsOptions.oem.brand}): $${parseFloat(partsOptions.oem.price || 0).toFixed(2)}`,
        col1 + 10,
        rowY
      );
      rowY += 12;
    }
    if (partsOptions.aftermarket) {
      doc.text(
        `☐ Aftermarket (${partsOptions.aftermarket.brand}): $${parseFloat(
          partsOptions.aftermarket.price || 0
        ).toFixed(2)}`,
        col1 + 10,
        rowY
      );
      rowY += 12;
    }
  }

  // ═══════════════════════════════════════════════════════════════════
  // TOTALS
  // ═══════════════════════════════════════════════════════════════════
  rowY += 10;
  doc.moveTo(col3, rowY).lineTo(colEnd, rowY).stroke();
  rowY += 5;

  const printTotal = (label, value, bold = false) => {
    if (bold) doc.font("Helvetica-Bold");
    else doc.font("Helvetica");
    doc.text(label, col3, rowY);
    doc.text(`$${parseFloat(value || 0).toFixed(2)}`, col4 + 5, rowY);
    rowY += 14;
  };

  printTotal("Labor:", totals?.labor || 0);
  printTotal("Parts:", totals?.parts || 0);
  printTotal("Shop Supplies:", totals?.supplies || 0);
  printTotal("Tax:", totals?.tax || 0);

  doc.moveTo(col3, rowY).lineTo(colEnd, rowY).stroke();
  rowY += 5;

  doc.fontSize(12);
  printTotal("TOTAL:", totals?.total || 0, true);

  // ═══════════════════════════════════════════════════════════════════
  // MECHANIC REFERENCE (Page 2 - Internal Use)
  // ═══════════════════════════════════════════════════════════════════
  if (mechanicSpecs) {
    doc.addPage();

    doc
      .fontSize(14)
      .font("Helvetica-Bold")
      .text("MECHANIC REFERENCE — INTERNAL USE ONLY", { align: "center" });

    doc.moveDown(1);
    doc.fontSize(10).font("Helvetica-Bold").text("VEHICLE");
    doc.font("Helvetica");
    doc.text(
      `${vehicle?.year} ${vehicle?.make} ${vehicle?.model} ${vehicle?.trim || ""} — ${vehicle?.engine || ""}`
    );
    doc.text(`VIN: ${vehicle?.vin || "N/A"}`);

    if (mechanicSpecs.sensorLocations) {
      doc.moveDown(1);
      doc.font("Helvetica-Bold").text("SENSOR LOCATIONS");
      doc.font("Helvetica");
      doc.text(mechanicSpecs.sensorLocations.bankIdentification || "");
      const sensors = mechanicSpecs.sensorLocations.sensors || {};
      for (const [key, sensor] of Object.entries(sensors)) {
        if (typeof sensor === "object") {
          doc.text(`• ${sensor.name || key}: ${sensor.location || ""}`);
          if (sensor.access) doc.text(`    Access: ${sensor.access}`);
        }
      }
    }

    if (mechanicSpecs.fluids) {
      doc.moveDown(1);
      doc.font("Helvetica-Bold").text("FLUID SPECIFICATIONS");
      doc.font("Helvetica");
      const oil = mechanicSpecs.fluids.engineOil || {};
      doc.text(`• Engine Oil: ${oil.capacityWithFilter || "?"} — ${oil.weight || "?"}`);
      const coolant = mechanicSpecs.fluids.coolant || {};
      doc.text(`• Coolant: ${coolant.capacity || "?"} — ${coolant.type || "?"}`);
      const trans = mechanicSpecs.fluids.transmission || {};
      doc.text(`• Transmission: ${trans.type || "?"}`);
    }

    if (mechanicSpecs.torqueSpecs) {
      doc.moveDown(1);
      doc.font("Helvetica-Bold").text("TORQUE SPECIFICATIONS");
      doc.font("Helvetica");
      const torque = mechanicSpecs.torqueSpecs;
      if (torque.oilDrainPlug?.value) doc.text(`• Oil Drain Plug: ${torque.oilDrainPlug.value}`);
      if (torque.o2Sensor?.value) doc.text(`• O2 Sensor: ${torque.o2Sensor.value}`);
      if (torque.wheelLugNuts?.value) doc.text(`• Wheel Lug Nuts: ${torque.wheelLugNuts.value}`);
      if (torque.sparkPlugs?.value) doc.text(`• Spark Plugs: ${torque.sparkPlugs.value}`);
    }

    if (mechanicSpecs.specialTools?.length > 0) {
      doc.moveDown(1);
      doc.font("Helvetica-Bold").text("SPECIAL TOOLS REQUIRED");
      doc.font("Helvetica");
      for (const tool of mechanicSpecs.specialTools) {
        doc.text(`• ${tool}`);
      }
    }
  }

  // ═══════════════════════════════════════════════════════════════════
  // FOOTER — Warranty, Disclaimers, Signature
  // ═══════════════════════════════════════════════════════════════════
  // Go back to page 1 for footer
  doc.switchToPage(0);

  const footerY = 680;
  doc.moveTo(50, footerY).lineTo(562, footerY).stroke();

  doc.fontSize(8).font("Helvetica");

  const warranty = shop?.warranty || "12 months / 12,000 miles on parts and labor";
  doc.text(`Warranty: ${warranty}`, 50, footerY + 10);

  const payment = shop?.paymentTerms || "Payment due upon completion of service";
  doc.text(`Payment: ${payment}`, 50, footerY + 22);

  if (shop?.disclaimers?.length > 0) {
    doc.text(shop.disclaimers.join(" "), 50, footerY + 34, { width: 400 });
  }

  // Signature line
  doc.text("Customer Authorization: _______________________________   Date: ____________", 50, footerY + 60);

  // Finalize PDF
  doc.end();

  // Wait for stream to finish
  await new Promise((resolve, reject) => {
    stream.on("finish", resolve);
    stream.on("error", reject);
  });

  console.log(`[estimate-pdf] Generated: ${filePath}`);
  return filePath;
}

module.exports = { generateEstimatePDF };
