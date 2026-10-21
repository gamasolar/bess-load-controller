import * as Primitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import type { ReactNode } from "react";

/** Gaveta sobre Radix Dialog: foco preso, Escape, título acessível e foco devolvido ao fechar. */
export function Sheet({
  open,
  onOpenChange,
  title,
  description,
  children,
  compact = false,
  portalContainer,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  children: ReactNode;
  compact?: boolean;
  portalContainer?: HTMLElement | null;
}) {
  return (
    <Primitive.Root open={open} onOpenChange={onOpenChange}>
      <Primitive.Portal container={portalContainer}>
        <div className="cams cams-portal">
          <Primitive.Overlay className="sheet-overlay" />
          <Primitive.Content className={"sheet " + (compact ? "sheet-compact" : "")}>
            <header className="sheet-header">
              <div>
                <Primitive.Title>{title}</Primitive.Title>
                <Primitive.Description>{description}</Primitive.Description>
              </div>
              <Primitive.Close className="icon-button" aria-label="Fechar janela">
                <X size={20} />
              </Primitive.Close>
            </header>
            <div className="sheet-content">{children}</div>
          </Primitive.Content>
        </div>
      </Primitive.Portal>
    </Primitive.Root>
  );
}
