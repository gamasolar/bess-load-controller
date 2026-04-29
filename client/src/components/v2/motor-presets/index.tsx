// Dispatcher — escolhe o preset certo baseado no `cardCustomization.motorPreset` do site.
// Todos os presets compartilham a mesma interface (MotorPresetProps).
import { MotorImpeller } from "./MotorImpeller";
import { MotorSparkline } from "./MotorSparkline";
import { MotorGauge } from "./MotorGauge";
import { MotorPID } from "./MotorPID";
import { DEFAULT_MOTOR_PRESET, type MotorPreset, type MotorPresetProps } from "./shared";

export { MotorImpeller, MotorSparkline, MotorGauge, MotorPID };
export type { MotorPreset, MotorPresetProps };
export { DEFAULT_MOTOR_PRESET, colorsFor, captionFor } from "./shared";

export const MOTOR_PRESET_OPTIONS: { key: MotorPreset; label: string; description: string }[] = [
  { key: "C", label: "Sparkline", description: "Mini gráfico das últimas leituras — vê tendência da carga." },
  { key: "E", label: "Impeller", description: "Vista frontal do impulsor da bomba centrífuga, rotor girando." },
  { key: "G", label: "Gauge moderno", description: "Mostrador analógico premium com gradiente, halo e glass." },
  { key: "I", label: "P&ID", description: "Esquema técnico de engenharia: reservatório → bomba → rede com fluxo." },
];

export function MotorPresetView({
  preset,
  ...props
}: { preset?: MotorPreset | string | null } & MotorPresetProps) {
  const p: MotorPreset =
    preset === "C" || preset === "E" || preset === "G" || preset === "I"
      ? preset
      : DEFAULT_MOTOR_PRESET;
  switch (p) {
    case "C": return <MotorSparkline {...props} />;
    case "E": return <MotorImpeller {...props} />;
    case "G": return <MotorGauge {...props} />;
    case "I": return <MotorPID {...props} />;
  }
}
