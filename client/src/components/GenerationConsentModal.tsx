import { useMemo, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";

interface GenerationConsentModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAccept: () => Promise<void> | void;
  loading?: boolean;
}

export function GenerationConsentModal({
  open,
  onOpenChange,
  onAccept,
  loading = false,
}: GenerationConsentModalProps) {
  const [checked, setChecked] = useState(false);

  const disabled = useMemo(() => !checked || loading, [checked, loading]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Generation Terms Consent</DialogTitle>
          <DialogDescription>
            Before your first generation, you must accept these terms.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2 text-sm text-muted-foreground">
          <p>1. You are responsible for prompts and uploaded content.</p>
          <p>2. You will not generate illegal, abusive, or infringing content.</p>
          <p>3. Generated outputs may include platform safety processing.</p>
        </div>

        <label className="mt-4 flex items-center gap-2 text-sm">
          <Checkbox checked={checked} onCheckedChange={(v) => setChecked(Boolean(v))} />
          <span>I have read and agree to the generation terms.</span>
        </label>

        <DialogFooter>
          <Button variant="secondary" onClick={() => onOpenChange(false)} disabled={loading}>
            Cancel
          </Button>
          <Button
            onClick={async () => {
              await onAccept();
              setChecked(false);
            }}
            disabled={disabled}
          >
            {loading ? "Saving..." : "Agree and Continue"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
