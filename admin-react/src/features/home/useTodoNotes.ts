import { useEffect, useRef, useState } from 'react';

export interface TodoNote {
  id: string;
  text: string;
}

const TODO_STORAGE_KEY = 'insta-grup-vlas-todo-v1';

function loadStored(): TodoNote[] {
  try {
    const saved = JSON.parse(localStorage.getItem(TODO_STORAGE_KEY) || '[]');
    return Array.isArray(saved) ? saved : [];
  } catch {
    return [];
  }
}

// Personal browser-only scratch space -- never touches Supabase, same as
// the vanilla version (see admin-core.js's own comment on this).
export function useTodoNotes() {
  const [notes, setNotes] = useState<TodoNote[]>(() => loadStored());
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const persist = (next: TodoNote[]) => {
    localStorage.setItem(TODO_STORAGE_KEY, JSON.stringify(next));
  };

  const addNote = (): string => {
    const note: TodoNote = { id: 'todo-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7), text: '' };
    if (saveTimer.current) clearTimeout(saveTimer.current);
    setNotes((prev) => {
      const next = [note, ...prev];
      persist(next);
      return next;
    });
    return note.id;
  };

  const updateNoteText = (id: string, text: string) => {
    setNotes((prev) => {
      const next = prev.map((n) => (n.id === id ? { ...n, text } : n));
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => persist(next), 400);
      return next;
    });
  };

  const deleteNote = (id: string) => {
    // Without clearing a pending debounced save here, deleting a note
    // within 400ms of editing it let that stale timer fire afterward and
    // persist its own (pre-delete) snapshot of `notes`, silently
    // resurrecting the just-deleted note in localStorage -- it reappeared
    // on the next reload despite React state correctly showing it gone
    // (CLICK-PATH-401).
    if (saveTimer.current) clearTimeout(saveTimer.current);
    setNotes((prev) => {
      const next = prev.filter((n) => n.id !== id);
      persist(next);
      return next;
    });
  };

  useEffect(() => () => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
  }, []);

  return { notes, addNote, updateNoteText, deleteNote };
}
