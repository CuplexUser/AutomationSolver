import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { LadderProgram } from '@automationsolver/shared';
import { puzzleApi, settingsApi } from './client';

export function usePuzzles() {
  return useQuery({ queryKey: ['puzzles'], queryFn: () => puzzleApi.list() });
}

export function usePuzzle(slug: string) {
  return useQuery({ queryKey: ['puzzle', slug], queryFn: () => puzzleApi.detail(slug) });
}

export function useSaveDraft(slug: string) {
  return useMutation({
    mutationFn: (program: LadderProgram) => puzzleApi.saveDraft(slug, program),
  });
}

export function useSubmit(slug: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (program: LadderProgram) => puzzleApi.submit(slug, program),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['puzzles'] });
      void qc.invalidateQueries({ queryKey: ['puzzle', slug] });
    },
  });
}

export function useSettings() {
  return useQuery({ queryKey: ['settings'], queryFn: () => settingsApi.get() });
}

export function useSaveSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (settings: Record<string, unknown>) => settingsApi.put(settings),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['settings'] }),
  });
}
