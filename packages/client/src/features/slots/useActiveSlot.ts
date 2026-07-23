import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { PuzzleSpec } from '@automationsolver/shared';
import { slotApi, type SolutionSlot } from '../../api/client';
import { useSaveSettings, useSettings, useSlots } from '../../api/queries';

/**
 * Resolves which save slot is "active" for a puzzle (remembered per-user in
 * user_settings.activeSlot, falling back to the most-recently-updated slot)
 * and loads its program.
 */
export function useActiveSlot(spec: PuzzleSpec) {
  const { data: settingsData } = useSettings();
  const saveSettings = useSaveSettings();
  const { data: slotsData, isLoading: slotsLoading } = useSlots(spec.slug);
  const qc = useQueryClient();

  const slots: SolutionSlot[] = slotsData?.slots ?? [];
  const activeSlotMap = (settingsData?.settings.activeSlot as Record<string, number> | undefined) ?? {};
  const remembered = activeSlotMap[spec.slug];
  const activeId = slots.find((s) => s.id === remembered)?.id ?? slots[0]?.id ?? null;

  const activeSlotQuery = useQuery({
    queryKey: ['slot', spec.slug, activeId],
    queryFn: () => slotApi.get(spec.slug, activeId!),
    enabled: activeId != null,
  });

  const setActive = (id: number) => {
    saveSettings.mutate(
      { ...settingsData?.settings, activeSlot: { ...activeSlotMap, [spec.slug]: id } },
      { onSuccess: () => void qc.invalidateQueries({ queryKey: ['slot', spec.slug, id] }) },
    );
  };

  return {
    slots,
    activeId,
    activeProgram: activeSlotQuery.data?.program ?? null,
    // Nothing to load once slots have loaded and there's no active id, or once the active slot's program has arrived.
    ready: !slotsLoading && (activeId == null || activeSlotQuery.isSuccess || activeSlotQuery.isError),
    setActive,
  };
}
