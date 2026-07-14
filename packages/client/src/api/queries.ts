import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { puzzleApi, settingsApi, slotApi, type PuzzleProgram } from './client';

export function usePuzzles() {
  return useQuery({ queryKey: ['puzzles'], queryFn: () => puzzleApi.list() });
}

export function usePuzzle(slug: string) {
  return useQuery({ queryKey: ['puzzle', slug], queryFn: () => puzzleApi.detail(slug) });
}

export function useSubmit(slug: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (program: PuzzleProgram) => puzzleApi.submit(slug, program),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['puzzles'] });
      void qc.invalidateQueries({ queryKey: ['puzzle', slug] });
      void qc.invalidateQueries({ queryKey: ['slots', slug] });
    },
  });
}

export function useSlots(slug: string) {
  return useQuery({ queryKey: ['slots', slug], queryFn: () => slotApi.list(slug) });
}

export function useCreateSlot(slug: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ program, name }: { program: PuzzleProgram; name?: string }) =>
      slotApi.create(slug, program, name),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['slots', slug] }),
  });
}

export function useUpdateSlot(slug: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...patch }: { id: number; name?: string; program?: PuzzleProgram }) =>
      slotApi.update(slug, id, patch),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['slots', slug] }),
  });
}

export function useDeleteSlot(slug: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => slotApi.remove(slug, id),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['slots', slug] }),
  });
}

export function useSettings() {
  return useQuery({ queryKey: ['settings'], queryFn: () => settingsApi.get() });
}

export function useSaveSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (settings: Record<string, unknown>) => settingsApi.put(settings),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['settings'] });
      // devUnlockAll changes puzzle lock state, which the server computes into these.
      void qc.invalidateQueries({ queryKey: ['puzzles'] });
      void qc.invalidateQueries({ queryKey: ['puzzle'] });
    },
  });
}
