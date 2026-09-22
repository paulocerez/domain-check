import { forwardRef } from 'react';
import type { RegistrarKind } from '@domain-check/shared';
import { Badge } from '@/components/ui/primitives';
import { Tooltip } from '@/components/ui/tooltip';
import godaddyLogo from '@/assets/registrars/godaddy.png';
import ionosLogo from '@/assets/registrars/ionos.png';

/**
 * Brand marks are cropped copies of the assets the README uses, downscaled to
 * row height. Each keeps its own background colour and is drawn on a tile of
 * that colour: the wordmarks are supplied on an opaque field, and recolouring
 * someone else's logo per theme is worse than framing it.
 */
const BRANDS: Partial<Record<RegistrarKind, { src: string; background: string }>> = {
  ionos: { src: ionosLogo, background: '#12468f' },
  godaddy: { src: godaddyLogo, background: '#ffffff' },
};

/**
 * Which registrar account a domain came from, at table density.
 *
 * Unknown kinds — `mock`, or a newly added adapter whose asset is not in yet —
 * fall back to the label as a badge rather than a broken image.
 */
export function RegistrarLogo({ kind, label }: { kind: RegistrarKind; label: string }) {
  const brand = BRANDS[kind];
  return (
    <Tooltip content={label}>
      {brand ? <Tile src={brand.src} background={brand.background} label={label} /> : <Badge variant="outline">{label}</Badge>}
    </Tooltip>
  );
}

// forwardRef because the Tooltip trigger is `asChild`; a plain function
// component drops the ref and the tooltip never opens.
const Tile = forwardRef<HTMLSpanElement, { src: string; background: string; label: string }>(
  function Tile({ src, background, label }, ref) {
    return (
      <span
        ref={ref}
        style={{ background }}
        className="inline-flex h-4 w-12 items-center justify-center overflow-hidden rounded-sm ring-1 ring-border"
      >
        <img src={src} alt={label} className="size-full object-contain p-px" />
      </span>
    );
  },
);
