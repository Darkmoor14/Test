import { useTickets } from './TicketsContext';
import type { Ticket } from './types';

declare global {
  interface Window { showToast?: (message: string) => void; }
}
function showToast(message: string) {
  if (typeof window.showToast === 'function') window.showToast(message);
}

function ticketShareText(t: Ticket): string {
  const isUrgent = t.type === 'Anunt accident';
  const lines = [
    `Sesizare ${t.ticket_number || '—'} (${isUrgent ? 'Accident' : 'Defect'})`,
    `Adresă: ${t.address || '—'}`,
    `Telefon: ${t.phone || '—'}`,
  ];
  if (t.description) lines.push(`Descriere: ${t.description}`);
  if (t.status === 'Terminat' && t.resolution_note) lines.push(`Ce s-a făcut: ${t.resolution_note}`);
  return lines.join('\n');
}

// Returns whether the data actually left this device (shared or copied) --
// the caller uses this to decide whether to clear the selection that led
// here. Cancelling the native share sheet shared nothing, so the selection
// a user might want to share again, or add to, should survive (CLICK-PATH-103).
async function shareText(title: string, text: string, itemLabel: string): Promise<boolean> {
  if (navigator.share) {
    try {
      await navigator.share({ title, text });
      return true;
    } catch (err) {
      if ((err as Error).name !== 'AbortError') console.error(err);
      return false;
    }
  }
  try {
    await navigator.clipboard.writeText(text);
    showToast(`Datele ${itemLabel} au fost copiate.`);
    return true;
  } catch (err) {
    console.error(err);
    alert(`Nu am putut partaja sau copia datele ${itemLabel}.`);
    return false;
  }
}

export function useShareTickets() {
  const store = useTickets();
  const shareSelected = async () => {
    const selected = Array.from(store.overviewShareSelectedIds).map((id) => store.tickets.find((t) => t.id === id)).filter(Boolean) as Ticket[];
    if (selected.length === 0) return;
    let didShare: boolean;
    if (selected.length === 1) {
      didShare = await shareText(`Sesizare ${selected[0].ticket_number || ''}`, ticketShareText(selected[0]), 'acestei sesizări');
    } else {
      const text = selected.map(ticketShareText).join('\n\n---\n\n');
      didShare = await shareText(`${selected.length} sesizări`, text, 'sesizărilor');
    }
    if (didShare) store.clearShareSelection();
  };
  return { shareSelected };
}
