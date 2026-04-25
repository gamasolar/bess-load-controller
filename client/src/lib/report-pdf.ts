import jsPDF from "jspdf";

interface ReportData {
  reportType: string;
  periodStart: Date | string;
  periodEnd: Date | string;
  avgSoc: number;
  minSoc: number;
  maxSoc: number;
  avgPvPower: number | null;
  maxPvPower: number | null;
  avgLoadPower: number | null;
  maxLoadPower: number | null;
  avgBatteryPower: number | null;
  avgTemperature: number | null;
  maxTemperature: number | null;
  totalReadings: number;
  loadOnMinutes: number;
  estimatedEnergyKwh: number;
  totalEvents: number;
  totalAlarms: number;
  maneuverCount: number;
  notificationSent: boolean;
  createdAt: Date | string;
}

function fmtDate(d: Date | string): string {
  const dt = typeof d === "string" ? new Date(d) : d;
  return dt.toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function fmtShortDate(d: Date | string): string {
  const dt = typeof d === "string" ? new Date(d) : d;
  return dt.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
}

function fmtDuration(minutes: number): string {
  if (minutes < 60) return `${minutes}min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m > 0 ? `${h}h ${m}min` : `${h}h`;
}

export function exportReportPDF(report: ReportData, siteName: string): void {
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  const pageWidth = doc.internal.pageSize.getWidth();
  const margin = 20;
  const contentWidth = pageWidth - margin * 2;
  let y = margin;

  // ── Header ──
  doc.setFillColor(15, 23, 42); // slate-900
  doc.rect(0, 0, pageWidth, 40, "F");

  doc.setTextColor(34, 197, 94); // green-500
  doc.setFontSize(18);
  doc.setFont("helvetica", "bold");
  doc.text("BESS Controller", margin, 18);

  doc.setTextColor(148, 163, 184); // slate-400
  doc.setFontSize(10);
  doc.setFont("helvetica", "normal");
  doc.text("Relatório de Performance", margin, 26);

  const typeLabel = report.reportType === "daily" ? "DIÁRIO" : "SEMANAL";
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(11);
  doc.setFont("helvetica", "bold");
  doc.text(
    `${typeLabel} — ${fmtShortDate(report.periodStart)} a ${fmtShortDate(report.periodEnd)}`,
    margin,
    34
  );

  y = 50;

  // ── Site Info ──
  doc.setTextColor(30, 41, 59);
  doc.setFontSize(14);
  doc.setFont("helvetica", "bold");
  doc.text(siteName, margin, y);
  y += 6;

  doc.setFontSize(9);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(100, 116, 139);
  doc.text(`Gerado em: ${fmtDate(report.createdAt)}`, margin, y);
  y += 10;

  // ── Separator ──
  doc.setDrawColor(226, 232, 240);
  doc.setLineWidth(0.5);
  doc.line(margin, y, pageWidth - margin, y);
  y += 8;

  // ── Helper: draw metric row ──
  function drawMetricRow(label: string, value: string, detail?: string) {
    doc.setFontSize(10);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(30, 41, 59);
    doc.text(label, margin, y);

    doc.setFont("helvetica", "normal");
    doc.setTextColor(15, 23, 42);
    doc.text(value, margin + 70, y);

    if (detail) {
      doc.setFontSize(8);
      doc.setTextColor(100, 116, 139);
      doc.text(detail, margin + 70, y + 4);
      y += 10;
    } else {
      y += 7;
    }
  }

  // ── Section: Estado de Carga ──
  doc.setFontSize(12);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(34, 197, 94);
  doc.text("Estado de Carga (SOC)", margin, y);
  y += 8;

  drawMetricRow("SOC Médio", `${report.avgSoc.toFixed(2)}%`);
  drawMetricRow("SOC Mínimo", `${report.minSoc.toFixed(2)}%`);
  drawMetricRow("SOC Máximo", `${report.maxSoc.toFixed(2)}%`);
  y += 4;

  // ── Section: Potência ──
  doc.setFontSize(12);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(234, 179, 8); // yellow-500
  doc.text("Potência", margin, y);
  y += 8;

  if (report.avgPvPower != null) {
    drawMetricRow(
      "Geração FV Média",
      `${report.avgPvPower.toFixed(2)} kW`,
      report.maxPvPower != null ? `Pico: ${report.maxPvPower.toFixed(2)} kW` : undefined
    );
  }
  if (report.avgLoadPower != null) {
    drawMetricRow(
      "Consumo Médio",
      `${report.avgLoadPower.toFixed(2)} kW`,
      report.maxLoadPower != null ? `Pico: ${report.maxLoadPower.toFixed(2)} kW` : undefined
    );
  }
  if (report.avgBatteryPower != null) {
    drawMetricRow("Potência Bateria Média", `${report.avgBatteryPower.toFixed(2)} kW`);
  }
  y += 4;

  // ── Section: Temperatura ──
  if (report.avgTemperature != null) {
    doc.setFontSize(12);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(239, 68, 68); // red-500
    doc.text("Temperatura", margin, y);
    y += 8;

    drawMetricRow(
      "Temperatura Média",
      `${report.avgTemperature.toFixed(2)} °C`,
      report.maxTemperature != null ? `Máxima: ${report.maxTemperature.toFixed(2)} °C` : undefined
    );
    y += 4;
  }

  // ── Section: Operação ──
  doc.setFontSize(12);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(59, 130, 246); // blue-500
  doc.text("Operação", margin, y);
  y += 8;

  drawMetricRow("Tempo de Operação", fmtDuration(report.loadOnMinutes));
  drawMetricRow("Energia Estimada", `${report.estimatedEnergyKwh.toFixed(2)} kWh`);
  drawMetricRow("Total de Leituras", `${report.totalReadings}`);
  y += 4;

  // ── Section: Eventos ──
  doc.setFontSize(12);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(168, 85, 247); // purple-500
  doc.text("Eventos e Alarmes", margin, y);
  y += 8;

  drawMetricRow("Total de Eventos", `${report.totalEvents}`);
  drawMetricRow("Total de Alarmes", `${report.totalAlarms}`);
  drawMetricRow("Manobras", `${report.maneuverCount}`);
  y += 4;

  // ── Footer separator ──
  doc.setDrawColor(226, 232, 240);
  doc.setLineWidth(0.5);
  doc.line(margin, y, pageWidth - margin, y);
  y += 6;

  doc.setFontSize(8);
  doc.setFont("helvetica", "italic");
  doc.setTextColor(148, 163, 184);
  doc.text("BESS Controller Dashboard — Gamasolar", margin, y);
  doc.text(
    `Notificação: ${report.notificationSent ? "Enviada" : "Não enviada"}`,
    pageWidth - margin,
    y,
    { align: "right" }
  );

  // ── Download ──
  const fileName = `relatorio_${report.reportType}_${fmtShortDate(report.periodStart).replace(/\//g, "-")}_${fmtShortDate(report.periodEnd).replace(/\//g, "-")}_${siteName.replace(/\s+/g, "_")}.pdf`;
  doc.save(fileName);
}
