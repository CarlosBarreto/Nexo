import { AgentGalleryCard } from "./agent-gallery-card";
import {
  type AgentGalleryLabels,
  type GalleryElement,
  mergeGalleryLabels,
} from "./agent-gallery-labels";

/**
 * The Bestiario: a visual gallery of the workspace's agents — identity card
 * per agent (avatar, soul element, birth date, description). Props-only per
 * the library boundary: the app resolves colors, formats dates, and passes
 * t() labels in; an agent whose soul is not forged yet renders the
 * "unforged" state deliberately (the legacy engine never forges souls).
 */

export interface AgentGalleryItem {
  id: string;
  name: string;
  /** Pre-resolved avatar hex (the app runs resolveAgentColor). */
  color?: string;
  description?: string;
  /** null/undefined = soul not forged yet. */
  element?: GalleryElement | null;
  /** Pre-formatted birth date (the app owns locale formatting). */
  bornLabel?: string | null;
}

export interface AgentGalleryProps {
  items: AgentGalleryItem[];
  onSelect?: (id: string) => void;
  labels?: AgentGalleryLabels;
  emptyTitle?: string;
  emptyDescription?: string;
}

export function AgentGallery({
  items,
  onSelect,
  labels,
  emptyTitle = "No agents yet",
  emptyDescription = "Create an agent and it will appear here.",
}: AgentGalleryProps) {
  const l = mergeGalleryLabels(labels);

  if (items.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <p className="text-sm font-medium text-foreground">{emptyTitle}</p>
        <p className="text-xs text-muted-foreground mt-1">{emptyDescription}</p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
      {items.map((item) => (
        <AgentGalleryCard
          key={item.id}
          item={item}
          labels={l}
          onSelect={onSelect}
        />
      ))}
    </div>
  );
}
